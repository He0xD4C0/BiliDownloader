'use strict'

const { app, safeStorage } = require('electron')
const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { spawn } = require('child_process')
const ffmpegStaticPath = require('ffmpeg-static')

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

class ApplicationService extends EventEmitter {
  constructor() {
    super()
    this.tasks = []
    this.controllers = new Map()
    this.currentUser = null
    this.bilibiliCookies = {}
    this.settings = null
    this.statePath = null
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
      max_concurrent_downloads: 3,
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

    this.removeExpiredTaskRecords()
    fs.mkdirSync(this.settings.default_download_path, { recursive: true })
    this.persist()
  }

  removeExpiredTaskRecords() {
    const cutoff = Date.now() - 30 * 86400000
    const before = this.tasks.length
    this.tasks = this.tasks.filter(task => {
      const timestamp = new Date(task.completed_at || task.created_at).getTime()
      return !Number.isFinite(timestamp) || timestamp >= cutoff
    })
    const removed = before - this.tasks.length
    if (removed) console.info(`已自动清理 ${removed} 条超过30天的任务记录`)
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

  async request({ method = 'GET', url, data, params = {}, token }) {
    const route = String(url || '').replace(/^\/api\/v1/, '')
    const normalizedMethod = method.toUpperCase()

    if (normalizedMethod === 'GET' && route === '/video/parse-url') return this.parseVideoUrl(params.url)
    if (normalizedMethod === 'GET' && route === '/video/info') return this.getVideoInfo({ ...params, cookies: this.bilibiliCookies })
    if (normalizedMethod === 'POST' && route === '/video/check-vip-status') return this.checkVipStatus(this.bilibiliCookies)
    if (normalizedMethod === 'POST' && route === '/download/start') return this.startDownload(data || {})
    if (normalizedMethod === 'GET' && route === '/download/tasks') return this.listTasks(params)
    if (normalizedMethod === 'GET' && route === '/download/stats') return this.getStats()
    if (normalizedMethod === 'GET' && route === '/download/history') return this.getHistory(params.days)
    if (normalizedMethod === 'GET' && route === '/download/settings') return this.settings
    if (normalizedMethod === 'POST' && route === '/download/settings') return this.updateSettings(data)
    if (normalizedMethod === 'POST' && route === '/download/clear-completed') return this.clearCompleted()
    if (normalizedMethod === 'POST' && route === '/auth/bilibili/qrcode') return this.createQrCode()
    if (normalizedMethod === 'POST' && route === '/auth/bilibili/check-login') return this.checkQrCode(data?.qrcode_key)
    if (normalizedMethod === 'GET' && route === '/auth/session-status') return this.validateCurrentSession(token)
    if (normalizedMethod === 'GET' && route === '/auth/me') return this.getCurrentUser(token)
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

  async bilibiliGet(url, { params, cookies } = {}) {
    const target = new URL(url)
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') target.searchParams.set(key, String(value))
    }
    const headers = { ...BILIBILI_HEADERS }
    if (cookies && Object.keys(cookies).length) headers.Cookie = cookieHeader(cookies)
    const response = await fetch(target, { headers, redirect: 'follow' })
    if (!response.ok) {
      const error = new Error(`B站请求失败: HTTP ${response.status}`)
      error.transient = response.status === 408 || response.status === 429 || response.status >= 500
      throw error
    }
    const result = await response.json()
    if (result.code !== 0) throw new Error(result.message || `B站请求失败: ${result.code}`)
    return { data: result.data, response }
  }

  async getVideoInfo({ bvid, aid, login_status = 0, cookies = {} }) {
    if (!bvid && !aid) throw new Error('必须提供BV号或AV号')
    const { data } = await this.bilibiliGet('https://api.bilibili.com/x/web-interface/view', {
      params: { bvid, aid }
    })
    const loginStatus = Number(login_status) || 0
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

  async getPlayUrl(task) {
    let fnval = 16
    if ((task.login_status || 0) >= 1) fnval |= 64 | 128 | 256 | 512
    if (task.audio_quality === 30251) fnval |= 2048
    const { data } = await this.bilibiliGet('https://api.bilibili.com/x/player/playurl', {
      params: { bvid: task.bvid, cid: task.cid, qn: task.quality || 80, fnval, fnver: 0, fourk: 1 },
      cookies: task.cookies
    })
    return data
  }

  async startDownload(input) {
    const cookies = Object.keys(this.bilibiliCookies).length ? this.bilibiliCookies : (input.cookies || {})
    const video = await this.getVideoInfo({ bvid: input.bvid, aid: input.aid, login_status: input.login_status, cookies })
    const taskId = crypto.randomUUID()
    const now = new Date().toISOString()
    const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
    const directory = input.download_path || this.settings.default_download_path
    const task = {
      id: Date.now(), task_id: taskId, title: video.title, bvid: video.bvid, aid: video.aid,
      uploader: video.uploader,
      cid: input.cid || video.cid || video.pages?.[0]?.cid, page: 1,
      quality: String(input.quality || 80), format: 'mp4',
      file_path: path.join(directory, `${safeTitle}-${taskId.slice(0, 8)}.mp4`),
      file_size: null, downloaded_size: 0, status: 'pending', progress: 0, speed: null,
      error_message: null, error_trace: null, created_at: now, updated_at: null,
      started_at: null, completed_at: null, cookies,
      audio_quality: input.audio_quality, login_status: input.login_status || 0,
      auto_merge: input.auto_merge ?? this.settings.auto_merge,
      delete_temp_files: input.delete_temp_files ?? this.settings.delete_temp_files
    }
    this.tasks.unshift(task)
    this.persist()
    this.emitTask(task)
    queueMicrotask(() => this.runDownload(task).catch(error => console.error('下载任务失败:', error)))
    return { ...this.publicTask(task), message: '下载任务已创建' }
  }

  async runDownload(task) {
    const controller = new AbortController()
    this.controllers.set(task.task_id, controller)
    Object.assign(task, { status: 'downloading', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    this.persist()
    this.emitTask(task)

    try {
      const playInfo = await this.getPlayUrl(task)
      const videoStream = playInfo.dash?.video?.find(item => item.id === Number(task.quality)) || playInfo.dash?.video?.[0]
      const audioStreams = playInfo.dash?.audio || []
      const audioStream = audioStreams.find(item => item.id === Number(task.audio_quality)) || audioStreams[0]
      const videoUrl = videoStream?.baseUrl || videoStream?.base_url
      const audioUrl = audioStream?.baseUrl || audioStream?.base_url
      const combinedUrl = playInfo.durl?.[0]?.url
      if (!videoUrl && !combinedUrl) throw new Error('未找到可下载的视频流')
      fs.mkdirSync(path.dirname(task.file_path), { recursive: true })

      if (videoUrl && audioUrl && task.auto_merge !== false) {
        const videoPath = `${task.file_path}.video.tmp`
        const audioPath = `${task.file_path}.audio.tmp`
        try {
          task.progress = 0
          await this.downloadStream(videoUrl, videoPath, task, controller.signal, { progressStart: 0, progressEnd: 70 })
          await this.downloadStream(audioUrl, audioPath, task, controller.signal, { progressStart: 70, progressEnd: 90 })
          task.status = 'merging'
          task.progress = 90
          this.emitTask(task)
          await this.mergeStreams(videoPath, audioPath, task.file_path, controller.signal)
        } finally {
          if (task.delete_temp_files !== false) {
            fs.rmSync(videoPath, { force: true })
            fs.rmSync(audioPath, { force: true })
          }
        }
      } else {
        await this.downloadStream(combinedUrl || videoUrl, task.file_path, task, controller.signal)
      }

      const fileSize = fs.existsSync(task.file_path) ? fs.statSync(task.file_path).size : task.file_size
      Object.assign(task, { status: 'completed', file_size: fileSize, downloaded_size: fileSize, progress: 100, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(), speed: 0 })
    } catch (error) {
      if (controller.signal.aborted && task.status !== 'paused') task.status = 'cancelled'
      if (!controller.signal.aborted) {
        task.status = 'failed'
        task.error_message = serializeError(error)
      }
      task.updated_at = new Date().toISOString()
    } finally {
      this.controllers.delete(task.task_id)
      this.persist()
      this.emitTask(task)
    }
  }

  async downloadStream(url, destination, task, signal, { progressStart = 0, progressEnd = 100 } = {}) {
    const started = Date.now()
    const response = await fetch(url, { headers: { ...BILIBILI_HEADERS, Range: 'bytes=0-' }, signal })
    if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length')) || 0
    let downloaded = 0
    const progressStream = new TransformStream({
      transform: (chunk, controller) => {
        downloaded += chunk.byteLength
        const ratio = total ? Math.min(1, downloaded / total) : 0
        task.progress = progressStart + ratio * (progressEnd - progressStart)
        task.speed = downloaded / Math.max(1, (Date.now() - started) / 1000)
        if (downloaded === chunk.byteLength || downloaded % (4 * 1024 * 1024) < chunk.byteLength) this.emitTask(task)
        controller.enqueue(chunk)
      }
    })
    await pipeline(Readable.fromWeb(response.body.pipeThrough(progressStream)), fs.createWriteStream(destination))
  }

  mergeStreams(videoPath, audioPath, destination, signal) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(resolveFfmpegPath(), [
        '-y',
        '-i', videoPath,
        '-i', audioPath,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c', 'copy',
        '-movflags', '+faststart',
        destination
      ], { windowsHide: true })
      let stderr = ''
      const abort = () => ffmpeg.kill('SIGTERM')
      signal.addEventListener('abort', abort, { once: true })
      ffmpeg.stderr.on('data', chunk => { stderr += chunk.toString() })
      ffmpeg.on('error', error => {
        signal.removeEventListener('abort', abort)
        reject(error)
      })
      ffmpeg.on('close', code => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) return reject(new Error('合并已取消'))
        if (code === 0) return resolve()
        reject(new Error(`音视频合并失败: ${stderr.trim().split('\n').slice(-3).join(' ')}`))
      })
    })
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
    const task = this.tasks.find(item => item.task_id === taskId)
    if (!task) throw new Error('任务不存在')
    return this.publicTask(task)
  }

  async changeTask(taskId, action) {
    const task = this.tasks.find(item => item.task_id === taskId)
    if (!task) throw new Error('任务不存在')
    if (action === 'pause') {
      task.status = 'paused'
      this.controllers.get(taskId)?.abort()
    } else if (action === 'cancel') {
      task.status = 'cancelled'
      this.controllers.get(taskId)?.abort()
    } else if (action === 'resume') {
      task.status = 'pending'
      task.error_message = null
      queueMicrotask(() => this.runDownload(task).catch(error => console.error('恢复下载失败:', error)))
    }
    task.updated_at = new Date().toISOString()
    this.persist()
    this.emitTask(task)
    return { message: action === 'pause' ? '下载已暂停' : action === 'resume' ? '下载已恢复' : '下载已取消' }
  }

  deleteTask(taskId, deleteFile = false) {
    const task = this.tasks.find(item => item.task_id === taskId)
    if (!task) throw new Error('任务不存在')
    this.controllers.get(taskId)?.abort()

    if (deleteFile && task.file_path) {
      try {
        fs.rmSync(task.file_path, { force: true })
      } catch (error) {
        throw new Error(`删除下载文件失败: ${serializeError(error)}`)
      }
    }

    this.tasks = this.tasks.filter(item => item.task_id !== taskId)
    this.persist()
    return { message: deleteFile ? '任务记录和文件已删除' : '任务记录已删除' }
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
    this.settings = { ...this.settings, ...(settings || {}) }
    fs.mkdirSync(this.settings.default_download_path, { recursive: true })
    this.persist()
    return this.settings
  }

  clearCompleted() {
    const count = this.tasks.filter(task => task.status === 'completed').length
    this.tasks = this.tasks.filter(task => task.status !== 'completed')
    this.persist()
    return { message: `已清理${count}个已完成任务` }
  }

  createCurrentUser(accountInfo, previousUser = null) {
    const vip = accountInfo.vip || {}
    const vipType = vip.vipType ?? accountInfo.vip_type ?? 0
    const vipStatus = vip.vipStatus ?? accountInfo.vip_status ?? 0
    const now = new Date().toISOString()
    return {
      id: accountInfo.mid || previousUser?.id || 1,
      username: accountInfo.name || previousUser?.username || `bili_${accountInfo.mid || 'user'}`,
      email: `${accountInfo.mid || previousUser?.id || 'user'}@bilibili.local`,
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

  async validateCurrentSession(token) {
    if (!token || !this.currentUser) return { status: 'logged_out', user: null }
    if (!this.bilibiliCookies.SESSDATA || this.bilibiliCookies.SESSDATA === 'deleted') {
      this.logout()
      return { status: 'invalid', user: null }
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
    const response = await fetch(target, { headers: BILIBILI_HEADERS, redirect: 'manual' })
    const body = await response.json()
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
    return { status: 'success', message: '登录成功', access_token: crypto.randomUUID(), token_type: 'bearer', user: this.currentUser }
  }

  async getCurrentUser(token) {
    if (!token || !this.currentUser) throw new Error('未登录')
    return this.currentUser
  }

  logout() {
    this.currentUser = null
    this.bilibiliCookies = {}
    this.persist()
    return { message: '登出成功' }
  }
}

module.exports = { ApplicationService }
