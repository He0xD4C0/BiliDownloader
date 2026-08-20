import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import { api } from '@/utils/api'

export interface DownloadTask {
  id: number
  task_id: string
  title: string
  uploader?: string | null
  bvid: string | null
  aid: number | null
  cid: number | null
  page: number
  quality: string
  format: string
  file_path: string | null
  file_size: number | null
  downloaded_size: number | null
  status: 'pending' | 'downloading' | 'merging' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress: number
  speed: number | null
  error_message: string | null
  error_trace: string | null
  created_at: string
  updated_at: string | null
  started_at: string | null
  completed_at: string | null
}

export interface DownloadStats {
  total_tasks: number
  completed_tasks: number
  failed_tasks: number
  downloading_tasks: number
  total_downloaded_size: number
  average_speed: number
}

export interface DownloadSettings {
  default_download_path: string
  default_quality: string
  default_format: string
  max_concurrent_downloads: number
  download_speed_limit: number
  slow_speed_auto_pause: boolean
  slow_speed_threshold_kbps: number
  slow_speed_grace_seconds: number
  auto_merge: boolean
  delete_temp_files: boolean
  proxy_enabled: boolean
  proxy_url: string | null
}

export const useDownloadStore = defineStore('download', () => {
  // 状态
  const tasks: Ref<DownloadTask[]> = ref([])
  const activeTasks: Ref<number> = ref(0)
  const maxConcurrentDownloads: Ref<number> = ref(4)
  const downloadSpeed: Ref<number> = ref(0)
  const stats: Ref<DownloadStats | null> = ref(null)
  const settings: Ref<DownloadSettings> = ref({
    default_download_path: './downloads',
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
  })
  
  // 计算属性
  const pendingTasks = computed(() => 
    tasks.value.filter(task => task.status === 'pending')
  )
  
  const downloadingTasks = computed(() => 
    tasks.value.filter(task => task.status === 'downloading')
  )
  
  const completedTasks = computed(() => 
    tasks.value.filter(task => task.status === 'completed')
  )
  
  const failedTasks = computed(() => 
    tasks.value.filter(task => task.status === 'failed')
  )
  
  const pausedTasks = computed(() => 
    tasks.value.filter(task => task.status === 'paused')
  )
  
  // 方法
  const fetchTasks = async (status?: string, page: number = 1, pageSize: number = 50) => {
    try {
      const params: any = { page, page_size: pageSize }
      if (status) params.status = status
      
      const response = await api.get('/download/tasks', { params })
      tasks.value = response.tasks
      return response
    } catch (error) {
      console.error('获取下载任务失败:', error)
      throw error
    }
  }
  
  const fetchTask = async (taskId: string) => {
    try {
      const response = await api.get(`/download/task/${taskId}`)
      // 更新任务列表中的任务
      const index = tasks.value.findIndex(task => task.task_id === taskId)
      if (index !== -1) {
        tasks.value[index] = response
      }
      return response
    } catch (error) {
      console.error('获取任务详情失败:', error)
      throw error
    }
  }
  
  const startDownload = async (downloadData: {
    bvid?: string
    aid?: number
    cid: number
    quality?: number
    audio_quality?: number | null
    download_path?: string
    auto_merge?: boolean
    delete_temp_files?: boolean
  }) => {
    try {
      const response = await api.post('/download/start', downloadData)
      
      // 添加到任务列表
      tasks.value.unshift({
        ...response,
        // 添加一些默认值
        id: Date.now(),
        title: '新下载任务',
        bvid: downloadData.bvid || null,
        aid: downloadData.aid || null,
        cid: downloadData.cid,
        page: 1,
        quality: downloadData.quality?.toString() || '80',
        format: 'mp4',
        file_path: null,
        file_size: null,
        downloaded_size: 0,
        speed: null,
        error_message: null,
        error_trace: null,
        created_at: new Date().toISOString(),
        updated_at: null,
        started_at: null,
        completed_at: null
      })
      
      return response
    } catch (error) {
      console.error('开始下载失败:', error)
      throw error
    }
  }
  
  const startBatchDownload = async (downloadData: {
    bvid?: string
    aid?: number
    cids: number[]
    quality?: number
    audio_quality?: number | null
    download_path?: string
    auto_merge?: boolean
    delete_temp_files?: boolean
  }) => {
    try {
      const response = await api.post('/download/start-batch', downloadData)

      // 批量创建的任务逐个插入任务列表（倒序 unshift，保证 P1 在最前）
      const created = response.tasks || []
      for (let i = created.length - 1; i >= 0; i--) {
        tasks.value.unshift(created[i])
      }

      return response
    } catch (error) {
      console.error('批量创建下载任务失败:', error)
      throw error
    }
  }

  const pauseDownload = async (taskId: string) => {
    try {
      const response = await api.post(`/download/pause/${taskId}`)
      await fetchTask(taskId)
      return response
    } catch (error) {
      console.error('暂停下载失败:', error)
      throw error
    }
  }
  
  const resumeDownload = async (taskId: string) => {
    try {
      const response = await api.post(`/download/resume/${taskId}`)
      await fetchTask(taskId)
      return response
    } catch (error) {
      console.error('恢复下载失败:', error)
      throw error
    }
  }
  
  const cancelDownload = async (taskId: string) => {
    try {
      const response = await api.post(`/download/cancel/${taskId}`)
      await fetchTask(taskId)
      return response
    } catch (error) {
      console.error('取消下载失败:', error)
      throw error
    }
  }
  
  const deleteTask = async (taskId: string, deleteFile: boolean = false) => {
    try {
      const response = await api.delete(`/download/task/${taskId}`, {
        params: { delete_file: deleteFile }
      })
      // 从任务列表中移除
      tasks.value = tasks.value.filter(task => task.task_id !== taskId)
      return response
    } catch (error) {
      console.error('删除任务失败:', error)
      throw error
    }
  }
  
  const fetchStats = async () => {
    try {
      const response = await api.get('/download/stats')
      stats.value = response
      return response
    } catch (error) {
      console.error('获取下载统计失败:', error)
      throw error
    }
  }
  
  const fetchHistory = async (days: number = 7) => {
    try {
      const response = await api.get('/download/history', {
        params: { days }
      })
      return response
    } catch (error) {
      console.error('获取下载历史失败:', error)
      throw error
    }
  }
  
  const fetchSettings = async () => {
    try {
      const response = await api.get('/download/settings')
      settings.value = response
      maxConcurrentDownloads.value = response.max_concurrent_downloads ?? 4
      return response
    } catch (error) {
      console.error('获取下载设置失败:', error)
      throw error
    }
  }
  
  const updateSettings = async (newSettings: Partial<DownloadSettings>) => {
    try {
      const response = await api.post('/download/settings', newSettings)
      settings.value = { ...settings.value, ...response }
      maxConcurrentDownloads.value = response.max_concurrent_downloads ?? maxConcurrentDownloads.value
      return response
    } catch (error) {
      console.error('更新下载设置失败:', error)
      throw error
    }
  }
  
  const clearCompletedTasks = async () => {
    try {
      const response = await api.post('/download/clear-completed')
      // 从任务列表中移除已完成的任务
      tasks.value = tasks.value.filter(task => task.status !== 'completed')
      return response
    } catch (error) {
      console.error('清理已完成任务失败:', error)
      throw error
    }
  }
  
  // 由应用核心主动推送任务变化，不再轮询本机HTTP服务。
  const setupTaskUpdates = () => {
    if (!window.electronAPI) return () => undefined

    return window.electronAPI.onDownloadUpdate((updatedTask: DownloadTask) => {
      const index = tasks.value.findIndex(task => task.task_id === updatedTask.task_id)
      if (index === -1) {
        tasks.value.unshift(updatedTask)
      } else {
        tasks.value[index] = { ...tasks.value[index], ...updatedTask }
      }
    })
  }
  
  // 初始化
  fetchSettings()
  
  return {
    // 状态
    tasks,
    activeTasks,
    maxConcurrentDownloads,
    downloadSpeed,
    stats,
    settings,
    
    // 计算属性
    pendingTasks,
    downloadingTasks,
    completedTasks,
    failedTasks,
    pausedTasks,
    
    // 方法
    fetchTasks,
    fetchTask,
    startDownload,
    startBatchDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteTask,
    fetchStats,
    fetchHistory,
    fetchSettings,
    updateSettings,
    clearCompletedTasks,
    setupTaskUpdates
  }
})
