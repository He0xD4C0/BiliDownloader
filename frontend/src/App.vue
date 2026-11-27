<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="app-header-inner">
        <RouterLink class="app-brand" to="/" aria-label="BiliDownloader 下载工作台">
          <span class="brand-mark"><el-icon><Download /></el-icon></span>
          <span>BiliDownloader</span>
        </RouterLink>

        <div class="app-actions">
          <ElButton :icon="Setting" @click="showSettingsDialog = true">设置</ElButton>
          <ElButton
            :icon="darkTheme ? Sunny : Moon"
            :aria-label="darkTheme ? '切换到浅色主题' : '切换到深色主题'"
            :title="darkTheme ? '切换到浅色主题' : '切换到深色主题'"
            @click="toggleTheme"
          />
          <el-dropdown v-if="userStore.isLoggedIn" trigger="click" @command="handleUserCommand">
            <button type="button" class="user-avatar-wrap" aria-label="账号菜单">
              <el-avatar :size="26" :src="userStore.user?.avatar_url || undefined">
                {{ userAvatarFallback }}
              </el-avatar>
              <span class="username-text">{{ userStore.user?.username }}</span>
              <el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <ElButton v-else :icon="User" @click="showLoginDialog = true">登录 B 站</ElButton>
          <ElButton
            v-if="route.name !== 'Home'"
            type="primary"
            :icon="Plus"
            @click="showNewDownloadDialog = true"
          >
            新建下载
          </ElButton>
        </div>
      </div>
    </header>

    <main class="app-content">
      <RouterView v-slot="{ Component }">
        <component :is="Component" @new-download="showNewDownloadDialog = true" />
      </RouterView>
      <footer class="app-footer">
        <RouterLink to="/about">关于 BiliDownloader</RouterLink>
        <span>v{{ appVersion }}</span>
      </footer>
    </main>

    <!-- 新建下载对话框 -->
    <el-dialog
      v-model="showNewDownloadDialog"
      title="新建下载"
      width="min(650px, calc(100% - 32px))" class="app-dialog"
      destroy-on-close
      :close-on-click-modal="false"
    >
      <NewDownloadForm @success="onDownloadSuccess" @cancel="showNewDownloadDialog = false" />
    </el-dialog>

    <!-- 设置对话框（全局） -->
    <el-dialog
      v-model="showSettingsDialog"
      title="下载设置"
      width="min(620px, calc(100% - 32px))" class="app-dialog"
      destroy-on-close
    >
      <DownloadSettingsForm @success="onSettingsSaved" @cancel="showSettingsDialog = false" />
    </el-dialog>
    
    <!-- 登录对话框 - 只使用B站二维码登录 -->
    <el-dialog
      v-model="showLoginDialog"
      title="B站账号登录"
      width="min(420px, calc(100% - 32px))" class="app-dialog"
      :close-on-click-modal="false"
      :destroy-on-close="true"
      @opened="handleBilibiliLogin"
      @closed="cancelBilibiliLogin"
    >
      <div class="bilibili-login-dialog">
        <div v-if="!qrcodeInfo" class="loading-qrcode">
          <el-icon class="loading-icon" :size="48"><Loading /></el-icon>
          <p>正在获取登录二维码...</p>
        </div>
        
        <div v-else class="qrcode-content">
          <div class="qrcode-image">
            <img :src="qrcodeInfo.qrcode_img" alt="B站登录二维码" />
          </div>
          <div class="qrcode-status">
            <el-alert
              :title="loginStatus.title"
              :type="loginStatus.type"
              :description="loginStatus.description"
              :closable="false"
              center
            />
          </div>
          <div class="qrcode-actions">
            <el-button @click="showLoginDialog = false">取消</el-button>
            <el-button type="primary" @click="refreshQrcode" :loading="refreshingQrcode">
              刷新二维码
            </el-button>
          </div>
        </div>
      </div>
    </el-dialog>
    
    <!-- 全局通知 -->
    <GlobalNotification />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, watchEffect, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElButton, ElMessage } from 'element-plus'
import { Download, Loading, Moon, Plus, Setting, Sunny, User } from '@element-plus/icons-vue'
import QRCode from 'qrcode'
import { useUserStore } from '@/stores/user'
import { useDownloadStore } from '@/stores/download'
import { api } from '@/utils/api'
import NewDownloadForm from '@/components/download/NewDownloadForm.vue'
import DownloadSettingsForm from '@/components/download/SettingsForm.vue'
import GlobalNotification from '@/components/common/GlobalNotification.vue'

