<template>
  <div class="settings-form">
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="120px"
      label-position="left"
    >
      <!-- 下载路径 -->
      <el-form-item label="默认下载路径" prop="default_download_path">
        <el-input
          v-model="form.default_download_path"
          placeholder="请输入下载路径"
          clearable
        >
          <template #append>
            <el-button @click="selectDownloadPath">浏览</el-button>
          </template>
        </el-input>
      </el-form-item>
      
      <!-- 默认画质 -->
      <el-form-item label="默认画质" prop="default_quality">
        <el-select v-model="form.default_quality" placeholder="请选择默认画质">
          <el-option label="360P" value="360p" />
          <el-option label="480P" value="480p" />
          <el-option label="720P" value="720p" />
          <el-option label="1080P" value="1080p" />
          <el-option label="4K" value="4k" />
        </el-select>
      </el-form-item>
      
      <!-- 最大并发下载数 -->
      <el-form-item label="最大并发下载数" prop="max_concurrent_downloads">
        <el-slider
          v-model="form.max_concurrent_downloads"
          :min="1"
          :max="10"
          :step="1"
          show-stops
          show-input
        />
      </el-form-item>
      
      <!-- 下载选项 -->
      <el-form-item label="下载选项">
        <div class="checkbox-group">
          <el-checkbox v-model="form.auto_merge" label="自动合并音视频" />
          <el-checkbox v-model="form.delete_temp_files" label="下载完成后删除临时文件" />
        </div>
      </el-form-item>
      
      <!-- 代理设置 -->
      <el-form-item label="启用代理">
        <el-switch v-model="form.proxy_enabled" />
      </el-form-item>
      
      <div v-if="form.proxy_enabled" class="proxy-settings">
        <el-form-item label="代理地址" prop="proxy_url">
          <el-input
            v-model="form.proxy_url"
            placeholder="例如：http://127.0.0.1:7890"
            clearable
          />
        </el-form-item>
      </div>
      
      <!-- 表单操作 -->
      <el-form-item class="form-actions">
        <el-button @click="handleCancel">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">
          保存设置
        </el-button>
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
  max_concurrent_downloads: 3,
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
const selectDownloadPath = () => {
  // 这里应该调用系统的文件选择对话框
  // 由于浏览器限制，暂时使用输入框
  const path = prompt('请输入下载路径:', form.default_download_path)
  if (path !== null) {
    form.default_download_path = path
  }
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
    auto_merge: downloadStore.settings.auto_merge,
    delete_temp_files: downloadStore.settings.delete_temp_files,
    proxy_enabled: downloadStore.settings.proxy_enabled,
    proxy_url: downloadStore.settings.proxy_url || ''
  })
})
</script>

<style lang="scss" scoped>
.settings-form {
  padding: 8px 0;
  
  .checkbox-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
    
    .el-checkbox {
      margin-right: 0;
    }
  }
  
  .proxy-settings {
    margin-left: 120px;
    padding: 16px;
    background-color: #f5f5f5;
    border-radius: 4px;
    margin-bottom: 16px;
  }
  
  .form-actions {
    margin-top: 24px;
    text-align: right;
    
    .el-button {
      min-width: 100px;
    }
  }
}
</style>