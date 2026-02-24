# CODEX Project Context: talkingTool

## One-line summary
AI 提示词优化工具：移动端语音转文字 + 桌面端编辑 + Socket.IO 实时同步。

## Primary capabilities
- Mobile: 语音转文字（系统/讯飞/Whisper 离线）+ 提示词编辑与同步
- Desktop: Electron UI 展示 STT、编辑提示词、启动/停止本地同步服务
- Server: Socket.IO 同步中转 + 讯飞 STT 适配（sa2kit）

## Monorepo layout
- /Users/qihongrui/Desktop/project/talkingTool/packages/server
  - Node + Socket.IO 服务端，端口默认 3001
- /Users/qihongrui/Desktop/project/talkingTool/packages/desktop
  - Electron + React + Vite + Tailwind
- /Users/qihongrui/Desktop/project/talkingTool/packages/mobile
  - React Native (Expo) + NativeWind

## Key flows
- Mobile STT -> socket.emit("stt:chunk") -> Desktop display
- Mobile/desktop prompt edit -> socket.emit("prompt:update") -> cross-device sync
- Mobile -> stt:clear -> clear both sides

## Socket.IO events
- register (payload: "mobile" | "desktop")
- clients:status (mobile/desktop counts)
- stt:chunk { sessionId?, text, isFinal? }
- stt:clear
- prompt:update { content }

## Dev commands (from repo root)
- npm install
- npm run server        # start Socket.IO server (tsx watch)
- npm run desktop       # start Electron + Vite
- npm run mobile        # Expo start
- npm run dev           # server + desktop
- npm run dev:all        # server + desktop + mobile