const route = useRoute()
const userStore = useUserStore()
const downloadStore = useDownloadStore()

// 状态
const showNewDownloadDialog = ref(false)
const showSettingsDialog = ref(false)
const showLoginDialog = ref(false)

// B站二维码登录状态
const qrcodeInfo = ref<any>(null)
const loginStatus = reactive({
  title: '等待扫描',
  description: '请使用B站APP扫描二维码',
  type: 'info' as 'info' | 'success' | 'warning' | 'error'
})
const checkLoginTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const refreshingQrcode = ref(false)

const appVersion = ref('dev')
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
const selectedTheme = ref(themeMeta?.content || 'light dark')
const systemDark = ref(systemTheme.matches)
const darkTheme = computed(() => selectedTheme.value === 'dark' || (
  selectedTheme.value !== 'light' && systemDark.value
))

watchEffect(() => {
  if (themeMeta) themeMeta.content = selectedTheme.value
  document.documentElement.classList.toggle('dark', darkTheme.value)
})

const syncSystemTheme = (event: MediaQueryListEvent) => {
  systemDark.value = event.matches
}

const syncStoredTheme = (event: StorageEvent) => {
  if (event.key === 'app-theme' || event.key === null) {
    selectedTheme.value = event.newValue === 'light' || event.newValue === 'dark'
      ? event.newValue
      : 'light dark'
  }
}

const userAvatarFallback = computed(() => userStore.user?.username?.trim().charAt(0).toUpperCase() || 'B')

// 方法
const handleUserCommand = async (command: string) => {
  if (command === 'logout') {
    await userStore.logout()
    ElMessage.success('已退出登录')
  }
}

const toggleTheme = () => {
  const nextDark = !darkTheme.value
  selectedTheme.value = nextDark === systemDark.value ? 'light dark' : nextDark ? 'dark' : 'light'

  try {
    if (selectedTheme.value === 'light dark') {
      localStorage.removeItem('app-theme')
    } else {
      localStorage.setItem('app-theme', selectedTheme.value)
    }
  } catch {
    // The selected scheme still applies if storage is unavailable.
  }
}

const onDownloadSuccess = () => {
  showNewDownloadDialog.value = false
}

const onSettingsSaved = async () => {
  showSettingsDialog.value = false
  try {
    await downloadStore.fetchTasks()
    await downloadStore.fetchStats()
  } catch (error) {
    console.warn('刷新任务列表失败:', error)
  }
}

// B站二维码登录方法
const handleBilibiliLogin = async () => {
  qrcodeInfo.value = null
  loginStatus.title = '等待扫描'
  loginStatus.description = '正在获取二维码...'
  loginStatus.type = 'info'
  
  try {
    await getBilibiliQrcode()
    startCheckingLoginStatus()
  } catch (error: any) {
    ElMessage.error(error.message || '获取二维码失败')
  }
}

const getBilibiliQrcode = async () => {
  // 调用后端API获取B站真实二维码
  const response = await api.post('/auth/bilibili/qrcode')
  
  // 从B站API返回的数据
  const qrcode_url = response.qrcode_url  // B站给的URL（不是图片）
  const qrcode_key = response.qrcode_key
  
  const qrcode_img = await QRCode.toDataURL(qrcode_url, {
    width: 200,
    margin: 1,
    errorCorrectionLevel: 'M'
  })
  
  qrcodeInfo.value = {
    qrcode_img,
    qrcode_url,
    qrcode_key,
    expires_in: response.expires_in || 180
  }
  
  loginStatus.title = '等待扫描'
  loginStatus.description = '请使用B站APP扫描二维码登录'
  loginStatus.type = 'info'
}

const startCheckingLoginStatus = () => {
  stopCheckingLoginStatus()
  checkLoginTimer.value = setTimeout(async () => {
    checkLoginTimer.value = null
    await checkLoginStatus()
  }, 3000)
}

