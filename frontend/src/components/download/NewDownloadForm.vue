<template>
  <div class="new-download-form">
    <el-form label-position="top" @submit.prevent="parseUrl">
      <el-form-item label="B 站视频链接" for="download-video-url">
        <el-input
          id="download-video-url"
          ref="urlInput"
          v-model="form.url"
          :readonly="working"
          :aria-invalid="Boolean(linkError)"
          :aria-describedby="linkError ? 'download-video-hint download-video-error' : 'download-video-hint'"
          @input="resetPreview"
          @paste="pasteVideoLink"
        />
        <p id="download-video-hint" class="form-tip">粘贴 B 站视频链接，或输入 BV 号、AV 号。</p>
        <p v-if="linkError" id="download-video-error" class="form-tip field-error">{{ linkError }}</p>
      </el-form-item>
      <div v-if="!videoInfo" class="dialog-form-actions parse-actions">
        <el-button @click="emit('cancel')">取消</el-button>
        <el-button type="primary" native-type="submit" :loading="parsing">
          {{ parsing ? '正在获取视频信息' : '获取视频信息' }}
        </el-button>
      </div>
    </el-form>

    <template v-if="videoInfo">
      <div class="video-info-card">
        <div class="video-header">
          <el-image
            v-if="videoInfo.cover_url"
            :src="videoInfo.cover_url"
            fit="cover"
            :preview-src-list="[videoInfo.cover_url]"
            preview-teleported
            class="video-cover"
          >
            <template #error><span class="cover-unavailable">封面暂不可用</span></template>
          </el-image>
          <span v-else class="video-cover cover-unavailable">封面暂不可用</span>
          <div class="video-details">
            <h3 class="video-title">{{ videoInfo.title }}</h3>
            <div class="video-meta">
              <span>{{ videoInfo.uploader }}</span>
              <span v-if="videoInfo.duration">{{ formatDuration(videoInfo.duration) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="download-options">
        <div class="quality-field">
          <label for="download-quality">画质</label>
          <el-select id="download-quality" v-model="form.quality" :disabled="working" placeholder="暂无可用画质">
            <el-option
              v-for="quality in videoInfo.available_qualities"
              :key="quality.qn"
              :label="qualityLabel(quality)"
              :value="quality.qn"
            />
          </el-select>
          <p v-if="qualityFallback" class="form-tip">{{ qualityFallback }}</p>
          <p v-if="!videoInfo.available_qualities.length" class="form-tip field-error">
            第 {{ initialPage }} 集暂无可用画质。请修改链接后重试。
          </p>
        </div>
        <div>
          <p class="field-label">保存到</p>
          <div class="path-field">
            <span class="output-path"><span>{{ pathDisplay.prefix }}</span><span class="path-end">{{ pathDisplay.end }}</span></span>
            <el-button :disabled="working || choosingPath" @click="selectDownloadPath">更改</el-button>
          </div>
          <details class="full-path">
            <summary>完整路径</summary>
            <p>{{ outputDirectory }}</p>
          </details>
          <p v-if="pathError" class="form-tip field-error" role="status">{{ pathError }}</p>
        </div>
      </div>

      <section v-if="isMultiPage" class="page-selector" aria-labelledby="download-parts">
        <div class="page-selector-header">
          <h3 id="download-parts">分集 <small>{{ form.selectedCids.length }} / {{ videoInfo.pages.length }}</small></h3>
          <el-checkbox
            :model-value="form.selectedCids.length === videoInfo.pages.length"
            :indeterminate="form.selectedCids.length > 0 && form.selectedCids.length < videoInfo.pages.length"
            :disabled="working"
            @change="toggleAllPages"
          >全选</el-checkbox>
        </div>
        <p v-if="requestedPage !== null" class="form-tip">
          链接指向第 {{ requestedPage }} 集。
        </p>
        <div ref="pageList" class="page-list">
          <el-checkbox-group v-model="form.selectedCids" class="page-checkbox-group" :disabled="working">
            <el-checkbox
              v-for="page in videoInfo.pages"
              :key="page.cid"
              :value="page.cid"
              :data-cid="page.cid"
              class="page-checkbox"
            >
              <span class="page-label">P{{ page.page }}</span>
              <span class="page-title" :title="page.title">{{ page.title || '第 ' + page.page + ' 集' }}</span>
              <span class="page-duration">{{ formatDuration(page.duration) }}</span>
            </el-checkbox>
          </el-checkbox-group>
        </div>
        <p v-if="!form.selectedCids.length" class="form-tip field-error" role="status">请选择要下载的分集。</p>
      </section>

      <el-collapse class="advanced-section">
        <el-collapse-item title="高级设置" name="advanced">
          <div class="advanced-options">
            <el-switch
              v-if="isMultiPage"
              v-model="form.downloadToSubdir"
              :disabled="working"
              active-text="按视频建子文件夹"
              aria-label="按视频建子文件夹"
            />
            <div>
              <strong>文件名规则</strong>
              <p class="form-tip">{{ filenameRule }}</p>
              <p v-if="filenameExample" class="form-tip">示例：{{ filenameExample }}</p>
            </div>
            <div v-if="videoInfo.login_status >= 1" class="quality-field">
              <label for="download-audio-quality">音频质量</label>
              <el-select id="download-audio-quality" v-model="form.audioQuality" :disabled="working">
                <el-option
                  v-for="audio in audioQualities"
                  :key="audio.value"
                  :value="audio.value"
                  :label="audio.label"
                />
              </el-select>
            </div>
            <el-checkbox v-model="form.autoMerge" :disabled="working" label="自动合并音视频" />
            <el-checkbox v-model="form.deleteTempFiles" :disabled="working" label="下载完成后删除临时文件" />
          </div>
        </el-collapse-item>
      </el-collapse>

      <div class="dialog-form-actions download-actions">
        <div class="submit-feedback" aria-live="polite">
          <p v-if="submitError" class="field-error">{{ submitError }}</p>
          <template v-if="fallbacks.length">
            <p>以下分集将使用其他画质，请确认后下载。</p>
            <ul class="fallback-list">
              <li v-for="item in fallbacks" :key="item.cid">
                第 {{ item.page }} 集 · {{ item.quality && qualityLabel(item.quality) }}
              </li>
            </ul>
          </template>
        </div>
        <div class="download-buttons">
          <el-button :disabled="creating" @click="emit('cancel')">取消</el-button>
          <el-button
            type="primary"
            :disabled="!form.selectedCids.length || form.quality === null || choosingPath"
            :loading="checking || creating"
            @click="submitDownload"
          >{{ downloadLabel }}</el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { InputInstance } from 'element-plus'
import { useDownloadStore } from '@/stores/download'
import { api } from '@/utils/api'

interface Quality {
  qn: number
  name: string
  desc?: string
}

interface VideoPage {
  cid: number
  page: number
  title: string
  duration: number
  flat_filename: string
  grouped_filename: string
}

interface VideoInfo {
  bvid?: string
  aid?: number
  title: string
  uploader?: string
  duration: number
  cover_url?: string
  pages: VideoPage[]
  selected_cid: number
  available_qualities: Quality[]
  preferred_quality: Quality
  selected_quality: Quality | null
  login_status: number
}

interface CheckedPage {
  cid: number
  page: number
  quality: Quality | null
  status: 'ready' | 'no_stream' | 'unavailable'
}

const linkErrors = {
  invalid_input: '请输入 B 站视频链接、BV 号或 AV 号。',
  invalid_page: '链接指定的分集不存在，请检查分集号。',
  not_accessible: '此视频当前不可访问。请在 B 站打开原链接确认。',
  temporary_failure: '暂时无法获取视频信息，请重试。'
}
const multipleLinksError = '这段内容包含多条 B 站视频链接，请保留一条后重试。'

type ResolveResult =
  | { ok: true; video: VideoInfo; requested_page: number | null }
  | { ok: false; error: keyof typeof linkErrors }

const emit = defineEmits<{
  success: [taskIds: string[]]
  cancel: []
  creating: [value: boolean]
}>()
const props = withDefaults(defineProps<{ open?: boolean }>(), { open: true })
const downloadStore = useDownloadStore()
const urlInput = ref<InputInstance>()
const pageList = ref<HTMLElement>()
const videoInfo = ref<VideoInfo | null>(null)
const requestedPage = ref<number | null>(null)
const parsing = ref(false)
const checking = ref(false)
const creating = ref(false)
const choosingPath = ref(false)
const linkError = ref('')
const pathError = ref('')
const submitError = ref('')
const confirmedPreview = ref<CheckedPage[]>([])
let mounted = true
let previewAttempt = 0

const form = reactive({
  url: '',
  selectedCids: [] as number[],
  quality: null as number | null,
  audioQuality: null as number | null,
  downloadPath: downloadStore.settings.default_download_path,
  downloadToSubdir: true,
  autoMerge: downloadStore.settings.auto_merge,
  deleteTempFiles: downloadStore.settings.delete_temp_files
})

const working = computed(() => parsing.value || checking.value || creating.value)
const isMultiPage = computed(() => (videoInfo.value?.pages.length ?? 0) > 1)
const initialPage = computed(() => videoInfo.value?.pages.find(page => page.cid === videoInfo.value?.selected_cid)?.page)
const selectedPage = computed(() => videoInfo.value?.pages.find(page => form.selectedCids.includes(page.cid)))
const filenameExample = computed(() => form.downloadToSubdir
  ? selectedPage.value?.grouped_filename
  : selectedPage.value?.flat_filename)
const outputDirectory = computed(() => {
  const example = filenameExample.value
  if (!form.downloadToSubdir || !isMultiPage.value || !example) return form.downloadPath
  const folder = example.replace(/[/\\][^/\\]+$/, '')
  const separator = example.includes('\\') ? '\\' : '/'
  return form.downloadPath.replace(/[/\\]+$/, '') + separator + folder
})
const pathDisplay = computed(() => {
  const directory = outputDirectory.value
  const split = Math.max(directory.lastIndexOf('\\'), directory.lastIndexOf('/')) + 1
  return split === directory.length
    ? { prefix: '', end: directory }
    : { prefix: directory.slice(0, split), end: directory.slice(split) }
})
const filenameRule = computed(() => {
  if (!isMultiPage.value) return '视频标题.mp4'
  return form.downloadToSubdir ? '视频标题 / 分集号 - 分集名称.mp4' : '视频标题 - 分集号 - 分集名称.mp4'
})
const qualityLabel = (quality: Quality) => quality.desc ? quality.name + '（' + quality.desc + '）' : quality.name
const qualityFallback = computed(() => {
  const video = videoInfo.value
  if (!video?.selected_quality || video.selected_quality.qn === video.preferred_quality.qn ||
      form.quality !== video.selected_quality.qn) return ''
  return '当前无法下载 ' + video.preferred_quality.name + '，已选 ' + qualityLabel(video.selected_quality) + '。'
})
const audioQualities = computed(() => [
  { value: 30216, label: '高音质（192 Kbps）' },
  { value: 30232, label: '中音质（128 Kbps）' },
  { value: 30280, label: '普通音质（64 Kbps）' },
  ...(videoInfo.value?.login_status === 2 ? [{ value: 30251, label: 'Hi-Res 无损' }] : [])
])
const fallbacks = computed(() => confirmedPreview.value.filter(item => item.quality?.qn !== form.quality))
const downloadLabel = computed(() => {
  if (checking.value) return '正在核对分集画质'
  if (creating.value) return '正在添加下载任务'
  return (fallbacks.value.length ? '确认下载 ' : '下载 ') + form.selectedCids.length + ' 集'
})

const focusUrl = () => urlInput.value?.focus()
defineExpose({ focusUrl })

const resetPreview = () => {
  videoInfo.value = null
  requestedPage.value = null
  form.selectedCids = []
  form.quality = null
  linkError.value = ''
}

const videoLinksIn = (text: string) => {
  const matches = text.matchAll(/https?:\/\/[^\s<>"'【】「」『』《》“”‘’，。；、！？（）()[\]{}]+/gi)
  const links: string[] = []
  for (const match of matches) {
    try {
      const url = new URL(match[0].replace(/[.,;!]+$/, ''))
      if (['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'].includes(url.hostname) &&
          /^\/video\/(?:BV[0-9A-Za-z]{10}|av\d+)\/?$/i.test(url.pathname)) links.push(url.href)
    } catch {
      // The parser supplies the format error for content without a valid URL.
    }
  }
  return links
}

const pasteVideoLink = (event: ClipboardEvent) => {
  if (working.value || !event.clipboardData) return
  const text = event.clipboardData.getData('text/plain')
  const links = videoLinksIn(text)
  if (!links.length) return
  event.preventDefault()
  resetPreview()
  form.url = links.length === 1 ? links[0] : text.replace(/[\r\n]+/g, ' ')
  if (links.length > 1) linkError.value = multipleLinksError
}

const revealSelectedEpisode = () => {
  const list = pageList.value
  const part = list?.querySelector<HTMLElement>('[data-cid="' + videoInfo.value?.selected_cid + '"]')
  if (!list || !part || form.selectedCids.length !== 1 || form.selectedCids[0] !== videoInfo.value?.selected_cid) return

  const offset = part.getBoundingClientRect().top - list.getBoundingClientRect().top
  list.scrollTop += offset - (list.clientHeight - part.offsetHeight) / 2

  const body = list.closest<HTMLElement>('.el-dialog__body')
  if (!body) return
  const viewport = body.getBoundingClientRect()
  const footer = body.querySelector('.download-actions')?.getBoundingClientRect()
  const bottom = Math.min(viewport.bottom, footer?.top ?? viewport.bottom) - 8
  const row = part.getBoundingClientRect()
  if (row.bottom > bottom) body.scrollTop += row.bottom - bottom
  else if (row.top < viewport.top + 8) body.scrollTop -= viewport.top + 8 - row.top
}

const parseUrl = async () => {
  if (working.value || videoInfo.value) return
  const links = videoLinksIn(form.url)
  if (links.length > 1) {
    linkError.value = multipleLinksError
    focusUrl()
    return
  }
  if (links.length === 1) form.url = links[0]
  parsing.value = true
  linkError.value = ''
  try {
    const result = await api.get<ResolveResult>('/video/resolve', { params: { url: form.url } })
    if (!mounted) return
    if (!result.ok) {
      linkError.value = linkErrors[result.error] || linkErrors.temporary_failure
      return
    }
    videoInfo.value = result.video
    requestedPage.value = result.requested_page
    form.selectedCids = [result.video.selected_cid]
    form.quality = result.video.selected_quality?.qn ?? null
    form.audioQuality = result.video.login_status >= 1 ? 30216 : null
    await nextTick()
    revealSelectedEpisode()
  } catch {
    if (mounted) linkError.value = linkErrors.temporary_failure
  } finally {
    if (mounted) {
      parsing.value = false
      if (linkError.value) {
        await nextTick()
        focusUrl()
      }
    }
  }
}

const toggleAllPages = (checked: boolean | string | number) => {
  form.selectedCids = checked ? videoInfo.value?.pages.map(page => page.cid) ?? [] : []
}

const selectDownloadPath = async () => {
  pathError.value = ''
  choosingPath.value = true
  try {
    if (!window.electronAPI) throw new Error('Directory picker unavailable')
    const selected = await window.electronAPI.selectDownloadDirectory(form.downloadPath)
    if (mounted && selected) form.downloadPath = selected
  } catch {
    if (mounted) pathError.value = '暂时无法打开目录选择器，请重试。'
  } finally {
    if (mounted) choosingPath.value = false
  }
}

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return minutes + ':' + String(remainder).padStart(2, '0')
}

watch([() => form.selectedCids, () => form.quality, () => form.audioQuality], () => {
  confirmedPreview.value = []
  submitError.value = ''
})
watch(() => props.open, open => {
  if (open === false) previewAttempt += 1
}, { flush: 'sync' })

const submitDownload = async () => {
  const video = videoInfo.value
  const quality = form.quality
  const cids = [...form.selectedCids]
  if (props.open === false || !video || quality === null || !cids.length || working.value || choosingPath.value) return
  const attempt = ++previewAttempt
  submitError.value = ''

  try {
    let preview = confirmedPreview.value
    if (!preview.length) {
      checking.value = true
      preview = await api.post<CheckedPage[]>('/download/preview', {
        bvid: video.bvid, aid: video.aid, cids, quality, audio_quality: form.audioQuality
      })
      if (!mounted || attempt !== previewAttempt) return
      const blocked = preview.filter(item => item.status !== 'ready')
      if (blocked.length) {
        submitError.value = blocked.map(item => '第 ' + item.page + ' 集' + (
          item.status === 'no_stream' ? '暂无可下载的视频流' : '暂时无法核对画质'
        )).join('，') + '。请调整选集或重试。'
        return
      }
      confirmedPreview.value = preview
      if (preview.some(item => item.quality?.qn !== quality)) return
    }

    creating.value = true
    emit('creating', true)
    checking.value = false
    const payload = {
      bvid: video.bvid, aid: video.aid, quality,
      quality_by_cid: Object.fromEntries(preview.map(item => [item.cid, item.quality?.qn])),
      audio_quality: form.audioQuality,
      download_to_subdir: form.downloadToSubdir,
      download_path: form.downloadPath,
      auto_merge: form.autoMerge,
      delete_temp_files: form.deleteTempFiles
    }
    const tasks = cids.length === 1
      ? [await downloadStore.startDownload({ ...payload, cid: cids[0] })]
      : (await downloadStore.startBatchDownload({ ...payload, cids })).tasks
    if (mounted) emit('success', tasks.map(task => task.task_id))
  } catch {
    if (mounted && attempt === previewAttempt) {
      submitError.value = creating.value ? '暂时无法添加下载任务，请重试。' : '暂时无法核对分集画质，请重试。'
      confirmedPreview.value = []
    }
  } finally {
    if (mounted) {
      if (creating.value) emit('creating', false)
      checking.value = false
      creating.value = false
    }
  }
}

onMounted(async () => {
  window.addEventListener('resize', revealSelectedEpisode)
  const initialPath = form.downloadPath
  try {
    await downloadStore.fetchSettings()
    if (mounted && form.downloadPath === initialPath) form.downloadPath = downloadStore.settings.default_download_path
  } catch {
    if (mounted) pathError.value = '暂时无法读取默认目录，请确认保存位置。'
  }
})
onBeforeUnmount(() => {
  mounted = false
  window.removeEventListener('resize', revealSelectedEpisode)
})
</script>

<style lang="scss" scoped>
.form-tip {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.45;
  flex-basis: 100%;
  overflow-wrap: anywhere;
}

.field-error { color: var(--el-color-danger); }

.parse-actions,
.download-buttons,
.path-field {
  display: flex;
  align-items: center;
}

.parse-actions,
.download-buttons { justify-content: flex-end; }

.video-info-card,
.page-selector {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--surface-raised);
}

.video-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.video-cover {
  width: 88px;
  height: 50px;
  flex: none;
  border-radius: 6px;
}

.cover-unavailable {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 50px;
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
}

.video-details { min-width: 0; }
.video-title { font-size: 16px; overflow-wrap: anywhere; }
.video-meta { display: flex; gap: 12px; color: var(--muted); font-size: 13px; }

.download-options {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(0, 1.45fr);
  gap: 12px;
  margin-block: 12px;
}

.quality-field label,
.field-label {
  display: block;
  margin-bottom: 4px;
  color: var(--ink);
  font-weight: 600;
}

.path-field { gap: 8px; }
.output-path {
  display: flex;
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  line-height: 1.35;
}

.output-path span { overflow: hidden; text-overflow: ellipsis; }
.path-end { flex: none; max-width: 100%; }
.full-path { color: var(--muted); font-size: 13px; margin-top: 4px; }
.full-path summary { width: fit-content; cursor: pointer; }
.full-path p { overflow-wrap: anywhere; user-select: text; }
.download-options :deep(.el-select) { width: 100%; }

.page-selector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.page-selector h3 { font-size: 14px; }
.page-selector small { margin-left: 4px; color: var(--muted); }

.page-list {
  max-height: 148px;
  overflow: auto;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface);
  margin-top: 4px;
}

.page-checkbox-group { display: grid; }
.page-checkbox {
  min-width: 0;
  width: 100%;
  margin: 0;
  padding-inline: 8px;
}

.page-checkbox + .page-checkbox { border-top: 1px solid var(--line); }

.page-checkbox :deep(.el-checkbox__label) {
  display: flex;
  width: 100%;
  min-width: 0;
  gap: 8px;
}

.page-label { min-width: 30px; color: var(--accent); }
.page-title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.page-duration { color: var(--muted); font-size: 12px; }
.advanced-section { margin-top: 10px; }
.advanced-options { display: grid; gap: 8px; }
.advanced-options :deep(.el-select) { width: 220px; max-width: 100%; }
.submit-feedback:empty { display: none; }
.submit-feedback { margin-bottom: 8px; line-height: 1.45; }
.fallback-list { max-height: 95px; overflow: auto; padding-left: 20px; }

@media (max-width: 540px) {
  .download-options { grid-template-columns: 1fr; }
}
</style>
