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
        <h2 id="tasks-title" ref="taskHeading" tabindex="-1">下载任务</h2>
        <div class="header-actions">
          <ConcurrencyControl v-model="downloadStore.settings.max_concurrent_downloads" />
          <SpeedLimitControl v-model="downloadStore.settings.download_speed_limit" />
          <el-button :icon="Refresh" :loading="refreshing" @click="refreshTasks(true)">刷新</el-button>
        </div>
      </div>

      <div class="queue-controls">
        <div v-if="focusedTaskIds?.length" class="new-task-filter">
          <span>{{ actionTaskIds.length ? '本次操作' : '本次新建' }} · {{ totalTasks }} 项</span>
          <el-button link type="primary" @click="clearFocusedTasks">
            {{ actionTaskIds.length ? '返回原视图' : '查看全部' }}
          </el-button>
        </div>
        <el-radio-group v-else v-model="filterStatus" aria-label="按任务状态筛选">
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
              <el-dropdown-item command="start" :disabled="!globalContinue.ready.length || bulkBusy">
                继续整个队列中的 {{ globalContinue.ready.length }} 项
                <span v-if="globalContinue.restart.length">（{{ globalContinue.restart.length }} 项需重新下载）</span>
              </el-dropdown-item>
              <el-dropdown-item command="pause" :disabled="!globalPauseIds.length || bulkBusy">
                暂停整个队列中的 {{ globalPauseIds.length }} 项
              </el-dropdown-item>
              <el-dropdown-item command="clear" :disabled="!viewCompletedIds.length || bulkBusy" divided>
                删除当前视图中的 {{ viewCompletedIds.length }} 条已完成记录
              </el-dropdown-item>
              <el-dropdown-item command="delete" :disabled="bulkBusy" class="danger-command">
                暂停并删除整个队列的 {{ tasks.length }} 项
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <div v-if="actionNotice" class="task-action-notice">
        <p role="status">{{ actionNotice.message }}</p>
        <el-button v-if="actionNotice.taskIds.length" link type="primary" @click="viewActionTasks">
          {{ actionNotice.paused ? '查看已暂停任务' : '查看任务' }}
        </el-button>
        <el-button text size="small" @click="actionNotice = null">关闭提示</el-button>
      </div>

      <div v-if="selectedTasks.length" class="selection-toolbar">
        <span class="selection-count" aria-live="polite">已选 {{ selectedTasks.length }} 项</span>
        <el-button size="small" @click="pauseTasks(selectedPauseIds)" :disabled="!selectedPauseIds.length || bulkBusy">
          暂停选中的 {{ selectedPauseIds.length }} 项
        </el-button>
        <el-button size="small" @click="continueTasks(selectedContinue)" :disabled="!selectedContinue.ready.length || bulkBusy">
          继续选中的 {{ selectedContinue.ready.length }} 项
        </el-button>
        <span v-if="selectedContinue.restart.length">{{ selectedContinue.restart.length }} 项需重新下载</span>
        <el-button size="small" type="danger" plain @click="deleteSelectedTasks" :disabled="bulkBusy">
          删除选中的 {{ selectedTasks.length }} 项
        </el-button>
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
                      {{ row.uploader || '未知上传者' }}
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
                <p v-if="requiresRestart(row)" class="restart-note">{{ restartMessage }}</p>
              </td>
              <td>
                <div>{{ taskFileInfo(row) }}</div>
                <div v-if="qualityChange(row)" class="task-date quality-change">{{ qualityChange(row) }}</div>
                <div class="task-date" :title="formatDate(row.created_at)">{{ formatDate(row.created_at) }}</div>
              </td>
              <td>
                <div class="row-actions">
                  <el-button
                    v-if="row.status === 'downloading' || row.status === 'merging'"
                    link size="small" type="primary" :disabled="busyTaskIds.has(row.task_id)"
                    @click="changeTask(row, 'pause')"
                  >暂停</el-button>
                  <el-button
                    v-if="isStopped(row)"
                    link size="small" type="primary" :disabled="busyTaskIds.has(row.task_id)"
                    @click="changeTask(row, requiresRestart(row) ? 'restart' : 'resume')"
                  >{{ requiresRestart(row) ? '重新下载' : '继续' }}</el-button>
                  <template v-if="row.status === 'completed' && row.file_path">
                    <el-button link size="small" type="primary" @click="openFile(row.file_path)">播放</el-button>
                    <el-button link size="small" type="primary" @click="openFile(row.file_path, true)">在文件夹中显示</el-button>
                  </template>
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
        <el-button v-else-if="!refreshing && filterStatus && !focusedTaskIds?.length" @click="filterStatus = ''">查看全部</el-button>
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
      :close-on-press-escape="!deletingTasks"
      :show-close="!deletingTasks"
      @opened="focusDeleteCancel"
    >
      <p>{{ deleteDialogMessage }}</p>
      <el-checkbox v-if="deleteScope !== 'completed'" v-model="deleteFiles" :disabled="deletingTasks">
        同时删除磁盘上的下载文件
      </el-checkbox>
      <p>{{ deleteFiles ? '将删除任务记录及关联的下载文件。' : '将删除任务记录和未完成的下载缓存，保留已保存的视频文件。' }}</p>
      <template #footer>
        <div ref="deleteFooter">
          <el-button :disabled="deletingTasks" @click="cancelDelete">取消</el-button>
          <el-button type="danger" :loading="deletingTasks" @click="confirmDelete">
            删除 {{ pendingDeleteTaskIds.length }} 项
          </el-button>
        </div>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Clock, CircleCheck, Folder, FolderOpened, Film, MoreFilled, Operation, Plus, Refresh, TrendCharts } from '@element-plus/icons-vue'
