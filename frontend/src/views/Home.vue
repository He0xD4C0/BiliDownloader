<template>
  <div class="home">
    <!-- 统计卡片 -->
    <div class="stats-cards">
      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-icon downloading">
            <el-icon><Download /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.downloading_tasks || 0 }}</div>
            <div class="stat-label">下载中</div>
          </div>
        </div>
      </el-card>

      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-icon pending">
            <el-icon><Clock /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.pending_tasks || 0 }}</div>
            <div class="stat-label">等待中</div>
          </div>
        </div>
      </el-card>

      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-icon completed">
            <el-icon><CircleCheck /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.completed_tasks || 0 }}</div>
            <div class="stat-label">已完成</div>
          </div>
        </div>
      </el-card>

      <el-card class="stat-card">
        <div class="stat-content">
          <div class="stat-icon total">
            <el-icon><Folder /></el-icon>
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ stats.total_tasks || 0 }}</div>
            <div class="stat-label">总任务</div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 任务列表 -->
    <el-card class="tasks-card">
      <template #header>
        <div class="card-header">
          <div class="card-title-row">
            <h3>下载任务</h3>
            <div class="card-actions">
              <el-button size="small" @click="showNewDownloadDialog = true">
                <el-icon><Plus /></el-icon>
                新建下载
              </el-button>
              <el-button size="small" @click="refreshTasks">
                <el-icon><Refresh /></el-icon>
                刷新
              </el-button>
              <el-button size="small" @click="showSettingsDialog = true">
                <el-icon><Setting /></el-icon>
                设置
              </el-button>
            </div>
          </div>
          <!-- 3个筛选标签：互斥，默认不选择 -->
          <div class="filter-tags">
            <el-radio-group v-model="filterStatus" size="small">
              <el-radio-button value="">全部</el-radio-button>
              <el-radio-button value="downloading">下载中</el-radio-button>
              <el-radio-button value="pending">排队中</el-radio-button>
              <el-radio-button value="completed">已完成</el-radio-button>
            </el-radio-group>
          </div>
        </div>
      </template>

      <el-table :data="displayTasks" style="width: 100%" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="title" label="视频标题" min-width="300">
          <template #default="{ row }">
            <div class="video-info">
              <el-image
                v-if="row.cover_url"
                :src="row.cover_url"
                fit="cover"
                class="video-cover"
                :preview-src-list="[row.cover_url]"
              />
              <div class="video-details">
                <div class="video-title">{{ row.title || '未知标题' }}</div>
                <div class="video-meta">
                  <span class="meta-item">{{ row.uploader || '未知上传者' }}</span>
                  <el-divider direction="vertical" />
                  <span class="meta-item">{{ row.quality || '未知画质' }}</span>
                </div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="progress" label="进度" width="150">
          <template #default="{ row }">
            <div class="progress-cell">
              <el-progress
                :percentage="Math.round(row.progress)"
                :status="getProgressStatus(row.status)"
                :stroke-width="8"
              />
              <div class="progress-text">
                {{ Math.round(row.progress) }}%
                <span v-if="row.speed"> ({{ formatSpeed(row.speed) }})</span>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" effect="plain">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="file_size" label="大小" width="100">
          <template #default="{ row }">
            {{ formatFileSize(row.file_size) }}
          </template>
        </el-table-column>

        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <div class="action-buttons">
              <el-button
                v-if="row.status === 'downloading'"
                type="warning"
                size="small"
                @click="pauseTask(row.task_id)"
              >
                暂停
              </el-button>
              <el-button
                v-if="row.status === 'paused' || row.status === 'failed'"
                type="success"
                size="small"
                @click="resumeTask(row.task_id)"
              >
                继续
              </el-button>
              <el-button
                v-if="row.status === 'completed' && row.file_path"
                type="primary"
                size="small"
                @click="openFile(row.file_path)"
              >
                打开
              </el-button>
              <el-button
                type="danger"
                size="small"
                @click="deleteTask(row.task_id)"
              >
                删除
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="tasks.length === 0" class="empty-state">
        <el-empty description="暂无下载任务">
          <el-button type="primary" @click="showNewDownloadDialog = true">
            开始下载
          </el-button>
        </el-empty>
      </div>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="totalTasks"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </el-card>

    <!-- 批量操作 -->
    <div class="batch-actions" v-if="selectedTasks.length > 0">
      <el-card>
        <div class="batch-content">
          <span>已选择 {{ selectedTasks.length }} 个任务</span>
          <div class="batch-buttons">
            <el-button size="small" @click="pauseSelectedTasks" :disabled="!hasDownloadingSelected">
              暂停选中
            </el-button>
            <el-button size="small" @click="resumeSelectedTasks" :disabled="!hasPausedSelected">
              继续选中
            </el-button>
            <el-button size="small" @click="deleteSelectedTasks" type="danger">
              删除选中
            </el-button>
            <el-button size="small" @click="clearSelection">
              取消选择
            </el-button>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 删除任务确认对话框 -->
    <el-dialog
      v-model="showDeleteDialog"
      :title="deleteDialogTitle"
      width="420px"
      :close-on-click-modal="false"
    >
      <p>{{ deleteDialogMessage }}</p>
      <el-checkbox v-model="deleteFiles">是否同时删除文件</el-checkbox>
      <template #footer>
        <el-button @click="cancelDelete">取消</el-button>
        <el-button type="danger" :loading="deletingTasks" @click="confirmDelete">
          确定删除
        </el-button>
      </template>
    </el-dialog>

    <!-- 新建下载对话框 -->
    <el-dialog
      v-model="showNewDownloadDialog"
      title="新建下载"
      width="600px"
      :close-on-click-modal="false"
    >
      <NewDownloadForm @success="onDownloadSuccess" @cancel="showNewDownloadDialog = false" />
    </el-dialog>

    <!-- 设置对话框 -->
    <el-dialog
      v-model="showSettingsDialog"
      title="下载设置"
      width="500px"
    >
      <DownloadSettingsForm @success="onSettingsSaved" @cancel="showSettingsDialog = false" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Clock, CircleCheck, Folder, Plus, Refresh, Setting } from '@element-plus/icons-vue'
