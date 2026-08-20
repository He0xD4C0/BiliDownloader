<!-- 最大并行下载数控制：任务表格上方直接调整并保存 -->
<template>
  <div class="concurrency-control">
    <span class="concurrency-label">并行下载</span>
    <el-input-number
      :model-value="modelValue"
      :min="1"
      :max="10"
      :step="1"
      size="small"
      controls-position="right"
      @change="handleChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useDownloadStore } from '@/stores/download'

const props = defineProps<{ modelValue: number; max?: number }>()
const emit = defineEmits(['update:modelValue', 'change'])

const downloadStore = useDownloadStore()
const saving = ref(false)

// 保存到应用设置（Electron 主进程持久化），成功后立即影响下载队列并发上限
const handleChange = async (value: number | undefined) => {
  if (saving.value) return
  const upper = props.max && props.max > 0 ? props.max : 10
  const next = Math.max(1, Math.min(upper, Math.round(Number(value) || 4)))

  // 值未变化时避免重复保存
  if (next === props.modelValue) return

  saving.value = true
  // 先乐观更新界面，再持久化
  emit('update:modelValue', next)
  try {
    await downloadStore.updateSettings({ max_concurrent_downloads: next })
    emit('change', next)
    ElMessage.success(`已保存，最大并行下载数：${next}`)
  } catch (error) {
    console.error('保存最大并行下载数失败:', error)
    ElMessage.error('保存最大并行下载数失败')
    emit('update:modelValue', props.modelValue)
  } finally {
    saving.value = false
  }
}
</script>

<style lang="scss" scoped>
.concurrency-control {
  display: flex;
  align-items: center;
  gap: 8px;

  .concurrency-label {
    font-size: 13px;
    color: #606266;
    white-space: nowrap;
  }
}
</style>
