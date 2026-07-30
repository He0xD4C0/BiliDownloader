import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Ref } from 'vue'
import { api } from '@/utils/api'

export interface User {
  id: number
  username: string
  email: string | null
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
  const user: Ref<User | null> = ref(null)

  const isLoggedIn = computed(() => !!user.value)
  const currentUser = computed(() => user.value)

  const setUser = (userData: User | null) => {
    user.value = userData
  }

  const clearUser = () => {
    user.value = null
  }

  const validateSession = async () => {
    try {
      const response = await api.get<SessionStatus>('/auth/session-status')
      if (response.user) {
        setUser(response.user)
      } else if (response.status !== 'offline') {
        clearUser()
      }
      return response
    } catch (error) {
      console.warn('启动登录状态检查失败，保留离线登录状态:', error)
      return { status: 'offline', user: user.value } as SessionStatus
    }
  }

  const fetchUserInfo = async () => {
    try {
      const response = await api.get<User | null>('/auth/me')
      setUser(response)
      return response
    } catch (error) {
      console.warn('获取B站账号信息失败:', error)
      clearUser()
      return null
    }
  }

  const logout = async () => {
    try {
      await api.get('/auth/logout')
    } finally {
      clearUser()
    }
  }

  return {
    user,
    isLoggedIn,
    currentUser,
    setUser,
    clearUser,
    validateSession,
    fetchUserInfo,
    logout
  }
})
