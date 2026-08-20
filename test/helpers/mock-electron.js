'use strict'
// 可复用的 Electron 主进程 mock：将 mock 的 'electron' 模块预置进 createRequire 的缓存，
// 使 electron/application-service.js 可以在无 Electron 运行时的情况下被加载并单元测试。
const { createRequire } = require('module')
const os = require('os')
const path = require('path')
const fs = require('fs')

const SERVICE_PATH = path.resolve(__dirname, '../../electron/application-service.js')

function makeMockApp(overrides = {}) {
  return {
    getPath: (name) => {
      if (name === 'userData') return path.join(os.tmpdir(), 'bili-test-userdata-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))
      if (name === 'home') return os.homedir()
      return os.tmpdir()
    },
    isPackaged: false,
    ...overrides
  }
}

function makeMockSafeStorage(overrides = {}) {
  return {
    isEncryptionAvailable: () => false,
    encryptString: (value) => value,
    decryptString: (value) => value,
    ...overrides
  }
}

// 安装 mock 并返回 createRequire 句柄；必须先于 require(application-service.js) 调用
function installMockElectron(options = {}) {
  const req = createRequire(SERVICE_PATH)
  const electronId = req.resolve('electron')
  const mock = {
    app: options.app || makeMockApp(),
    safeStorage: options.safeStorage || makeMockSafeStorage()
  }
  req.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: mock }
  return { req, mock, electronId }
}

// 加载/导出真实 ApplicationService（模块缓存在各测试进程内相互独立）
function loadApplicationService(options = {}) {
  const { req } = installMockElectron(options)
  return req(SERVICE_PATH)
}

function tempDir(prefix = 'bili-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

module.exports = { loadApplicationService, installMockElectron, makeMockApp, makeMockSafeStorage, tempDir, SERVICE_PATH }