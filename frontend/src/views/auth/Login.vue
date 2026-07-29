<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-header">
        <div class="logo">
          <img src="/vite.svg" alt="Logo" />
          <h1>BiliDownloader</h1>
        </div>
        <p class="subtitle">B站视频下载工具</p>
      </div>
      
      <el-card class="login-card">
        <template #header>
          <div class="card-header">
            <h2>用户登录</h2>
            <p class="card-subtitle">请输入您的账号信息</p>
          </div>
        </template>
        
        <el-form
          ref="loginFormRef"
          :model="loginForm"
          :rules="loginRules"
          class="login-form"
          @submit.prevent="handleLogin"
        >
          <el-form-item prop="username">
            <el-input
              v-model="loginForm.username"
              placeholder="请输入用户名"
              size="large"
              :prefix-icon="User"
              :disabled="loading"
            />
          </el-form-item>
          
          <el-form-item prop="password">
            <el-input
              v-model="loginForm.password"
              type="password"
              placeholder="请输入密码"
              size="large"
              :prefix-icon="Lock"
              :disabled="loading"
              show-password
            />
          </el-form-item>
          
          <el-form-item>
            <el-checkbox v-model="loginForm.rememberMe" :disabled="loading">
              记住我
            </el-checkbox>
          </el-form-item>
          
          <el-form-item>
            <el-button
              type="primary"
              size="large"
              class="login-btn"
              :loading="loading"
              @click="handleLogin"
            >
              登录
            </el-button>
          </el-form-item>
          
          <div class="login-links">
            <router-link to="/register" class="link">注册账号</router-link>
            <el-divider direction="vertical" />
            <router-link to="/" class="link">返回首页</router-link>
          </div>
        </el-form>
        
        <div class="login-divider">
          <span>或使用以下方式登录</span>
        </div>
        
        <div class="alternative-login">
          <el-button
            type="info"
            size="large"
            class="bilibili-login-btn"
            :loading="bilibiliLoading"
            @click="handleBilibiliLogin"
          >
            <img src="https://www.bilibili.com/favicon.ico" alt="B站" class="bilibili-icon" />
            使用B站账号登录
          </el-button>
        </div>
      </el-card>
      
      <div class="login-footer">
        <p>仅供学习交流使用，请遵守B站相关协议和版权规定</p>
        <p class="version">版本 v1.0.0</p>
      </div>
      
      <!-- B站登录对话框 -->
      <el-dialog
        v-model="showBilibiliLoginDialog"
        title="B站登录"
        width="400px"
        :close-on-click-modal="false"
        :show-close="false"
      >
        <div class="bilibili-login-dialog">
          <div v-if="!qrcodeInfo" class="loading-qrcode">
            <el-icon class="loading-icon"><Loading /></el-icon>
            <p>正在获取登录二维码...</p>
          </div>
          
          <div v-else class="qrcode-content">
            <div class="qrcode-image">
              <img :src="qrcodeInfo.qrcode_url" alt="B站登录二维码" />
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
              <el-button @click="cancelBilibiliLogin">取消</el-button>
              <el-button type="primary" @click="refreshQrcode" :loading="refreshingQrcode">
                刷新二维码
              </el-button>
            </div>
          </div>
        </div>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { User, Lock, Loading } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

// 表单引用
const loginFormRef = ref<FormInstance>()

// 表单数据
const loginForm = reactive({
  username: '',
  password: '',
  rememberMe: false
})

// 表单验证规则
const loginRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, message: '用户名长度至少3个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少6个字符', trigger: 'blur' }
  ]
}

// 状态
const loading = ref(false)
const bilibiliLoading = ref(false)
const showBilibiliLoginDialog = ref(false)
const qrcodeInfo = ref<any>(null)
const loginStatus = reactive({
  title: '等待扫描',
  description: '请使用B站APP扫描二维码',
  type: 'info' as 'info' | 'success' | 'warning' | 'error'
})
const checkLoginTimer = ref<any>(null)
const refreshingQrcode = ref(false)

// 方法
const handleLogin = async () => {
  if (!loginFormRef.value) return
  
  const valid = await loginFormRef.value.validate()
  if (!valid) return
  
  loading.value = true
  
  try {
    await userStore.login(loginForm.username, loginForm.password)
    
    ElMessage.success('登录成功')
    router.push('/')
  } catch (error: any) {
    ElMessage.error(error.response?.data?.detail || '登录失败，请检查用户名和密码')
  } finally {
    loading.value = false
  }
}

