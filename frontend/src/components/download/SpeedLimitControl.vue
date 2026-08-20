<!-- 单线程限速控制：表格上方直接调整并保存（KB/s，0=不限速） -->
<template>
  <div class="speed-limit-control">
    <span class="speed-limit-label">限速</span>
    <el-input-number
      :model-value="modelValue"
      :min="0"
      :max="102400"
      :step="16"
      size="small"
      controls-position="right"
      @change="handleChange"
    />
    <span class="speed-limit-unit">KB/s</span>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useDownloadStore } from '@/stores/download'

const props = defineProps<{ modelValue: number }>()
const emit = defineEmits(['update:modelValue', 'change'])

const downloadStore = useDownloadStore()
const saving = ref(false)

// 保存到应用设置（Electron 主进程持久化），对运行中的下载即时生效
const handleChange = async (value: number | undefined) => {
  if (saving.value) return
  const next = Math.max(0, Math.min(102400, Math.round(Number(value) || 0)))

  if (next === props.modelValue) return

  saving.value = true
  emit('update:modelValue', next)
  try {
    await downloadStore.updateSettings({ download_speed_limit: next })
    emit('change', next)
    ElMessage.success(next > 0 ? `已保存，单线程限速：${next} KB/s` : '已保存，不限速')
  } catch (error) {
    console.error('保存单线程限速失败:', error)
    ElMessage.error('保存单线程限速失败')
    emit('update:modelValue', props.modelValue)
  } finally {
    saving.value = false
  }
}
</script>

<style lang="scss" scoped>
.speed-limit-control {
  display: flex;
  align-items: center;
  gap: 6px;

  .speed-limit-label {
    font-size: 13px;
    color: #606266;
    white-space: nowrap;
  }

  .speed-limit-unit {
    font-size: 12px;
    color: #909399;
    white-space: nowrap;
  }
}
</style>
