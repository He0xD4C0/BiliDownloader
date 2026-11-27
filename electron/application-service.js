'use strict'

const { app, safeStorage } = require('electron')
const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { setTimeout: delay } = require('timers/promises')
const ffmpegStaticPath = require('ffmpeg-static')

const QUEUED_OR_ACTIVE = new Set(['pending', 'downloading', 'merging'])
const TASK_ACTIONS = {
  pause: { status: 'paused', from: QUEUED_OR_ACTIVE, message: '下载已暂停' },
  resume: { status: 'pending', from: new Set(['paused', 'failed']), message: '任务已加入下载队列' },
  restart: { status: 'pending', from: new Set(['paused', 'failed']), message: '已加入重新下载队列' },
  cancel: { status: 'cancelled', from: new Set([...QUEUED_OR_ACTIVE, 'paused', 'failed']), message: '下载已取消' }
}
const RESET_DOWNLOAD = {
  progress: 0, downloaded_size: 0, file_size: null, started_at: null, completed_at: null,
  error_message: null, error_trace: null, actual_quality: null
}

const RESTART_REQUIRED = '无法从上次进度继续，需要重新下载'
const RESUME_OVERLAP_LIMIT = 64 * 1024
const COPY_FALLBACK_ERRORS = new Set(['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'])

class RestartRequiredError extends Error {
  constructor() {
    super(RESTART_REQUIRED)
  }
}

function responseValidator(headers) {
  const etag = headers.get('etag')
  if (etag) return /^"[^"\s]*"$/.test(etag) ? { header: 'etag', value: etag } : null
  const modified = headers.get('last-modified')
  const age = Date.parse(headers.get('date')) - Date.parse(modified)
  // Allow for origin and cache clock skew when treating Last-Modified as strong.
  return age >= 60000 ? { header: 'last-modified', value: modified } : null
}

function contentLength(value) {
  if (!/^\d+$/.test(value)) return null
  const length = Number(value)
  return Number.isSafeInteger(length) && length > 0 ? length : null
}

function responseRange(headers) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get('content-range'))
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  const total = contentLength(match[3])
  return total !== null && start <= end && end < total ? { start, end, total } : null
}

function partSize(filename) {
  try {
    const stat = fs.statSync(filename)
    return stat.isFile() ? stat.size : 0
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return 0
  }
}

function trackIdentity(task, kind, stream, quality) {
  return JSON.stringify([task.cid, kind, stream?.id ?? quality, stream?.codecid, stream?.codecs])
}

function downloadSources(stream, checkpoint) {
  const primary = stream?.baseUrl || stream?.base_url || stream?.url
  if (!primary) return []
  const backups = stream.backupUrl || stream.backup_url
  if (!Array.isArray(backups) || !backups.length) return [primary]
  const urls = [primary]
  const pathname = new URL(primary).pathname
  for (const candidate of backups) {
    try {
      const url = new URL(candidate)
      if (['http:', 'https:'].includes(url.protocol) && url.pathname === pathname && !urls.includes(candidate)) urls.push(candidate)
    } catch {}
  }
  if (checkpoint) {
    const same = urls.findIndex(candidate => {
      const url = new URL(candidate)
      return url.origin === checkpoint.origin && url.pathname === checkpoint.pathname
    })
    if (same > 0) urls.unshift(...urls.splice(same, 1))
  }
  return urls.slice(0, 4)
}

const BILIBILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com',
  Origin: 'https://www.bilibili.com'
}

const MEDIA_HEADERS = { ...BILIBILI_HEADERS, 'Accept-Encoding': 'identity' }

const QUALITY_NAMES = {
  6: ['240P', '极速', 426, 240],
  16: ['360P', '流畅', 640, 360],
  32: ['480P', '清晰', 854, 480],
  64: ['720P', '高清', 1280, 720],
  74: ['720P60', '高清60帧', 1280, 720],
  80: ['1080P', '高清', 1920, 1080],
  112: ['1080P+', '高清高码率', 1920, 1080],
  116: ['1080P60', '高清60帧', 1920, 1080],
  120: ['4K', '超清', 3840, 2160],
  125: ['HDR', '真彩', 3840, 2160],
  126: ['杜比视界', '杜比', 3840, 2160],
  127: ['8K', '超高清', 7680, 4320]
}

const DEFAULT_QUALITY_CODES = { '360p': 16, '480p': 32, '720p': 64, '1080p': 80, '4k': 120 }

function qualityName(quality) {
  return QUALITY_NAMES[Number(quality)]?.[0] ||
    (typeof quality === 'string' && /[a-z]/i.test(quality) ? quality.toUpperCase() : null)
}

function chooseQuality(available, requested) {
  const ordered = [...available].sort((a, b) => b.qn - a.qn)
  return ordered.find(item => item.qn <= requested) ?? ordered.at(-1) ?? null
}

function safeFilenamePart(value, limit, fallback) {
  const cleaned = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  let bytes = 0
  let part = ''
  for (const char of cleaned) {
    bytes += Buffer.byteLength(char)
    if (bytes > limit) break
    part += char
  }
  part = part.replace(/[. ]+$/, '') || fallback
  return /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?: *\.|$)/i.test(part) ? '_' + part : part
}

function downloadFilename(video, page, useSubdir) {
  const title = safeFilenamePart(video.title, 120, '未命名视频')
  if (!(video.pages?.length > 1)) return title + '.mp4'
  const number = page?.page || 1
  const width = Math.max(2, String(video.pages.at(-1).page).length)
  const label = 'P' + String(number).padStart(width, '0')
  const episode = safeFilenamePart(page?.title, 60, '第 ' + number + ' 集')
  return useSubdir
    ? path.join(title, label + ' - ' + episode + '.mp4')
    : title + ' - ' + label + ' - ' + episode + '.mp4'
}

function cookieHeader(cookies = {}) {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

function parseCookiePair(value, cookies) {
  const [pair] = String(value || '').split(';')
  const separator = pair.indexOf('=')
  if (separator > 0) cookies[pair.slice(0, separator)] = pair.slice(separator + 1)
}

function resolveFfmpegPath() {
  // On Windows ARM64 the package includes the x64 build, which runs under emulation.
  const binary = ffmpegStaticPath || (app.isPackaged && process.platform === 'win32' && process.arch === 'arm64'
    ? path.join(path.dirname(require.resolve('ffmpeg-static/package.json')), 'ffmpeg.exe')
    : null)
  if (!binary) throw new Error('未找到 FFmpeg，可执行文件未正确安装')
  return app.isPackaged ? binary.replace('app.asar', 'app.asar.unpacked') : binary
}

function serializeError(error) {
  return error instanceof Error ? error.message : String(error)
}

async function fetchWithTimeout(url, options, timeoutMs, readResponse) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`请求超时（${timeoutMs / 1000}秒）`)), timeoutMs)
  const userSignal = options.signal
  const onUserAbort = () => controller.abort(userSignal.reason)
  if (userSignal) userSignal.addEventListener('abort', onUserAbort, { once: true })
  try {
    userSignal?.throwIfAborted()
    const response = await fetch(url, { ...options, signal: controller.signal })
    return await readResponse(response)
  } finally {
    clearTimeout(timer)
    if (userSignal) userSignal.removeEventListener('abort', onUserAbort)
  }
}

