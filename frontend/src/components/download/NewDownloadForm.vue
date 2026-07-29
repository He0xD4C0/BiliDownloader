<template>
  <div class="new-download-form">
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      label-position="top"
    >
      <!-- 登录状态指示 -->
      <div v-if="checkingLogin" class="login-status-row">
        <span class="login-badge" style="color:#909399;background:#f4f4f5;">
          正在检测登录状态...
        </span>
      </div>
      <div v-else class="login-status-row">
        <span class="login-badge" :style="{
          color: loginStatusInfo.color,
          background: loginStatusInfo.color + '18',
          borderColor: loginStatusInfo.color + '44',
        }">
          {{ loginStatusInfo.icon }} {{ loginStatusInfo.text }}
        </span>
      </div>
      
      <!-- URL输入 -->
      <el-form-item label="B站视频链接" prop="url">
        <el-input
          v-model="form.url"
          placeholder="请输入B站视频链接（支持BV号、AV号、完整URL）"
          clearable
          @change="handleUrlChange"
        >
          <template #append>
            <el-button :icon="Search" @click="parseUrl" :loading="parsingUrl">
              解析
            </el-button>
          </template>
        </el-input>
        <div class="form-tip">
          支持格式：BV1xx411x7xx、av170001、https://www.bilibili.com/video/BV1xx411x7xx
        </div>
      </el-form-item>
      
      <!-- 视频信息展示 -->
      <div v-if="videoInfo" class="video-info-card">
        <div class="video-header">
          <el-image
            :src="videoInfo.cover_url"
            fit="cover"
            class="video-cover"
            :preview-src-list="[videoInfo.cover_url]"
          />
          <div class="video-details">
            <h3 class="video-title">{{ videoInfo.title }}</h3>
            <div class="video-meta">
              <span class="meta-item">
                <el-icon><User /></el-icon>
                {{ videoInfo.uploader }}
              </span>
              <span class="meta-item">
                <el-icon><Clock /></el-icon>
                {{ formatDuration(videoInfo.duration) }}
              </span>
              <span class="meta-item">
                <el-icon><Calendar /></el-icon>
                {{ formatDate(videoInfo.pub_date) }}
              </span>
            </div>
          </div>
        </div>
        
        <!-- 分P选择 -->
        <div v-if="videoInfo.pages && videoInfo.pages.length > 1" class="video-pages">
          <el-form-item label="选择分P">
            <el-select v-model="form.selectedPage" placeholder="请选择分P">
              <el-option
                v-for="page in videoInfo.pages"
                :key="page.cid"
                :label="`P${page.page} ${page.title}`"
                :value="page"
              />
            </el-select>
          </el-form-item>
        </div>
      </div>
      
      <!-- 画质选择 -->
      <el-form-item label="选择画质" prop="quality">
        <el-select v-model="form.quality" placeholder="请选择画质" class="quality-select">
          <el-option-group
            v-for="group in qualityGroups"
            :key="group.label"
            :label="group.label"
          >
            <el-option
              v-for="quality in group.options"
              :key="quality.qn"
              :label="`${quality.name} (${quality.desc})`"
              :value="quality.qn"
            >
              <div class="quality-option">
                <span class="quality-name">{{ quality.name }}</span>
                <span class="quality-desc">{{ quality.desc }}</span>
                <span class="quality-resolution">{{ quality.width }}×{{ quality.height }}</span>
              </div>
            </el-option>
          </el-option-group>
        </el-select>
      </el-form-item>
      
      <!-- 音频质量选择（仅登录用户可用） -->
      <el-form-item v-if="audioEnabled" label="音频质量">
        <el-select v-model="form.audioQuality" placeholder="请选择音频质量" class="quality-select">
          <el-option
            v-for="audio in availableAudioQualities"
            :key="audio.value"
            :label="`${audio.name} - ${audio.desc}`"
            :value="audio.value"
          >
            <div class="quality-option">
              <span class="quality-name">{{ audio.name }}</span>
              <span class="quality-desc">{{ audio.desc }}</span>
              <span v-if="audio.needVip" class="vip-tag">大会员</span>
            </div>
          </el-option>
        </el-select>
      </el-form-item>
      
      <!-- 下载设置 -->
      <el-collapse v-model="activeCollapse">
        <el-collapse-item title="高级设置" name="advanced">
          <!-- 保存路径 -->
          <el-form-item label="保存路径">
            <el-input
              v-model="form.downloadPath"
              placeholder="选择保存路径"
              readonly
            >
              <template #append>
                <el-button @click="selectDownloadPath">浏览</el-button>
              </template>
            </el-input>
          </el-form-item>
          
          <!-- 文件名模板 -->
          <el-form-item label="文件名">
            <el-input
              v-model="form.filenameTemplate"
              placeholder="例如：{title}_{quality}"
            />
            <div class="form-tip">
              可用变量：{title}、{bvid}、{aid}、{quality}、{date}、{uploader}
            </div>
          </el-form-item>
          
          <!-- 其他选项 -->
          <div class="advanced-options">
            <el-checkbox v-model="form.autoMerge" label="自动合并音视频" />
            <el-checkbox v-model="form.deleteTempFiles" label="下载完成后删除临时文件" />
          </div>
        </el-collapse-item>
      </el-collapse>
      
      <!-- 表单操作 -->
      <el-form-item class="form-actions">
        <el-button @click="handleCancel">取消</el-button>
        <el-button
          type="primary"
          @click="handleSubmit"
          :loading="submitting"
          :disabled="!form.url || !videoInfo"
        >
          开始下载
        </el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Search, User, Clock, Calendar } from '@element-plus/icons-vue'