const handleBilibiliLogin = async () => {
  bilibiliLoading.value = true
  
  try {
    // 获取二维码
    await getBilibiliQrcode()
    
    showBilibiliLoginDialog.value = true
    startCheckingLoginStatus()
  } catch (error) {
    ElMessage.error('获取二维码失败')
  } finally {
    bilibiliLoading.value = false
  }
}

const getBilibiliQrcode = async () => {
  // 这里应该调用后端API获取B站登录二维码
  // 暂时使用模拟数据
  qrcodeInfo.value = {
    qrcode_url: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=bilibili://qrcode/login/test',
    qrcode_key: 'test_qrcode_key',
    expires_in: 180
  }
  
  loginStatus.title = '等待扫描'
  loginStatus.description = '请使用B站APP扫描二维码'
  loginStatus.type = 'info'
}

const startCheckingLoginStatus = () => {
  if (checkLoginTimer.value) {
    clearInterval(checkLoginTimer.value)
  }
  
  checkLoginTimer.value = setInterval(async () => {
    await checkLoginStatus()
  }, 3000)
}

const checkLoginStatus = async () => {
  if (!qrcodeInfo.value) return
  
  try {
    // 这里应该调用后端API检查登录状态
    // 暂时模拟登录成功
    const success = Math.random() > 0.8
    
    if (success) {
      loginStatus.title = '登录成功'
      loginStatus.description = '正在跳转...'
      loginStatus.type = 'success'
      
      // 停止检查
      if (checkLoginTimer.value) {
        clearInterval(checkLoginTimer.value)
      }
      
      // 延迟跳转
      setTimeout(() => {
        showBilibiliLoginDialog.value = false
        ElMessage.success('B站账号登录成功')
        // 这里应该获取用户信息并保存
        router.push('/')
      }, 1500)
    }
  } catch (error) {
    console.error('检查登录状态失败:', error)
  }
}

const refreshQrcode = async () => {
  refreshingQrcode.value = true
  
  try {
    await getBilibiliQrcode()
  } catch (error) {
    ElMessage.error('刷新二维码失败')
  } finally {
    refreshingQrcode.value = false
  }
}

const cancelBilibiliLogin = () => {
  if (checkLoginTimer.value) {
    clearInterval(checkLoginTimer.value)
  }
  
  showBilibiliLoginDialog.value = false
  qrcodeInfo.value = null
}

// 清理定时器
onUnmounted(() => {
  if (checkLoginTimer.value) {
    clearInterval(checkLoginTimer.value)
  }
})
</script>

<style lang="scss" scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  
  .login-container {
    width: 100%;
    max-width: 440px;
    
    .login-header {
      text-align: center;
      margin-bottom: 32px;
      color: white;
      
      .logo {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        margin-bottom: 12px;
        
        img {
          width: 48px;
          height: 48px;
        }
        
        h1 {
          margin: 0;
          font-size: 32px;
          font-weight: bold;
        }
      }
      
      .subtitle {
        margin: 0;
        font-size: 16px;
        opacity: 0.9;
      }
    }
    
    .login-card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      
      .card-header {
        text-align: center;
        
        h2 {
          margin: 0 0 8px;
          font-size: 24px;
          color: #303133;
        }
        
        .card-subtitle {
          margin: 0;
          font-size: 14px;
          color: #909399;
        }
      }
      
      .login-form {
        .login-btn {
          width: 100%;
          margin-top: 8px;
        }
        
        .login-links {
          text-align: center;
          margin-top: 16px;
          font-size: 14px;
          
          .link {
            color: #409EFF;
            text-decoration: none;
            
            &:hover {
              text-decoration: underline;
            }
          }
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
    
    .login-footer {
      text-align: center;
      margin-top: 24px;
      color: rgba(255, 255, 255, 0.8);
      font-size: 14px;
      
      p {
        margin: 4px 0;
      }
      
      .version {
        font-size: 12px;
        opacity: 0.7;
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
}

@media (max-width: 480px) {
  .login-container {
    margin: 0 16px;
  }
  
  .login-card {
    .card-header h2 {
      font-size: 20px !important;
    }
  }
}
</style>