import { useDownloadStore } from '@/stores/download'
import NewDownloadForm from '@/components/download/NewDownloadForm.vue'
import DownloadSettingsForm from '@/components/download/SettingsForm.vue'

const downloadStore = useDownloadStore()

// 状态
const showNewDownloadDialog = ref(false)
const showSettingsDialog = ref(false)
const filterStatus = ref('') // 空字符串 = 全部（不筛选）
const currentPage = ref(1)
const pageSize = ref(20)
const selectedTasks = ref<string[]>([])
const showDeleteDialog = ref(false)
const deleteFiles = ref(false)
const deletingTasks = ref(false)
const pendingDeleteTaskIds = ref<string[]>([])

// 任务原始数据
const tasks = computed(() => downloadStore.tasks)

/**
 * 排序逻辑：
 * - 不筛选（filterStatus为空）：下载中排最前，其次排队中，最后已完成，同组内按创建时间倒序
 * - 筛选时：只保留该状态的任务，按创建时间倒序
 */
const displayTasks = computed(() => {
  let filtered = tasks.value

  if (filterStatus.value) {
    // 筛选状态：只显示该状态，按创建时间倒序
    filtered = filtered.filter(task => task.status === filterStatus.value)
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  } else {
    // 不筛选：全部显示，按 下载中 > 排队中 > 已完成 排序，同组内按创建时间倒序
    const statusOrder: Record<string, number> = {
      'downloading': 0,
      'pending': 1,
      'paused': 1,
      'completed': 2,
      'failed': 2,
      'cancelled': 2
    }
    filtered.sort((a, b) => {
      const orderA = statusOrder[a.status] ?? 99
      const orderB = statusOrder[b.status] ?? 99
      if (orderA !== orderB) return orderA - orderB
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }

  return filtered
})

const totalTasks = computed(() => displayTasks.value.length)
const deleteDialogTitle = computed(() => pendingDeleteTaskIds.value.length > 1 ? '删除选中任务' : '删除任务')
const deleteDialogMessage = computed(() => pendingDeleteTaskIds.value.length > 1
  ? `确定删除选中的 ${pendingDeleteTaskIds.value.length} 条任务记录吗？`
  : '确定删除此任务记录吗？')

const stats = computed(() => ({
  downloading_tasks: downloadStore.downloadingTasks.length,
  pending_tasks: downloadStore.pendingTasks.length,
  completed_tasks: downloadStore.completedTasks.length,
  total_tasks: downloadStore.tasks.length,
  failed_tasks: downloadStore.failedTasks.length,
  paused_tasks: downloadStore.pausedTasks.length
}))

const hasDownloadingSelected = computed(() => {
  return selectedTasks.value.some(taskId => {
    const task = tasks.value.find(t => t.task_id === taskId)
    return task && task.status === 'downloading'
  })
})

const hasPausedSelected = computed(() => {
  return selectedTasks.value.some(taskId => {
    const task = tasks.value.find(t => t.task_id === taskId)
    return task && (task.status === 'paused' || task.status === 'failed')
  })
})

// 方法
const refreshTasks = async () => {
  try {
    await downloadStore.fetchTasks()
    await downloadStore.fetchStats()
    ElMessage.success('任务列表已刷新')
  } catch (error) {
    ElMessage.error('刷新失败')
  }
}

const getProgressStatus = (status: string) => {
  switch (status) {
    case 'completed': return 'success'
    case 'failed': return 'exception'
    case 'paused': return 'warning'
    default: return undefined
  }
}

const getStatusType = (status: string) => {
  switch (status) {
    case 'completed': return 'success'
    case 'downloading': return 'primary'
    case 'merging': return 'primary'
    case 'paused': return 'warning'
    case 'failed': return 'danger'
    case 'pending': return 'info'
    default: return 'info'
  }
}

const getStatusText = (status: string) => {
  const statusMap: Record<string, string> = {
    'pending': '等待中',
    'downloading': '下载中',
    'merging': '合并中',
    'paused': '已暂停',
    'completed': '已完成',
    'failed': '失败',
    'cancelled': '已取消'
  }
  return statusMap[status] || status
}

const formatSpeed = (speed: number) => {
  if (speed >= 1024 * 1024) {
    return (speed / (1024 * 1024)).toFixed(2) + ' MB/s'
  } else if (speed >= 1024) {
    return (speed / 1024).toFixed(2) + ' KB/s'
  }
  return speed.toFixed(2) + ' B/s'
}

const formatFileSize = (size: number | null) => {
  if (!size) return '未知'
  if (size >= 1024 * 1024 * 1024) {
    return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  } else if (size >= 1024 * 1024) {
    return (size / (1024 * 1024)).toFixed(2) + ' MB'
  } else if (size >= 1024) {
    return (size / 1024).toFixed(2) + ' KB'
  }
  return size + ' B'
}

const formatDate = (dateString: string) => {
  if (!dateString) return '未知'
  return new Date(dateString).toLocaleString('zh-CN')
}

const pauseTask = async (taskId: string) => {
  try {
    await downloadStore.pauseDownload(taskId)
    ElMessage.success('任务已暂停')
  } catch (error) {
    ElMessage.error('暂停失败')
  }
}

const resumeTask = async (taskId: string) => {
  try {
    await downloadStore.resumeDownload(taskId)
    ElMessage.success('任务已恢复')
  } catch (error) {
    ElMessage.error('恢复失败')
  }
}

const deleteTask = (taskId: string) => {
  pendingDeleteTaskIds.value = [taskId]
  deleteFiles.value = false
  showDeleteDialog.value = true
}

const cancelDelete = () => {
  showDeleteDialog.value = false
  pendingDeleteTaskIds.value = []
  deleteFiles.value = false
}

const confirmDelete = async () => {
  deletingTasks.value = true
  try {
    for (const taskId of pendingDeleteTaskIds.value) {
      await downloadStore.deleteTask(taskId, deleteFiles.value)
    }
    selectedTasks.value = selectedTasks.value.filter(taskId => !pendingDeleteTaskIds.value.includes(taskId))
    await downloadStore.fetchTasks()
    await downloadStore.fetchStats()
    ElMessage.success(deleteFiles.value ? '任务记录和文件已删除' : '任务记录已删除')
    cancelDelete()
  } catch (error) {
    ElMessage.error('删除失败')
  } finally {
    deletingTasks.value = false
  }
}

const openFile = async (filePath: string) => {
  if (!window.electronAPI) {
    ElMessage.error('系统文件打开功能不可用')
    return
  }

  try {
    const opened = await window.electronAPI.openFile(filePath)
    if (!opened) ElMessage.error('文件不存在或已被移动')
  } catch (error: any) {
    ElMessage.error(error.message || '无法使用系统默认应用打开文件')
  }
}

const handleSizeChange = (size: number) => {
  pageSize.value = size
  currentPage.value = 1
}

const handlePageChange = (page: number) => {
  currentPage.value = page
}

const onSelectionChange = (selection: any[]) => {
  selectedTasks.value = selection.map((item: any) => item.task_id)
}

const pauseSelectedTasks = async () => {
  try {
    for (const taskId of selectedTasks.value) {
      const task = tasks.value.find(t => t.task_id === taskId)
      if (task && task.status === 'downloading') {
        await downloadStore.pauseDownload(taskId)
      }
    }
    ElMessage.success('选中任务已暂停')
  } catch (error) {
    ElMessage.error('暂停失败')
  }
}

const resumeSelectedTasks = async () => {
  try {
    for (const taskId of selectedTasks.value) {
      const task = tasks.value.find(t => t.task_id === taskId)
      if (task && (task.status === 'paused' || task.status === 'failed')) {
        await downloadStore.resumeDownload(taskId)
      }
    }
    ElMessage.success('选中任务已恢复')
  } catch (error) {
    ElMessage.error('恢复失败')
  }
}

const deleteSelectedTasks = () => {
  pendingDeleteTaskIds.value = [...selectedTasks.value]
  deleteFiles.value = false
  showDeleteDialog.value = true
}

const clearSelection = () => {
  selectedTasks.value = []
}

const onDownloadSuccess = () => {
  showNewDownloadDialog.value = false
  refreshTasks()
}

const onSettingsSaved = () => {
  showSettingsDialog.value = false
  refreshTasks()
}

// 定时器引用
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null

// 生命周期
onMounted(async () => {
  await refreshTasks()

  // 设置定时刷新（有下载中任务时每5秒刷新一次）
  autoRefreshTimer = setInterval(async () => {
    if (stats.value.downloading_tasks > 0) {
      await downloadStore.fetchTasks()
      await downloadStore.fetchStats()
    }
  }, 5000)
})

onUnmounted(() => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
  }
})