## Ports and URLs
- Server: http://localhost:3001
- Desktop dev UI: http://localhost:5173
- Mobile connects to serverUrl (saved in settings; default in code: http://192.168.0.100:3001)

## Configuration
- Server env (packages/server/src/index.ts):
  - IFLYTEK_APP_ID
  - IFLYTEK_API_KEY
  - IFLYTEK_API_SECRET
  - IFLYTEK_DEBUG=1 (default enabled by desktop launcher)
- Mobile server URL saved in AsyncStorage (Settings screen).

## Desktop implementation notes
- Electron main process starts/stops server via npm workspace command.
- LAN IPs computed and shown as links + QR codes in Settings tab.
- UI receives server logs via IPC.
- Key files:
  - /Users/qihongrui/Desktop/project/talkingTool/packages/desktop/electron/main.ts
  - /Users/qihongrui/Desktop/project/talkingTool/packages/desktop/electron/preload.ts
  - /Users/qihongrui/Desktop/project/talkingTool/packages/desktop/src/App.tsx

## Mobile implementation notes
- Home screen handles STT and prompt sync.
- Settings screen saves server URL, toggles STT engines, QR scan.
- STT engines:
  - system: expo-speech-recognition (online, Google)
  - iflytek: sa2kit + audio PCM stream (requires dev build)
  - whisper-tiny/base: whisper.rn (offline models in assets)
- Key files:
  - /Users/qihongrui/Desktop/project/talkingTool/packages/mobile/App.tsx
  - /Users/qihongrui/Desktop/project/talkingTool/packages/mobile/src/screens/HomeScreen.tsx
  - /Users/qihongrui/Desktop/project/talkingTool/packages/mobile/src/screens/MyScreen.tsx
  - /Users/qihongrui/Desktop/project/talkingTool/packages/mobile/src/context/SettingsContext.tsx
  - /Users/qihongrui/Desktop/project/talkingTool/packages/mobile/src/constants.ts

## Server implementation notes
- Socket.IO on top of http.createServer
- Tracks client types and broadcasts status
- IflytekServerAdapter attached per socket (sa2kit)
- Key file:
  - /Users/qihongrui/Desktop/project/talkingTool/packages/server/src/index.ts

## Desktop 打包包含 server + sa2kit

### 目标
桌面端安装包内置 server 产物和 `sa2kit` 依赖，离线可运行。

### 打包流程
1. `npm run electron:build` / `npm run electron:build:mac` / `npm run electron:build:win`
2. 自动执行 `scripts/prepare-server-bundle.js`：
   - `npm run server:build`
   - `npm install --omit=dev --prefix packages/server`（确保 `sa2kit` 复制进 node_modules）
   - 拷贝到 `packages/desktop/resources/server`
3. Electron 生产环境使用内置 server（`process.resourcesPath/server`）

### 注意
- `sa2kit` 已改为 npm 依赖（当前版本 `1.6.60`），无需在仓库根目录放置本地目录。

## External/local dependencies
- sa2kit is referenced via local file dependency: ../../../sa2kit
  - Ensure it exists in this path for server/mobile builds.

## Build outputs
- Desktop build: /Users/qihongrui/Desktop/project/talkingTool/packages/desktop/dist + dist-electron
- Electron builder output: /Users/qihongrui/Desktop/project/talkingTool/packages/desktop/release

## Known limitations / TODOs
- Mobile default server URL is a placeholder; user must set LAN IP.

## USB 有线连接（设计方案）
> 目标：在公司内网/受限 Wi-Fi 场景下，用 USB 线让手机访问桌面端 Socket.IO 服务。

### 方案一：Android（推荐）
- 使用 `adb reverse` 将手机端口反向映射到电脑端口。
- 手机端 serverUrl 统一使用 `http://127.0.0.1:3001`。
- 命令：
  - `adb reverse tcp:3001 tcp:3001`
  - 取消：`adb reverse --remove tcp:3001`

### 方案二：iOS（需要 usbmuxd / libimobiledevice）
- 通过 `iproxy` 将 iPhone 端口映射到本机。
- 手机端 serverUrl 使用 `http://127.0.0.1:3001`。
- 命令：
  - `iproxy 3001 3001`
  - 结束：`Ctrl+C`

### 连接流程（实施步骤）
1. 桌面端启动同步服务（确保端口 3001 监听在 0.0.0.0）。
2. 手机通过 USB 连接电脑。
3. 执行对应平台的端口映射命令（Android: adb reverse / iOS: iproxy）。
4. 手机端切换为 USB 地址：`http://127.0.0.1:3001`。
5. 在手机端「测试连接」验证可达。

### 需要落地的产品改动
- 移动端设置页增加「USB 有线连接」快捷入口（自动填入 127.0.0.1:3001 + 展示命令）。
- 桌面端设置页增加 USB 连接说明（Android/iOS 命令）。

## CI（Android 打包 / GitHub Actions）

### 现状
- GitHub Actions 已包含 Android APK 构建 job（基于 EAS Build）。
- 构建产物上传为 `android-apk` artifact。

### 需要提供的信息
- Expo 账号 Access Token（GitHub Secret: `EXPO_TOKEN`）
- 在本地运行 `npx eas init` 完成项目绑定并提交 `expo.extra.eas.projectId`
- Android keystore（首次构建时由 EAS 引导创建或通过 `npx eas credentials` 配置）

### 常用命令
- 本地初始化：`cd packages/mobile && npx eas init`
- 本地构建（验证）：`cd packages/mobile && npx eas build -p android --profile preview`

## 移动端内置安装包分发页

### 目标
在手机端内置桌面端安装包，通过手机本地 HTTP 服务向电脑分发（支持局域网和 USB）。

### 实现概览
- 移动端启动本地静态服务器（端口 `8787`）。
- 自动生成 `index.html` 下载页，列出 Windows/macOS 安装包。
- 局域网访问：`http://<手机IP>:8787/index.html`
- USB 访问：
  - Android：`adb forward tcp:8787 tcp:8787`
  - iOS：`iproxy 8787 8787`
  - 电脑访问 `http://127.0.0.1:8787/index.html`

### 资源放置
- 需要在移动端内置安装包：
  - `packages/mobile/assets/installers/desktop-win.exe`
  - `packages/mobile/assets/installers/desktop-mac.dmg`
- 这些文件会被打包进 App（`app.json` 已配置 `assetBundlePatterns`）。
