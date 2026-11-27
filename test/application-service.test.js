'use strict'
const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createServer } = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { setImmediate: nextTurn } = require('node:timers/promises')
const { loadApplicationService, makeMockApp, tempDir } = require('./helpers/mock-electron')

const mockApp = makeMockApp()
const { ApplicationService } = loadApplicationService({ app: mockApp })
const sep = path.sep;

const multiPageVideo = {
  bvid: 'BV1TEST1234', aid: 1, title: '测试:视频/标题?',
  pages: [ { cid: 101, page: 1, title: '第一集' }, { cid: 102, page: 2, title: '第二集' } ]
}

const singlePageVideo = {
  bvid: 'BV1SINGLE9', aid: 2, title: '单P视频', pages: [ { cid: 201, page: 1, title: '' } ]
}

describe('buildTaskBase：分P下载到子目录归类', () => {
  let svc
  beforeEach(() => {
    svc = new ApplicationService()
    svc.settings = { default_download_path: path.join(os.tmpdir(), 'bili-base-dl') }
  })

  it('多P且未传开关 → 保存到视频标题子文件夹，文件名为 分P号+分P名称', () => {
    const t1 = svc.buildTaskBase(multiPageVideo, multiPageVideo.pages[0], {}, 1)
    assert.ok(t1.file_path.includes(sep + '测试_视频_标题_' + sep), '子文件夹名为安全化后的视频标题')
    assert.equal(path.basename(t1.file_path), 'P1-第一集.mp4')
    assert.equal(t1.subdir, true)
    const t2 = svc.buildTaskBase(multiPageVideo, multiPageVideo.pages[1], {}, 1)
    assert.equal(path.basename(t2.file_path), 'P2-第二集.mp4')
  })

  it('多P + download_to_subdir:false → 关闭归类，沿用旧命名格式', () => {
    const t = svc.buildTaskBase(multiPageVideo, multiPageVideo.pages[0], { download_to_subdir: false }, 1)
    assert.ok(!t.file_path.includes(sep + '测试_视频_标题_' + sep), '无子文件夹')
    assert.match(path.basename(t.file_path), /^测试_视频_标题_-P1-第一集-[0-9a-f]{8}\.mp4$/)
    assert.equal(t.subdir, false)
  })

  it('单P + download_to_subdir:true → 开关无效，无子文件夹', () => {
    const t = svc.buildTaskBase(singlePageVideo, singlePageVideo.pages[0], { download_to_subdir: true }, 1)
    assert.ok(!t.file_path.includes(sep + '单P视频' + sep), '单P不建子文件夹')
    assert.match(path.basename(t.file_path), /^单P视频-[0-9a-f]{8}\.mp4$/)
    assert.equal(t.subdir, false)
  })

  it('自定义保存路径 → 子文件夹建在所选路径之下', () => {
    const t = svc.buildTaskBase(multiPageVideo, multiPageVideo.pages[0], { download_path: path.join('C:', 'custom', 'dir') }, 1)
    assert.ok(t.file_path.startsWith(path.join('C:', 'custom', 'dir') + sep + '测试_视频_标题_' + sep))
  })

  it('空标题或路径保留名 → 子文件夹名回退 video-{bvid前8位}', () => {
    for (const title of ['  ', '.', '..']) {
      const video = { ...multiPageVideo, title }
      const t = svc.buildTaskBase(video, video.pages[0], {}, 1)
      assert.ok(t.file_path.includes(sep + 'video-BV1TEST1' + sep), 'bvid 截断前8位作为回退目录名')
    }
  })
})

describe('deleteTask：删除文件后的空子文件夹清理', () => {
  let svc, base, sub
  beforeEach(() => {
    svc = new ApplicationService()
    base = tempDir('bili-delete-')
    sub = path.join(base, '视频标题')
    fs.mkdirSync(sub, { recursive: true })
  })
  afterEach(() => { try { fs.rmSync(base, { recursive: true, force: true }) } catch {} })

  it('删除后目录内还有其他分P → 子文件夹保留', async () => {
    const file1 = path.join(sub, 'P1-第一集.mp4')
    const file2 = path.join(sub, 'P2-第二集.mp4')
    fs.writeFileSync(file1, 'x')
    fs.writeFileSync(file2, 'y')
    svc.registerTask({ task_id: 'a', title: 't', file_path: file1, status: 'completed', subdir: true })
    await svc.deleteTask('a', true)
    assert.equal(fs.existsSync(file1), false, '文件已删除')
    assert.equal(fs.existsSync(sub), true, '目录非空则保留')
    svc.registerTask({ task_id: 'b', title: 't', file_path: file2, status: 'completed', subdir: true })
    await svc.deleteTask('b', true)
    assert.equal(fs.existsSync(file2), false)
    assert.equal(fs.existsSync(sub), false, '最后一个文件删除后空目录被移除')
    assert.equal(fs.existsSync(base), true, '基础下载目录保留')
  })

  it('deleteFile=false → 文件与目录均保留', async () => {
    const file3 = path.join(sub, 'P1-x.mp4')
    fs.writeFileSync(file3, 'x')
    svc.registerTask({ task_id: 'c', title: 't', file_path: file3, status: 'completed', subdir: true })
    await svc.deleteTask('c', false)
    assert.equal(fs.existsSync(file3), true)
    assert.equal(fs.existsSync(sub), true)
  })
})