// 监听状态变化
watch(
  () => downloadStore.tasks,
  () => {
    if (displayTasks.value.length === 0 && currentPage.value > 1) {
      currentPage.value = Math.max(1, currentPage.value - 1)
    }
  }
)
</script>

<style lang="scss" scoped>
.home {
  padding: 20px;

  .stats-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 24px;

    .stat-card {
      .stat-content {
        display: flex;
        align-items: center;
        gap: 16px;

        .stat-icon {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;

          &.downloading { background-color: #409EFF; }
          &.pending { background-color: #E6A23C; }
          &.completed { background-color: #67C23A; }
          &.total { background-color: #909399; }

          .el-icon {
            font-size: 24px;
            color: white;
          }
        }

        .stat-info {
          .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #303133;
          }

          .stat-label {
            font-size: 14px;
            color: #909399;
          }
        }
      }
    }
  }

  .tasks-card {
    .card-header {
      display: flex;
      flex-direction: column;
      gap: 12px;

      .card-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;

        h3 {
          margin: 0;
          font-size: 18px;
          color: #303133;
        }

        .card-actions {
          display: flex;
          gap: 8px;
        }
      }

      .filter-tags {
        display: flex;
        align-items: center;

        .el-radio-group {
          :deep(.el-radio-button__inner) {
            padding: 5px 16px;
          }
        }
      }
    }

    .video-info {
      display: flex;
      align-items: center;
      gap: 12px;

      .video-cover {
        width: 80px;
        height: 45px;
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
      }

      .video-details {
        flex: 1;

        .video-title {
          margin: 0 0 4px;
          font-size: 14px;
          font-weight: 500;
          color: #303133;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .video-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: #606266;

          .meta-item {
            display: flex;
            align-items: center;
          }
        }
      }
    }

    .progress-cell {
      .progress-text {
        margin-top: 4px;
        font-size: 12px;
        color: #909399;
        text-align: center;
      }
    }

    .action-buttons {
      display: flex;
      gap: 8px;
    }

    .pagination-wrapper {
      margin-top: 16px;
      display: flex;
      justify-content: center;
    }

    .empty-state {
      padding: 40px 0;
    }
  }

  .batch-actions {
    margin-top: 16px;

    .batch-content {
      display: flex;
      align-items: center;
      justify-content: space-between;

      .batch-buttons {
        display: flex;
        gap: 8px;
      }
    }
  }
}

// 响应式设计
@media (max-width: 1200px) {
  .stats-cards {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}

@media (max-width: 768px) {
  .stats-cards {
    grid-template-columns: 1fr !important;
  }

  .card-title-row {
    flex-direction: column;
    align-items: flex-start !important;
    gap: 12px;
  }

  .card-actions {
    flex-wrap: wrap;
  }
}
</style>
