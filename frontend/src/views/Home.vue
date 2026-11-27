<template>
  <div class="workspace">
    <section class="workspace-intro" aria-labelledby="workspace-title">
      <div class="intro-main">
        <h1 id="workspace-title">下载工作台</h1>
        <p>使用 B 站链接、BV 号或 AV 号创建下载。</p>
        <el-button :icon="Plus" class="intro-action" size="large" @click="emit('new-download')">
          新建下载
        </el-button>
      </div>

      <dl class="transfer-summary">
        <div>
          <dt><el-icon><TrendCharts /></el-icon> 总下载速度</dt>
          <dd>{{ downloadStore.downloadSpeed ? formatSpeed(downloadStore.downloadSpeed) : '0 KB/s' }}</dd>
        </div>
        <div>
          <dt><el-icon><Operation /></el-icon> 活动任务 / 并行上限</dt>
          <dd>{{ downloadStore.activeTasks }} <span>/ {{ downloadStore.maxConcurrentDownloads }}</span></dd>
        </div>
      </dl>
    </section>

    <dl class="stat-strip" aria-label="任务统计">
      <div v-for="stat in taskStats" :key="stat.label" class="stat-cell" :class="stat.tone">
        <dt>
          <el-icon class="stat-icon" aria-hidden="true"><component :is="stat.icon" /></el-icon>
          {{ stat.label }}
        </dt>
        <dd>{{ stat.value }}</dd>
      </div>
    </dl>

    <section class="tasks-section" aria-labelledby="tasks-title">
      <div class="tasks-header">
        <h2 id="tasks-title">下载任务</h2>
        <div class="header-actions">
          <ConcurrencyControl v-model="downloadStore.settings.max_concurrent_downloads" />
          <SpeedLimitControl v-model="downloadStore.settings.download_speed_limit" />
          <el-button :icon="Refresh" :loading="refreshing" @click="refreshTasks(true)">刷新</el-button>
        </div>
      </div>

      <div class="queue-controls">
        <el-radio-group v-model="filterStatus" aria-label="按任务状态筛选">
          <el-radio-button v-for="filter in taskFilters" :key="filter.value" :value="filter.value">
            {{ filter.label }}
          </el-radio-button>
        </el-radio-group>

        <el-dropdown
          v-if="tasks.length"
          trigger="click"
          placement="bottom-end"
          @command="handleBatchCommand"
        >
          <el-button :icon="MoreFilled">批量操作</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="start" :disabled="!canStartAll">全部开始</el-dropdown-item>
              <el-dropdown-item command="pause" :disabled="!canPauseAll">全部暂停</el-dropdown-item>
              <el-dropdown-item command="clear" :disabled="!hasCompletedTasks" divided>删除已完成</el-dropdown-item>
              <el-dropdown-item command="delete" class="danger-command">全部暂停并删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <div v-if="selectedTasks.length" class="selection-toolbar">
        <span class="selection-count" aria-live="polite">已选 {{ selectedTasks.length }} 项</span>
        <el-button size="small" @click="pauseSelectedTasks" :disabled="!hasDownloadingSelected">暂停选中</el-button>
        <el-button size="small" @click="resumeSelectedTasks" :disabled="!hasPausedSelected">开始选中</el-button>
        <el-button size="small" type="danger" plain @click="deleteSelectedTasks">删除选中</el-button>
        <el-button size="small" text @click="clearSelection">取消选择</el-button>
      </div>

      <div v-if="pageTasks.length" class="table-scroll" role="region" aria-labelledby="tasks-title" tabindex="0">
        <table class="task-table">
          <colgroup>
            <col class="col-check" />
            <col class="col-video" />
            <col class="col-progress" />
            <col class="col-status" />
            <col class="col-file" />
            <col class="col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  aria-label="选择本页全部任务"
                  :checked="allPageTasksSelected"
                  :indeterminate.prop="selectedTasks.length > 0 && !allPageTasksSelected"
                  @change="togglePageSelection"
                />
              </th>
              <th scope="col">视频</th>
              <th scope="col">进度</th>
              <th scope="col">状态</th>
              <th scope="col">文件信息</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageTasks" :key="row.task_id" :class="{ selected: selectedTasks.includes(row.task_id) }">
              <td>
                <input
                  v-model="selectedTasks"
                  type="checkbox"
                  :value="row.task_id"
                  :aria-label="'选择任务 ' + (row.title || row.task_id)"
                />
              </td>
              <th scope="row">
                <div class="video-info">
                  <el-image
                    v-if="row.cover_url"
                    :src="row.cover_url"
                    fit="cover"
                    alt=""
                    class="video-cover"
                    :preview-src-list="[row.cover_url]"
                    preview-teleported
                  >
                    <template #error><span class="cover-placeholder"><el-icon><Film /></el-icon></span></template>
                  </el-image>
                  <span v-else class="cover-placeholder" aria-hidden="true"><el-icon><Film /></el-icon></span>
                  <div class="video-details">
                    <div class="video-title" :title="row.title">{{ row.title || '未知标题' }}</div>
                    <div class="video-meta">
                      {{ row.uploader || '未知上传者' }} · {{ row.quality || '未知画质' }}
                    </div>
                  </div>
                </div>
              </th>
              <td class="progress-cell">
                <progress :value="row.progress" max="100" :class="row.status" aria-label="下载进度" />
                <div class="progress-text">
                  <span>{{ Math.round(row.progress) }}%</span>
                  <span v-if="row.status === 'downloading' && row.speed">{{ formatSpeed(row.speed) }}</span>
                </div>
              </td>
              <td>
                <el-tag :type="getStatusType(row.status)" effect="light" round disable-transitions>
                  {{ getStatusText(row.status) }}
                </el-tag>
              </td>
              <td>
                <div>{{ formatFileSize(row.file_size) }}</div>
                <div class="task-date" :title="formatDate(row.created_at)">{{ formatDate(row.created_at) }}</div>
              </td>
              <td>
                <div class="row-actions">
                  <el-button v-if="row.status === 'downloading'" link size="small" type="primary" @click="pauseTask(row.task_id)">暂停</el-button>
                  <el-button v-if="row.status === 'paused' || row.status === 'failed'" link size="small" type="primary" @click="resumeTask(row.task_id)">继续</el-button>
                  <el-button v-if="row.status === 'completed' && row.file_path" link size="small" type="primary" @click="openFile(row.file_path)">打开</el-button>
                  <el-button link size="small" type="danger" @click="deleteTask(row.task_id)">删除</el-button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="empty-state">
        <span class="empty-icon"><el-icon><FolderOpened /></el-icon></span>
        <p>{{ emptyMessage }}</p>
        <el-button v-if="loadFailed" @click="refreshTasks(true)">重试</el-button>
        <el-button v-else-if="!refreshing && filterStatus" @click="filterStatus = ''">查看全部</el-button>
      </div>

      <div v-if="totalTasks" class="pagination-bar">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="totalTasks"
          :pager-count="5"
          layout="total, sizes, prev, pager, next"
        />
      </div>
    </section>

    <!-- 删除任务确认对话框 -->
    <el-dialog
      v-model="showDeleteDialog"
      :title="deleteDialogTitle"
      width="min(420px, calc(100% - 32px))" class="app-dialog"
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

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Clock, CircleCheck, Folder, FolderOpened, Film, MoreFilled, Operation, Plus, Refresh, TrendCharts } from '@element-plus/icons-vue'
import { useDownloadStore } from '@/stores/download'
import ConcurrencyControl from '@/components/download/ConcurrencyControl.vue'
import SpeedLimitControl from '@/components/download/SpeedLimitControl.vue'

