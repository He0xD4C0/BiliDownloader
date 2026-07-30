<template>
  <div id="app">
    <el-container class="layout-container">
      <!-- 主内容区 -->
      <el-container class="main-container">
        <!-- 顶部导航栏 -->
        <el-header height="60px" class="header" v-if="showHeader">
          <div class="header-left">
            <div class="header-logo" @click="router.push('/')">
              <img src="/vite.svg" alt="BiliDownloader Logo" />
              <span class="app-name">BiliDownloader</span>
              <span class="app-version">v0.0.0</span>
            </div>
            <el-breadcrumb separator="/" class="breadcrumb" v-if="breadcrumb.length">
              <el-breadcrumb-item v-for="item in breadcrumb" :key="item.path">
                {{ item.title }}
              </el-breadcrumb-item>
            </el-breadcrumb>
          </div>
          
          <div class="header-right">
            <!-- 登录 / 用户菜单 -->
            <el-dropdown
              v-if="userStore.isLoggedIn"
              trigger="click"
              @command="handleUserCommand"
            >
              <div class="user-avatar-wrap">
                <el-avatar :size="32" :src="userStore.user?.avatar_url || undefined">
                  {{ userAvatarFallback }}
                </el-avatar>
                <span class="username-text">{{ userStore.user?.username }}</span>
                <el-icon class="dropdown-arrow"><ArrowDown /></el-icon>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="logout">
                    <el-icon><SwitchButton /></el-icon>退出登录
                  </el-dropdown-item>
                  <el-dropdown-item command="about">
                    <el-icon><InfoFilled /></el-icon>关于
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-button v-else size="small" @click="showLoginDialog = true">
              登录
            </el-button>

            <el-button text class="theme-btn" @click="toggleTheme">
              <el-icon><Moon /></el-icon>
              <span>主题</span>
            </el-button>
            
            <el-button
              type="primary"
              size="small"
              @click="showNewDownloadDialog = true"
              class="new-download-btn"
            >
              <el-icon><Plus /></el-icon>新建下载
            </el-button>
          </div>
        </el-header>
        
        <!-- 主要内容 -->
        <el-main class="main-content">
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </el-main>
        
        <!-- 底部信息栏 -->
        <el-footer height="40px" class="footer" v-if="showFooter">
          <div class="footer-content">
            <div class="footer-left">
              <span>BiliDownloader v0.0.0</span>
              <el-divider direction="vertical" />
              <span>仅供学习交流使用</span>
            </div>
            <div class="footer-right">
              <span>当前下载速度: {{ downloadSpeed }}</span>
              <el-divider direction="vertical" />
              <span>任务数: {{ activeTasks }}/{{ maxTasks }}</span>
            </div>
          </div>
        </el-footer>
      </el-container>
    </el-container>
    
    <!-- 新建下载对话框 -->
    <el-dialog
      v-model="showNewDownloadDialog"
      title="新建下载"
      width="600px"
      :close-on-click-modal="false"
    >
      <NewDownloadForm @success="onDownloadSuccess" @cancel="showNewDownloadDialog = false" />
    </el-dialog>
    
    <!-- 登录对话框 - 只使用B站二维码登录 -->
    <el-dialog
      v-model="showLoginDialog"
      title="B站账号登录"
      width="400px"
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
          <p class="qrcode-tip">请使用B站APP扫描二维码登录</p>
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
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import QRCode from 'qrcode'
import { useUserStore } from '@/stores/user'
import { useDownloadStore } from '@/stores/download'
import { api } from '@/utils/api'
import NewDownloadForm from '@/components/download/NewDownloadForm.vue'
import GlobalNotification from '@/components/common/GlobalNotification.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const downloadStore = useDownloadStore()

// 状态
const showNewDownloadDialog = ref(false)
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

// 计算属性
const showHeader = computed(() => true)
const showFooter = computed(() => true)

const breadcrumb = computed(() => {
  const crumbs = []
  const pathArr = route.path.split('/').filter(Boolean)
  
  let currentPath = ''
  for (const segment of pathArr) {
    currentPath += `/${segment}`
    crumbs.push({
      path: currentPath,
      title: segment.charAt(0).toUpperCase() + segment.slice(1)
    })
  }
  
  return crumbs
})

const downloadSpeed = computed(() => {
  return downloadStore.downloadSpeed > 0 
    ? `${(downloadStore.downloadSpeed / 1024).toFixed(2)} MB/s`
    : '0 KB/s'
})

