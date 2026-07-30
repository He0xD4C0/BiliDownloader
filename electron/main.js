const { app, BrowserWindow, ipcMain, session, shell, Menu, Tray } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { ApplicationService } = require('./application-service')
const isDev = !app.isPackaged

function configureApplicationPaths() {
  let dataDirectory
  if (process.platform === 'win32') {
    const roamingDirectory = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    dataDirectory = path.join(roamingDirectory, 'BiliDownloader')
  } else if (process.platform === 'linux') {
    dataDirectory = path.join(os.homedir(), '.local', 'share', 'BiliDownloader')
  }

  if (!dataDirectory) return
  fs.mkdirSync(dataDirectory, { recursive: true })
  app.setPath('userData', dataDirectory)
}

configureApplicationPaths()

const applicationService = new ApplicationService()

// 保持窗口对象的全局引用，避免被垃圾回收
let mainWindow = null
let tray = null

function createWindow() {
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../public/icon.png')
  })

  // 加载应用
  if (isDev) {
    // 开发环境：加载Vite开发服务器
    mainWindow.loadURL('http://localhost:5173')
    
    // 打开开发者工具
    mainWindow.webContents.openDevTools()
  } else {
    // 生产环境：加载构建好的文件
    mainWindow.loadFile(path.join(__dirname, '../frontend/dist/index.html'))
  }

  // 窗口准备就绪后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // 窗口关闭事件
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 处理外部链接（在默认浏览器中打开）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 允许加载同源URL
    if (url.startsWith('http://localhost') || url.startsWith('file://')) {
      return { action: 'allow' }
    }
    
    // 外部链接在浏览器中打开
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 创建应用菜单
  createApplicationMenu()
}

// 创建系统托盘
function createTray() {
  if (process.platform === 'darwin') {
    // macOS不需要托盘图标
    return
  }

  tray = new Tray(path.join(__dirname, '../public/tray-icon.png'))
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
        }
      }
    },
    {
      label: '暂停所有下载',
      click: () => {
        mainWindow?.webContents.send('pause-all-downloads')
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip('BiliDownloader')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
}

// 创建应用菜单
function createApplicationMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建下载',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow?.webContents.send('new-download')
          }
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          role: 'quit'
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'Shift+CmdOrCtrl+R', role: 'forceReload' },
        { label: '切换开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏切换', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' },
        { label: '关闭', accelerator: 'CmdOrCtrl+W', role: 'close' },
        { type: 'separator' },
        { label: '前置所有窗口', role: 'front' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 BiliDownloader',
          click: () => {
            mainWindow?.webContents.send('show-about')
          }
        },
        {
          label: '检查更新',
          click: () => {
            mainWindow?.webContents.send('check-updates')
          }
        },
        {
          label: '报告问题',
          click: () => {
            shell.openExternal('https://github.com/He0xD4C0/BiliDownloader/issues')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// 当 Electron 完成初始化时调用
app.whenReady().then(() => {
  applicationService.initialize()
  applicationService.on('download-update', (task) => {
    mainWindow?.webContents.send('download-update', task)
  })

  createWindow()
  createTray()

  // 设置浏览器原生下载路径，与应用下载设置保持一致。
  session.defaultSession.setDownloadPath(applicationService.settings.default_download_path)

  // 处理下载事件
  session.defaultSession.on('will-download', (event, item, webContents) => {
    // 这里可以拦截下载事件，但我们的下载是通过API处理的
    // 这个事件主要用于处理浏览器原生下载
  })

  // 在 macOS 上，当点击 dock 图标并且没有其他窗口打开时，重新创建一个窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// IPC 通信处理
ipcMain.handle('app:request', (_event, request) => applicationService.request(request))

ipcMain.handle('get-app-info', () => {
  return {
    version: app.getVersion(),
    name: app.getName(),
    platform: process.platform,
    isDev: isDev
  }
})

ipcMain.handle('select-download-directory', async () => {
  const { dialog } = require('electron')
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  })
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('open-file-directory', (event, filePath) => {
  if (filePath && require('fs').existsSync(filePath)) {
    shell.showItemInFolder(filePath)
    return true
  }
  return false
})

ipcMain.handle('open-file', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return false

  const errorMessage = await shell.openPath(filePath)
  if (errorMessage) throw new Error(`无法使用系统默认应用打开文件: ${errorMessage}`)
  return true
})

// 处理来自渲染进程的下载状态更新
ipcMain.on('download-status-update', (event, status) => {
  // 更新托盘图标或通知
  if (tray) {
    tray.setToolTip(`BiliDownloader - ${status}`)
  }
})

// 处理来自渲染进程的显示通知
ipcMain.handle('show-notification', (event, options) => {
  const { Notification } = require('electron')
  
  new Notification({
    title: options.title || 'BiliDownloader',
    body: options.body,
    silent: options.silent || false
  }).show()
  
  return true
})

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
  
  if (mainWindow) {
    mainWindow.webContents.send('app-error', error.message)
  }
})