const { contextBridge, ipcRenderer } = require('electron')

// 向渲染进程暴露安全的API
contextBridge.exposeInMainWorld('electronAPI', {
  // 统一应用服务：渲染层不再访问本机HTTP后端
  request: (request) => ipcRenderer.invoke('app:request', request),
  onDownloadUpdate: (callback) => {
    const listener = (_event, task) => callback(task)
    ipcRenderer.on('download-update', listener)
    return () => ipcRenderer.removeListener('download-update', listener)
  },

  // 获取应用信息
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  
  // 选择下载目录
  selectDownloadDirectory: () => ipcRenderer.invoke('select-download-directory'),
  
  // 打开文件所在目录
  openFileDirectory: (filePath) => ipcRenderer.invoke('open-file-directory', filePath),
  
  // 打开文件
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  
  // 显示通知
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),
  
  // 监听主进程事件
  onDownloadStatusUpdate: (callback) => {
    ipcRenderer.on('download-status-update', (event, status) => callback(status))
  },
  
  onNewDownload: (callback) => {
    ipcRenderer.on('new-download', () => callback())
  },

  onShowAbout: (callback) => {
    ipcRenderer.on('show-about', () => callback())
  },
  
  onCheckUpdates: (callback) => {
    ipcRenderer.on('check-updates', () => callback())
  },
  
  onAppError: (callback) => {
    ipcRenderer.on('app-error', (event, error) => callback(error))
  },
  
  // 移除监听器
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel)
  }
})

// 监听DOMContentLoaded事件，确保在DOM加载完成后执行
document.addEventListener('DOMContentLoaded', () => {
  // 可以在这里添加一些初始化代码
  console.log('DOM loaded, electronAPI is available')
})