import { useDownloadStore } from '@/stores/download'
import { api } from '@/utils/api'

const emit = defineEmits(['success', 'cancel'])

// Store
const downloadStore = useDownloadStore()

// 表单引用
const formRef = ref<FormInstance>()

// 登录状态: 0=未登录, 1=已登录, 2=大会员
const loginStatus = ref(0)
const loginStatusText = ref('')
const checkingLogin = ref(false)

// 音频质量常量
const ALL_AUDIO_QUALITIES = [
  { value: 30216, name: '高音质', desc: '192Kbps', needVip: false },
  { value: 30232, name: '中音质', desc: '128Kbps', needVip: false },
  { value: 30280, name: '普通音质', desc: '64Kbps', needVip: false },
  { value: 30251, name: 'Hi-Res 无损', desc: '96KHz/24bit', needVip: true },
]

// 表单数据
const form = reactive({
  url: '',
  quality: 80 as number | null, // 解析后选择最高可用画质
  selectedPage: null as any,
  downloadPath: downloadStore.settings.default_download_path,
  filenameTemplate: '{title}_{quality}',
  autoMerge: true,
  deleteTempFiles: true,
  audioQuality: 30216 as number | null, // 默认高音质
})

// 表单验证规则
const rules: FormRules = {
  url: [
    { required: true, message: '请输入视频链接', trigger: 'blur' }
  ],
  quality: [
    { required: true, message: '请选择画质', trigger: 'change' }
  ]
}

// 状态
const parsingUrl = ref(false)
const submitting = ref(false)
const videoInfo = ref<any>(null)
const activeCollapse = ref([])

// 根据登录状态过滤后的音频质量列表
const availableAudioQualities = computed(() => {
  return ALL_AUDIO_QUALITIES.filter(q => {
    if (q.needVip) return loginStatus.value === 2
    return loginStatus.value >= 1 // 至少已登录才能选音频
  })
})

// 是否开启音频选项
const audioEnabled = computed(() => loginStatus.value >= 1)

// 计算属性 - 画质分组（基于videoInfo里的available_qualities）
const qualityGroups = computed(() => {
  if (!videoInfo.value) return []
  
  const qualities = videoInfo.value.available_qualities || []
  
  // 分组：高画质、标准画质、低画质
  const groups = [
    {
      label: '高画质',
      options: qualities.filter((q: any) => q.qn >= 80)
    },
    {
      label: '标准画质',
      options: qualities.filter((q: any) => q.qn >= 32 && q.qn < 80)
    },
    {
      label: '低画质',
      options: qualities.filter((q: any) => q.qn < 32)
    }
  ].filter(group => group.options.length > 0)
  
  return groups
})

// 登录状态标签
const loginStatusInfo = computed(() => {
  const statusMap: Record<number, { text: string, color: string, icon: string }> = {
    0: { text: '未登录 - 仅360P/480P', color: '#909399', icon: '🔒' },
    1: { text: '已登录 - 最高1080P', color: '#67c23a', icon: '✅' },
    2: { text: '大会员 - 全部画质', color: '#e6a23c', icon: '👑' }
  }
  return statusMap[loginStatus.value] || statusMap[0]
})

// 方法
const handleUrlChange = () => {
  videoInfo.value = null
  form.selectedPage = null
}

// 检测B站登录状态；凭证由 Electron 主进程安全保存并自动使用。
const checkLoginStatus = async () => {
  checkingLogin.value = true
  try {
    const response = await api.post('/video/check-vip-status')
    loginStatus.value = response.login_status || 0
    loginStatusText.value = response.is_vip ? '大会员' : response.is_logged_in ? '已登录' : '未登录'
  } catch (error) {
    console.error('检测登录状态失败:', error)
    loginStatus.value = 0
  } finally {
    checkingLogin.value = false
  }
}

