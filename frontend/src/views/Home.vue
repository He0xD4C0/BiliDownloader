<template>
  <div class="home">
    <!-- 统计条：四个分区横向一排，分割线区分，无卡片样式 -->
    <div class="stat-strip">
      <div class="stat-cell">
        <div class="stat-icon downloading">
          <el-icon><Download /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.downloading_tasks || 0 }}</div>
          <div class="stat-label">下载中</div>
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-icon pending">
          <el-icon><Clock /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.pending_tasks || 0 }}</div>
          <div class="stat-label">等待中</div>
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-icon completed">
          <el-icon><CircleCheck /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.completed_tasks || 0 }}</div>
          <div class="stat-label">已完成</div>
        </div>
      </div>
      <div class="stat-cell">
        <div class="stat-icon total">
          <el-icon><Folder /></el-icon>
        </div>
        <div class="stat-info">
          <div class="stat-value">{{ stats.total_tasks || 0 }}</div>
          <div class="stat-label">总任务</div>
        </div>
      </div>
    </div>

    <!-- 任务区 -->
    <div class="tasks-section">
      <div class="tasks-header">
        <div class="header-title-row">
          <h3>下载任务</h3>
          <div class="header-actions">
            <ConcurrencyControl
              v-model="downloadStore.settings.max_concurrent_downloads"
              class="quick-control"
            />
            <SpeedLimitControl
              v-model="downloadStore.settings.download_speed_limit"
              class="quick-control"
            />
            <el-button size="small" @click="refreshTasks">
              <el-icon><Refresh /></el-icon>
              刷新
            </el-button>
          </div>
        </div>
        <!-- 4个筛选标签：互斥，默认不选择 -->
        <div class="filter-tags">
          <el-radio-group v-model="filterStatus" size="small">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="downloading">下载中</el-radio-button>
            <el-radio-button value="pending">排队中</el-radio-button>
            <el-radio-button value="completed">已完成</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <!-- 表格上方操作栏：全量操作 + 选中操作 -->
      <div v-if="tasks.length > 0" class="batch-toolbar">
        <div class="toolbar-group">
          <span class="toolbar-label">全量操作</span>
          <el-button size="small" @click="startAllTasks" :disabled="!canStartAll">全部开始</el-button>
          <el-button size="small" @click="pauseAllTasks" :disabled="!canPauseAll">全部暂停</el-button>
          <el-button size="small" type="danger" plain @click="pauseAndDeleteAllTasks">全部暂停并删除</el-button>
          <el-button size="small" @click="deleteCompletedTasks" :disabled="!hasCompletedTasks">删除已完成</el-button>
        </div>
        <div v-if="selectedTasks.length > 0" class="toolbar-group selection-group">
          <span class="toolbar-label">已选 {{ selectedTasks.length }}</span>
          <el-button size="small" @click="pauseSelectedTasks" :disabled="!hasDownloadingSelected">暂停选中</el-button>
          <el-button size="small" @click="resumeSelectedTasks" :disabled="!hasPausedSelected">开始选中</el-button>
          <el-button size="small" type="danger" plain @click="deleteSelectedTasks">删除选中</el-button>
          <el-button size="small" text @click="clearSelection">取消选择</el-button>
        </div>
      </div>

      <el-table
        :data="displayTasks"
        style="width: 100%"
        class="flat-table"
        @selection-change="onSelectionChange"
      >
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

      <div class="pagination-bar">
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

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Clock, CircleCheck, Folder, Refresh } from '@element-plus/icons-vue'
import { useDownloadStore } from '@/stores/download'
import NewDownloadForm from '@/components/download/NewDownloadForm.vue'
import ConcurrencyControl from '@/components/download/ConcurrencyControl.vue'
import SpeedLimitControl from '@/components/download/SpeedLimitControl.vue'

const downloadStore = useDownloadStore()

