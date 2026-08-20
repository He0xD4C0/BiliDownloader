<img width="1920" height="720" alt="未标题-1" src="https://github.com/user-attachments/assets/acbfc17d-f66c-454e-b329-b43a703e2824" />

BiliDownloader 是一个用于解析和下载 B 站视频的独立 Electron 桌面应用。Vue 负责界面展示，视频解析、账号状态、下载任务、文件系统和本地持久化均由 Electron 主进程统一管理。

<table>
  <tr>
    <td><img width="1200" height="800" alt="e8532cf24f254c8d9d6cff7638da1f86" src="https://github.com/user-attachments/assets/fa7e7769-1d99-4dcd-a63f-b1082ebe9aa2" /></td>
    <td><img width="1200" height="800" alt="bef1021349c1ed07b4c98a1f53ca247c" src="https://github.com/user-attachments/assets/9a7564c2-de6f-411b-8465-938fcef8d7f5" /></td>
  </tr>
</table>

本项目不需要 Python、FastAPI、本机 API 端口或浏览器插件。

## 功能概览

- 支持 BV 号、AV 号和完整 B 站视频链接
- 支持分P（多P）视频批量下载：一次解析后勾选多个分P，为每个分P独立创建下载任务
- 分P视频下载自动归类：默认保存到「视频标题」子文件夹，文件名自动为 分P号+分P名称，可在下载界面关闭该开关；单分P视频不提供此功能
- 根据视频和当前账号权限解析实际可下载画质
- B 站二维码登录
- 启动时自动检查登录状态并刷新账号资料和头像
- 下载任务创建、暂停、恢复、取消和历史记录
- 最大并行下载数默认为 4，可在下载任务表格上方直接调整并立即保存；调低上限会自动暂停多余任务，调高上限会自动开始排队任务
- 支持单线程限速设置（KB/s，0=不限速）：可在表格上方或设置中调整，对运行中的下载即时生效
- 表格上方提供全量/选中操作栏：全部开始、全部暂停、全部暂停并删除、删除已完成，以及按勾选任务批量操作
- 低速自动暂停：下载速率持续低于阈值时自动暂停并移至队尾（等待中）重试；阈值/宽限期可配置，可在设置中开关
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

项目只有一个根级 npm 工程。安装依赖并启动开发环境：

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动 Vite 开发服务器和 Electron 桌面应用，无需进入 `frontend` 单独安装依赖。

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

## 测试

后端单元测试位于 `test/`（Node 自带 test runner，无需额外依赖；`test/helpers/mock-electron.js` 负责在无 Electron 环境下加载应用服务）：

```bash
npm test          # 运行全部后端单元测试
npm run test:unit # 只运行 test/application-service.test.js
```

一键执行完整校验（类型检查 + 单元测试 + 前端构建）：

```bash
npm run verify
```

浏览器验收流程（静态托管构建产物、注入 `window.electronAPI` 桩）参见项目技能 `.agents/skills/bili-testing/SKILL.md`。

## 数据和下载目录

### Windows

应用数据：

```text
%USERPROFILE%\AppData\Roaming\BiliDownloader
```

代码优先使用 `%APPDATA%\BiliDownloader`，在标准 Windows 环境中与上述路径一致。

默认下载目录：

```text
%USERPROFILE%\Downloads\BiliDownloader
```

### Linux

应用数据：

```text
~/.local/share/BiliDownloader
```

默认下载目录：

```text
~/Downloads/BiliDownloader
```

### macOS

应用数据使用 Electron 的系统 `userData` 目录，通常为：

```text
~/Library/Application Support/bilidownloader
```

默认下载目录：

```text
~/Downloads/BiliDownloader
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
bilidownloader/
├── electron/
│   ├── main.js                 # Electron 入口与系统能力
│   ├── preload.js              # 安全 IPC 边界
│   ├── application-service.js  # 视频解析、账号、下载和持久化服务
│   └── build/                  # 构建资源和 macOS entitlements
├── frontend/
│   ├── src/                    # Vue 界面、Pinia store 和 IPC 适配层
│   └── public/                 # 前端静态资源
├── electron-builder.config.js
├── package-lock.json
└── package.json                # Electron 与 Vue 的统一依赖和脚本
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
- B 站登录二维码在应用内本地生成，不会将登录二维码内容发送给第三方图片服务。
- 未登录时以 B 站网页版匿名请求方式访问公开内容；登录后由 Electron 主进程自动携带已加密保存的 B 站凭证。
- Windows 和 Linux 安装包需要在目标平台继续验证目录权限、托盘图标和安装行为。

## 使用说明

1. 请遵守 B 站服务协议以及当地版权法规。
2. 仅下载你有权保存的内容。
3. 可用画质取决于视频本身、当前账号权限和 B 站接口返回结果。
4. 本项目只提供独立桌面应用，不包含浏览器插件集成能力。

## License

MIT License