describe('设置默认值', () => {
  it('初始化时并行数/限速/低速自动暂停默认值正确', (t) => {
    const fakeProfile = tempDir('bili-profile-')
    const originalGetPath = mockApp.getPath
    t.mock.method(mockApp, 'getPath', name => name === 'home' ? fakeProfile : originalGetPath(name))
    const oldProfile = process.env.USERPROFILE
    process.env.USERPROFILE = fakeProfile
    let svc
    try {
      svc = new ApplicationService()
      svc.initialize()
      assert.equal(svc.settings.max_concurrent_downloads, 4)
      assert.equal(svc.settings.download_speed_limit, 0)
      assert.equal(svc.settings.slow_speed_threshold_kbps, 50)
      assert.equal(svc.settings.slow_speed_grace_seconds, 15)
      assert.equal(svc.settings.slow_speed_auto_pause, true)
    } finally {
      if (oldProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = oldProfile
      if (svc && svc.statePath) fs.rmSync(path.dirname(svc.statePath), { recursive: true, force: true })
      fs.rmSync(fakeProfile, { recursive: true, force: true })
    }
  })
})

describe('下载任务状态机', () => {
  let svc, directory
  const post = (url, data) => svc.request({ method: 'POST', url: '/download/' + url, data })
  const start = (data = {}) => post('start', { bvid: multiPageVideo.bvid, ...data })
  const remove = (task, deleteFile = false) => svc.request({
    method: 'DELETE', url: '/download/task/' + task.task_id, params: { delete_file: deleteFile }
  })

  beforeEach(() => {
    directory = tempDir('bili-state-')
    svc = new ApplicationService()
    svc.statePath = path.join(directory, 'application-state.json')
    svc.settings = { default_download_path: directory, max_concurrent_downloads: 2 }
    svc.getVideoInfo = async () => multiPageVideo
    svc.getPlayUrl = async () => ({ durl: [{ url: 'https://example.invalid/video' }] })
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('暂停后立即恢复，旧进程退出前同一个任务只运行一次', async () => {
    let releaseFirst
    const first = new Promise(resolve => { releaseFirst = resolve })
    const attempts = []
    svc.downloadStream = async (_url, destination, task, signal) => {
      attempts.push(signal)
      if (attempts.length === 1) await first
      if (!signal.aborted) fs.writeFileSync(destination, 'complete')
    }
    const task = await start()
    try {
      await nextTurn()
      await post('pause/' + task.task_id)
      await post('resume/' + task.task_id)
      await post('resume/' + task.task_id)
      await nextTurn()
      assert.equal(attempts.length, 1)
      assert.equal(svc.getTask(task.task_id).status, 'pending')
      assert.equal(attempts[0].aborted, true)
    } finally {
      releaseFirst()
      await nextTurn()
    }
    assert.equal(attempts.length, 2)
    assert.equal(svc.getTask(task.task_id).status, 'completed')
    assert.equal(fs.readFileSync(task.file_path, 'utf8'), 'complete')
  })

  it('已完成任务拒绝暂停、恢复和取消', async () => {
    svc.downloadStream = async (_url, destination) => fs.writeFileSync(destination, 'complete')
    const task = await start()
    await nextTurn()
    for (const action of ['pause', 'resume', 'cancel']) {
      await assert.rejects(post(action + '/' + task.task_id), /状态/)
    }
    assert.equal(svc.getTask(task.task_id).status, 'completed')
  })

  it('下载失败时清除临时文件，重试清除上一次的错误与进度', async () => {
    let attempt = 0
    svc.downloadStream = async (_url, destination, task) => {
      attempt += 1
      if (attempt === 1) {
        fs.writeFileSync(destination, 'partial')
        Object.assign(task, { progress: 42, downloaded_size: 7, speed: 5 })
        throw new Error('连接中断')
      }
      assert.equal(task.progress, 0)
      assert.equal(task.downloaded_size, 0)
      assert.equal(task.error_message, null)
      fs.writeFileSync(destination, 'complete')
    }
    const task = await start()
    await nextTurn()
    const failed = svc.getTask(task.task_id)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error_message, '连接中断')
    assert.equal(failed.speed, null)
    assert.deepEqual(fs.readdirSync(path.dirname(task.file_path)), [])

    await post('resume/' + task.task_id)
    await nextTurn()
    assert.equal(svc.getTask(task.task_id).status, 'completed')
    assert.equal(fs.readFileSync(task.file_path, 'utf8'), 'complete')
  })

  it('删除正在合并的任务时等待合并退出，清除临时输出且不再推送更新', async () => {
    let releaseMerge
    const merge = new Promise(resolve => { releaseMerge = resolve })
    const events = []
    svc.on('download-update', task => events.push(task.status))
    svc.getPlayUrl = async () => ({ dash: { video: [{ baseUrl: 'video' }], audio: [{ baseUrl: 'audio' }] } })
    svc.downloadStream = async (_url, destination) => fs.writeFileSync(destination, 'stream')
    svc.mergeStreams = async (_video, _audio, destination) => {
      await merge
      fs.writeFileSync(destination, 'partial merge')
    }
    const task = await start()
    await nextTurn()
    assert.equal(svc.getTask(task.task_id).status, 'merging')
    let deleted = false
    const deletion = remove(task, true).then(() => { deleted = true })
    try {
      await nextTurn()
      assert.equal(deleted, false)
    } finally {
      releaseMerge()
      await deletion
      await nextTurn()
    }
    assert.throws(() => svc.getTask(task.task_id), /任务不存在/)
    assert.equal(events.includes('completed'), false)
    assert.deepEqual(fs.readdirSync(directory), ['application-state.json'])
  })

  it('同一分P的多个下载使用独立文件，删除其中之一保留另一个', async () => {
    svc.downloadStream = async (_url, destination, task) => fs.writeFileSync(destination, task.task_id)
    const first = await start()
    const second = await start()
    await nextTurn()
    assert.notEqual(first.file_path, second.file_path)
    await remove(first, true)
    assert.equal(fs.readFileSync(second.file_path, 'utf8'), second.task_id)
  })

  it('单个下载按传入 CID 下载对应分P，拒绝找不到的 CID', async () => {
    svc.downloadStream = async (_url, destination, task) => fs.writeFileSync(destination, String(task.cid))
    const selected = await start({ cid: '102' })
    await assert.rejects(start({ cid: 999 }), /分P不存在/)
    await nextTurn()
    assert.equal(selected.page, 2)
    assert.equal(fs.readFileSync(selected.file_path, 'utf8'), '102')
    assert.equal(svc.listTasks().total, 1)
  })

  it('删除旧版共用路径的任务时保留仍被引用的文件', async () => {
    const file = path.join(directory, 'legacy.mp4')
    fs.writeFileSync(file, 'legacy')
    svc.registerTask({ task_id: 'old-a', status: 'completed', file_path: file })
    svc.registerTask({ task_id: 'old-b', status: 'completed', file_path: file })
    assert.match((await remove(svc.getTask('old-a'), true)).message, /共用文件已保留/)
    assert.equal(fs.readFileSync(file, 'utf8'), 'legacy')
    await remove(svc.getTask('old-b'), true)
    assert.equal(fs.existsSync(file), false)
  })

  it('降低并发暂停较早开始的任务，提升后仍等待被中止任务退出', async () => {
    svc.settings.max_concurrent_downloads = 4
    let release
    const active = new Promise(resolve => { release = resolve })
    const attempts = new Map()
    svc.downloadStream = async (_url, destination, task, signal) => {
      attempts.set(task.task_id, signal)
      await active
      if (!signal.aborted) fs.writeFileSync(destination, 'complete')
    }
    const tasks = []
    try {
      for (let i = 0; i < 5; i++) tasks.push(await start())
      await nextTurn()
      await post('settings', { max_concurrent_downloads: 2 })
      assert.deepEqual(tasks.map(task => svc.getTask(task.task_id).status),
        ['paused', 'paused', 'downloading', 'downloading', 'pending'])
      assert.deepEqual([...attempts.values()].map(signal => signal.aborted), [true, true, false, false])
      const stored = JSON.parse(fs.readFileSync(svc.statePath, 'utf8'))
      assert.equal(stored.tasks.filter(task => task.status === 'paused').length, 2)
      await post('settings', { max_concurrent_downloads: 3 })
      assert.equal(attempts.has(tasks[4].task_id), false)
    } finally {
      release()
      await nextTurn()
    }
    assert.equal(svc.getTask(tasks[4].task_id).status, 'completed')
  })

  it('全部暂停同时清除排队任务，取消仍可用于已暂停任务', async () => {
    svc.settings.max_concurrent_downloads = 1
    const attempted = []
    svc.getPlayUrl = async (task, signal) => {
      attempted.push(task.task_id)
      signal.throwIfAborted()
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    const { tasks } = await post('start-batch', { bvid: multiPageVideo.bvid })
    await nextTurn()
    svc.pauseAllDownloads()
    await post('cancel/' + tasks[1].task_id)
    await nextTurn()
    assert.deepEqual(attempted, [tasks[0].task_id])
    assert.deepEqual(tasks.map(task => svc.getTask(task.task_id).status), ['paused', 'cancelled'])
    await assert.rejects(post('resume/' + tasks[1].task_id), /状态/)
  })

  it('低速仅在其他任务等待时让位，每次手动启动最多自动重排一次', async () => {
    svc.settings.max_concurrent_downloads = 1
    let release
    const waiting = new Promise(resolve => { release = resolve })
    const runs = []
    svc.downloadStream = async (_url, destination, task, signal) => {
      runs.push(task.task_id)
      if (runs.length === 1) await waiting
      task.progress = 42
      const demoted = svc.demoteSlowTask(task)
      if (demoted) {
        assert.equal(task.progress, 0)
        assert.equal(task.downloaded_size, 0)
        assert.equal(task.speed, null)
        assert.equal(signal.aborted, true)
      } else {
        fs.writeFileSync(destination, 'complete')
      }
    }
    const first = await start()
    const second = await start()
    try {
      await nextTurn()
    } finally {
      release()
      await nextTurn()
    }
    assert.deepEqual(runs, [first.task_id, second.task_id, first.task_id, second.task_id])
    assert.equal(svc.getTask(first.task_id).status, 'completed')
    assert.equal(svc.getTask(second.task_id).status, 'completed')
  })

  it('重启恢复合并中和排队任务，保留仍可恢复的旧记录', (t) => {
    t.mock.method(mockApp, 'getPath', () => directory)
    const old = new Date(Date.now() - 40 * 86400000).toISOString()
    fs.writeFileSync(svc.statePath, JSON.stringify({
      settings: svc.settings,
      tasks: ['merging', 'pending', 'downloading', 'failed', 'completed', 'cancelled'].map(status => ({
        task_id: status, status, created_at: old, speed: 123
      }))
    }))
    const restarted = new ApplicationService()
    restarted.initialize()
    const stored = JSON.parse(fs.readFileSync(svc.statePath, 'utf8'))
    assert.deepEqual(stored.tasks.map(task => task.status), ['paused', 'paused', 'paused', 'failed'])
    assert.deepEqual(stored.tasks.slice(0, 3).map(task => task.speed), [null, null, null])
    assert.equal(restarted.getTask('merging').status, 'paused')
  })

  it('取消正在限速等待的 HTTP 下载，及时释放名额与临时文件', { timeout: 5000 }, async () => {
    let enterThrottle
    const throttling = new Promise(resolve => { enterThrottle = resolve })
    const server = createServer((request, response) => {
      if (request.url === '/slow') {
        response.writeHead(200, { 'Content-Length': 8192 })
        response.write(Buffer.alloc(4096))
      } else {
        response.end('complete')
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const baseUrl = 'http://127.0.0.1:' + server.address().port
      svc.settings.max_concurrent_downloads = 1
      let speedLimit = 0.01
      Object.defineProperty(svc.settings, 'download_speed_limit', {
        get() {
          enterThrottle()
          return speedLimit
        }
      })
      svc.getPlayUrl = async task => ({ durl: [{ url: baseUrl + (task.page === 1 ? '/slow' : '/fast') }] })
      const { tasks } = await post('start-batch', { bvid: multiPageVideo.bvid })
      await throttling
      const worker = svc.downloadRuns.get(tasks[0].task_id)
      speedLimit = 0
      await post('cancel/' + tasks[0].task_id)
      await worker.done
      await svc.downloadRuns.get(tasks[1].task_id)?.done
      assert.equal(svc.getTask(tasks[0].task_id).status, 'cancelled')
      assert.equal(svc.getTask(tasks[1].task_id).status, 'completed')
      assert.deepEqual(fs.readdirSync(path.dirname(tasks[0].file_path)), [path.basename(tasks[1].file_path)])
    } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  })
})