const parseUrl = async () => {
  if (!form.url.trim()) {
    ElMessage.warning('请输入视频链接')
    return
  }
  
  parsingUrl.value = true
  
  try {
    // 解析URL
    const response = await api.get('/video/parse-url', {
      params: { url: form.url }
    })
    
    const { bvid, aid } = response
    
    if (!bvid && !aid) {
      throw new Error('无法解析视频链接')
    }
    
    // 先检测登录状态
    await checkLoginStatus()
    
    // 获取视频信息；Electron 主进程会自动使用已保存的登录凭证。
    const videoResponse = await api.get('/video/info', {
      params: {
        bvid,
        aid,
        login_status: loginStatus.value,
      }
    })

    videoInfo.value = videoResponse
    
    // 默认选择第一个分P
    if (videoInfo.value.pages && videoInfo.value.pages.length > 0) {
      form.selectedPage = videoInfo.value.pages[0]
    }
    
    // 默认选择当前解析结果中的最高可用画质。
    const availableQualities = videoInfo.value.available_qualities || []
    form.quality = availableQualities[0]?.qn ?? null
    
    // 默认音频质量
    if (loginStatus.value >= 1) {
      form.audioQuality = 30216 // 高音质
    } else {
      form.audioQuality = null  // 未登录不支持音频选择
    }
    
    ElMessage.success('视频信息获取成功')
  } catch (error: any) {
    console.error('解析视频失败:', error)
    ElMessage.error(error.response?.data?.detail || '解析视频失败，请检查链接格式')
  } finally {
    parsingUrl.value = false
  }
}

const selectDownloadPath = async () => {
  if (!window.electronAPI) {
    ElMessage.error('系统目录选择器不可用')
    return
  }

  const selectedPath = await window.electronAPI.selectDownloadDirectory()
  if (selectedPath) form.downloadPath = selectedPath
}

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('zh-CN')
}

const handleCancel = () => {
  emit('cancel')
}

const handleSubmit = async () => {
  if (!formRef.value) return
  
  const valid = await formRef.value.validate()
  if (!valid) return
  
  if (!videoInfo.value) {
    ElMessage.warning('请先解析视频信息')
    return
  }
  
  submitting.value = true
  
  try {
    // 获取选择的页面
    const page = form.selectedPage || videoInfo.value.pages?.[0]
    
    // 准备下载数据（包含音频质量和登录状态）
    const downloadData = {
      bvid: videoInfo.value.bvid,
      aid: videoInfo.value.aid,
      cid: page?.cid || videoInfo.value.cid,
      quality: form.quality ?? undefined,
      audio_quality: form.audioQuality,           // 音频质量
      login_status: loginStatus.value,             // 登录状态
      auto_merge: form.autoMerge,
      delete_temp_files: form.deleteTempFiles,
      download_path: form.downloadPath
    }
    
    // 开始下载
    await downloadStore.startDownload(downloadData)
    
    ElMessage.success('下载任务已创建')
    emit('success')
  } catch (error: any) {
    console.error('创建下载任务失败:', error)
    ElMessage.error(error.response?.data?.detail || '创建下载任务失败')
  } finally {
    submitting.value = false
  }
}

// 生命周期
onMounted(async () => {
  // 加载下载设置
  await downloadStore.fetchSettings()
  form.downloadPath = downloadStore.settings.default_download_path
})
</script>

<style lang="scss" scoped>
.new-download-form {
  padding: 8px 0;
  
  .form-tip {
    font-size: 12px;
    color: #909399;
    margin-top: 4px;
  }
  
  // 登录状态指示器
  .login-status-row {
    margin-bottom: 12px;
    
    .login-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      border: 1px solid transparent;
      font-weight: 500;
    }
  }
  
  // 大会员标签
  .vip-tag {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    color: #e6a23c;
    background: #fdf6ec;
    border: 1px solid #e6a23c33;
    margin-left: 4px;
  }
  
  .video-info-card {
    border: 1px solid #e6e6e6;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
    background-color: #fafafa;
    
    .video-header {
      display: flex;
      gap: 16px;
      
      .video-cover {
        width: 160px;
        height: 90px;
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
      }
      
      .video-details {
        flex: 1;
        
        .video-title {
          margin: 0 0 8px;
          font-size: 16px;
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
          flex-wrap: wrap;
          gap: 16px;
          
          .meta-item {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 12px;
            color: #606266;
            
            .el-icon {
              font-size: 14px;
            }
          }
        }
      }
    }
    
    .video-pages {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #e6e6e6;
    }
  }
  
  .quality-select {
    width: 100%;
  }
  
  .quality-option {
    display: flex;
    justify-content: space-between;
    align-items: center;
    
    .quality-name {
      font-weight: 500;
      min-width: 80px;
    }
    
    .quality-desc {
      color: #909399;
      flex: 1;
    }
    
    .quality-resolution {
      color: #606266;
      font-family: monospace;
    }
  }
  
  .advanced-options {
    display: flex;
    flex-direction: column;
    gap: 12px;
    
    .el-checkbox {
      margin-right: 0;
    }
  }
  
  .form-actions {
    margin-top: 24px;
    text-align: right;
    
    .el-button {
      min-width: 100px;
    }
  }
}

:deep(.el-collapse-item__header) {
  font-weight: 500;
  color: #303133;
}
</style>