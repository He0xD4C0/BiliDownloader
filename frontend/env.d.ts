/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare module 'element-plus/dist/locale/zh-cn.mjs' {
  const locale: any
  export default locale
}

interface AppRequest {
  method?: string
  url: string
  data?: unknown
  params?: Record<string, unknown>
}

interface ElectronAPI {
  request<T = any>(request: AppRequest): Promise<T>
  onDownloadUpdate(callback: (task: any) => void): () => void
  getAppInfo(): Promise<Record<string, unknown>>
  selectDownloadDirectory(): Promise<string | null>
  openFileDirectory(filePath: string): Promise<boolean>
  openFile(filePath: string): Promise<boolean>
  showNotification(options: { title?: string; body: string; silent?: boolean }): Promise<boolean>
  onNewDownload(callback: () => void): void
  onShowAbout(callback: () => void): void
  onCheckUpdates(callback: () => void): void
  onAppError(callback: (error: string) => void): void
  removeAllListeners(channel: string): void
}

interface Window {
  electronAPI?: ElectronAPI
}
