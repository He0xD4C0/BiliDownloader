<template>
  <div class="settings-form">
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <fieldset class="settings-group">
        <legend>默认下载</legend>
        <div class="settings-grid">
          <el-form-item label="默认下载路径" prop="default_download_path" class="full-width">
            <el-input v-model="form.default_download_path" placeholder="请输入下载路径" clearable>
              <template #append>
                <el-button @click="selectDownloadPath">浏览</el-button>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item label="默认画质" prop="default_quality">
            <el-select v-model="form.default_quality" placeholder="请选择默认画质">
              <el-option label="360P" value="360p" />
              <el-option label="480P" value="480p" />
              <el-option label="720P" value="720p" />
              <el-option label="1080P" value="1080p" />
              <el-option label="4K" value="4k" />
            </el-select>
          </el-form-item>

          <el-form-item label="下载后处理">
            <div class="checkbox-group">
              <el-checkbox v-model="form.auto_merge" label="自动合并音视频" />
              <el-checkbox v-model="form.delete_temp_files" label="下载完成后删除临时文件" />
            </div>
          </el-form-item>
        </div>
      </fieldset>

      <fieldset class="settings-group">
        <legend>下载队列</legend>
        <div class="settings-grid">
          <el-form-item label="最大并发下载数" prop="max_concurrent_downloads">
            <el-input-number v-model="form.max_concurrent_downloads" :min="1" :max="10" controls-position="right" />
          </el-form-item>

          <el-form-item label="单线程限速" prop="download_speed_limit">
            <el-input-number
              v-model="form.download_speed_limit"
              :min="0"
              :max="102400"
              :step="16"
              controls-position="right"
            />
            <span class="settings-hint">KB/s，0 为不限速</span>
          </el-form-item>

          <el-form-item class="full-width">
            <el-switch v-model="form.slow_speed_auto_pause" active-text="低速自动暂停" aria-label="低速自动暂停" />
            <span class="settings-hint">持续低速时暂停下载，并将任务移至队尾。</span>
          </el-form-item>

          <template v-if="form.slow_speed_auto_pause">
            <el-form-item label="低速阈值（KB/s）" prop="slow_speed_threshold_kbps">
              <el-input-number
                v-model="form.slow_speed_threshold_kbps"
                :min="1"
                :max="102400"
                :step="16"
                controls-position="right"
              />
            </el-form-item>
            <el-form-item label="宽限期（秒）" prop="slow_speed_grace_seconds">
              <el-input-number
                v-model="form.slow_speed_grace_seconds"
                :min="1"
                :max="600"
                controls-position="right"
              />
            </el-form-item>
          </template>
        </div>
      </fieldset>

      <fieldset class="settings-group">
        <legend>网络</legend>
        <el-form-item>
          <el-switch v-model="form.proxy_enabled" active-text="启用代理" aria-label="启用代理" />
        </el-form-item>
        <el-form-item v-if="form.proxy_enabled" label="代理地址" prop="proxy_url">
          <el-input v-model="form.proxy_url" placeholder="例如：http://127.0.0.1:7890" clearable />
        </el-form-item>
      </fieldset>

      <el-form-item class="dialog-form-actions">
        <el-button @click="handleCancel">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">保存设置</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useDownloadStore } from '@/stores/download'

const emit = defineEmits(['success', 'cancel'])

// Store
const downloadStore = useDownloadStore()

// 表单引用
const formRef = ref<FormInstance>()

// 表单数据
const form = reactive({
  default_download_path: '',
  default_quality: '1080p',
  max_concurrent_downloads: 4,
  download_speed_limit: 0,
  slow_speed_auto_pause: true,
  slow_speed_threshold_kbps: 50,
  slow_speed_grace_seconds: 15,
  auto_merge: true,
  delete_temp_files: true,
  proxy_enabled: false,
  proxy_url: ''
})

// 表单验证规则
const rules: FormRules = {
  default_download_path: [
    { required: true, message: '请输入下载路径', trigger: 'blur' }
  ],
  default_quality: [
    { required: true, message: '请选择默认画质', trigger: 'change' }
  ],
  max_concurrent_downloads: [
    { required: true, message: '请设置最大并发下载数', trigger: 'change' }
  ]
}

// 状态
const submitting = ref(false)

// 方法
const selectDownloadPath = async () => {
  if (!window.electronAPI) {
    ElMessage.error('系统目录选择器不可用')
    return
  }

  const selectedPath = await window.electronAPI.selectDownloadDirectory()
  if (selectedPath) form.default_download_path = selectedPath
}

const handleCancel = () => {
  emit('cancel')
}

const handleSubmit = async () => {
  if (!formRef.value) return
  
  const valid = await formRef.value.validate()
  if (!valid) return
  
  submitting.value = true
  
  try {
    // 更新设置
    await downloadStore.updateSettings({
      default_download_path: form.default_download_path,
      default_quality: form.default_quality,
      max_concurrent_downloads: form.max_concurrent_downloads,
      download_speed_limit: form.download_speed_limit,
      slow_speed_auto_pause: form.slow_speed_auto_pause,
      slow_speed_threshold_kbps: form.slow_speed_threshold_kbps,
      slow_speed_grace_seconds: form.slow_speed_grace_seconds,
      auto_merge: form.auto_merge,
      delete_temp_files: form.delete_temp_files,
      proxy_enabled: form.proxy_enabled,
      proxy_url: form.proxy_enabled ? form.proxy_url : null
    })
    
    ElMessage.success('设置已保存')
    emit('success')
  } catch (error: any) {
    console.error('保存设置失败:', error)
    ElMessage.error(error.response?.data?.detail || '保存设置失败')
  } finally {
    submitting.value = false
  }
}

// 生命周期
onMounted(async () => {
  // 加载当前设置
  await downloadStore.fetchSettings()
  
  // 更新表单数据
  Object.assign(form, {
    default_download_path: downloadStore.settings.default_download_path,
    default_quality: downloadStore.settings.default_quality,
    max_concurrent_downloads: downloadStore.settings.max_concurrent_downloads,
    download_speed_limit: downloadStore.settings.download_speed_limit || 0,
    slow_speed_auto_pause: downloadStore.settings.slow_speed_auto_pause !== false,
    slow_speed_threshold_kbps: downloadStore.settings.slow_speed_threshold_kbps || 50,
    slow_speed_grace_seconds: downloadStore.settings.slow_speed_grace_seconds || 15,
    auto_merge: downloadStore.settings.auto_merge,
    delete_temp_files: downloadStore.settings.delete_temp_files,
    proxy_enabled: downloadStore.settings.proxy_enabled,
    proxy_url: downloadStore.settings.proxy_url || ''
  })
})
</script>

<style lang="scss" scoped>
.settings-group {
  min-width: 0;
  padding: 8px 14px 0;
  margin-bottom: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;

  legend {
    padding-inline: 6px;
    color: var(--ink);
    font-size: 14px;
    font-weight: 700;
  }

  :deep(.el-form-item) {
    margin-bottom: 14px;
  }

  :deep(.el-select),
  :deep(.el-input-number) {
    width: min(100%, 156px);
  }
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 18px;

  .full-width {
    grid-column: 1 / -1;
  }
}

.checkbox-group {
  display: grid;

  :deep(.el-checkbox) {
    margin-inline-end: 0;
  }
}

.settings-hint {
  margin-inline-start: 8px;
  color: var(--muted);
  font-size: 12px;
}

@media (max-width: 500px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