const checkLoginStatus = async () => {
  if (!qrcodeInfo.value?.qrcode_key) return
  
  try {
    const response = await api.post('/auth/bilibili/check-login', {
      qrcode_key: qrcodeInfo.value.qrcode_key
    })
    
    // 更新登录状态显示
    switch (response.status) {
      case 'scanning':
        loginStatus.title = '等待扫描'
        loginStatus.description = '请使用B站APP扫描二维码'
        loginStatus.type = 'info'
        break
      case 'confirming':
        loginStatus.title = '已扫描'
        loginStatus.description = '请在手机端确认登录'
        loginStatus.type = 'warning'
        break
      case 'cancelled':
        loginStatus.title = '已取消'
        loginStatus.description = '扫码登录已取消，点击刷新按钮重新获取'
        loginStatus.type = 'error'
        stopCheckingLoginStatus()
        break
      case 'expired':
        loginStatus.title = '二维码已过期'
        loginStatus.description = '请点击刷新按钮重新获取二维码'
        loginStatus.type = 'warning'
        stopCheckingLoginStatus()
        break
      case 'success':
        loginStatus.title = '登录成功'
        loginStatus.description = '正在获取用户信息...'
        loginStatus.type = 'success'
        stopCheckingLoginStatus()

        if (response.user) {
          userStore.setUser(response.user)
        } else {
          await userStore.fetchUserInfo()
        }
        showLoginDialog.value = false
        qrcodeInfo.value = null
        ElMessage.success('B站账号登录成功')
        break
      case 'error':
        loginStatus.title = '登录失败'
        loginStatus.description = response.message || '检查登录状态失败，请刷新二维码重试'
        loginStatus.type = 'error'
        stopCheckingLoginStatus()
        break
      default:
        if (response.message) {
          loginStatus.title = '登录状态异常'
          loginStatus.description = response.message
          loginStatus.type = 'warning'
        }
    }

    if (['scanning', 'confirming'].includes(response.status)) {
      startCheckingLoginStatus()
    }
  } catch (error: any) {
    console.error('检查登录状态失败:', error)
    loginStatus.title = '网络异常'
    loginStatus.description = error.message || '暂时无法检查登录状态，正在重试'
    loginStatus.type = 'warning'
    startCheckingLoginStatus()
  }
}

const stopCheckingLoginStatus = () => {
  if (checkLoginTimer.value) {
    clearTimeout(checkLoginTimer.value)
    checkLoginTimer.value = null
  }
}

const refreshQrcode = async () => {
  refreshingQrcode.value = true
  
  try {
    await getBilibiliQrcode()
    startCheckingLoginStatus()
  } catch (error) {
    ElMessage.error('刷新二维码失败')
  } finally {
    refreshingQrcode.value = false
  }
}

const cancelBilibiliLogin = () => {
  stopCheckingLoginStatus()
  qrcodeInfo.value = null
}

const stopTaskUpdates = downloadStore.setupTaskUpdates()

// 初始化
onMounted(async () => {
  systemTheme.addEventListener('change', syncSystemTheme)
  window.addEventListener('storage', syncStoredTheme)
  if (window.electronAPI) {
    try {
      const appInfo = await window.electronAPI.getAppInfo()
      if (appInfo.version) {
        appVersion.value = appInfo.version
      }
    } catch (error) {
      console.warn('获取应用版本失败:', error)
    }
  }

  const session = await userStore.validateSession()
  if (session.status === 'offline') {
    console.info('当前网络不可用，已跳过账号有效性检查')
  }
})

onUnmounted(() => {
  systemTheme.removeEventListener('change', syncSystemTheme)
  window.removeEventListener('storage', syncStoredTheme)
  stopTaskUpdates()
  if (checkLoginTimer.value) {
    clearTimeout(checkLoginTimer.value)
  }
})
</script>

<style scoped lang="scss">
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  background: var(--surface);
  border-bottom: 1px solid var(--line);
}

.app-header-inner,
.app-content {
  width: min(100%, 1380px);
  margin-inline: auto;
  padding-inline: clamp(16px, 3.2vw, 42px);
}

.app-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  min-height: 64px;
  gap: 10px 20px;
  padding-block: 10px;
}

.app-brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ink);
  text-decoration: none;
  font-size: 17px;
  font-weight: 750;
  letter-spacing: -0.025em;
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #123c34;
  color: #c6f5de;
  font-size: 19px;
}

.app-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.user-avatar-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 190px;
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;

  &:hover {
    background: var(--surface-raised);
  }
}

.username-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.app-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 22px;
  padding-top: clamp(16px, 2.5vw, 30px);
}

.app-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-block: 10px 20px;
  color: var(--muted);
  font-size: 12px;

  a {
    color: inherit;
    text-underline-offset: 3px;
  }
}

.bilibili-login-dialog {
  text-align: center;

  .loading-qrcode {
    padding-block: 32px;
    color: var(--muted);
  }

  .loading-icon {
    color: var(--accent);
    margin-bottom: 12px;
  }

  .qrcode-image img {
    width: 200px;
    height: 200px;
    border: 1px solid var(--line);
    border-radius: 12px;
  }

  .qrcode-status {
    margin-block: 14px;
  }

  .qrcode-actions {
    display: flex;
    justify-content: center;
  }
}
</style>