const emit = defineEmits<{ (event: 'new-download'): void }>()
const downloadStore = useDownloadStore()

const taskFilters = [
  { label: '全部', value: '' },
  { label: '下载中', value: 'downloading' },
  { label: '排队中', value: 'pending' },
  { label: '已暂停', value: 'paused' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' }
]

const refreshing = ref(false)
const loadFailed = ref(false)
const emptyMessage = computed(() => {
  if (refreshing.value) return '正在加载任务…'
  if (loadFailed.value) return '任务列表加载失败'
  return filterStatus.value ? '没有符合筛选条件的任务' : '暂无下载任务'
})

// 状态
const filterStatus = ref('') // 空字符串 = 全部（不筛选）
const currentPage = ref(1)
const pageSize = ref(20)
const selectedTasks = ref<string[]>([])
const showDeleteDialog = ref(false)
const deleteFiles = ref(false)
const deletingTasks = ref(false)
const pendingDeleteTaskIds = ref<string[]>([])
const isDeletingAll = ref(false)

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
    'merging': 0,
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
const pageTasks = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return displayTasks.value.slice(start, start + pageSize.value)
})
const allPageTasksSelected = computed(() =>
  pageTasks.value.length > 0 && pageTasks.value.every(task => selectedTasks.value.includes(task.task_id))
)

const togglePageSelection = () => {
  selectedTasks.value = allPageTasksSelected.value ? [] : pageTasks.value.map(task => task.task_id)
}

