# AI 提示词优化工具

语音转文字 → 提示词编辑/优化 → 手机与桌面端实时同步

## 项目结构

```
talkingTool/
├── packages/
│   ├── server/     # Socket.IO 同步服务 (Node.js)
│   ├── desktop/    # Electron 桌面端 (React + Tailwind)
│   └── mobile/     # 移动端 App (React Native + Expo)
├── Doc.md          # 需求与技术方案文档
└── package.json    # Monorepo 根配置
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动同步服务（需先启动）

```bash
npm run server
```

### 3. 启动桌面端

```bash
npm run desktop
```

### 4. 启动移动端

```bash
npm run mobile
```

## 开发说明

- **Server**：默认端口 `3001`，负责移动端与桌面端的 Socket.IO 通信
- **Desktop**：Electron + React + Vite + Tailwind，开发时加载 `http://localhost:5173`
- **Mobile**：Expo 项目，需在真机或模拟器上测试，连接时请将 `SOCKET_URL` 改为本机 IP

## 后续开发

1. 移动端接入 `react-native-voice` 实现语音转文字
2. 实现提示词双向同步与 AI 优化逻辑
3. 打包发布

## CI（GitHub Actions）- Android 打包

当前仓库已配置自动构建 Android APK（EAS Build）。触发条件：push / PR / 手动触发。

### 你需要提供的信息
- Expo 账号 Access Token（保存为 GitHub Secret：`EXPO_TOKEN`）
- 初始化 EAS 项目（一次性）

### 本地一次性操作
```bash
cd /Users/qihongrui/Desktop/project/talkingTool/packages/mobile
npx eas init
```
完成后会写入 `app.json` 中的 `expo.extra.eas.projectId`，请提交到仓库。

### Android 签名
首次构建会引导生成/上传 keystore。也可手动配置：
```bash
cd /Users/qihongrui/Desktop/project/talkingTool/packages/mobile
npx eas credentials
```

### 构建产物
GitHub Actions 会生成 `android-apk` artifact，可在 Actions 页面下载。
