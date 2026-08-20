'use strict'
const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadApplicationService, tempDir } = require('./helpers/mock-electron')

const { ApplicationService } = loadApplicationService()
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

  it('空标题 → 子文件夹名回退 video-{bvid前8位}', () => {
    const video = { ...multiPageVideo, title: '  ' }
    const t = svc.buildTaskBase(video, video.pages[0], {}, 1)
    assert.ok(t.file_path.includes(sep + 'video-BV1TEST1' + sep), 'bvid 截断前8位作为回退目录名')
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

  it('删除后目录内还有其他分P → 子文件夹保留', () => {
    const file1 = path.join(sub, 'P1-第一集.mp4')
    const file2 = path.join(sub, 'P2-第二集.mp4')
    fs.writeFileSync(file1, 'x')
    fs.writeFileSync(file2, 'y')
    svc.registerTask({ task_id: 'a', title: 't', file_path: file1, status: 'completed', subdir: true })
    svc.deleteTask('a', true)
    assert.equal(fs.existsSync(file1), false, '文件已删除')
    assert.equal(fs.existsSync(sub), true, '目录非空则保留')
    svc.registerTask({ task_id: 'b', title: 't', file_path: file2, status: 'completed', subdir: true })
    svc.deleteTask('b', true)
    assert.equal(fs.existsSync(file2), false)
    assert.equal(fs.existsSync(sub), false, '最后一个文件删除后空目录被移除')
    assert.equal(fs.existsSync(base), true, '基础下载目录保留')
  })

  it('deleteFile=false → 文件与目录均保留', () => {
    const file3 = path.join(sub, 'P1-x.mp4')
    fs.writeFileSync(file3, 'x')
    svc.registerTask({ task_id: 'c', title: 't', file_path: file3, status: 'completed', subdir: true })
    svc.deleteTask('c', false)
    assert.equal(fs.existsSync(file3), true)
    assert.equal(fs.existsSync(sub), true)
  })
})

describe('并发上限的自动管理', () => {
  it('updateSettings 调低上限 4→2 → 较早开始的 2 个超出任务被自动暂停', () => {
    const svc = new ApplicationService()
    const downDir = tempDir('bili-conc-')
    svc.settings = { default_download_path: downDir, max_concurrent_downloads: 4 }
    const tasks = [1, 2, 3, 4].map(n => ({
      task_id: 't' + n, title: 't' + n, status: 'downloading',
      started_at: new Date(1700000000000 + n * 1000).toISOString(),
      created_at: new Date(1700000000000 + n * 1000).toISOString()
    }))
    for (const t of tasks) svc.registerTask(t)
    const aborted = []
    const emitted = []
    for (const t of tasks) svc.controllers.set(t.task_id, { abort: () => aborted.push(t.task_id) })
    svc.emitTask = (task) => emitted.push(task.task_id)
    svc.updateSettings({ max_concurrent_downloads: 2 })
    // 语义：最新开始的 max 个继续下载，较早开始的超出部分被暂停（进度保留，可恢复）
    const paused = tasks.filter(t => t.status === 'paused').map(t => t.task_id).sort()
    assert.deepEqual(paused, ['t1', 't2'], '较早开始的两个被暂停')
    assert.deepEqual(aborted.sort(), ['t1', 't2'])
    assert.deepEqual(emitted.sort(), ['t1', 't2'])
    fs.rmSync(downDir, { recursive: true, force: true })
  })
})

describe('低速自动暂停：demoteSlowTask', () => {
  it('下载中 → 等待中（pending）、进度清零、移至队列尾、中止连接', () => {
    const svc = new ApplicationService()
    svc.downloadQueue = ['q1']
    const task = {
      task_id: 'slow', title: '低速任务', status: 'downloading',
      progress: 42, downloaded_size: 1024, speed: 10, started_at: '2024-01-01T00:00:00.000Z'
    }
    let aborted = false
    svc.controllers.set('slow', { abort: () => { aborted = true } })
    svc.demoteSlowTask(task)
    assert.equal(task.status, 'pending')
    assert.equal(task.progress, 0)
    assert.equal(task.downloaded_size, 0)
    assert.equal(task.speed, null)
    assert.equal(task.started_at, null)
    assert.deepEqual(svc.downloadQueue, ['q1', 'slow'], '位于队列尾')
    assert.equal(aborted, true)
  })
})

describe('设置默认值', () => {
  it('初始化时并行数/限速/低速自动暂停默认值正确', () => {
    const fakeProfile = tempDir('bili-profile-')
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
      process.env.USERPROFILE = oldProfile
      if (svc && svc.statePath) fs.rmSync(path.dirname(svc.statePath), { recursive: true, force: true })
      fs.rmSync(fakeProfile, { recursive: true, force: true })
    }
  })
})