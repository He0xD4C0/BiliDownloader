# BilibiliDown

BilibiliDown 是一个用于解析和下载 B 站视频的独立 Electron 桌面应用。Vue 负责界面展示，视频解析、账号状态、下载任务、文件系统和本地持久化均由 Electron 主进程统一管理。

本项目不需要 Python、FastAPI、本机 API 端口或浏览器插件。

## 功能概览

- 支持 BV 号、AV 号和完整 B 站视频链接
- 根据视频和当前账号权限解析实际可下载画质
- B 站二维码登录
- 启动时自动检查登录状态并刷新账号资料和头像
- 下载任务创建、暂停、恢复、取消和历史记录
- 下载进度通过 Electron IPC 实时推送
- 本地保存应用设置和任务状态
- 使用 Electron `safeStorage` 加密保存 B 站登录凭证
- 使用系统目录选择器设置下载位置

## 统一程序架构

应用不运行独立的 localhost 后端：

```text
Vue 渲染层
  → preload 暴露的受控 API
  → Electron IPC
  → Electron 主进程 ApplicationService
  → B站网络 API / 本地文件 / 本地状态
```

- **Electron 主进程**：管理应用生命周期、业务服务、下载任务、账号凭证、文件系统、系统对话框和通知。
- **Vue 渲染层**：负责界面、用户操作和状态展示。
- **preload**：通过 `contextBridge` 提供受控的 IPC 能力。
- **IPC**：替代 Axios → localhost → FastAPI 的本地调用链。
- **事件推送**：下载进度由主进程主动推送，不使用 HTTP 轮询。
- **本地持久化**：任务、设置、账号资料和加密登录凭证保存在应用数据目录。

B 站网络请求、流式下载、文件写入和系统对话框仍然使用异步操作，因为它们是真实 I/O。

## 技术栈

- Electron 27
- Vue 3 + TypeScript
- Vite
- Pinia
- Element Plus
- electron-builder

## 环境要求

- Node.js 18 或更高版本，推荐当前 LTS
- npm
- 可访问 B 站的网络连接

开发和构建均不需要 Python 环境。

## 快速开始

### 使用启动脚本

macOS 或 Linux：

```bash
chmod +x start.sh
./start.sh
```

Windows：

```text
双击 start.bat
```

启动脚本会检查 Node.js/npm，并安装缺失的根目录及前端依赖。

### 手动启动

```bash
npm install
npm --prefix frontend install
npm run dev
```

`npm run dev` 会同时启动 Vite 开发服务器和 Electron 桌面应用。

## 构建与打包

构建当前平台的前端和安装包：

```bash
npm run build
```

仅构建前端：

```bash
npm run build:frontend
```

仅生成当前平台的未安装应用目录：

```bash
npm run package
```

按目标平台构建：

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

构建结果保存在：

```text
dist-electron/
```

> 跨平台产物通常应在对应操作系统上构建。Windows 和 Linux 的签名、安装器及系统依赖也需要在目标构建环境中验证。

## 数据和下载目录

### Windows

应用数据：

```text
%USERPROFILE%\AppData\Roaming\BilibiliDown
```

代码优先使用 `%APPDATA%\BilibiliDown`，在标准 Windows 环境中与上述路径一致。

默认下载目录：

```text
%USERPROFILE%\Downloads\BiliBiliDown
```

### Linux

应用数据：

```text
/opt/BilibiliDown
```

默认下载目录：

```text
~/Downloads/BilibiliDown
```

> `/opt/BilibiliDown` 必须对运行应用的用户可写。Linux 安装包或部署脚本应创建该目录并设置合适的所有者和权限。

### macOS

应用数据使用 Electron 的系统 `userData` 目录，通常为：

```text
~/Library/Application Support/bilibilidown
```

默认下载目录：

```text
~/Downloads/BilibiliDown
```

用户可在应用中选择其他下载目录。任务、设置和账号状态保存在应用数据目录的 `application-state.json` 中；B 站登录凭证通过 Electron `safeStorage` 加密后持久化。

## 登录状态策略

应用启动时，如果本地存在登录状态，将请求 B 站账号接口验证登录凭证：

- 凭证有效：刷新用户名、头像、UID、会员状态、等级和个性签名等资料。
- 凭证失效：清除本地登录状态和登录凭证。
- DNS、断网、超时、HTTP 408/429/5xx 等网络异常：跳过检查并保留离线登录状态。

视频解析和下载请求由 Electron 主进程自动携带当前账号凭证，渲染进程不直接读取 B 站 Cookie。

## 项目目录

```text
bilibilidown/
├── electron/
│   ├── main.js                 # Electron 入口与系统能力
│   ├── preload.js              # 安全 IPC 边界
│   ├── application-service.js  # 视频解析、账号、下载和持久化服务
│   └── build/                  # 构建资源和 macOS entitlements
├── frontend/
│   ├── src/                    # Vue 界面、Pinia store 和 IPC 适配层
│   └── public/                 # 前端静态资源
├── electron-builder.config.js
├── package.json
├── start.sh
└── start.bat
```

## 常用命令

```bash
npm run dev             # 启动开发环境
npm run build:frontend  # 类型检查并构建 Vue
npm run build:electron  # 构建当前平台安装包
npm run package         # 生成未安装应用目录
npm run build:mac       # 构建 macOS 产物
npm run build:win       # 构建 Windows 产物
npm run build:linux     # 构建 Linux 产物
npm start               # 直接启动 Electron
```

## 当前限制

- 当前下载核心优先保存选定的视频流。
- B 站 DASH 视频通常将视频和音频分开提供；完整音视频合并仍需接入 FFmpeg。
- 恢复下载目前会重新发起下载，尚未实现经过验证的持久化断点续传。
- 二维码图片目前通过外部 QR 图片服务生成，后续可改为本地生成。
- Windows 和 Linux 安装包需要在目标平台继续验证目录权限、托盘图标和安装行为。

## 使用说明

1. 请遵守 B 站服务协议以及当地版权法规。
2. 仅下载你有权保存的内容。
3. 可用画质取决于视频本身、当前账号权限和 B 站接口返回结果。
4. 本项目只提供独立桌面应用，不包含浏览器插件集成能力。

## License

MIT License