class ApplicationService extends EventEmitter {
  constructor() {
    super()
    this.tasks = []
    this._tasksById = new Map()
    this.downloadRuns = new Map()
    this.deletingTasks = new Set()
    this.currentUser = null
    this.bilibiliCookies = {}
    this.settings = null
    this.statePath = null
    this.downloadQueue = []
    this.queueDrainScheduled = false
    this.slowRetries = new Set()
  }

  initialize() {
    const dataDirectory = app.getPath('userData')
    const downloadDirectory = process.platform === 'win32'
      ? path.join(process.env.USERPROFILE || app.getPath('home'), 'Downloads', 'BiliDownloader')
      : path.join(app.getPath('home'), 'Downloads', 'BiliDownloader')
    this.statePath = path.join(dataDirectory, 'application-state.json')
    this.settings = {
      default_download_path: downloadDirectory,
      default_quality: '1080p',
      default_format: 'mp4',
      max_concurrent_downloads: 4,
      download_speed_limit: 0, // 单线程限速 KB/s，0=不限速
      slow_speed_threshold_kbps: 50, // 低速自动暂停阈值 KB/s，0=关闭
      slow_speed_grace_seconds: 15, // 持续低速多久后自动暂停（秒）
      slow_speed_auto_pause: true, // 低速自动暂停总开关
      auto_merge: true,
      delete_temp_files: true,
      proxy_enabled: false,
      proxy_url: null
    }

    try {
      const persisted = JSON.parse(fs.readFileSync(this.statePath, 'utf8'))
      this.tasks = Array.isArray(persisted.tasks) ? persisted.tasks : []
      this.settings = { ...this.settings, ...(persisted.settings || {}) }
      this.currentUser = persisted.currentUser || null
      this.bilibiliCookies = this.deserializeCookies(persisted.bilibiliCookies)
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('读取应用状态失败:', error)
    }

    let reaped = 0
    for (const task of this.tasks) {
      if (QUEUED_OR_ACTIVE.has(task.status)) {
        task.status = 'paused'
        task.speed = null
        task.updated_at = new Date().toISOString()
        reaped += 1
      }
      if ((task.status === 'paused' || task.status === 'failed') && task.resume_checkpoint && !task.restart_requested) {
        try {
          if (!this.resumeState(task)) this.restoreCheckpointProgress(task)
        } catch (error) {
          console.warn('读取下载断点失败:', error)
          task.resume_state = 'restart_required'
        }
      }
    }
    if (reaped) console.info(`已将 ${reaped} 个中断的下载任务标记为已暂停`)

    this._tasksById = new Map(this.tasks.map(task => [task.task_id, task]))
    this.removeExpiredTaskRecords()
    fs.mkdirSync(this.settings.default_download_path, { recursive: true })
    this.persist()
  }

  removeExpiredTaskRecords() {
    const cutoff = Date.now() - 30 * 86400000
    const before = this.tasks.length
    this.tasks = this.tasks.filter(task => {
      if (task.status !== 'completed' && task.status !== 'cancelled') return true
      const timestamp = new Date(task.completed_at || task.updated_at || task.created_at).getTime()
      return !Number.isFinite(timestamp) || timestamp >= cutoff
    })
    const removed = before - this.tasks.length
    if (removed) {
      console.info(`已自动清理 ${removed} 条超过30天的任务记录`)
      this._tasksById = new Map(this.tasks.map(task => [task.task_id, task]))
    }
    return removed
  }

  serializeCookies() {
    if (!Object.keys(this.bilibiliCookies).length) return null
    const value = JSON.stringify(this.bilibiliCookies)
    if (safeStorage.isEncryptionAvailable()) {
      return { encrypted: true, value: safeStorage.encryptString(value).toString('base64') }
    }
    return { encrypted: false, value }
  }

  deserializeCookies(stored) {
    if (!stored?.value) return {}
    try {
      const value = stored.encrypted
        ? safeStorage.decryptString(Buffer.from(stored.value, 'base64'))
        : stored.value
      return JSON.parse(value)
    } catch (error) {
      console.warn('读取B站登录凭证失败:', error)
      return {}
    }
  }

