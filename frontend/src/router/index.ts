import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

// 页面组件（懒加载）
const Home = () => import('@/views/Home.vue')
const About = () => import('@/views/About.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: Home,
    meta: { title: '首页' }
  },
  {
    path: '/login',
    redirect: '/'
  },
  {
    path: '/register',
    redirect: '/'
  },
  {
    path: '/download',
    redirect: '/'
  },
  {
    path: '/tasks',
    redirect: '/'
  },
  {
    path: '/history',
    redirect: '/'
  },
  {
    path: '/settings',
    redirect: '/'
  },
  {
    path: '/search',
    redirect: '/'
  },
  {
    path: '/about',
    name: 'About',
    component: About,
    meta: { title: '关于' }
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHashHistory('/#/'),
  routes
})

// 路由守卫：仅设置页面标题，不进行任何登录拦截
router.beforeEach((to, from, next) => {
  if (to.meta.title) {
    document.title = `${to.meta.title} - BiliDownloader`
  }
  next()
})

export default router