// 状态
const showNewDownloadDialog = ref(false)
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
  const filtered = tasks.value.slice()

  if (filterStatus.value) {
    return filtered
      .filter(task => task.status === filterStatus.value)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  const statusOrder: Record<string, number> = {
    'downloading': 0,
    'pending': 1,
    'paused': 1,
    'completed': 2,
    'failed': 2,
    'cancelled': 2
  }
  return filtered.sort((a, b) => {
    const orderA = statusOrder[a.status] ?? 99
    const orderB = statusOrder[b.status] ?? 99
    if (orderA !== orderB) return orderA - orderB
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
})

const totalTasks = computed(() => displayTasks.value.length)

// 删除对话框：区分"全部暂停并删除"与"选中/单个删除"的文案
const isDeletingAll = computed(() => {
  return tasks.value.length > 0 && pendingDeleteTaskIds.value.length === tasks.value.length
})

const deleteDialogTitle = computed(() => {
  if (pendingDeleteTaskIds.value.length === 0) return '删除任务'
  if (isDeletingAll.value) return '暂停并删除全部任务'
  return pendingDeleteTaskIds.value.length > 1 ? '删除选中任务' : '删除任务'
})

const deleteDialogMessage = computed(() => {
  if (pendingDeleteTaskIds.value.length === 0) return ''
  if (isDeletingAll.value) {
    return `将中止全部下载并删除全部 ${pendingDeleteTaskIds.value.length} 条任务记录，确定继续吗？`
  }
  if (pendingDeleteTaskIds.value.length > 1) {
    return `确定删除选中的 ${pendingDeleteTaskIds.value.length} 条任务记录吗？`
  }
  return '确定删除此任务记录吗？'
})

const stats = computed(() => ({
  downloading_tasks: downloadStore.downloadingTasks.length,
  pending_tasks: downloadStore.pendingTasks.length,
  completed_tasks: downloadStore.completedTasks.length,
  total_tasks: downloadStore.tasks.length,
  failed_tasks: downloadStore.failedTasks.length,
  paused_tasks: downloadStore.pausedTasks.length
}))

// 全量操作可用性
const canStartAll = computed(() =>
  tasks.value.some(task => task.status === 'paused' || task.status === 'failed')
)
const canPauseAll = computed(() =>
  tasks.value.some(task => ['downloading', 'pending', 'merging'].includes(task.status))
)
const hasCompletedTasks = computed(() =>
  tasks.value.some(task => task.status === 'completed')
)

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

// ---- 全量操作 ----
const startAllTasks = async () => {
  const ids = tasks.value
    .filter(task => task.status === 'paused' || task.status === 'failed')
    .map(task => task.task_id)
  if (!ids.length) return
  try {
    let done = 0
    for (const taskId of ids) {
      await downloadStore.resumeDownload(taskId)
      done += 1
    }
    await downloadStore.fetchStats()
    ElMessage.success(`已开始 ${done} 个任务`)
  } catch (error) {
    ElMessage.error('全部开始失败')
  }
}

const pauseAllTasks = async () => {
  const ids = tasks.value
    .filter(task => ['downloading', 'pending', 'merging'].includes(task.status))
    .map(task => task.task_id)
  if (!ids.length) return
  try {
    let done = 0
    for (const taskId of ids) {
      await downloadStore.pauseDownload(taskId)
      done += 1
    }
    await downloadStore.fetchStats()
    ElMessage.success(`已暂停 ${done} 个任务`)
  } catch (error) {
    ElMessage.error('全部暂停失败')
  }
}

const pauseAndDeleteAllTasks = () => {
  pendingDeleteTaskIds.value = tasks.value.map(task => task.task_id)
  deleteFiles.value = false
  showDeleteDialog.value = true
}

const deleteCompletedTasks = async () => {
  try {
    await ElMessageBox.confirm('确定删除全部已完成的任务记录吗？', '删除已完成', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch (error) {
    return // 用户取消
  }

  try {
    const response = await downloadStore.clearCompletedTasks()
    await downloadStore.fetchStats()
    ElMessage.success(response?.message || '已完成任务记录已删除')
  } catch (error) {
    console.error('删除已完成任务失败:', error)
    ElMessage.error('删除已完成任务失败')
  }
}

// ---- 选中操作 ----
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
    ElMessage.success('选中任务已开始')
  } catch (error) {
    ElMessage.error('开始失败')
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

// 生命周期
onMounted(async () => {
  await refreshTasks()
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
  padding: 0;
  background-color: #fff;
  min-height: 100%;

  // 统计条：四个分区横向一排，仅用分割线区分，无卡片样式
  .stat-strip {
    display: flex;
    background-color: #fff;
    border-bottom: 1px solid #e6e6e6;

    .stat-cell {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 20px 24px;
      border-right: 1px solid #e6e6e6;

      &:last-child {
        border-right: none;
      }

      .stat-icon {
        width: 44px;
        height: 44px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;

        &.downloading { background-color: #409EFF; }
        &.pending { background-color: #E6A23C; }
        &.completed { background-color: #67C23A; }
        &.total { background-color: #909399; }

        .el-icon {
          font-size: 22px;
          color: #fff;
        }
      }

      .stat-info {
        .stat-value {
          font-size: 24px;
          font-weight: bold;
          line-height: 1.2;
          color: #303133;
        }

        .stat-label {
          font-size: 14px;
          color: #909399;
        }
      }
    }
  }

  // 任务区
  .tasks-section {
    background-color: #fff;

    .tasks-header {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px 24px;
      border-bottom: 1px solid #e6e6e6;

      .header-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;

        h3 {
          margin: 0;
          font-size: 18px;
          color: #303133;
        }

        .header-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;

          .quick-control {
            margin-right: 4px;
          }
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

    // 表格上方操作栏
    .batch-toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px 24px;
      padding: 8px 24px;
      border-bottom: 1px solid #e6e6e6;
      background-color: #fff;

      .toolbar-group {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;

        &.selection-group {
          padding-left: 24px;
          border-left: 1px solid #e6e6e6;
        }

        .toolbar-label {
          font-size: 12px;
          color: #909399;
          white-space: nowrap;
        }
      }
    }

    // 扁平化表格：自身不再有外框，仅保留表头/行发丝线
    .flat-table {
      :deep(.el-table) {
        border: none;
      }

      :deep(.el-table__inner-wrapper) {
        border-bottom: none;
        border-right: none;
      }
    }

    .empty-state {
      padding: 40px 0;
    }

    .pagination-bar {
      border-top: 1px solid #e6e6e6;
      padding: 12px 24px;
      display: flex;
      justify-content: center;
    }
  }
}

// 响应式：统计条始终保持一行四列，仅收缩单元格内边距
@media (max-width: 768px) {
  .home {
    .stat-cell {
      gap: 8px;
      padding: 14px 12px;

      .stat-icon {
        width: 34px;
        height: 34px;
      }

      .stat-info .stat-value {
        font-size: 20px;
      }
    }

    .tasks-header .header-title-row {
      flex-direction: column;
      align-items: flex-start !important;
    }

    .header-actions {
      flex-wrap: wrap;
    }
  }
}
</style>
