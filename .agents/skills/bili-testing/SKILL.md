---
name: bili-testing
description: 运行并扩展 BiliDownloader 的测试流程：后端单元测试（mock Electron 的 node:test）、类型检查、前端构建与浏览器验收。在代码改动之后、声明功能完成之前，以及需要新增测试或执行浏览器验收时使用。
whenToUse: 验收后端改动（electron/application-service.js）、运行 npm test / npm run verify、做 typecheck 或构建，或使用 Chrome DevTools + window.electronAPI 桩进行浏览器验收时。
---

# BiliDownloader 测试流程

本技能定义本项目（BiliDownloader，Electron + Vue 3 SPA）的测试与验收标准流程。改动任何功能后，按下面四道门禁执行；后端逻辑改动必须跑单元测试，UI/布局改动必须跑浏览器验收。

## 四道门禁（按顺序）

1. **语法检查**：`node --check electron/application-service.js`（及改过的 `electron/*.js`）
2. **后端单元测试**：`npm test`（Node 内置 test runner，`test/application-service.test.js`）
3. **类型检查**：`npm run typecheck`（vue-tsc）
4. **构建**：`npm run build:frontend`（内含 typecheck，产物在 `frontend/dist/`）

一键执行 2-4：`npm run verify`；只跑单个文件：`npm run test:unit`。

## 后端单元测试（test/ 目录）

- `test/application-service.test.js`：覆盖分P子目录归类、deleteTask 空目录清理、并发上限自动管理（enforceConcurrencyLimit）、低速自动暂停（demoteSlowTask）、设置默认值。
- `test/helpers/mock-electron.js`：可复用工具。**为什么必须预置 require 缓存**：`application-service.js` 顶层 `require('electron')`，在无 Electron 运行时的普通 Node 下会加载失败。做法是 `createRequire(应用服务文件路径)` 得到 `req`，把 mock（`app.getPath`/`isPackaged`、`safeStorage`）写进 `req.cache[req.resolve('electron')]`，再 `req(应用服务路径)` 加载，模块内部 `require('electron')` 命中缓存拿到 mock。
- 新增测试要点：直接构造 `new ApplicationService()` 并手写最小 task/video 对象调用原型方法即可，无需网络；文件系统操作一律用 `os.tmpdir()` 下的临时目录并在 afterEach 清理；不要调用 `svc.initialize()` 除非测试设置默认值（它会按 `USERPROFILE` 建真实下载目录，需临时替换环境变量）。

## 浏览器验收（UI/布局/交互）

应用是 SPA，`window.electronAPI` 由 preload 注入；浏览器验收时先把 `frontend/dist` 托管起来并**注入桩**：

1. 托管构建产物（无 Electron 依赖）：后台运行 `npm run preview`（vite preview，默认 http://localhost:4173），或使用脚本 `scripts/ 级别的一次性 node 静态服务器（注意回到项目根目录、指定 frontend/dist）。
2. 在页面 `evaluate_script` 注入 `window.electronAPI` 桩：模板见 `resources/electronapi-stub.js`（含 multi/single 视频信息切换与 `window.__test` 载荷记录）。返回一个可调用函数体 `() => {...}`。
3. **导航/刷新会清掉桩**：必须在每次导航后重新注入；注入后再手动点一次"刷新"拉取任务列表，否则首页会显示"刷新失败"提示。
4. 驱动 DOM 断言（打开对话框→填 URL→解析→检查开关/表单→提交→读 `window.__test.lastBatchPayload` / `lastStartPayload` 验证请求载荷）。

### 浏览器验收已知坑（务必遵守）

- **evaluate_script 必须传可调用函数**：`function: '() => {...}'`；传 IIFE 会执行但随后报 `fn is not a function`。
- **el-input 需要原生事件**：直接赋值 `input.value` 后要 `dispatchEvent(new Event('input', {bubbles:true}))` 才能触发 v-model；el-input-number 的增减箭头对 `.click()` 无响应（基于 mousedown 的 vRepeatClick），需分发 `MouseEvent('mousedown')`。
- **按钮选择器要限定在对话框内**：页面遮罩下还挂着空状态的"开始下载"按钮（`tasks.length===0` 时），`document.querySelectorAll('button')` 按文档序会先命中它；用 `[...document.querySelectorAll('.el-dialog button')].find(b => b.textContent.includes('开始下载'))`。
- **ASI/`(` 续行缺分号陷阱**：模块级语句（如 `const sep = path.sep`）后紧跟以 `(` 开头的行（如 `(async () => {...})()`）时会被解析成函数调用（报 `path.sep is not a function`）。测试/脚本里此类行必须加分号。
- **a11y 快照匹配**：`take_snapshot` 返回 JSON 中转义了引号（`\"`），用正则匹配 `uid=x_y switch "下载到子目录"` 会失配；要么直接对 `uid` 点击，要么用页面内 evaluate_script 做 DOM 断言。
- **后台任务记得回收**：托管服务器作为 managed background job 启动，验收结束 `job_kill`；临时脚本用完删除，保持仓库干净。

## 验收完成的定义

- 后端改动：`npm test` 全绿 + `node --check` 通过；如涉及新行为，测试文件同步新增用例。
- 前端改动：`npm run typecheck` + `npm run build:frontend` 通过。
- UI/交互改动：浏览器验收脚本给出具体断言（元素存在/隐藏、默认值、请求载荷），并把关键截图或载荷输出留档。

## 相关文件

- 后端：`electron/application-service.js`（应用服务；IPC 路由在 `request()` 内正则匹配）
- 测试工具：`test/helpers/mock-electron.js`、`test/application-service.test.js`
- 验收桩模板：`resources/electronapi-stub.js`
- 前端入口：`frontend/src/App.vue`、`frontend/src/views/Home.vue`、`frontend/src/components/download/NewDownloadForm.vue`