  persist() {
    if (!this.statePath) return
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true })
    const temporaryPath = `${this.statePath}.tmp`
    fs.writeFileSync(temporaryPath, JSON.stringify({
      tasks: this.tasks,
      settings: this.settings,
      currentUser: this.currentUser,
      bilibiliCookies: this.serializeCookies()
    }, null, 2))
    fs.renameSync(temporaryPath, this.statePath)
  }

  async request({ method = 'GET', url, data, params = {} }) {
    const route = String(url || '').replace(/^\/api\/v1/, '')
    const normalizedMethod = method.toUpperCase()

    if (normalizedMethod === 'GET' && route === '/video/parse-url') return this.parseVideoUrl(params.url)
    if (normalizedMethod === 'GET' && route === '/video/resolve') return this.resolveVideo(params.url)
    if (normalizedMethod === 'GET' && route === '/video/info') return this.getVideoInfo({ bvid: params.bvid, aid: params.aid })
    if (normalizedMethod === 'POST' && route === '/video/check-vip-status') return this.checkVipStatus(this.bilibiliCookies)
    if (normalizedMethod === 'POST' && route === '/download/start') return this.startDownload(data || {})
    if (normalizedMethod === 'POST' && route === '/download/start-batch') return this.startBatchDownload(data || {})
    if (normalizedMethod === 'POST' && route === '/download/preview') return this.previewDownload(data || {})
    if (normalizedMethod === 'POST' && route === '/download/pause-all') {
      return this.pauseAllDownloads(new Set(data?.task_ids || []))
    }
    if (normalizedMethod === 'GET' && route === '/download/tasks') return this.listTasks(params)
    if (normalizedMethod === 'GET' && route === '/download/stats') return this.getStats()
    if (normalizedMethod === 'GET' && route === '/download/history') return this.getHistory(params.days)
    if (normalizedMethod === 'GET' && route === '/download/settings') return this.settings
    if (normalizedMethod === 'POST' && route === '/download/settings') return this.updateSettings(data)
    if (normalizedMethod === 'POST' && route === '/download/clear-completed') return this.clearCompleted(data?.task_ids)
    if (normalizedMethod === 'POST' && route === '/auth/bilibili/qrcode') return this.createQrCode()
    if (normalizedMethod === 'POST' && route === '/auth/bilibili/check-login') return this.checkQrCode(data?.qrcode_key)
    if (normalizedMethod === 'GET' && route === '/auth/session-status') return this.validateCurrentSession()
    if (normalizedMethod === 'GET' && route === '/auth/me') return this.getCurrentUser()
    if (normalizedMethod === 'GET' && route === '/auth/logout') return this.logout()

    const taskMatch = route.match(/^\/download\/task\/([^/]+)$/)
    if (taskMatch && normalizedMethod === 'GET') return this.getTask(taskMatch[1])
    if (taskMatch && normalizedMethod === 'DELETE') return this.deleteTask(taskMatch[1], params.delete_file)

    const actionMatch = route.match(/^\/download\/(pause|resume|restart|cancel)\/([^/]+)$/)
    if (actionMatch && normalizedMethod === 'POST') return this.changeTask(actionMatch[2], actionMatch[1])

    throw new Error(`统一应用服务尚未实现 ${normalizedMethod} ${route}`)
  }

  parseVideoUrl(input) {
    const value = String(input || '').trim()
    let id = value
    let page = null
    const unknown = { type: 'unknown', bvid: null, aid: null, p: null }
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol) ||
          !['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(url.hostname)) return unknown
      id = /^\/video\/([^/]+)\/?$/.exec(url.pathname)?.[1] || ''
      if (url.searchParams.has('p')) {
        const part = url.searchParams.get('p')
        page = /^\d+$/.test(part) ? Number(part) : NaN
      }
    } catch {}
    const suffix = /^BV([0-9A-Za-z]{10})$/i.exec(id)?.[1]
    const aid = Number(/^AV(\d+)$/i.exec(id)?.[1])
    if (page !== null && (!Number.isSafeInteger(page) || page < 1)) return { ...unknown, error: 'invalid_page' }
    if (suffix) return { type: 'video', bvid: 'BV' + suffix, aid: null, p: page }
    if (Number.isSafeInteger(aid) && aid > 0) return { type: 'video', bvid: null, aid, p: page }
    return unknown
  }

  async resolveVideo(input) {
    const parsed = this.parseVideoUrl(input)
    if (parsed.type !== 'video') return { ok: false, error: parsed.error || 'invalid_input' }
    try {
      const video = await this.getVideoInfo(parsed)
      return { ok: true, video, requested_page: parsed.p }
    } catch (error) {
      return { ok: false, error: error.videoError || 'temporary_failure' }
    }
  }

  getAvailableQualities(playInfo) {
    const streams = (playInfo.dash?.video || []).filter(stream => stream.baseUrl || stream.base_url)
    const formats = new Map((playInfo.support_formats || []).map(format => [Number(format.quality), format]))
    const streamByQuality = new Map()

    for (const stream of streams) {
      const qn = Number(stream.id)
      if (Number.isSafeInteger(qn) && qn > 0 && !streamByQuality.has(qn)) streamByQuality.set(qn, stream)
    }

    if (playInfo.durl?.length === 1 && playInfo.durl[0]?.url && playInfo.quality &&
        !streamByQuality.has(Number(playInfo.quality))) {
      streamByQuality.set(Number(playInfo.quality), {})
    }

    return [...streamByQuality.entries()]
      .sort(([a], [b]) => b - a)
      .map(([qn, stream]) => {
        const format = formats.get(qn)
        const fallback = QUALITY_NAMES[qn] || [`${qn}`, '', stream.width || 0, stream.height || 0]
        const name = format?.display_desc || fallback[0]
        const parsedDescription = format?.new_description?.replace(name, '').trim()
        return {
          qn,
          name,
          desc: parsedDescription || format?.superscript || fallback[1],
          width: stream.width || fallback[2],
          height: stream.height || fallback[3]
        }
      })
  }

  async bilibiliGet(url, { params, cookies, signal } = {}) {
    const target = new URL(url)
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') target.searchParams.set(key, String(value))
    }
    const headers = { ...BILIBILI_HEADERS }
    if (cookies && Object.keys(cookies).length) headers.Cookie = cookieHeader(cookies)
    return fetchWithTimeout(target, { headers, redirect: 'follow', signal }, 30000, async response => {
      if (!response.ok) {
        await response.body?.cancel()
        const error = new Error(`B站请求失败: HTTP ${response.status}`)
        error.transient = response.status === 408 || response.status === 429 || response.status >= 500
        throw error
      }
      const result = await response.json()
      if (result.code !== 0) {
        const error = new Error(result.message || 'B站请求失败: ' + result.code)
        error.bilibiliCode = result.code
        throw error
      }
      return { data: result.data }
    })
  }

  async getVideoInfo({ bvid, aid, p = null, withQualities = true }) {
    if (!bvid && !aid) throw new Error('必须提供BV号或AV号')
    const cookies = this.bilibiliCookies
    const accountStatus = await this.checkVipStatus(cookies)
    const loginStatus = accountStatus.login_status
    let data
    try {
      ({ data } = await this.bilibiliGet('https://api.bilibili.com/x/web-interface/view', {
        params: { bvid, aid },
        cookies
      }))
    } catch (error) {
      if ([-404, 62002].includes(error.bilibiliCode)) error.videoError = 'not_accessible'
      throw error
    }
    const pages = data.pages?.length ? data.pages : [{ cid: data.cid, page: 1, part: data.title, duration: data.duration }]
    const video = {
      bvid: data.bvid,
      aid: data.aid,
      cid: data.cid,
      title: data.title,
      description: data.desc,
      cover_url: data.pic,
      duration: data.duration,
      uploader: data.owner?.name,
      uploader_uid: data.owner?.mid,
      uploader_avatar: data.owner?.face,
      pub_date: data.pubdate,
      pages: pages.map(page => ({ ...page, title: page.title || page.part })),
      login_status: loginStatus,
      quality_label: loginStatus >= 2 ? '大会员，支持全部画质' : loginStatus >= 1 ? '已登录，最高支持 1080P' : '未登录，仅支持 360P/480P'
    }
    if (!withQualities) return video

    const selected = p === null ? video.pages[0] : video.pages.find(page => page.page === p)
    if (!selected?.cid) throw Object.assign(new Error('所选分集不存在'), { videoError: 'invalid_page' })
    const play = await this.getPlayUrl({ bvid: video.bvid, cid: selected.cid, quality: 127, login_status: loginStatus })
    const available = this.getAvailableQualities(play)
    const preferred = DEFAULT_QUALITY_CODES[this.settings?.default_quality?.toLowerCase()] ?? 80
    return {
      ...video,
      pages: video.pages.map(page => ({
        ...page,
        flat_filename: downloadFilename(video, page, false),
        grouped_filename: downloadFilename(video, page, true)
      })),
      selected_cid: selected.cid,
      available_qualities: available,
      preferred_quality: { qn: preferred, name: qualityName(preferred) },
      selected_quality: chooseQuality(available, preferred)
    }
  }

  async checkVipStatus(cookies = {}) {
    const empty = { is_logged_in: false, is_vip: false, vip_type: 0, vip_status: 0, login_status: 0, user_id: 0, user_name: '', vip_due_date: 0 }
    if (!cookies.SESSDATA || cookies.SESSDATA === 'deleted') return empty
    try {
      const { data } = await this.bilibiliGet('https://api.bilibili.com/x/space/myinfo', { cookies })
      const vip = data.vip || {}
      const vipType = vip.vipType ?? data.vip_type ?? 0
      const vipStatus = vip.vipStatus ?? data.vip_status ?? 0
      const isVip = vipType > 0 && vipStatus === 1
      return {
        is_logged_in: Boolean(data.mid),
        is_vip: isVip,
        vip_type: vipType,
        vip_status: vipStatus,
        login_status: isVip ? 2 : 1,
        user_id: data.mid || 0,
        user_name: data.name || '',
        vip_due_date: vip.vipDueDate ?? data.vipDueDate ?? 0
      }
    } catch {
      return empty
    }
  }

  async getPlayUrl(task, signal) {
    let fnval = 16
    if ((task.login_status || 0) >= 1) fnval |= 64 | 128 | 256 | 512
    if (task.audio_quality === 30251) fnval |= 2048
    const { data } = await this.bilibiliGet('https://api.bilibili.com/x/player/playurl', {
      params: { bvid: task.bvid, cid: task.cid, qn: task.quality || 80, fnval, fnver: 0, fourk: 1 },
      cookies: this.bilibiliCookies,
      signal
    })
    return data
  }

  buildTaskBase(video, page, input, loginStatus, idOffset = 0) {
    const taskId = crypto.randomUUID()
    const now = new Date().toISOString()
    const pages = video.pages || []
    const isMultiPage = pages.length > 1
    const pageNumber = page?.page || 1
    const title = isMultiPage ? `${video.title} P${pageNumber} ${page?.title || ''}`.replace(/\s+/g, ' ').trim() : video.title
    const directory = input.download_path || this.settings.default_download_path
    // 文件夹归类：仅多P视频且开启"下载到子目录"时，保存到以视频标题命名的子文件夹，文件名为 分P号+分P名称
    const useSubdir = isMultiPage && input.download_to_subdir !== false
    const filePath = path.join(directory, downloadFilename(video, page, useSubdir))
    const cid = page?.cid || video.cid || pages[0]?.cid
    const planned = Number(input.quality_by_cid?.[cid])
    return {
      id: Date.now() + idOffset,
      task_id: taskId,
      title,
      bvid: video.bvid,
      aid: video.aid,
      uploader: video.uploader,
      cid,
      page: pageNumber,
      quality: String(input.quality || 80),
      planned_quality: Number.isSafeInteger(planned) && planned > 0 ? planned : null,
      actual_quality: null,
      resume_state: null,
      format: 'mp4',
      subdir: useSubdir,
      base_filename: path.basename(filePath),
      file_path: this.availableDownloadPath(filePath, taskId),
      file_size: null,
      downloaded_size: 0,
      status: 'pending',
      progress: 0,
      speed: null,
      error_message: null,
      error_trace: null,
      created_at: now,
      updated_at: null,
      started_at: null,
      completed_at: null,
      audio_quality: input.audio_quality,
      login_status: loginStatus,
      auto_merge: input.auto_merge ?? this.settings.auto_merge,
      delete_temp_files: input.delete_temp_files ?? this.settings.delete_temp_files
    }
  }

  registerTask(task) {
    this.tasks.unshift(task)
    this._tasksById.set(task.task_id, task)
  }

  isSharedDownloadPath(filePath, taskId) {
    const normalize = file => {
      const resolved = path.resolve(file)
      return process.platform === 'linux' ? resolved : resolved.toLowerCase()
    }
    const target = normalize(filePath)
    return this.tasks.some(task => task.task_id !== taskId && task.file_path && normalize(task.file_path) === target)
  }

  availableDownloadPath(filePath, taskId) {
    const { dir, name, ext } = path.parse(filePath)
    let candidate = filePath
    let index = 2
    while (this.isSharedDownloadPath(candidate, taskId) || fs.lstatSync(candidate, { throwIfNoEntry: false })) {
      candidate = path.join(dir, name + ' (' + index + ')' + ext)
      index += 1
    }
    return candidate
  }

  temporaryDownloadPaths(task) {
    const base = path.join(path.dirname(task.file_path), `.bili-${task.task_id}`)
    return { output: `${base}.part.mp4`, video: `${base}.video.tmp`, audio: `${base}.audio.tmp` }
  }

  async startDownload(input) {
    const video = await this.getVideoInfo({ bvid: input.bvid, aid: input.aid, withQualities: false })
    const loginStatus = video.login_status
    const pages = video.pages || []
    const cid = input.cid ?? video.cid ?? pages[0]?.cid
    const page = pages.find(item => Number(item.cid) === Number(cid))
    if (!Number(cid) || (!page && (pages.length || Number(video.cid) !== Number(cid)))) {
      throw new Error('所选分P不存在，无法下载')
    }
    const task = this.buildTaskBase(video, page, input, loginStatus)
    this.registerTask(task)
    this.persist()
    this.emitTask(task)
    this.enqueueDownload(task)
    return { ...this.publicTask(task), message: '下载任务已创建' }
  }

  async startBatchDownload(input) {
    if (!Array.isArray(input.cids) || !input.cids.length) throw new Error('请选择要下载的分集')
    const video = await this.getVideoInfo({ bvid: input.bvid, aid: input.aid, withQualities: false })
    const loginStatus = video.login_status
    const selectedPages = this.selectedDownloadPages(video, input.cids)

    const created = selectedPages.map((page, index) => this.buildTaskBase(video, page, input, loginStatus, index))
    for (let i = created.length - 1; i >= 0; i--) this.registerTask(created[i])
    this.persist()
    for (const task of created) {
      this.emitTask(task)
      this.enqueueDownload(task)
    }
    return {
      count: created.length,
      tasks: created.map(task => this.publicTask(task)),
      message: `已创建 ${created.length} 个下载任务`
    }
  }

  selectedDownloadPages(video, cids) {
    const ids = new Set(cids.map(Number))
    const selected = (video.pages || []).filter(page => ids.has(Number(page.cid)))
    const unmatched = [...ids].filter(id => !selected.some(page => Number(page.cid) === id))
    if (unmatched.length) throw new Error('以下分集不存在，无法下载：' + unmatched.join('、'))
    return selected
  }

  async previewDownload(input) {
    if (!Array.isArray(input.cids) || !input.cids.length) throw new Error('请选择要下载的分集')
    const video = await this.getVideoInfo({ bvid: input.bvid, aid: input.aid, withQualities: false })
    const pages = this.selectedDownloadPages(video, input.cids)
    const result = []
    for (let offset = 0; offset < pages.length; offset += 3) {
      result.push(...await Promise.all(pages.slice(offset, offset + 3).map(async page => {
        try {
          const play = await this.getPlayUrl({
            bvid: video.bvid, cid: page.cid, login_status: video.login_status, quality: 127,
            audio_quality: input.audio_quality
          })
          const quality = chooseQuality(this.getAvailableQualities(play), Number(input.quality))
          return { cid: page.cid, page: page.page, quality, status: quality ? 'ready' : 'no_stream' }
        } catch {
          return { cid: page.cid, page: page.page, quality: null, status: 'unavailable' }
        }
      })))
    }
    return result
  }


  resumeState(task) {
    if (task.restart_requested) return null
    if (task.resume_state === 'restart_required') return task.resume_state
    if (!task.resume_checkpoint) {
      return task.progress > 0 || task.downloaded_size > 0 ? 'restart_required' : null
    }

    const files = this.temporaryDownloadPaths(task)
    const tracks = Object.entries(task.resume_checkpoint.tracks)
    let totalBytes = 0
    for (const [kind, track] of tracks) {
      const size = partSize(files[kind])
      totalBytes += size
      if ((track.complete && (!track.total || size !== track.total)) ||
          (size > 0 && !track.complete && (!track.validator || !track.total || size > track.total))) {
        return 'restart_required'
      }
    }
    return totalBytes < (task.downloaded_size || 0) ? 'restart_required' : null
  }

  restoreCheckpointProgress(task) {
    const { mode, tracks } = task.resume_checkpoint
    const files = this.temporaryDownloadPaths(task)
    const size = kind => tracks[kind] ? partSize(files[kind]) : 0
    const fraction = (kind, bytes) => tracks[kind]?.total ? Math.min(1, bytes / tracks[kind].total) : 0
    if (mode === 'dash') {
      const video = size('video')
      const audio = size('audio')
      task.progress = Math.max(task.progress || 0, fraction('video', video) * 70 + fraction('audio', audio) * 20)
      task.downloaded_size = video + audio
    } else {
      const output = size('output')
      task.progress = Math.max(task.progress || 0, Math.min(99, fraction('output', output) * 100))
      task.downloaded_size = output
    }
  }

  removeTemporaryFiles(task, keepSources = false) {
    if (!task.file_path) return
    const { output, video, audio } = this.temporaryDownloadPaths(task)
    for (const file of keepSources ? [output] : [output, video, audio]) fs.rmSync(file, { force: true })
  }

  publishDownload(task, output) {
    const basePath = path.join(path.dirname(task.file_path), task.base_filename || path.basename(task.file_path))
    let filePath = task.file_path
    if (fs.lstatSync(filePath, { throwIfNoEntry: false }) || this.isSharedDownloadPath(filePath, task.task_id)) {
      filePath = this.availableDownloadPath(basePath, task.task_id)
    }

    while (true) {
      try {
        try {
          fs.linkSync(output, filePath)
        } catch (error) {
          if (!COPY_FALLBACK_ERRORS.has(error.code)) throw error
          fs.copyFileSync(output, filePath, fs.constants.COPYFILE_EXCL)
        }
        return filePath
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        filePath = this.availableDownloadPath(basePath, task.task_id)
      }
    }
  }

  async runDownload(task, signal) {
    const { output, video, audio } = this.temporaryDownloadPaths(task)
    try {
      signal.throwIfAborted()
      if (task.restart_requested) {
        this.removeTemporaryFiles(task)
        Object.assign(task, RESET_DOWNLOAD, { resume_state: null })
        delete task.resume_checkpoint
        delete task.restart_requested
      }
      if (this.resumeState(task)) throw new RestartRequiredError()
      if (task.resume_checkpoint) this.restoreCheckpointProgress(task)
      this.transitionTask(task, 'downloading', { started_at: task.started_at || new Date().toISOString() })
      const tracks = task.resume_checkpoint?.tracks
      const complete = task.resume_checkpoint?.mode === 'dash'
        ? tracks.video?.complete && tracks.audio?.complete
        : tracks?.output?.complete

      if (!complete) {
        const expectedQuality = task.actual_quality ?? task.planned_quality ?? Number(task.quality)
        const playInfo = await this.getPlayUrl({ ...task, quality: expectedQuality }, signal)
        signal.throwIfAborted()
        const actual = chooseQuality(this.getAvailableQualities(playInfo), expectedQuality)
        const combinedStream = playInfo.durl?.length === 1 ? playInfo.durl[0] : null
        const videoStreams = (playInfo.dash?.video || []).filter(item =>
          (actual ? Number(item.id) === actual.qn : !combinedStream?.url) && (item.baseUrl || item.base_url))
        const previousVideo = tracks?.video || tracks?.output
        const videoStream = videoStreams.find(item => trackIdentity(task, 'video', item) === previousVideo?.identity) || videoStreams[0]
        const audioStreams = (playInfo.dash?.audio || []).filter(item => item.baseUrl || item.base_url)
        const audioStream = audioStreams.find(item => trackIdentity(task, 'audio', item) === tracks?.audio?.identity) ||
          audioStreams.find(item => item.id === Number(task.audio_quality)) || audioStreams[0]
        const videoUrls = downloadSources(videoStream, previousVideo)
        const audioUrls = downloadSources(audioStream, tracks?.audio)
        const combinedUrls = videoUrls.length ? [] : downloadSources(combinedStream, tracks?.output)
        if (!videoUrls.length && !combinedUrls.length) throw new Error('未找到可下载的视频流')
        const mode = videoUrls.length && audioUrls.length && task.auto_merge !== false ? 'dash' : 'single'
        if (task.resume_checkpoint && task.resume_checkpoint.mode !== mode) throw new RestartRequiredError()
        task.resume_checkpoint ??= { mode, tracks: {} }
        task.actual_quality = actual?.qn ?? null
        this.emitTask(task)
        fs.mkdirSync(path.dirname(task.file_path), { recursive: true })

        if (mode === 'dash') {
          const videoIdentity = trackIdentity(task, 'video', videoStream)
          const audioIdentity = trackIdentity(task, 'audio', audioStream)
          if ((tracks?.video?.complete && tracks.video.identity !== videoIdentity) ||
              (tracks?.audio?.complete && tracks.audio.identity !== audioIdentity)) throw new RestartRequiredError()
          if (!tracks?.video?.complete) {
            await this.downloadTrack(videoUrls, video, task, signal, { kind: 'video', identity: videoIdentity, progressEnd: 70 })
          }
          signal.throwIfAborted()
          if (!tracks?.audio?.complete) {
            await this.downloadTrack(audioUrls, audio, task, signal, {
              kind: 'audio', identity: audioIdentity, progressStart: 70, progressEnd: 90
            })
          }
        } else {
          const identity = trackIdentity(task, videoStream ? 'video' : 'combined', videoStream, actual?.qn)
          await this.downloadTrack(videoUrls.length ? videoUrls : combinedUrls, output, task, signal, { identity })
        }
      }

      signal.throwIfAborted()
      if (task.resume_checkpoint?.mode === 'dash') {
        this.transitionTask(task, 'merging', { progress: 90 })
        await this.mergeStreams(video, audio, output, signal)
      }

      signal.throwIfAborted()
      const fileSize = fs.statSync(output).size
      if (!fileSize) throw new Error('下载文件为空')
      const filePath = this.publishDownload(task, output)
      delete task.resume_checkpoint
      this.slowRetries.delete(task.task_id)
      this.transitionTask(task, 'completed', {
        file_path: filePath, file_size: fileSize, downloaded_size: fileSize, progress: 100,
        completed_at: new Date().toISOString(), resume_state: null
      })
    } catch (error) {
      if (!signal.aborted && QUEUED_OR_ACTIVE.has(task.status)) {
        this.slowRetries.delete(task.task_id)
        if (error instanceof RestartRequiredError) {
          this.transitionTask(task, 'paused', { resume_state: 'restart_required', error_message: RESTART_REQUIRED })
        } else {
          this.transitionTask(task, 'failed', { error_message: serializeError(error) })
        }
      }
    } finally {
      try {
        if (task.status === 'completed' || task.status === 'cancelled') {
          this.removeTemporaryFiles(task, task.status === 'completed' && task.delete_temp_files === false)
          delete task.resume_checkpoint
          if (task.status === 'cancelled') this.persist()
        } else if (task.resume_checkpoint?.mode === 'dash') {
          fs.rmSync(output, { force: true })
        }

        if (task.resume_checkpoint && !this.deletingTasks.has(task.task_id)) {
          if (!this.resumeState(task)) this.restoreCheckpointProgress(task)
          this.persist()
          this.emitTask(task)
        }
      } catch (error) {
        console.warn('清理或保存下载断点失败:', error)
      }
    }
  }

  async preferredDownloadSource(urls, signal) {
    const probes = await Promise.all(urls.map(url => fetchWithTimeout(url, {
      method: 'HEAD', headers: MEDIA_HEADERS, signal
    }, 3000, response => response.ok ? {
      total: contentLength(response.headers.get('content-length')),
      validator: responseValidator(response.headers)
    } : null).catch(() => null)))
    signal.throwIfAborted()
    const primaryTotal = probes[0]?.total
    const preferred = probes.findIndex(probe =>
      probe?.total && probe.validator?.header === 'etag' && (!primaryTotal || primaryTotal === probe.total))
    return preferred === -1 ? urls[0] : urls[preferred]
  }

  async downloadTrack(urls, destination, task, signal, options) {
    if (urls.length === 1) return this.downloadStream(urls[0], destination, task, signal, options)
    const offset = partSize(destination)
    const first = offset ? urls[0] : await this.preferredDownloadSource(urls, signal)
    let transientError
    for (const url of [first, ...urls.filter(candidate => candidate !== first)]) {
      try {
        await this.downloadStream(url, destination, task, signal, options)
        return
      } catch (error) {
        signal.throwIfAborted()
        if (partSize(destination) !== offset) throw error
        if (!(error instanceof RestartRequiredError)) transientError = error
      }
    }
    throw transientError || new RestartRequiredError()
  }

  async downloadStream(url, destination, task, signal, {
    kind = 'output', identity, progressStart = 0, progressEnd = 100
  } = {}) {
    signal.throwIfAborted()
    const started = Date.now()
    const source = new URL(url)
    const tracks = task.resume_checkpoint.tracks
    const track = tracks[kind]
    const offset = partSize(destination)
    const otherBytes = kind === 'audio' ? partSize(this.temporaryDownloadPaths(task).video) : 0
    if (offset && (!track?.validator || track.identity !== identity)) {
      throw new RestartRequiredError()
    }
    const headers = { ...MEDIA_HEADERS }
    if (offset) headers['If-Range'] = track.validator.value
    if (source.protocol === 'https:' && (source.hostname === 'bilibili.com' || source.hostname.endsWith('.bilibili.com')) &&
        Object.keys(this.bilibiliCookies).length) headers.Cookie = cookieHeader(this.bilibiliCookies)

    const stallController = new AbortController()
    let stallTimer
    const armStall = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => stallController.abort(new Error('下载连接已超时（长时间无数据）')), 5 * 60 * 1000)
    }
    const onUserAbort = () => stallController.abort(signal.reason)
    signal.addEventListener('abort', onUserAbort, { once: true })

    let response
    let file
    try {
      const overlapStart = Math.max(0, offset - RESUME_OVERLAP_LIMIT)
      let from = offset && track.origin !== source.origin ? overlapStart : offset
      const requestRange = async start => {
        armStall()
        return fetch(url, { headers: { ...headers, Range: 'bytes=' + start + '-' }, signal: stallController.signal })
      }
      response = await requestRange(from)
      let resource = new URL(response.url || url)
      if (offset && from === offset && resource.origin !== track.origin && response.status === 206) {
        await response.body?.cancel()
        from = overlapStart
        response = await requestRange(from)
        resource = new URL(response.url || url)
      }
      if (!response.ok || !response.body) {
        if (offset && response.status === 416) throw new RestartRequiredError()
        throw new Error('下载失败: HTTP ' + response.status)
      }

      const encoding = response.headers.get('content-encoding')
      const range = responseRange(response.headers)
      const length = contentLength(response.headers.get('content-length'))
      const validRange = response.status === 206 && range?.start === from && range.end === range.total - 1 &&
        (length === null || length === range.end - from + 1)
      if (offset && (!validRange || range.total !== track.total || resource.pathname !== track.pathname ||
          response.headers.get(track.validator.header) !== track.validator.value ||
          (encoding && encoding !== 'identity'))) throw new RestartRequiredError()
      if ((encoding && encoding !== 'identity') || (response.status === 206 && !validRange)) {
        throw new Error('服务器返回了无效的下载数据')
      }
      const total = validRange ? range.total : length
      const metadata = {
        identity, origin: resource.origin, pathname: resource.pathname,
        validator: offset ? track.validator : responseValidator(response.headers),
        total, complete: false
      }
      if (!offset) {
        tracks[kind] = metadata
        this.persist()
      }

      let received = 0
      let committed = offset
      let lastEmit = 0
      let slowSince = null
      const speedWindow = [[started, 0]]
      file = await fs.promises.open(destination, offset ? 'r+' : 'w')
      if (offset && (await file.stat()).size !== offset) throw new RestartRequiredError()
      const overlap = Buffer.alloc(offset - from)
      if (overlap.length) {
        const { bytesRead } = await file.read(overlap, 0, overlap.length, from)
        if (bytesRead !== overlap.length) throw new RestartRequiredError()
      }
      let overlapChecked = 0

      for await (const data of response.body) {
        stallController.signal.throwIfAborted()
        clearTimeout(stallTimer)
        received += data.byteLength
        const limitKbps = Number(this.settings.download_speed_limit) || 0
        if (limitKbps > 0) {
          const waitMs = received * 1000 / (limitKbps * 1024) - (Date.now() - started)
          if (waitMs > 0) await delay(waitMs, undefined, { signal: stallController.signal })
        }
        stallController.signal.throwIfAborted()

        const chunk = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
        const compare = Math.min(overlap.length - overlapChecked, chunk.length)
        if (compare && !chunk.subarray(0, compare).equals(overlap.subarray(overlapChecked, overlapChecked + compare))) {
          throw new RestartRequiredError()
        }
        overlapChecked += compare
        if (overlapChecked === overlap.length && tracks[kind] !== metadata) {
          tracks[kind] = metadata
          this.persist()
        }
        const writeBytes = chunk.length - compare
        if (total !== null && committed + writeBytes > total) throw new Error('下载数据超出预期长度')

        let position = compare
        while (position < chunk.length) {
          stallController.signal.throwIfAborted()
          const { bytesWritten } = await file.write(chunk, position, chunk.length - position, committed)
          if (!bytesWritten) throw new Error('无法写入下载数据')
          position += bytesWritten
          committed += bytesWritten
        }
        stallController.signal.throwIfAborted()
        armStall()

        const now = Date.now()
        speedWindow.push([now, received])
        while (speedWindow.length > 2 && now - speedWindow[1][0] > 10000) speedWindow.shift()
        const [windowTime, windowBytes] = speedWindow[0]
        task.speed = (received - windowBytes) * 1000 / Math.max(1, now - windowTime)
        task.downloaded_size = otherBytes + committed
        if (total) {
          const progress = progressStart + (committed / total) * (progressEnd - progressStart)
          task.progress = Math.max(task.progress, Math.min(99, progress))
        }
        const isComplete = total !== null && committed === total
        const thresholdKbps = Number(this.settings.slow_speed_threshold_kbps) || 0
        if (this.settings.slow_speed_auto_pause !== false && !isComplete &&
            (limitKbps === 0 || limitKbps > thresholdKbps) && task.speed / 1024 < thresholdKbps) {
          slowSince ??= now
          const graceMs = (Number(this.settings.slow_speed_grace_seconds) || 15) * 1000
          if (now - slowSince >= graceMs && this.demoteSlowTask(task)) stallController.signal.throwIfAborted()
        } else {
          slowSince = null
        }
        if (isComplete || now - lastEmit >= 250) {
          lastEmit = now
          this.emitTask(task)
        }
      }

      if (!committed || (total !== null && committed !== total) || overlapChecked !== overlap.length) {
        throw new Error('下载数据不完整')
      }
      metadata.total = committed
      metadata.complete = true
      task.downloaded_size = otherBytes + committed
      task.progress = Math.min(99, progressEnd)
      this.persist()
      this.emitTask(task)
    } finally {
      clearTimeout(stallTimer)
      signal.removeEventListener('abort', onUserAbort)
      try {
        await file?.close()
      } finally {
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
      }
    }
  }

  mergeStreams(videoPath, audioPath, destination, signal) {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(resolveFfmpegPath(), [
        '-y',
        '-threads', '0',
        '-i', videoPath,
        '-i', audioPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c', 'copy',
        '-max_muxing_queue_size', '1024',
        '-movflags', '+faststart',
        destination
      ], { windowsHide: true })
      let stderr = ''
      let processError
      const abort = () => ffmpeg.kill('SIGTERM')
      signal.addEventListener('abort', abort, { once: true })
      ffmpeg.stderr.on('data', chunk => { stderr += chunk.toString() })
      ffmpeg.on('error', error => { processError = error })
      ffmpeg.on('close', code => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) return reject(signal.reason)
        if (processError) return reject(processError)
        if (code === 0) return resolve()
        reject(new Error(`音视频合并失败: ${stderr.trim().split('\n').slice(-3).join(' ')}`))
      })
    })
  }

  enqueueDownload(task) {
    if (!this.downloadQueue.includes(task.task_id)) this.downloadQueue.push(task.task_id)
    this.drainQueue()
  }

  concurrencyLimit() {
    const configured = Number(this.settings.max_concurrent_downloads)
    return Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : 1
  }

  drainQueue() {
    if (!this.downloadQueue.length || this.queueDrainScheduled) return
    this.queueDrainScheduled = true
    queueMicrotask(() => {
      this.queueDrainScheduled = false
      while (this.downloadQueue.length && this.downloadRuns.size < this.concurrencyLimit()) {
        const index = this.downloadQueue.findIndex(id => !this.downloadRuns.has(id))
        if (index === -1) break
        const [taskId] = this.downloadQueue.splice(index, 1)
        const task = this._tasksById.get(taskId)
        if (task?.status !== 'pending' || this.deletingTasks.has(taskId)) continue
        const controller = new AbortController()
        const done = Promise.resolve()
          .then(() => this.runDownload(task, controller.signal))
          .catch(error => console.error('下载任务失败:', error))
          .finally(() => {
            this.downloadRuns.delete(taskId)
            this.drainQueue()
          })
        this.downloadRuns.set(taskId, { controller, done })
      }
    })
  }

  // 保留最近开始的任务，暂停超出上限的任务。
  enforceConcurrencyLimit() {
    const active = [...this.downloadRuns]
      .filter(([id, run]) => !run.controller.signal.aborted && QUEUED_OR_ACTIVE.has(this._tasksById.get(id)?.status))
    const excess = active.slice(0, Math.max(0, active.length - this.concurrencyLimit()))
    for (const [id] of excess) {
      this.stopTask(this._tasksById.get(id), 'paused')
    }
  }

  // 有其他任务等待时让出下载名额，每次手动启动最多让位一次。
  demoteSlowTask(task) {
    if (task.status !== 'downloading' || this.slowRetries.has(task.task_id) ||
        !this.downloadQueue.some(id => !this.downloadRuns.has(id) && this._tasksById.get(id)?.status === 'pending')) {
      return false
    }
    this.slowRetries.add(task.task_id)
    this.downloadRuns.get(task.task_id).controller.abort()
    this.transitionTask(task, 'pending')
    this.enqueueDownload(task)
    return true
  }

  transitionTask(task, status, changes = {}) {
    Object.assign(task, changes, { status, speed: status === 'completed' ? 0 : null, updated_at: new Date().toISOString() })
    this.persist()
    this.emitTask(task)
  }

  stopTask(task, status) {
    this.downloadQueue = this.downloadQueue.filter(id => id !== task.task_id)
    const run = this.downloadRuns.get(task.task_id)
    run?.controller.abort()
    if (status === 'cancelled' && !run) {
      this.removeTemporaryFiles(task)
      delete task.resume_checkpoint
    }
    if (status === 'cancelled') delete task.restart_requested
    this.transitionTask(task, status)
  }

  pauseAllDownloads(taskIds) {
    for (const task of this.tasks) {
      if ((!taskIds || taskIds.has(task.task_id)) &&
          QUEUED_OR_ACTIVE.has(task.status) && !this.deletingTasks.has(task.task_id)) this.stopTask(task, 'paused')
    }
  }

  emitTask(task) {
    this.emit('download-update', this.publicTask(task))
  }

  publicTask(task) {
    const { cookies, resume_checkpoint, restart_requested, ...safeTask } = task
    let resumeState = null
    if (task.status === 'paused' || task.status === 'failed') {
      try {
        resumeState = this.resumeState(task)
      } catch {
        // An unavailable drive should not prevent the existing queue from rendering.
        resumeState = task.resume_state ?? null
      }
    }
    return {
      ...safeTask,
      resume_state: resumeState,
      quality_name: qualityName(task.quality),
      planned_quality_name: task.planned_quality ? qualityName(task.planned_quality) : null,
      actual_quality_name: task.actual_quality ? qualityName(task.actual_quality) : null
    }
  }

  listTasks({ status, page = 1, page_size = 50 } = {}) {
    const filtered = status ? this.tasks.filter(task => task.status === status) : this.tasks
    const offset = (Number(page) - 1) * Number(page_size)
    return { page: Number(page), page_size: Number(page_size), total: filtered.length, tasks: filtered.slice(offset, offset + Number(page_size)).map(task => this.publicTask(task)) }
  }

  getTask(taskId) {
    const task = this._tasksById.get(taskId)
    if (!task) throw new Error('任务不存在')
    return this.publicTask(task)
  }

  async changeTask(taskId, action) {
    const task = this._tasksById.get(taskId)
    if (!task) throw new Error('任务不存在')
    if (this.deletingTasks.has(taskId)) throw new Error('任务正在删除')
    if (!Object.hasOwn(TASK_ACTIONS, action)) throw new Error('无效的任务操作')
    const { status, from, message } = TASK_ACTIONS[action]
    const startsDownload = action === 'resume' || action === 'restart'
    if (startsDownload && QUEUED_OR_ACTIVE.has(task.status)) return { message, outcome: 'queued' }
    if (task.status === status) return { message }
    if (!from.has(task.status)) throw new Error('当前任务状态（' + task.status + '）不支持此操作')

    if (action === 'resume' && this.resumeState(task)) {
      this.transitionTask(task, task.status, { resume_state: 'restart_required', error_message: RESTART_REQUIRED })
      return { message: RESTART_REQUIRED, outcome: 'restart_required' }
    }

    this.slowRetries.delete(taskId)
    if (startsDownload) {
      if (action === 'restart') task.restart_requested = true
      this.transitionTask(task, status, { error_message: null, error_trace: null })
      this.enqueueDownload(task)
      return { message, outcome: 'queued' }
    }
    this.stopTask(task, status)
    return { message }
  }

  async deleteTask(taskId, deleteFile = false) {
    const task = this._tasksById.get(taskId)
    if (!task) throw new Error('任务不存在')
    if (this.deletingTasks.has(taskId)) throw new Error('任务正在删除')
    this.deletingTasks.add(taskId)

    try {
      if (QUEUED_OR_ACTIVE.has(task.status)) this.stopTask(task, 'paused')
      const run = this.downloadRuns.get(taskId)
      if (run) await run.done
      let shared = false
      if (task.file_path && (deleteFile || task.status !== 'completed')) {
        try {
          this.removeTemporaryFiles(task)
          if (deleteFile && task.status === 'completed') {
            shared = this.isSharedDownloadPath(task.file_path, taskId)
            if (!shared) fs.rmSync(task.file_path, { force: true })
          }
          if (task.subdir === true) {
            try {
              fs.rmdirSync(path.dirname(task.file_path))
            } catch (error) {
              if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') {
                console.warn('清理下载子目录失败:', error)
              }
            }
          }
        } catch (error) {
          throw new Error(`删除下载文件失败: ${serializeError(error)}`)
        }
      }
      this.tasks = this.tasks.filter(item => item.task_id !== taskId)
      this._tasksById.delete(taskId)
      this.slowRetries.delete(taskId)
      this.persist()
      if (shared) return { message: '任务记录已删除，共用文件已保留', shared_file: true }
      return { message: deleteFile ? '任务记录和文件已删除' : '任务记录已删除' }
    } finally {
      this.deletingTasks.delete(taskId)
      if (this.downloadQueue.length) this.drainQueue()
    }
  }

  getStats() {
    const completed = this.tasks.filter(task => task.status === 'completed')
    const downloading = this.tasks.filter(task => task.status === 'downloading')
    return {
      total_tasks: this.tasks.length,
      completed_tasks: completed.length,
      failed_tasks: this.tasks.filter(task => task.status === 'failed').length,
      downloading_tasks: downloading.length,
      total_downloaded_size: completed.reduce((sum, task) => sum + (task.file_size || 0), 0),
      average_speed: downloading.length ? downloading.reduce((sum, task) => sum + (task.speed || 0), 0) / downloading.length : 0
    }
  }

  getHistory(days = 7) {
    const cutoff = Date.now() - Number(days) * 86400000
    const groups = new Map()
    for (const task of this.tasks) {
      if (task.status !== 'completed' || new Date(task.created_at).getTime() < cutoff) continue
      const date = task.created_at.slice(0, 10)
      const item = groups.get(date) || { date, count: 0, total_size: 0 }
      item.count += 1
      item.total_size += task.file_size || 0
      groups.set(date, item)
    }
    return { days: Number(days), history: [...groups.values()].sort((a, b) => b.date.localeCompare(a.date)) }
  }

  updateSettings(settings) {
    const updated = { ...this.settings, ...(settings || {}) }
    fs.mkdirSync(updated.default_download_path, { recursive: true })
    this.settings = updated
    this.persist()
    // 并发自动管理：调低上限→自动暂停多余活动任务；调高上限→自动启动排队任务
    this.enforceConcurrencyLimit()
    this.drainQueue()
    return this.settings
  }

  clearCompleted(taskIds) {
    if (!Array.isArray(taskIds)) throw new Error('请选择要删除的已完成任务')
    const scope = new Set(taskIds)
    const removed = this.tasks.filter(task => task.status === 'completed' && scope.has(task.task_id))
    const removedIds = new Set(removed.map(task => task.task_id))
    this.tasks = this.tasks.filter(task => !removedIds.has(task.task_id))
    this._tasksById = new Map(this.tasks.map(task => [task.task_id, task]))
    this.persist()
    return { task_ids: [...removedIds], message: '已删除 ' + removedIds.size + ' 条已完成任务记录' }
  }

  createCurrentUser(accountInfo, previousUser = null) {
    const vip = accountInfo.vip || {}
    const vipType = vip.vipType ?? accountInfo.vip_type ?? 0
    const vipStatus = vip.vipStatus ?? accountInfo.vip_status ?? 0
    const now = new Date().toISOString()
    return {
      id: accountInfo.mid || previousUser?.id || 0,
      username: accountInfo.name || previousUser?.username || `bili_${accountInfo.mid || 'user'}`,
      email: null,
      avatar_url: accountInfo.face || previousUser?.avatar_url || null,
      is_superuser: false,
      created_at: previousUser?.created_at || now,
      updated_at: now,
      bili_uid: String(accountInfo.mid || previousUser?.bili_uid || ''),
      bili_name: accountInfo.name || previousUser?.bili_name || '',
      is_vip: vipType > 0 && vipStatus === 1,
      vip_type: vipType,
      vip_status: vipStatus,
      vip_due_date: vip.vipDueDate ?? accountInfo.vipDueDate ?? 0,
      level: accountInfo.level ?? previousUser?.level ?? 0,
      sign: accountInfo.sign ?? previousUser?.sign ?? ''
    }
  }

  isNetworkError(error) {
    if (error?.transient || error instanceof TypeError) return true
    const code = error?.cause?.code || error?.code
    return ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)
  }

  async validateCurrentSession() {
    if (!this.currentUser || !this.bilibiliCookies.SESSDATA || this.bilibiliCookies.SESSDATA === 'deleted') {
      if (this.currentUser || Object.keys(this.bilibiliCookies).length) this.logout()
      return { status: 'logged_out', user: null }
    }

    try {
      const { data } = await this.bilibiliGet('https://api.bilibili.com/x/space/myinfo', { cookies: this.bilibiliCookies })
      if (!data.mid) {
        this.logout()
        return { status: 'invalid', user: null }
      }
      this.currentUser = this.createCurrentUser(data, this.currentUser)
      this.persist()
      return { status: 'valid', user: this.currentUser }
    } catch (error) {
      if (this.isNetworkError(error)) {
        console.warn('网络不可用，跳过B站登录状态检查:', error)
        return { status: 'offline', user: this.currentUser }
      }
      this.logout()
      return { status: 'invalid', user: null }
    }
  }

  async createQrCode() {
    const { data } = await this.bilibiliGet('https://passport.bilibili.com/x/passport-login/web/qrcode/generate')
    return { qrcode_url: data.url, qrcode_key: data.qrcode_key, expires_in: 180 }
  }

  async checkQrCode(qrcodeKey) {
    if (!qrcodeKey) throw new Error('缺少二维码标识')
    const target = new URL('https://passport.bilibili.com/x/passport-login/web/qrcode/poll')
    target.searchParams.set('qrcode_key', qrcodeKey)
    const { response, body } = await fetchWithTimeout(
      target, { headers: BILIBILI_HEADERS, redirect: 'manual' }, 15000,
      async response => ({ response, body: await response.json() })
    )
    const code = body.data?.code ?? body.code
    if (code === 86101) return { status: 'scanning', message: '等待扫描二维码' }
    if (code === 86090) return { status: 'confirming', message: '已扫描，请在手机端确认' }
    if (code === 86038 || code === -404) return { status: 'expired', message: '二维码已过期' }
    if (code !== 0) return { status: 'error', message: body.message || '检查登录状态失败' }

    const cookies = {}
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : String(response.headers.get('set-cookie') || '').split(/,(?=\s*[^;,]+=)/)
    for (const value of setCookies) parseCookiePair(value, cookies)

    if (body.data?.url) {
      const loginUrl = new URL(body.data.url)
      for (const [name, value] of loginUrl.searchParams) {
        if (['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid'].includes(name)) {
          cookies[name] = value
        }
      }
    }
    const vip = await this.checkVipStatus(cookies)
    if (!vip.is_logged_in) throw new Error('登录成功但未能获取有效的B站登录凭证，请刷新二维码重试')
    const { data: accountInfo } = await this.bilibiliGet('https://api.bilibili.com/x/space/myinfo', { cookies })
    this.bilibiliCookies = cookies
    this.currentUser = this.createCurrentUser(accountInfo)
    this.persist()
    return { status: 'success', message: '登录成功', user: this.currentUser }
  }

  async getCurrentUser() {
    const session = await this.validateCurrentSession()
    return session.user
  }

  logout() {
    this.currentUser = null
    this.bilibiliCookies = {}
    this.persist()
    return { message: '登出成功' }
  }
}

module.exports = { ApplicationService }