const activeTasks = computed(() => downloadStore.activeTasks)
const maxTasks = computed(() => downloadStore.maxConcurrentDownloads)
const userAvatarFallback = computed(() => userStore.user?.username?.trim().charAt(0).toUpperCase() || 'B')

// 方法
const handleUserCommand = async (command: string) => {
  if (command === 'about') {
    await router.push('/about')
    return
  }
  if (command === 'logout') {
    await userStore.logout()
    ElMessage.success('已退出登录')
  }
}

const toggleTheme = () => {
  ElMessage.info('主题切换功能正在开发中')
}

const onDownloadSuccess = () => {
  showNewDownloadDialog.value = false
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
  const session = await userStore.validateSession()
  if (session.status === 'offline') {
    console.info('当前网络不可用，已跳过账号有效性检查')
  }

  try {
    await downloadStore.fetchTasks()
  } catch (error) {
    console.warn('加载下载任务失败:', error)
  }
})

onUnmounted(() => {
  stopTaskUpdates()
  if (checkLoginTimer.value) {
    clearTimeout(checkLoginTimer.value)
  }
})
</script>

<style lang="scss" scoped>
.layout-container {
  height: 100vh;
  
  .main-container {
    width: 100%;

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #e6e6e6;
      background-color: #fff;
      
      .header-left {
        display: flex;
        align-items: center;
        gap: 20px;
        
        .header-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          user-select: none;

          img {
            width: 32px;
            height: 32px;
          }

          .app-name {
            color: #303133;
            font-size: 18px;
            font-weight: 700;
            white-space: nowrap;
          }

          .app-version {
            color: #909399;
            font-size: 12px;
          }
        }

        .breadcrumb {
          :deep(.el-breadcrumb__inner) {
            font-weight: normal;
          }
        }
      }
      
      .header-right {
        display: flex;
        align-items: center;
        gap: 16px;
        
        .user-avatar-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          transition: background-color 0.2s;
          
          &:hover {
            background-color: #f0f2f5;
          }
          
          .dropdown-arrow {
            color: #909399;
            font-size: 12px;
          }

          .username-text {
            font-size: 14px;
            color: #303133;
            font-weight: 500;
          }
        }
        
        .theme-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          color: #606266;

          &:hover {
            color: #409EFF;
          }
        }
        
        .new-download-btn {
          .el-icon {
            margin-right: 5px;
          }
        }
      }
    }
    
    .main-content {
      padding: 20px;
      background-color: #f5f5f5;
      overflow-y: auto;
    }
    
    .footer {
      border-top: 1px solid #e6e6e6;
      background-color: #fff;
      
      .footer-content {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
        color: #909399;
        
        .footer-left,
        .footer-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }
      }
    }
  }
}

// 登录对话框样式
.login-dialog-body {
  padding: 0 8px;
  
  .login-form {
    .login-btn {
      width: 100%;
      margin-top: 8px;
    }
  }
  
  .login-divider {
    position: relative;
    text-align: center;
    margin: 24px 0;
    
    &::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      height: 1px;
      background-color: #e6e6e6;
    }
    
    span {
      position: relative;
      display: inline-block;
      padding: 0 16px;
      background-color: white;
      color: #909399;
      font-size: 14px;
    }
  }
  
  .alternative-login {
    .bilibili-login-btn {
      width: 100%;
      
      .bilibili-icon {
        width: 20px;
        height: 20px;
        margin-right: 8px;
        vertical-align: middle;
      }
    }
  }
}

.bilibili-login-dialog {
  text-align: center;
  
  .loading-qrcode {
    padding: 40px 0;
    
    .loading-icon {
      font-size: 48px;
      color: #409EFF;
      margin-bottom: 16px;
    }
    
    p {
      margin: 0;
      color: #909399;
    }
  }
  
  .qrcode-content {
    .qrcode-image {
      margin-bottom: 20px;
      
      img {
        width: 200px;
        height: 200px;
        border: 1px solid #e6e6e6;
        border-radius: 8px;
      }
    }
    
    .qrcode-tip {
      margin: 0 0 20px;
      color: #606266;
      font-size: 14px;
    }
    
    .qrcode-status {
      margin-bottom: 20px;
    }
    
    .qrcode-actions {
      display: flex;
      gap: 12px;
      justify-content: center;
    }
  }
}

// 过渡动画
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
