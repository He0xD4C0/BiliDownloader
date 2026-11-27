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
    assert.equal(path.basename(t1.file_path), 'P01 - 第一集.mp4')
    assert.equal(t1.subdir, true)
    const t2 = svc.buildTaskBase(multiPageVideo, multiPageVideo.pages[1], {}, 1)
    assert.equal(path.basename(t2.file_path), 'P02 - 第二集.mp4')
  })

  it('多P + download_to_subdir:false → 标题和分集号写入同一个文件名', () => {
    const t = svc.buildTaskBase(multiPageVideo, multiPageVideo.pages[0], { download_to_subdir: false }, 1)
    assert.ok(!t.file_path.includes(sep + '测试_视频_标题_' + sep), '无子文件夹')
    assert.equal(path.basename(t.file_path), '测试_视频_标题_ - P01 - 第一集.mp4')
    assert.equal(t.subdir, false)
  })

  it('单P + download_to_subdir:true → 开关无效，无子文件夹', () => {
    const t = svc.buildTaskBase(singlePageVideo, singlePageVideo.pages[0], { download_to_subdir: true }, 1)
    assert.ok(!t.file_path.includes(sep + '单P视频' + sep), '单P不建子文件夹')
    assert.equal(path.basename(t.file_path), '单P视频.mp4')
    assert.equal(t.subdir, false)
  })

  it('自定义保存路径 → 子文件夹建在所选路径之下', () => {
    const t = svc.buildTaskBase(multiPageVideo, multiPageVideo.pages[0], { download_path: path.join('C:', 'custom', 'dir') }, 1)
    assert.ok(t.file_path.startsWith(path.join('C:', 'custom', 'dir') + sep + '测试_视频_标题_' + sep))
  })

  it('空标题及 Windows 保留名生成可用路径', () => {
    for (const title of ['  ', '.', '..']) {
      const video = { ...multiPageVideo, title }
      const t = svc.buildTaskBase(video, video.pages[0], {}, 1)
      assert.ok(t.file_path.includes(sep + '未命名视频' + sep))
    }
    const reserved = svc.buildTaskBase({ ...singlePageVideo, title: 'CON.txt.' }, singlePageVideo.pages[0], {}, 1)
    assert.equal(path.basename(reserved.file_path), '_CON.txt.mp4')
  })

  it('长中文和 emoji 标题生成可在磁盘创建的文件名', () => {
    const directory = tempDir('bili-filename-')
    try {
      const page = { cid: 101, page: 1, title: '🎬'.repeat(40) }
      const video = { ...multiPageVideo, title: '标题'.repeat(65), pages: [page, multiPageVideo.pages[1]] }
      for (const download_to_subdir of [true, false]) {
        const task = svc.buildTaskBase(video, page, { download_path: directory, download_to_subdir }, 1)
        const filename = path.basename(task.file_path)
        assert.ok(Buffer.byteLength(filename) <= 255)
        assert.equal(filename, Buffer.from(filename).toString())
        fs.mkdirSync(path.dirname(task.file_path), { recursive: true })
        fs.writeFileSync(task.file_path, 'media')
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('分集、可用画质和解析错误', () => {
  const svc = new ApplicationService()
  const video = {
    bvid: 'BV1yW411p7V1', aid: 1, title: '样例',
    pages: Array.from({ length: 29 }, (_, index) => ({ cid: 101 + index, page: index + 1, part: '分集 ' + (index + 1) }))
  }
  const stream = id => ({ id, baseUrl: 'https://example.invalid/' + id })
  const resolve = url => svc.request({ url: '/video/resolve', params: { url } })

  beforeEach(() => {
    svc.settings = { default_quality: '1080p' }
    svc.bilibiliGet = async () => ({ data: video })
    svc.getPlayUrl = async ({ cid }) => ({ dash: { video: cid === 103 ? [stream(32), stream(16)] : [stream(80)] } })
  })

  it('显式定位第 3 集并读取该集画质，普通链接从第 1 集开始', async () => {
    const explicit = await resolve('https://www.bilibili.com/video/BV1yW411p7V1/?p=3')
    assert.equal(explicit.requested_page, 3)
    assert.equal(explicit.video.selected_cid, 103)
    assert.equal(explicit.video.selected_quality.qn, 32)
    assert.equal(explicit.video.pages[2].grouped_filename, path.join('样例', 'P03 - 分集 3.mp4'))
    const implicit = await resolve(video.bvid)
    assert.equal(implicit.requested_page, null)
    assert.equal(implicit.video.selected_cid, 101)
    assert.equal(implicit.video.selected_quality.qn, 80)
    assert.equal(svc.parseVideoUrl(' av123 ').aid, 123)
  })

  it('格式、分集、不可访问和暂时失败分别返回类型', async () => {
    assert.equal((await resolve('https://other.example/video/' + video.bvid)).error, 'invalid_input')
    assert.equal((await resolve('https://www.bilibili.com/video/' + video.bvid + '?p=30')).error, 'invalid_page')
    assert.equal((await resolve('https://www.bilibili.com/video/' + video.bvid + '?p=2.5')).error, 'invalid_page')
    svc.bilibiliGet = async () => { throw Object.assign(new Error('稿件不可见'), { bilibiliCode: 62002 }) }
    assert.equal((await resolve(video.bvid)).error, 'not_accessible')
    svc.bilibiliGet = async () => { throw new Error('timeout') }
    assert.equal((await resolve(video.bvid)).error, 'temporary_failure')
  })

  it('按默认画质选精确档、最高较低档或最低可用档', async () => {
    svc.getPlayUrl = async () => ({ dash: { video: [stream(116), stream(64), stream(32)] } })
    assert.equal((await resolve(video.bvid)).video.selected_quality.qn, 64)
    svc.settings.default_quality = '360p'
    assert.equal((await resolve(video.bvid)).video.selected_quality.qn, 32)
    svc.settings.default_quality = '480p'
    assert.equal((await resolve(video.bvid)).video.selected_quality.qn, 32)
  })

  it('预检指出回落和无视频流的分集，批量入口拒绝空列表', async () => {
    const preview = await svc.previewDownload({ bvid: video.bvid, cids: [101, 103], quality: 80 })
    assert.deepEqual(preview.map(item => [item.page, item.quality.qn]), [[1, 80], [3, 32]])
    svc.getPlayUrl = async () => ({})
    assert.deepEqual(await svc.previewDownload({ bvid: video.bvid, cids: [103], quality: 80 }), [
      { cid: 103, page: 3, quality: null, status: 'no_stream' }
    ])
    await assert.rejects(svc.startBatchDownload({ bvid: video.bvid, cids: [] }), /请选择/)
    assert.equal(svc.tasks.length, 0)
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

  it('无可用断点时保留进度，显式重新下载后清除错误与进度', async () => {
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
    assert.equal(failed.resume_state, 'restart_required')
    assert.equal(failed.progress, 42)
    assert.equal(failed.speed, null)
    assert.equal((await post('resume/' + task.task_id)).outcome, 'restart_required')
    assert.equal(fs.readFileSync(svc.temporaryDownloadPaths(task).output, 'utf8'), 'partial')

    await post('restart/' + task.task_id)
    await nextTurn()
    assert.equal(svc.getTask(task.task_id).status, 'completed')
    assert.equal(fs.readFileSync(task.file_path, 'utf8'), 'complete')
  })

  it('删除正在合并的任务时等待合并退出，清除临时输出且不再推送更新', async () => {
    let releaseMerge
    const merge = new Promise(resolve => { releaseMerge = resolve })
    const events = []
    svc.on('download-update', task => events.push(task.status))
    svc.getPlayUrl = async () => ({ dash: { video: [{ id: 80, baseUrl: 'video' }], audio: [{ baseUrl: 'audio' }] } })
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
    assert.equal(path.basename(second.file_path), 'P01 - 第一集 (2).mp4')
    await remove(first, true)
    assert.equal(fs.readFileSync(second.file_path, 'utf8'), second.task_id)
  })

  it('使用实际下载流的画质，并保留提交前确认的画质', async () => {
    svc.getPlayUrl = async ({ quality }) => {
      assert.equal(quality, 64)
      return { dash: { video: [{ id: 80, baseUrl: 'higher' }, { id: 32, baseUrl: 'lower' }] } }
    }
    svc.downloadStream = async (url, destination) => {
      assert.equal(url, 'lower')
      fs.writeFileSync(destination, 'complete')
    }
    const task = await start({ quality: 80, quality_by_cid: { 101: 64 } })
    await nextTurn()
    assert.equal(svc.getTask(task.task_id).status, 'completed')
    assert.equal(svc.getTask(task.task_id).planned_quality_name, '720P')
    assert.equal(svc.getTask(task.task_id).actual_quality_name, '480P')
  })

  it('按确认时的任务范围暂停和清理，保留后来完成的任务及文件', async () => {
    const file = path.join(directory, 'keep.mp4')
    fs.writeFileSync(file, 'content')
    svc.registerTask({ task_id: 'old-completed', status: 'completed', file_path: file })
    svc.registerTask({ task_id: 'new-completed', status: 'completed', file_path: file })
    svc.registerTask({ task_id: 'scoped', status: 'pending' })
    svc.registerTask({ task_id: 'outside', status: 'pending' })
    await post('pause-all', { task_ids: ['scoped'] })
    assert.equal(svc.getTask('scoped').status, 'paused')
    assert.equal(svc.getTask('outside').status, 'pending')
    const result = await post('clear-completed', { task_ids: ['old-completed', 'outside'] })
    assert.deepEqual(result.task_ids, ['old-completed'])
    assert.equal(svc.getTask('new-completed').status, 'completed')
    assert.equal(fs.existsSync(file), true)
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
    const { tasks } = await post('start-batch', { bvid: multiPageVideo.bvid, cids: [101, 102] })
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
      const { tasks } = await post('start-batch', { bvid: multiPageVideo.bvid, cids: [101, 102] })
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

describe('真实 HTTP 断点续传', () => {
  let svc, directory, servers
  const data = Buffer.from(Uint8Array.from({ length: 512 * 1024 }, (_, index) => (index * 19 + Math.floor(index / 256)) % 251))
  const etag = '"fixture-video"'
  const lastModified = 'Wed, 01 Jan 2020 00:00:00 GMT'
  const chunk = 128 * 1024

  beforeEach(() => {
    directory = tempDir('bili-resume-')
    servers = []
    svc = new ApplicationService()
    svc.statePath = path.join(directory, 'application-state.json')
    svc.settings = { default_download_path: directory, max_concurrent_downloads: 1 }
    svc.getVideoInfo = async () => singlePageVideo
  })

  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
    await Promise.allSettled([...svc.downloadRuns.values()].map(run => run.done))
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const start = (data = {}) => svc.request({
    method: 'POST', url: '/download/start', data: { ...data, bvid: singlePageVideo.bvid }
  })
  const action = (type, taskId) => svc.request({ method: 'POST', url: '/download/' + type + '/' + taskId })

  async function host(handler) {
    const server = createServer(handler)
    servers.push(server)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    return 'http://127.0.0.1:' + server.address().port
  }

  function writeMedia(req, res, { bytes = data, until = bytes.length, tag = etag, modified, status = 206, invalidRange } = {}) {
    const offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range)?.[1] || 0)
    const from = status === 200 ? 0 : offset
    const headers = { 'Content-Length': bytes.length - from }
    if (tag) headers.ETag = tag
    if (modified) headers['Last-Modified'] = modified
    if (status === 206) headers['Content-Range'] = invalidRange || 'bytes ' + from + '-' + (bytes.length - 1) + '/' + bytes.length
    res.writeHead(status, headers)
    if (until === bytes.length) res.end(bytes.subarray(from))
    else res.write(bytes.subarray(from, until))
  }

  async function waitForTask(id, predicate) {
    const limit = Date.now() + 4000
    while (Date.now() < limit) {
      const task = svc.getTask(id)
      if (predicate(task)) return task
      await new Promise(resolve => setTimeout(resolve, 8))
    }
    assert.fail('Task condition timed out: ' + JSON.stringify(svc.getTask(id)))
  }

  async function pauseAt(task, size) {
    const active = await waitForTask(task.task_id, current => current.downloaded_size === size)
    const worker = svc.downloadRuns.get(task.task_id)
    await action('pause', task.task_id)
    await worker.done
    const paused = svc.getTask(task.task_id)
    assert.equal(paused.status, 'paused')
    assert.equal(paused.progress, active.progress)
    assert.equal(paused.downloaded_size, size)
    assert.equal(paused.speed, null)
    return paused
  }

  it('同源暂停两次，续传请求只获取剩余字节，首屏进度不归零', async () => {
    const requests = []
    const origin = await host((req, res) => {
      requests.push(req.headers)
      writeMedia(req, res, { until: [chunk, chunk * 2, data.length][requests.length - 1] })
    })
    let urlCount = 0
    svc.getPlayUrl = async () => ({ quality: 80, durl: [{ url: origin + '/video.mp4?t=' + ++urlCount }] })
    const task = await start()
    for (const end of [chunk, chunk * 2]) {
      const paused = await pauseAt(task, end)
      const seen = []
      const observe = updated => { if (updated.task_id === task.task_id) seen.push(updated) }
      svc.on('download-update', observe)
      const queued = await action('resume', task.task_id)
      svc.off('download-update', observe)
      assert.equal(queued.outcome, 'queued')
      assert.equal(seen[0].status, 'pending')
      assert.equal(seen[0].progress, paused.progress)
      assert.equal(seen[0].downloaded_size, end)
    }
    const done = await waitForTask(task.task_id, current => current.status === 'completed')
    assert.deepEqual(fs.readFileSync(done.file_path), data)
    assert.deepEqual(requests.map(req => req.range), ['bytes=0-', 'bytes=' + chunk + '-', 'bytes=' + chunk * 2 + '-'])
    assert.deepEqual(requests.map(req => req['if-range']), [undefined, etag, etag])
    assert.ok(requests.every(req => req['accept-encoding']?.split(/,\s*/).every(encoding => encoding === 'identity')))
    assert.deepEqual(fs.readdirSync(path.dirname(done.file_path)), [path.basename(done.file_path), 'application-state.json'].sort((a, b) => a > b ? 1 : -1))
    assert.equal(svc._tasksById.get(task.task_id).resume_checkpoint, undefined)
  })

  it('刷新签名及更换 CDN 后，以强 Last-Modified 与最多 64 KiB 重叠核对后跨重启续传', async t => {
    const requests = []
    const first = await host((req, res) => writeMedia(req, res, { until: chunk, tag: null, modified: lastModified }))
    const second = await host((req, res) => {
      requests.push(req.headers)
      writeMedia(req, res, { tag: null, modified: lastModified })
    })
    svc.getPlayUrl = async () => ({ quality: 80, durl: [{ url: first + '/video.mp4?token=old' }] })
    const task = await start()
    const paused = await pauseAt(task, chunk)
    assert.equal('resume_checkpoint' in paused, false)
    assert.equal(fs.readFileSync(svc.statePath, 'utf8').includes('token=old'), false)

    t.mock.method(mockApp, 'getPath', () => directory)
    svc = new ApplicationService()
    svc.initialize()
    svc.getPlayUrl = async () => ({ quality: 80, durl: [{ url: second + '/video.mp4?token=new' }] })
    assert.equal(svc.getTask(task.task_id).progress, paused.progress)
    assert.equal((await action('resume', task.task_id)).outcome, 'queued')
    const done = await waitForTask(task.task_id, current => current.status === 'completed')
    assert.equal(requests[0].range, 'bytes=' + (chunk - 64 * 1024) + '-')
    assert.equal(requests[0]['if-range'], lastModified)
    assert.deepEqual(fs.readFileSync(done.file_path), data)
  })


  it('刷新地址后优先使用同源同路径的备用地址，从精确偏移开始', async () => {
    const requests = []
    const first = await host((req, res) => {
      requests.push({ host: 'first', range: req.headers.range, url: req.url })
      writeMedia(req, res, { until: requests.length === 1 ? chunk : data.length })
    })
    const second = await host((req, res) => {
      requests.push({ host: 'second', range: req.headers.range, url: req.url })
      writeMedia(req, res)
    })
    let playCalls = 0
    svc.getPlayUrl = async () => {
      const url = ++playCalls === 1
        ? { url: first + '/video.mp4?t=original' }
        : {
            url: second + '/video.mp4?t=primary',
            backup_url: [first + '/other.mp4?t=wrong', first + '/video.mp4?t=fresh']
          }
      return { quality: 80, durl: [url] }
    }
    const task = await start()
    await pauseAt(task, chunk)
    await action('resume', task.task_id)
    const done = await waitForTask(task.task_id, current => current.status === 'completed')
    assert.deepEqual(requests, [
      { host: 'first', range: 'bytes=0-', url: '/video.mp4?t=original' },
      { host: 'first', range: 'bytes=' + chunk + '-', url: '/video.mp4?t=fresh' }
    ])
    assert.deepEqual(fs.readFileSync(done.file_path), data)
  })


  it('首次选择有强 ETag 的 CDN，主地址续传返回 200 时切到匹配实际 GET 验证器的备用地址', async () => {
    const requests = []
    const cookiesByMethod = []
    svc.bilibiliCookies = { fixture: 'example' }
    function track(hostName, req) {
      cookiesByMethod.push([req.method, req.headers.cookie])
      requests.push({
        hostName, method: req.method, range: req.headers.range,
        ifRange: req.headers['if-range'], url: req.url
      })
    }
    const weak = await host((req, res) => {
      track('weak', req)
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': data.length, ETag: 'W/"weak"' })
        res.end()
      } else {
        writeMedia(req, res, { status: 200, tag: 'W/"weak"' })
      }
    })
    const stable = await host((req, res) => {
      track('stable', req)
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': data.length, ETag: '"head-metadata"' })
        res.end()
      } else {
        writeMedia(req, res, { until: chunk })
      }
    })
    const fallback = await host((req, res) => {
      track('fallback', req)
      writeMedia(req, res)
    })
    let playCalls = 0
    svc.getPlayUrl = async () => ({
      quality: 80,
      durl: [{
        url: weak + '/video.mp4?t=fresh',
        backupUrl: [++playCalls === 1 ? stable + '/video.mp4?t=first' : fallback + '/video.mp4?t=second']
      }]
    })
    const task = await start()
    await pauseAt(task, chunk)
    await action('resume', task.task_id)
    const done = await waitForTask(task.task_id, current => current.status === 'completed')
    assert.deepEqual(requests.filter(req => req.method === 'HEAD').map(req => req.hostName).sort(), ['stable', 'weak'])
    assert.deepEqual(requests.filter(req => req.method === 'GET'), [
      { hostName: 'stable', method: 'GET', range: 'bytes=0-', ifRange: undefined, url: '/video.mp4?t=first' },
      { hostName: 'weak', method: 'GET', range: 'bytes=' + (chunk - 64 * 1024) + '-', ifRange: etag, url: '/video.mp4?t=fresh' },
      { hostName: 'fallback', method: 'GET', range: 'bytes=' + (chunk - 64 * 1024) + '-', ifRange: etag, url: '/video.mp4?t=second' }
    ])
    assert.ok(cookiesByMethod.every(([, cookie]) => cookie === undefined))
    assert.deepEqual(fs.readFileSync(done.file_path), data)
  })

  it('跨源响应验证器相同但重叠字节不同，不写入内容并要求显式重新下载', async () => {
    const changed = Buffer.from(data)
    changed[chunk - 1] ^= 1
    const first = await host((req, res) => writeMedia(req, res, { until: chunk }))
    const second = await host((req, res) => writeMedia(req, res, { bytes: changed }))
    let origin = first
    svc.getPlayUrl = async () => ({ quality: 80, durl: [{ url: origin + '/video.mp4' }] })
    const task = await start()
    const paused = await pauseAt(task, chunk)
    origin = second
    const original = svc.temporaryDownloadPaths(task).output
    assert.equal((await action('resume', task.task_id)).outcome, 'queued')
    const rejected = await waitForTask(task.task_id, current => current.resume_state === 'restart_required')
    assert.equal(rejected.status, 'paused')
    assert.equal(rejected.progress, paused.progress)
    assert.deepEqual(fs.readFileSync(original), data.subarray(0, chunk))
    assert.equal((await action('resume', task.task_id)).outcome, 'restart_required')
    assert.equal((await action('restart', task.task_id)).outcome, 'queued')
    const done = await waitForTask(task.task_id, current => current.status === 'completed')
    assert.deepEqual(fs.readFileSync(done.file_path), changed)
  })

  for (const reason of ['200', '416', 'bad-range', 'changed-validator', 'weak-validator']) {
    it(reason + ' 时保留原进度且不把响应追加到旧文件', async () => {
      let requests = 0
      const origin = await host((req, res) => {
        requests += 1
        if (requests === 1) {
          writeMedia(req, res, { until: chunk, tag: reason === 'weak-validator' ? 'W/' + etag : etag })
          return
        }
        if (reason === '416') {
          res.writeHead(416, { 'Content-Range': 'bytes */' + data.length })
          res.end()
        } else {
          writeMedia(req, res, {
            status: reason === '200' ? 200 : 206,
            tag: reason === 'changed-validator' ? '"changed"' : etag,
            invalidRange: reason === 'bad-range' ? 'bytes 0-1/' + data.length : undefined
          })
        }
      })
      svc.getPlayUrl = async () => ({ quality: 80, durl: [{ url: origin + '/video.mp4' }] })
      const task = await start()
      const paused = await pauseAt(task, chunk)
      const result = await action('resume', task.task_id)
      assert.equal(result.outcome, reason === 'weak-validator' ? 'restart_required' : 'queued')
      const rejected = await waitForTask(task.task_id, current => current.resume_state === 'restart_required')
      assert.equal(rejected.status, 'paused')
      assert.equal(rejected.progress, paused.progress)
      assert.deepEqual(fs.readFileSync(svc.temporaryDownloadPaths(task).output), data.subarray(0, chunk))
    })
  }

  it('续传收到 503 时保留断点，网络恢复后继续取得剩余字节', async () => {
    const requests = []
    const origin = await host((req, res) => {
      requests.push(req.headers.range)
      if (requests.length === 2) {
        res.writeHead(503)
        res.end()
      } else {
        writeMedia(req, res, { until: requests.length === 1 ? chunk : data.length })
      }
    })
    svc.getPlayUrl = async () => ({ quality: 80, durl: [{ url: origin + '/video.mp4' }] })
    const task = await start()
    await pauseAt(task, chunk)
    await action('resume', task.task_id)
    const failed = await waitForTask(task.task_id, current => current.status === 'failed')
    assert.equal(failed.resume_state, null)
    assert.equal(failed.downloaded_size, chunk)
    assert.match(failed.error_message, /503/)
    await action('resume', task.task_id)
    const done = await waitForTask(task.task_id, current => current.status === 'completed')
    assert.deepEqual(requests, ['bytes=0-', 'bytes=' + chunk + '-', 'bytes=' + chunk + '-'])
    assert.deepEqual(fs.readFileSync(done.file_path), data)
  })

  it('分别续传 DASH 视频和音频，暂停合并后保留双轨并且无需联网重做 FFmpeg 阶段', async () => {
    const audio = Buffer.from(data.subarray(60, 60 + chunk * 2))
    const requests = new Map()
    const origin = await host((req, res) => {
      const track = req.url
      const ranges = requests.get(track) || []
      ranges.push(req.headers.range)
      requests.set(track, ranges)
      const bytes = track === '/video' ? data : audio
      writeMedia(req, res, { bytes, until: ranges.length === 1 ? chunk : bytes.length })
    })
    let playCount = 0
    svc.getPlayUrl = async () => {
      if (++playCount > 3) throw new Error('合并续跑不应获取网络流')
      return { dash: {
        video: [{ id: 80, codecid: 7, baseUrl: origin + '/video' }],
        audio: [{ id: 30280, baseUrl: origin + '/audio' }]
      } }
    }
    let mergeAttempts = 0
    svc.mergeStreams = async (videoPath, audioPath, result, signal) => {
      mergeAttempts += 1
      assert.deepEqual(fs.readFileSync(videoPath), data)
      assert.deepEqual(fs.readFileSync(audioPath), audio)
      if (mergeAttempts === 1) {
        fs.writeFileSync(result, 'incomplete')
        if (signal.aborted) signal.throwIfAborted()
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      } else {
        fs.writeFileSync(result, Buffer.concat([data, audio]))
      }
    }

    const task = await start({ auto_merge: true })
    const paths = svc.temporaryDownloadPaths(task)
    await pauseAt(task, chunk)
    await action('resume', task.task_id)
    await pauseAt(task, data.length + chunk)
    await action('resume', task.task_id)
    const merging = await waitForTask(task.task_id, current => current.status === 'merging')
    assert.equal(merging.progress, 90)
    const worker = svc.downloadRuns.get(task.task_id)
    await action('pause', task.task_id)
    await worker.done
    assert.ok(!fs.existsSync(paths.output))
    assert.ok(fs.existsSync(paths.video))
    assert.ok(fs.existsSync(paths.audio))
    await action('resume', task.task_id)
    const done = await waitForTask(task.task_id, current => current.status === 'completed')
    assert.equal(mergeAttempts, 2)
    assert.equal(playCount, 3)
    assert.deepEqual(requests.get('/video'), ['bytes=0-', 'bytes=' + chunk + '-'])
    assert.deepEqual(requests.get('/audio'), ['bytes=0-', 'bytes=' + chunk + '-'])
    assert.deepEqual(fs.readFileSync(done.file_path), Buffer.concat([data, audio]))
    assert.ok(!fs.existsSync(paths.video))
    assert.ok(!fs.existsSync(paths.audio))
  })

  it('未完成记录的删除清理断点，但不会误删被同名占用的目标文件', async () => {
    const origin = await host((req, res) => writeMedia(req, res, { until: chunk }))
    svc.getPlayUrl = async () => ({ quality: 80, durl: [{ url: origin + '/video.mp4' }] })
    const task = await start()
    await pauseAt(task, chunk)
    const { output } = svc.temporaryDownloadPaths(task)
    fs.writeFileSync(task.file_path, '独立文件')
    await svc.deleteTask(task.task_id, true)
    assert.throws(() => svc.getTask(task.task_id), /任务不存在/)
    assert.equal(fs.existsSync(output), false)
    assert.equal(fs.readFileSync(task.file_path, 'utf8'), '独立文件')
  })

  it('从媒体服务器下载时不会携带其他站点的登录凭证', async () => {
    let requestHeaders
    const origin = await host((req, res) => {
      requestHeaders = req.headers
      writeMedia(req, res)
    })
    svc.bilibiliCookies = { SESSDATA: 'fixture' }
    svc.getPlayUrl = async () => ({ quality: 80, durl: [{ url: origin + '/video.mp4' }] })
    const task = await start()
    await waitForTask(task.task_id, current => current.status === 'completed')
    assert.equal(requestHeaders.cookie, undefined)
  })

  it('多文件传统视频流不会把其中一段标记为完整下载', async () => {
    let requests = 0
    const origin = await host((req, res) => {
      requests += 1
      writeMedia(req, res)
    })
    const playInfo = { quality: 80, durl: [{ url: origin + '/part1.mp4' }, { url: origin + '/part2.mp4' }] }
    svc.getPlayUrl = async () => playInfo
    assert.deepEqual(svc.getAvailableQualities(playInfo), [])
    const task = await start()
    const failed = await waitForTask(task.task_id, current => current.status === 'failed')
    assert.match(failed.error_message, /未找到可下载的视频流/)
    assert.equal(requests, 0)
    assert.equal(fs.existsSync(task.file_path), false)
  })

  it('不使用悬空链接占用的下载路径', () => {
    const blocked = path.join(directory, '占用.mp4')
    fs.symlinkSync(path.join(directory, '不存在'), blocked, 'junction')
    assert.equal(svc.availableDownloadPath(blocked, 'fixture'), path.join(directory, '占用 (2).mp4'))
    const task = { task_id: 'fixture', file_path: blocked }
    const { output } = svc.temporaryDownloadPaths(task)
    fs.writeFileSync(output, 'media')
    assert.equal(svc.publishDownload(task, output), path.join(directory, '占用 (2).mp4'))
    assert.ok(fs.lstatSync(blocked).isSymbolicLink())
  })

  it('发布文件时目标刚被占用，保留占用文件并发布至下一个可用名称', async t => {
    const origin = await host((req, res) => writeMedia(req, res))
    svc.getPlayUrl = async () => ({ quality: 80, durl: [{ url: origin + '/video.mp4' }] })
    const link = fs.linkSync
    let occupied
    t.mock.method(fs, 'linkSync', (file, target) => {
      if (!occupied) {
        occupied = target
        fs.writeFileSync(target, '独立文件')
      }
      link(file, target)
    })
    const task = await start()
    const done = await waitForTask(task.task_id, current => current.status === 'completed')
    assert.equal(occupied, task.file_path)
    assert.equal(fs.readFileSync(task.file_path, 'utf8'), '独立文件')
    assert.equal(path.basename(done.file_path), '单P视频 (2).mp4')
    assert.deepEqual(fs.readFileSync(done.file_path), data)
  })
})