import { useDownloadStore, type DownloadTask } from '@/stores/download'
import ConcurrencyControl from '@/components/download/ConcurrencyControl.vue'
import SpeedLimitControl from '@/components/download/SpeedLimitControl.vue'

const props = defineProps<{ newTaskIds?: string[] }>()
const emit = defineEmits<{ 'new-download': []; 'clear-new-tasks': [] }>()
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
const actionTaskIds = ref<string[]>([])
const focusedTaskIds = computed(() => actionTaskIds.value.length ? actionTaskIds.value : props.newTaskIds)
const actionNotice = ref<{ message: string; taskIds: string[]; paused: boolean } | null>(null)
const busyTaskIds = ref(new Set<string>())
const bulkBusy = ref(false)
const restartMessage = '无法从上次进度继续，需要重新下载'
const emptyMessage = computed(() => {
  if (refreshing.value) return '正在加载任务…'
  if (loadFailed.value) return '任务列表加载失败'
  if (focusedTaskIds.value?.length) return '此视图中的任务已移除'
  return filterStatus.value ? '没有符合筛选条件的任务' : '暂无下载任务'
})

// 状态
const filterStatus = ref('') // 空字符串 = 全部（不筛选）
const currentPage = ref(1)
const pageSize = ref(20)
const selectedTasks = ref<string[]>([])
const showDeleteDialog = ref(false)
const deleteFooter = ref<HTMLElement>()
const taskHeading = ref<HTMLElement>()
const deleteFiles = ref(false)
const deletingTasks = ref(false)
const pendingDeleteTaskIds = ref<string[]>([])
const deleteScope = ref<'all' | 'completed' | 'selected'>('selected')

// 任务原始数据
const tasks = computed(() => downloadStore.tasks)

/**
 * 排序逻辑：
 * - 不筛选（filterStatus为空）：下载中排最前，其次排队中，最后已完成，同组内按创建时间倒序
 * - 筛选时：只保留该状态的任务，按创建时间倒序
 */
