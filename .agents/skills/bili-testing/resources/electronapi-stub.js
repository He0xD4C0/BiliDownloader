// 浏览器验收专用 window.electronAPI 桩模板
// 用法：在已加载 BiliDownloader 页面的 Chrome DevTools 中，经 evaluate_script 传入本文件内容（即 `function: "() => {...}"`，
// 即把下面的 (async () => {...})() 去掉包裹、改作函数体返回）。每次导航/刷新后桩会被清除，需重新注入，
// 注入后点一次页面上的「刷新」按钮以避免首页提示「刷新失败」。
// 验收要点：通过 window.__test.lastStartPayload / lastBatchPayload 断言提交载荷。

(() => {
  window.__test = { mode: 'multi', lastStartPayload: null, lastBatchPayload: null }
  // mode: 'multi'=多分P视频信息；'single'=单分P视频信息。验收时分页切换：
  // window.__test.mode = 'single'; 然后重新解析

  const settings = {
    default_download_path: 'D:\\Downloads\\BiliDownloader',
    default_quality: '1080p',
    default_format: 'mp4',
    max_concurrent_downloads: 4,
    download_speed_limit: 0,
    slow_speed_auto_pause: true,
    slow_speed_threshold_kbps: 50,
    slow_speed_grace_seconds: 15,
    auto_merge: true,
    delete_temp_files: true,
    proxy_enabled: false,
    proxy_url: null
  }

  const taskStub = (data) => ({
    task_id: 't-' + Date.now(), id: Date.now(), title: 'x', bvid: data.bvid, aid: data.aid, cid: data.cid,
    page: 1, quality: '80', format: 'mp4', file_path: '', file_size: null, downloaded_size: 0,
    status: 'pending', progress: 0, speed: null, error_message: null, error_trace: null,
    created_at: new Date().toISOString(), updated_at: null, started_at: null, completed_at: null
  })

  const multiInfo = {
    bvid: 'BV1TEST1234', aid: 1234, cid: 101, title: '测试多P视频', description: '', cover_url: '',
    duration: 600, uploader: 'UP主', pub_date: 1700000000, login_status: 1, quality_label: '',
    available_qualities: [
      { qn: 80, name: '1080P', desc: '高清', width: 1920, height: 1080 },
      { qn: 64, name: '720P', desc: '高清', width: 1280, height: 720 },
      { qn: 32, name: '480P', desc: '清晰', width: 854, height: 480 }
    ],
    pages: [
      { cid: 101, page: 1, title: '第一集', duration: 300 },
      { cid: 102, page: 2, title: '第二集', duration: 300 }
    ]
  }
  const singleInfo = {
    bvid: 'BV1SINGLE9', aid: 5678, cid: 201, title: '单P测试视频', description: '', cover_url: '',
    duration: 120, uploader: 'UP主', pub_date: 1700000000, login_status: 1, quality_label: '',
    available_qualities: [ { qn: 80, name: '1080P', desc: '高清', width: 1920, height: 1080 } ],
    pages: [ { cid: 201, page: 1, title: '', duration: 120 } ]
  }

  window.electronAPI = {
    request: async ({ method, url, data, params }) => {
      const route = String(url || '')
      if (method === 'GET' && route === '/video/parse-url') return { type: 'video', bvid: 'BV1TEST1234', aid: 1234, p: 1 }
      if (method === 'POST' && route === '/video/check-vip-status') return { is_logged_in: true, is_vip: false, vip_type: 0, vip_status: 0, login_status: 1, user_id: 1, user_name: 'tester', vip_due_date: 0 }
      if (method === 'GET' && route === '/video/info') return window.__test.mode === 'multi' ? multiInfo : singleInfo
      if (method === 'GET' && route === '/download/settings') return settings
      if (method === 'POST' && route === '/download/settings') return settings
      if (method === 'GET' && route === '/download/tasks') return { page: 1, page_size: 50, total: 0, tasks: [] }
      if (method === 'GET' && route === '/download/stats') return { total_tasks: 0, completed_tasks: 0, failed_tasks: 0, downloading_tasks: 0, total_downloaded_size: 0, average_speed: 0 }
      if (method === 'GET' && route === '/download/history') return { days: 7, history: [] }
      if (method === 'POST' && route === '/download/start') { window.__test.lastStartPayload = data; return taskStub(data) }
      if (method === 'POST' && route === '/download/start-batch') { window.__test.lastBatchPayload = data; return { count: 2, tasks: [] } }
      if (/^\/download\/task\//.test(route)) return {}
      if (/^\/auth\//.test(route)) return { user: null, is_logged_in: false }
      return { ok: true }
    },
    onDownloadUpdate: () => () => {},
    selectDownloadDirectory: async () => null,
    openFile: async () => true
  }
})()