watch([filterStatus, pageSize], () => { currentPage.value = 1 })
watch(totalTasks, total => {
  currentPage.value = Math.min(currentPage.value, Math.max(1, Math.ceil(total / pageSize.value)))
})
watch([currentPage, filterStatus, pageSize], () => { selectedTasks.value = [] })
watch(pageTasks, visible => {
  const selected = selectedTasks.value.filter(id => visible.some(task => task.task_id === id))
  if (selected.length !== selectedTasks.value.length) selectedTasks.value = selected
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

const taskStats = computed(() => [
  { label: '下载中', value: downloadStore.downloadingTasks.length, icon: Download, tone: 'downloading' },
  { label: '等待中', value: downloadStore.pendingTasks.length, icon: Clock, tone: 'pending' },
  { label: '已完成', value: downloadStore.completedTasks.length, icon: CircleCheck, tone: 'completed' },
  { label: '总任务', value: tasks.value.length, icon: Folder, tone: 'total' }
])

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
const refreshTasks = async (notify = false) => {
  if (refreshing.value) return
  refreshing.value = true
  loadFailed.value = false
  try {
    await downloadStore.fetchTasks()
    await downloadStore.fetchStats()
    if (notify) ElMessage.success('任务列表已刷新')
  } catch {
    loadFailed.value = true
    if (notify) ElMessage.error('刷新失败')
  } finally {
    refreshing.value = false
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
  if (size === null) return '—'
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
  isDeletingAll.value = false
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

const handleBatchCommand = (command: string) => {
  switch (command) {
    case 'start': return startAllTasks()
    case 'pause': return pauseAllTasks()
    case 'clear': return deleteCompletedTasks()
    case 'delete': return pauseAndDeleteAllTasks()
  }
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
  isDeletingAll.value = true
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
  isDeletingAll.value = false
  pendingDeleteTaskIds.value = [...selectedTasks.value]
  deleteFiles.value = false
  showDeleteDialog.value = true
}

const clearSelection = () => {
  selectedTasks.value = []
}

onMounted(() => refreshTasks())
</script>

<style lang="scss" scoped>
.workspace {
  display: grid;
  min-width: 0;
  gap: 16px;
}

.workspace-intro {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 24px 40px;
  border: 1px solid #315b51;
  border-radius: 20px;
  padding: clamp(22px, 3vw, 36px);
  color: #f7fff9;
  background:
    radial-gradient(ellipse at right bottom, #295f51 0%, transparent 65%),
    linear-gradient(120deg, #142b26, #123b33);
}

.intro-main {
  h1 {
    font-size: clamp(30px, 3.4vw, 42px);
    line-height: 1.15;
    font-weight: 750;
    letter-spacing: -0.04em;
  }

  p {
    margin-block: 10px 20px;
    color: #c1d9d0;
  }
}

.intro-action {
  --el-button-text-color: #123528;
  --el-button-bg-color: #bcf3d6;
  --el-button-border-color: #bcf3d6;
  --el-button-hover-text-color: #123528;
  --el-button-hover-bg-color: #d8fce8;
  --el-button-hover-border-color: #d8fce8;
  --el-button-active-text-color: #123528;
  --el-button-active-bg-color: #a5e5c4;
  --el-button-active-border-color: #a5e5c4;
  font-weight: 700;
}

.transfer-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 24px;
  padding: 15px 18px;
  border: 1px solid #709286;
  border-radius: 14px;
  background: #0e2d2666;

  dt {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #cee5dc;
    white-space: nowrap;
    font-size: 12px;
  }

  dd {
    margin-top: 4px;
    white-space: nowrap;
    font-size: clamp(18px, 2.1vw, 26px);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;

    span {
      color: #b7d5c9;
      font-size: 0.7em;
      font-weight: 500;
    }
  }
}

.stat-strip,
.tasks-section {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
}

.stat-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.stat-cell {
  --stat-padding: clamp(10px, 2vw, 22px);
  position: relative;
  padding: 14px var(--stat-padding);
  padding-inline-start: calc(var(--stat-padding) + 48px);
  border-inline-end: 1px solid var(--line);

  &:last-child {
    border-inline-end: 0;
  }

  dt {
    font-size: 12px;
    color: var(--muted);
    white-space: nowrap;
  }

  dd {
    font-size: 22px;
    font-weight: 700;
    line-height: 1.25;
    font-variant-numeric: tabular-nums;
  }
}

.stat-icon {
  position: absolute;
  inset-inline-start: var(--stat-padding);
  inset-block-start: 50%;
  translate: 0 -50%;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  font-size: 19px;
  background: var(--surface-raised);
  color: var(--muted);

  .stat-cell.downloading & {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .stat-cell.pending & {
    background: var(--el-color-warning-light-9);
    color: var(--el-color-warning-dark-2);
  }

  .stat-cell.completed & {
    background: var(--el-color-success-light-9);
    color: var(--el-color-success-dark-2);
  }
}

.tasks-section {
  min-width: 0;
}

.tasks-header,
.queue-controls,
.selection-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 12px clamp(12px, 2vw, 22px);
}

.tasks-header,
.queue-controls {
  justify-content: space-between;
}

.tasks-header {
  h2 {
    font-size: 19px;
    line-height: 1.3;
  }
}

.header-actions,
.row-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.queue-controls {
  border-top: 1px solid var(--line);
}

.selection-toolbar {
  background: var(--accent-soft);
  gap: 8px;
}

.selection-count {
  margin-inline-end: 6px;
  color: var(--accent);
  font-weight: 650;
}

.selection-toolbar,
.row-actions {
  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.table-scroll {
  overflow: auto;
  max-width: 100%;
  max-height: min(620px, 60vh);
  border-block: 1px solid var(--line);

  &:focus-visible {
    outline-offset: -2px;
  }
}

.task-table {
  width: 100%;
  min-width: 680px;
  border-spacing: 0;
  table-layout: fixed;

  .col-check { width: 40px; }
  .col-progress { width: clamp(120px, 15vw, 190px); }
  .col-status { width: 86px; }
  .col-file { width: clamp(125px, 14vw, 158px); }
  .col-actions { width: 96px; }

  thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface-raised);
    color: var(--muted);
    font-size: 12px;
  }

  th,
  td {
    padding: 10px 8px;
    text-align: left;
  }

  tbody tr + tr > * {
    border-top: 1px solid var(--line);
  }

  tbody tr:hover,
  tbody tr.selected {
    background: var(--surface-raised);
  }

  th:first-child,
  td:first-child {
    text-align: center;
  }

  input[type='checkbox'] {
    width: 16px;
    height: 16px;
    vertical-align: middle;
    cursor: pointer;
  }
}

.video-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.video-cover,
.cover-placeholder {
  width: 60px;
  height: 38px;
  flex: 0 0 60px;
  border-radius: 7px;
  background: var(--surface-raised);
}

.cover-placeholder {
  display: grid;
  place-items: center;
  color: var(--muted);
}

.video-details {
  min-width: 0;
}

.video-title,
.video-meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.video-title {
  font-weight: 650;
}

.video-meta,
.task-date,
.progress-text {
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}

.progress-cell progress {
  --progress-color: var(--accent);
  display: block;
  width: 100%;
  height: 7px;
  border-radius: 99px;
  overflow: hidden;
  accent-color: var(--progress-color);
  background: var(--line);
  appearance: none;

  &.completed { --progress-color: var(--el-color-success-dark-2); }
  &.paused { --progress-color: var(--el-color-warning-dark-2); }
  &.failed { --progress-color: var(--el-color-danger); }

  &::-webkit-progress-bar {
    background: var(--line);
  }

  &::-webkit-progress-value {
    background: var(--progress-color);
    border-radius: inherit;
  }

  &::-moz-progress-bar {
    background: var(--progress-color);
    border-radius: inherit;
  }
}

.progress-text {
  display: flex;
  justify-content: space-between;
  gap: 4px;
  margin-top: 5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.row-actions {
  gap: 10px;
}

:deep(.el-tag--warning) {
  --el-tag-text-color: var(--el-color-warning-dark-2);
}

:deep(.el-tag--success) {
  --el-tag-text-color: var(--el-color-success-dark-2);
}

:deep(.el-tag--info) {
  --el-tag-text-color: var(--muted);
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 38px 16px 42px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  text-align: center;

  .empty-icon {
    display: grid;
    place-items: center;
    width: 50px;
    height: 50px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 24px;
  }
}

.pagination-bar {
  display: flex;
  justify-content: flex-end;
  padding: 10px 14px;
  overflow-x: auto;

  :deep(.el-pagination) {
    flex-wrap: wrap;
    white-space: normal;
    padding: 0;
  }
}

@media (max-height: 680px) {
  .workspace {
    gap: 12px;
  }

  .workspace-intro {
    padding-block: 16px;
  }

  .intro-main p {
    margin-block: 6px 12px;
  }

  .stat-cell {
    padding-block: 10px;
  }
}

@media (max-width: 555px) {
  .stat-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .stat-cell:nth-child(2) {
    border-inline-end: 0;
  }

  .stat-cell:nth-child(n + 3) {
    border-top: 1px solid var(--line);
  }

  .header-actions {
    gap: 8px;
  }
}
</style>
