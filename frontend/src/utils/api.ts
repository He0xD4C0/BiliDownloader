import type { AxiosRequestConfig } from 'axios'

interface AppResponse<T> extends Promise<T> {}

const electronRequest = <T>(method: string, url: string, data?: unknown, config?: AxiosRequestConfig): AppResponse<T> => {
  if (!window.electronAPI) {
    return Promise.reject(new Error('应用服务不可用，请通过 Electron 启动 BiliDownloader'))
  }

  return window.electronAPI.request<T>({
    method,
    url,
    data,
    params: config?.params
  })
}

// 保留现有调用形状，让组件和 store 无需感知 IPC；调用已不再经过 localhost HTTP。
export const api = {
  defaults: {
    headers: {
      common: {} as Record<string, string>
    }
  },
  get: <T = any>(url: string, config?: AxiosRequestConfig) => electronRequest<T>('GET', url, undefined, config),
  post: <T = any>(url: string, data?: unknown, config?: AxiosRequestConfig) => electronRequest<T>('POST', url, data, config),
  put: <T = any>(url: string, data?: unknown, config?: AxiosRequestConfig) => electronRequest<T>('PUT', url, data, config),
  delete: <T = any>(url: string, config?: AxiosRequestConfig) => electronRequest<T>('DELETE', url, undefined, config),
  patch: <T = any>(url: string, data?: unknown, config?: AxiosRequestConfig) => electronRequest<T>('PATCH', url, data, config)
}

export const setupApi = () => undefined
export const request = api
export default api