const displayTasks = computed(() => {
  const ids = new Set(focusedTaskIds.value)
  const filtered = ids.size ? tasks.value.filter(task => ids.has(task.task_id)) : tasks.value.slice()

  if (filterStatus.value && !ids.size) {
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
watch(() => props.newTaskIds, async ids => {
  actionTaskIds.value = []
  currentPage.value = 1
  selectedTasks.value = []
  if (ids?.length) {
    filterStatus.value = ''
    await nextTick()
    taskHeading.value?.focus()
  }
}, { immediate: true })
watch(focusedTaskIds, () => {
  currentPage.value = 1
  selectedTasks.value = []
})
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
  if (deleteScope.value === 'all') return '暂停并删除整个队列'
  if (deleteScope.value === 'completed') return '删除已完成任务'
  return pendingDeleteTaskIds.value.length > 1 ? '删除选中任务' : '删除任务'
})

const deleteDialogMessage = computed(() => {
  const count = pendingDeleteTaskIds.value.length
  if (deleteScope.value === 'all') return '将暂停整个队列中的下载和排队，并删除其中 ' + count + ' 项任务。'
  if (deleteScope.value === 'completed') return '将删除当前视图中的 ' + count + ' 条已完成记录。'
  return '将删除所选的 ' + count + ' 项任务。'
})

const focusDeleteCancel = () => deleteFooter.value?.querySelector('button')?.focus()

const taskStats = computed(() => [
  { label: '下载中', value: downloadStore.downloadingTasks.length, icon: Download, tone: 'downloading' },
  { label: '排队中', value: downloadStore.pendingTasks.length, icon: Clock, tone: 'pending' },
  { label: '已完成', value: downloadStore.completedTasks.length, icon: CircleCheck, tone: 'completed' },
  { label: '总任务', value: tasks.value.length, icon: Folder, tone: 'total' }
])

const isStopped = (task: DownloadTask) => task.status === 'paused' || task.status === 'failed'
const canPause = (task: DownloadTask) => ['downloading', 'pending', 'merging'].includes(task.status)
const requiresRestart = (task: DownloadTask) => isStopped(task) && task.resume_state === 'restart_required'

const continuationScope = (entries: DownloadTask[]) => ({
  ready: entries.filter(task => isStopped(task) && !requiresRestart(task)).map(task => task.task_id),
  restart: entries.filter(requiresRestart).map(task => task.task_id)
})

const selectedEntries = computed(() => tasks.value.filter(task => selectedTasks.value.includes(task.task_id)))
const globalContinue = computed(() => continuationScope(tasks.value))
const selectedContinue = computed(() => continuationScope(selectedEntries.value))
const globalPauseIds = computed(() => tasks.value.filter(canPause).map(task => task.task_id))
const selectedPauseIds = computed(() => selectedEntries.value.filter(canPause).map(task => task.task_id))
const viewCompletedIds = computed(() => displayTasks.value
  .filter(task => task.status === 'completed').map(task => task.task_id))

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
    'pending': '排队中',
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

const taskFileInfo = (task: DownloadTask) => {
  const requested = task.quality_name || '未知画质'
  const quality = task.actual_quality_name || (
    task.status === 'completed' ? '原选 ' + requested : (task.planned_quality_name || requested)
  )
  return task.file_size === null ? quality : quality + ' · ' + formatFileSize(task.file_size)
}

const qualityChange = (task: DownloadTask) => {
  const actual = task.actual_quality_name
  const planned = task.planned_quality_name || task.quality_name
  if (actual && planned && actual !== planned) return '画质由 ' + planned + ' 调整为 ' + actual
  if (planned && task.quality_name && planned !== task.quality_name) return '已确认调整为 ' + planned
  return ''
}

const clearFocusedTasks = () => {
  if (actionTaskIds.value.length) actionTaskIds.value = []
  else emit('clear-new-tasks')
}

const viewActionTasks = async () => {
  if (!actionNotice.value?.taskIds.length) return
  actionTaskIds.value = actionNotice.value.taskIds
  actionNotice.value = null
  await nextTick()
  taskHeading.value?.focus()
}

const setActionNotice = (message: string, affectedIds: string[], previouslyVisible: Set<string>, paused: boolean) => {
  const visibleNow = new Set(displayTasks.value.map(task => task.task_id))
  actionNotice.value = {
    message,
    taskIds: affectedIds.filter(id => previouslyVisible.has(id) && !visibleNow.has(id)),
    paused
  }
}

const changeTask = async (task: DownloadTask, action: 'pause' | 'resume' | 'restart') => {
  const id = task.task_id
  if (busyTaskIds.value.has(id)) return
  busyTaskIds.value.add(id)
  const visible = new Set(displayTasks.value.map(entry => entry.task_id))
  try {
    if (action === 'pause') {
      await downloadStore.pauseDownload(id)
      setActionNotice('任务已暂停。', [id], visible, true)
    } else if (action === 'restart') {
      await downloadStore.restartDownload(id)
      setActionNotice('任务已加入队列，将重新下载。', [id], visible, false)
    } else {
      const response = await downloadStore.resumeDownload(id)
      const updated = tasks.value.find(entry => entry.task_id === id)
      const restartRequired = response.outcome === 'restart_required' || updated?.resume_state === 'restart_required'
      setActionNotice(restartRequired ? restartMessage + '。' : '任务已加入下载队列。', [id], visible, false)
    }
  } catch {
    ElMessage.error(action === 'pause' ? '暂停失败' : action === 'restart' ? '重新下载失败' : '继续失败')
  } finally {
    busyTaskIds.value.delete(id)
  }
}

const deleteTask = (taskId: string) => {
  deleteScope.value = 'selected'
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
  if (deletingTasks.value || !pendingDeleteTaskIds.value.length) return
  deletingTasks.value = true
  const ids = [...pendingDeleteTaskIds.value]
  const removeFiles = deleteFiles.value
  let keptSharedFile = false
  try {
    if (deleteScope.value === 'completed') {
      await downloadStore.clearCompletedTasks(ids)
    } else {
      if (deleteScope.value === 'all') await downloadStore.pauseTasks(ids)
      for (const taskId of ids) {
        if (!tasks.value.some(task => task.task_id === taskId)) continue
        const result = await downloadStore.deleteTask(taskId, removeFiles)
        keptSharedFile ||= Boolean(result?.shared_file)
        pendingDeleteTaskIds.value = pendingDeleteTaskIds.value.filter(id => id !== taskId)
      }
    }
    selectedTasks.value = selectedTasks.value.filter(taskId => !ids.includes(taskId))
    ElMessage.success(keptSharedFile
      ? '任务记录已删除，其他任务仍引用的文件已保留'
      : removeFiles ? '任务记录和文件已删除' : '任务记录已删除')
    cancelDelete()
    void refreshTasks()
  } catch (error) {
    ElMessage.error('删除失败')
  } finally {
    deletingTasks.value = false
  }
}

const openFile = async (filePath: string, reveal = false) => {
  if (!window.electronAPI) {
    ElMessage.error('系统文件打开功能不可用')
    return
  }

  try {
    const opened = reveal
      ? await window.electronAPI.openFileDirectory(filePath)
      : await window.electronAPI.openFile(filePath)
    if (!opened) ElMessage.error('文件不存在或已被移动')
  } catch (error: any) {
    ElMessage.error(error.message || (reveal ? '无法在文件夹中显示文件' : '无法使用系统默认应用播放'))
  }
}

const handleBatchCommand = (command: string) => {
  switch (command) {
    case 'start': return continueTasks(globalContinue.value)
    case 'pause': return pauseTasks(globalPauseIds.value)
    case 'clear': return deleteCompletedTasks()
    case 'delete': return pauseAndDeleteAllTasks()
  }
}

const continueTasks = async (scope: ReturnType<typeof continuationScope>) => {
  if (bulkBusy.value || !scope.ready.length) return
  const { ready, restart } = scope
  const visible = new Set(displayTasks.value.map(task => task.task_id))
  const queued: string[] = []
  let skipped = restart.length
  let failed = 0
  bulkBusy.value = true
  try {
    for (const id of ready) {
      try {
        const response = await downloadStore.resumeDownload(id)
        const task = tasks.value.find(entry => entry.task_id === id)
        if (response.outcome === 'restart_required' || task?.resume_state === 'restart_required') skipped += 1
        else queued.push(id)
      } catch {
        failed += 1
      }
    }
    const feedback = ['已将 ' + queued.length + ' 项加入下载队列。']
    if (skipped) feedback.push(skipped + ' 项需重新下载，已跳过。')
    if (failed) feedback.push(failed + ' 项继续失败。')
    setActionNotice(feedback.join(''), queued, visible, false)
  } finally {
    bulkBusy.value = false
  }
}

const pauseTasks = async (ids: string[]) => {
  if (bulkBusy.value || !ids.length) return
  const visible = new Set(displayTasks.value.map(task => task.task_id))
  bulkBusy.value = true
  try {
    await downloadStore.pauseTasks(ids)
    await downloadStore.fetchTasks()
    const paused = ids.filter(id => tasks.value.some(task => task.task_id === id && task.status === 'paused'))
    setActionNotice('已暂停 ' + paused.length + ' 项任务。', paused, visible, true)
  } catch {
    ElMessage.error('批量暂停失败')
  } finally {
    bulkBusy.value = false
  }
}

const pauseAndDeleteAllTasks = () => {
  deleteScope.value = 'all'
  pendingDeleteTaskIds.value = tasks.value.map(task => task.task_id)
  deleteFiles.value = false
  showDeleteDialog.value = true
}

const deleteCompletedTasks = () => {
  deleteScope.value = 'completed'
  pendingDeleteTaskIds.value = [...viewCompletedIds.value]
  deleteFiles.value = false
  showDeleteDialog.value = true
}

const deleteSelectedTasks = () => {
  deleteScope.value = 'selected'
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
  .col-actions { width: 126px; }

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

.new-task-filter {
  display: flex;
  align-items: center;
  gap: 10px;
}

.task-action-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 8px clamp(12px, 2vw, 22px);
  background: var(--surface-raised);

  :deep(.el-button + .el-button) { margin-left: 0; }
}

.restart-note {
  margin-top: 4px;
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
}

.quality-change { color: var(--el-color-warning-dark-2); }

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
