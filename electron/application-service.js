'use strict'

const { app, safeStorage } = require('electron')
const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { spawn } = require('child_process')
const { setTimeout: delay } = require('timers/promises')
const ffmpegStaticPath = require('ffmpeg-static')

const QUEUED_OR_ACTIVE = new Set(['pending', 'downloading', 'merging'])
const TASK_ACTIONS = {
  pause: { status: 'paused', from: QUEUED_OR_ACTIVE, message: '下载已暂停' },
  resume: { status: 'pending', from: new Set(['paused', 'failed']), message: '下载已恢复' },
  cancel: { status: 'cancelled', from: new Set([...QUEUED_OR_ACTIVE, 'paused', 'failed']), message: '下载已取消' }
}
const RESET_DOWNLOAD = {
  progress: 0, downloaded_size: 0, file_size: null, started_at: null, completed_at: null,
  error_message: null, error_trace: null
}

const BILIBILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com',
  Origin: 'https://www.bilibili.com'
}

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
  if (!ffmpegStaticPath) throw new Error('未找到 FFmpeg，可执行文件未正确安装')
  return app.isPackaged ? ffmpegStaticPath.replace('app.asar', 'app.asar.unpacked') : ffmpegStaticPath
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
    if (normalizedMethod === 'GET' && route === '/video/info') return this.getVideoInfo({ bvid: params.bvid, aid: params.aid })
    if (normalizedMethod === 'POST' && route === '/video/check-vip-status') return this.checkVipStatus(this.bilibiliCookies)
    if (normalizedMethod === 'POST' && route === '/download/start') return this.startDownload(data || {})
    if (normalizedMethod === 'POST' && route === '/download/start-batch') return this.startBatchDownload(data || {})
    if (normalizedMethod === 'GET' && route === '/download/tasks') return this.listTasks(params)
    if (normalizedMethod === 'GET' && route === '/download/stats') return this.getStats()
    if (normalizedMethod === 'GET' && route === '/download/history') return this.getHistory(params.days)
    if (normalizedMethod === 'GET' && route === '/download/settings') return this.settings
    if (normalizedMethod === 'POST' && route === '/download/settings') return this.updateSettings(data)
    if (normalizedMethod === 'POST' && route === '/download/clear-completed') return this.clearCompleted()
    if (normalizedMethod === 'POST' && route === '/auth/bilibili/qrcode') return this.createQrCode()
    if (normalizedMethod === 'POST' && route === '/auth/bilibili/check-login') return this.checkQrCode(data?.qrcode_key)
    if (normalizedMethod === 'GET' && route === '/auth/session-status') return this.validateCurrentSession()
    if (normalizedMethod === 'GET' && route === '/auth/me') return this.getCurrentUser()
    if (normalizedMethod === 'GET' && route === '/auth/logout') return this.logout()

    const taskMatch = route.match(/^\/download\/task\/([^/]+)$/)
    if (taskMatch && normalizedMethod === 'GET') return this.getTask(taskMatch[1])
    if (taskMatch && normalizedMethod === 'DELETE') return this.deleteTask(taskMatch[1], params.delete_file)

    const actionMatch = route.match(/^\/download\/(pause|resume|cancel)\/([^/]+)$/)
    if (actionMatch && normalizedMethod === 'POST') return this.changeTask(actionMatch[2], actionMatch[1])

    throw new Error(`统一应用服务尚未实现 ${normalizedMethod} ${route}`)
  }

  parseVideoUrl(input) {
    const value = String(input || '').trim()
    const bvid = value.match(/BV[0-9A-Za-z]{10}/i)?.[0]
    const aid = value.match(/AV(\d+)/i)?.[1]
    let page = 1
    try {
      page = Number(new URL(value).searchParams.get('p')) || 1
    } catch {}
    return { type: bvid || aid ? 'video' : 'unknown', bvid: bvid || null, aid: aid ? Number(aid) : null, p: page }
  }

  getAvailableQualities(playInfo) {
    const streams = playInfo.dash?.video || []
    const formats = new Map((playInfo.support_formats || []).map(format => [Number(format.quality), format]))
    const streamByQuality = new Map()

    for (const stream of streams) {
      const qn = Number(stream.id)
      if (!streamByQuality.has(qn)) streamByQuality.set(qn, stream)
    }

    if (!streamByQuality.size && playInfo.durl?.length && playInfo.quality) {
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
      if (result.code !== 0) throw new Error(result.message || `B站请求失败: ${result.code}`)
      return { data: result.data }
    })
  }

  async getVideoInfo({ bvid, aid }) {
    if (!bvid && !aid) throw new Error('必须提供BV号或AV号')
    const cookies = this.bilibiliCookies
    const accountStatus = await this.checkVipStatus(cookies)
    const loginStatus = accountStatus.login_status
    const { data } = await this.bilibiliGet('https://api.bilibili.com/x/web-interface/view', {
      params: { bvid, aid },
      cookies
    })
    const playInfo = await this.getPlayUrl({
      bvid: data.bvid,
      cid: data.cid || data.pages?.[0]?.cid,
      quality: 127,
      login_status: loginStatus,
      cookies
    })
    const availableQualities = this.getAvailableQualities(playInfo)
    return {
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
      pages: (data.pages || []).map(page => ({ ...page, title: page.title || page.part })),
      available_qualities: availableQualities,
      login_status: loginStatus,
      quality_label: loginStatus >= 2 ? '大会员，支持全部画质' : loginStatus >= 1 ? '已登录，最高支持 1080P' : '未登录，仅支持 360P/480P'
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
    const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
    const safePageTitle = String(page?.title || `第${pageNumber}P`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    const title = isMultiPage ? `${video.title} P${pageNumber} ${page?.title || ''}`.replace(/\s+/g, ' ').trim() : video.title
    const directory = input.download_path || this.settings.default_download_path
    // 文件夹归类：仅多P视频且开启"下载到子目录"时，保存到以视频标题命名的子文件夹，文件名为 分P号+分P名称
    const useSubdir = isMultiPage && input.download_to_subdir !== false
    let filePath
    if (useSubdir) {
      const subdirName = safeTitle.trim().replace(/\.+$/, '').trimEnd() || `video-${(video.bvid || taskId).slice(0, 8)}`
      filePath = path.join(directory, subdirName, `P${pageNumber}-${safePageTitle}.mp4`)
    } else {
      const fileBase = (isMultiPage ? `${safeTitle}-P${pageNumber}-${safePageTitle}` : safeTitle).slice(0, 180)
      filePath = path.join(directory, `${fileBase}-${taskId.slice(0, 8)}.mp4`)
    }
    return {
      id: Date.now() + idOffset,
      task_id: taskId,
      title,
      bvid: video.bvid,
      aid: video.aid,
      uploader: video.uploader,
      cid: page?.cid || video.cid || pages[0]?.cid,
      page: pageNumber,
      quality: String(input.quality || 80),
      format: 'mp4',
      subdir: useSubdir,
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
    let index = 0
    while (this.isSharedDownloadPath(candidate, taskId) || fs.existsSync(candidate)) {
      const suffix = index === 0 ? '' : `-${index}`
      candidate = path.join(dir, `${name}-${taskId.slice(0, 8)}${suffix}${ext}`)
      index += 1
    }
    return candidate
  }

  temporaryDownloadPaths(task) {
    const base = path.join(path.dirname(task.file_path), `.bili-${task.task_id}`)
    return { output: `${base}.part.mp4`, video: `${base}.video.tmp`, audio: `${base}.audio.tmp` }
  }

  async startDownload(input) {
    const video = await this.getVideoInfo({ bvid: input.bvid, aid: input.aid })
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
    const video = await this.getVideoInfo({ bvid: input.bvid, aid: input.aid })
    const loginStatus = video.login_status
    const pages = video.pages || []
    if (!pages.length) throw new Error('该视频没有可下载的分P')

    let selectedPages = pages
    if (Array.isArray(input.cids) && input.cids.length > 0) {
      const cidSet = new Set(input.cids.map(cid => Number(cid)))
      const unmatched = [...cidSet].filter(cid => !pages.some(page => Number(page.cid) === cid))
      if (unmatched.length) throw new Error(`以下分P不存在，无法下载：${unmatched.join('、')}`)
      selectedPages = pages.filter(page => cidSet.has(Number(page.cid)))
    }
    if (!selectedPages.length) throw new Error('未选择任何分P')

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

  async runDownload(task, signal) {
    const { output, video, audio } = this.temporaryDownloadPaths(task)
    try {
      signal.throwIfAborted()
      this.transitionTask(task, 'downloading', { started_at: new Date().toISOString() })
      const playInfo = await this.getPlayUrl(task, signal)
      signal.throwIfAborted()
      const videoStream = playInfo.dash?.video?.find(item => item.id === Number(task.quality)) || playInfo.dash?.video?.[0]
      const audioStreams = playInfo.dash?.audio || []
      const audioStream = audioStreams.find(item => item.id === Number(task.audio_quality)) || audioStreams[0]
      const videoUrl = videoStream?.baseUrl || videoStream?.base_url
      const audioUrl = audioStream?.baseUrl || audioStream?.base_url
      const combinedUrl = playInfo.durl?.[0]?.url
      if (!videoUrl && !combinedUrl) throw new Error('未找到可下载的视频流')
      fs.mkdirSync(path.dirname(task.file_path), { recursive: true })

      if (videoUrl && audioUrl && task.auto_merge !== false) {
        try {
          await this.downloadStream(videoUrl, video, task, signal, { progressEnd: 70 })
          signal.throwIfAborted()
          await this.downloadStream(audioUrl, audio, task, signal, { progressStart: 70, progressEnd: 90 })
          signal.throwIfAborted()
          this.transitionTask(task, 'merging', { progress: 90 })
          await this.mergeStreams(video, audio, output, signal)
        } finally {
          if (task.delete_temp_files !== false) {
            for (const file of [video, audio]) {
              try {
                fs.rmSync(file, { force: true })
              } catch (error) {
                console.warn('清理下载临时文件失败:', error)
              }
            }
          }
        }
      } else {
        await this.downloadStream(combinedUrl || videoUrl, output, task, signal)
      }

      signal.throwIfAborted()
      const fileSize = fs.statSync(output).size
      if (!fileSize) throw new Error('下载文件为空')
      const filePath = this.availableDownloadPath(task.file_path, task.task_id)
      fs.renameSync(output, filePath)
      this.slowRetries.delete(task.task_id)
      this.transitionTask(task, 'completed', {
        file_path: filePath, file_size: fileSize, downloaded_size: fileSize, progress: 100,
        completed_at: new Date().toISOString()
      })
    } catch (error) {
      if (!signal.aborted && QUEUED_OR_ACTIVE.has(task.status)) {
        this.slowRetries.delete(task.task_id)
        this.transitionTask(task, 'failed', { error_message: serializeError(error) })
      }
    } finally {
      try {
        fs.rmSync(output, { force: true })
      } catch (error) {
        console.warn('清理下载临时文件失败:', error)
      }
    }
  }

  async downloadStream(url, destination, task, signal, { progressStart = 0, progressEnd = 100 } = {}) {
    signal.throwIfAborted()
    const started = Date.now()
    const headers = {
      ...BILIBILI_HEADERS,
      Origin: 'https://www.bilibili.com',
      Range: 'bytes=0-'
    }
    if (Object.keys(this.bilibiliCookies).length) headers.Cookie = cookieHeader(this.bilibiliCookies)

    const stallController = new AbortController()
    let stallTimer = null
    const STALL_TIMEOUT = 5 * 60 * 1000 // 5 分钟无数据视为连接中断
    const armStall = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => stallController.abort(new Error('下载连接已超时（长时间无数据）')), STALL_TIMEOUT)
    }
    const onUserAbort = () => stallController.abort(signal.reason)
    signal.addEventListener('abort', onUserAbort, { once: true })
    armStall()

    try {
      const response = await fetch(url, { headers, signal: stallController.signal })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new Error(`下载失败: HTTP ${response.status}`)
      }
      const total = Number(response.headers.get('content-length')) || 0
      const previousBytes = task.downloaded_size
      let downloaded = 0
      let lastEmit = 0
      let slowSince = null
      const speedWindow = [[started, 0]]
      const progressStream = new TransformStream({
        transform: async (chunk, controller) => {
          stallController.signal.throwIfAborted()
          clearTimeout(stallTimer)
          downloaded += chunk.byteLength
          const limitKbps = Number(this.settings.download_speed_limit) || 0
          if (limitKbps > 0) {
            const expectedMs = downloaded * 1000 / (limitKbps * 1024)
            const waitMs = expectedMs - (Date.now() - started)
            if (waitMs > 0) await delay(waitMs, undefined, { signal: stallController.signal })
          }
          stallController.signal.throwIfAborted()
          armStall()
          const now = Date.now()
          speedWindow.push([now, downloaded])
          while (speedWindow.length > 2 && now - speedWindow[1][0] > 10000) speedWindow.shift()
          const [windowTime, windowBytes] = speedWindow[0]
          task.speed = (downloaded - windowBytes) * 1000 / Math.max(1, now - windowTime)
          const thresholdKbps = Number(this.settings.slow_speed_threshold_kbps) || 0
          const isComplete = total > 0 && downloaded >= total
          if (this.settings.slow_speed_auto_pause !== false && !isComplete &&
              (limitKbps === 0 || limitKbps > thresholdKbps) && task.speed / 1024 < thresholdKbps) {
            slowSince ??= now
            const graceMs = (Number(this.settings.slow_speed_grace_seconds) || 15) * 1000
            if (now - slowSince >= graceMs && this.demoteSlowTask(task)) return
          } else {
            slowSince = null
          }
          const ratio = total ? Math.min(1, downloaded / total) : 0
          task.progress = progressStart + ratio * (progressEnd - progressStart)
          task.downloaded_size = previousBytes + downloaded
          if (downloaded === chunk.byteLength || isComplete || now - lastEmit >= 250) {
            lastEmit = now
            this.emitTask(task)
          }
          controller.enqueue(chunk)
        }
      })
      await pipeline(Readable.fromWeb(response.body.pipeThrough(progressStream)), fs.createWriteStream(destination), {
        signal: stallController.signal
      })
    } catch (error) {
      stallController.signal.throwIfAborted()
      throw error
    } finally {
      clearTimeout(stallTimer)
      signal.removeEventListener('abort', onUserAbort)
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
    this.transitionTask(task, 'pending', RESET_DOWNLOAD)
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
    this.downloadRuns.get(task.task_id)?.controller.abort()
    this.transitionTask(task, status)
  }

  pauseAllDownloads() {
    for (const task of this.tasks) {
      if (QUEUED_OR_ACTIVE.has(task.status) && !this.deletingTasks.has(task.task_id)) this.stopTask(task, 'paused')
    }
  }

  emitTask(task) {
    this.emit('download-update', this.publicTask(task))
  }

  publicTask(task) {
    const { cookies, ...safeTask } = task
    return safeTask
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
    if (task.status === status || (action === 'resume' && QUEUED_OR_ACTIVE.has(task.status))) return { message }
    if (!from.has(task.status)) throw new Error(`当前任务状态（${task.status}）不支持此操作`)

    this.slowRetries.delete(taskId)
    if (action === 'resume') {
      this.transitionTask(task, status, RESET_DOWNLOAD)
      this.enqueueDownload(task)
    } else {
      this.stopTask(task, status)
    }
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
      if (deleteFile && task.file_path) {
        try {
          shared = this.isSharedDownloadPath(task.file_path, taskId)
          for (const file of Object.values(this.temporaryDownloadPaths(task))) fs.rmSync(file, { force: true })
          if (!shared) fs.rmSync(task.file_path, { force: true })
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
      if (shared) return { message: '任务记录已删除，共用文件已保留' }
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

  clearCompleted() {
    const count = this.tasks.filter(task => task.status === 'completed').length
    this.tasks = this.tasks.filter(task => task.status !== 'completed')
    this._tasksById = new Map(this.tasks.map(task => [task.task_id, task]))
    this.persist()
    return { message: `已清理${count}个已完成任务` }
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
