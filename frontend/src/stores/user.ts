import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import { api } from '@/utils/api'

export interface User {
  id: number
  username: string
  email: string
  avatar_url: string | null
  is_superuser: boolean
  created_at: string
  updated_at: string | null
  bili_uid?: string
  bili_name?: string
  is_vip?: boolean
  vip_type?: number
  vip_status?: number
  vip_due_date?: number
  level?: number
  sign?: string
}

interface SessionStatus {
  status: 'valid' | 'invalid' | 'offline' | 'logged_out'
  user: User | null
}

export const useUserStore = defineStore('user', () => {
  // 状态
  const user: Ref<User | null> = ref(null)
  const token: Ref<string | null> = ref(localStorage.getItem('token'))
  
  // 计算属性
  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const currentUser = computed(() => user.value)
  
  // 方法
  const setToken = (newToken: string) => {
    token.value = newToken
    localStorage.setItem('token', newToken)
    api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
  }
  
  const clearToken = () => {
    token.value = null
    localStorage.removeItem('token')
    delete api.defaults.headers.common['Authorization']
  }
  
  const setUser = (userData: User) => {
    user.value = userData
  }
  
  const clearUser = () => {
    user.value = null
  }
  
  const validateSession = async () => {
    if (!token.value) return { status: 'logged_out', user: null } as SessionStatus

    try {
      const response = await api.get<SessionStatus>('/auth/session-status')
      if (response.user) setUser(response.user)
      if (response.status === 'invalid' || response.status === 'logged_out') {
        clearToken()
        clearUser()
      }
      return response
    } catch (error) {
      console.warn('启动登录状态检查失败，保留离线登录状态:', error)
      return { status: 'offline', user: user.value } as SessionStatus
    }
  }

  const fetchUserInfo = async () => {
    // 如果没有token，直接返回null
    if (!token.value) {
      return null
    }
    try {
      const response = await api.get('/auth/me')
      setUser(response)
      return response
    } catch (error) {
      // 认证失败时静默清除状态，不抛异常
      clearToken()
      clearUser()
      return null
    }
  }
  
  const login = async (username: string, password: string) => {
    try {
      const response = await api.post('/auth/login', {
        username,
        password
      })
      
      setToken(response.access_token)
      await fetchUserInfo()
      
      return response
    } catch (error) {
      throw error
    }
  }
  
  const register = async (username: string, email: string, password: string, confirmPassword: string) => {
    try {
      const response = await api.post('/user/register', {
        username,
        email,
        password,
        confirm_password: confirmPassword
      })
      
      return response
    } catch (error) {
      throw error
    }
  }
  
  const logout = async () => {
    try {
      await api.get('/auth/logout')
    } catch (error) {
      // 忽略登出错误
    } finally {
      localStorage.removeItem('bilibili_cookies')
      clearToken()
      clearUser()
    }
  }
  
  const updateProfile = async (profileData: Partial<User>) => {
    try {
      const response = await api.put('/user/profile', profileData)
      setUser(response)
      return response
    } catch (error) {
      throw error
    }
  }
  
  const changePassword = async (oldPassword: string, newPassword: string) => {
    try {
      const response = await api.post('/user/change-password', {
        old_password: oldPassword,
        new_password: newPassword
      })
      return response
    } catch (error) {
      throw error
    }
  }
  
  // 初始化时设置token
  if (token.value) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token.value}`
  }
  
  return {
    // 状态
    user,
    token,
    
    // 计算属性
    isLoggedIn,
    currentUser,
    
    // 方法
    setToken,
    clearToken,
    setUser,
    clearUser,
    validateSession,
    fetchUserInfo,
    login,
    register,
    logout,
    updateProfile,
    changePassword
  }
})
