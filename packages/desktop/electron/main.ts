/**
 * Electron 主进程
 */
import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";
import { networkInterfaces } from "os";
import { tmpdir } from "os";
import fs from "fs";

const isDev = process.env.NODE_ENV !== "production";
type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";
type UsbCommandTarget = "android" | "ios";
type TerminalId = "terminal";
type AiToolId = "codex" | "claude" | "gemini";

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcessWithoutNullStreams | null = null;
let serverStatus: ServerStatus = "stopped";
const serverLogs: string[] = [];
const USB_COMMANDS: Record<UsbCommandTarget, string> = {
  android: "adb reverse tcp:3001 tcp:3001",
  ios: "iproxy 3001 3001",
};

const AI_TOOLS: Array<{ id: AiToolId; name: string; command: string }> = [
  { id: "codex", name: "Codex CLI", command: "codex" },
  { id: "claude", name: "Claude Code", command: "claude" },
  { id: "gemini", name: "Gemini CLI", command: "gemini" },
];

function commandExists(command: string) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], { stdio: "ignore" });
  return result.status === 0;
}

function getTerminalStatus() {
  return [
    {
      id: "terminal" as TerminalId,
      name: process.platform === "darwin" ? "Terminal" : "System Terminal",
      installed:
        process.platform === "darwin"
          ? spawnSync("osascript", ["-e", 'id of app "Terminal"'], {
              stdio: "ignore",
            }).status === 0
          : true,
    },
  ];
}

function getAiToolStatus() {
  return AI_TOOLS.map((tool) => ({
    ...tool,
    installed: commandExists(tool.command),
  }));
}

function runAppleScript(lines: string[]) {
  const args = lines.flatMap((line) => ["-e", line]);
  const result = spawnSync("osascript", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "执行 AppleScript 失败");
  }
}

function sendPromptToTerminalTool(terminalId: TerminalId, toolId: AiToolId, prompt: string) {
  const tool = AI_TOOLS.find((item) => item.id === toolId);
  if (!tool) {
    return { ok: false, message: "未找到对应 AI 工具" };
  }
  if (!commandExists(tool.command)) {
    return { ok: false, message: `${tool.name} 未安装` };
  }
  if (terminalId !== "terminal") {
    return { ok: false, message: "暂不支持该终端" };
  }

  try {
    if (process.platform === "darwin") {
      const payloadFile = path.join(tmpdir(), `talkingtool-prompt-${Date.now()}.txt`);
      fs.writeFileSync(payloadFile, prompt, "utf8");
      const safeCommand = tool.command.replace(/"/g, '\\"');
      const safeFile = payloadFile.replace(/"/g, '\\"');
      runAppleScript([
        'tell application "Terminal" to activate',
        `tell application "Terminal" to do script "${safeCommand}"`,
        "delay 0.6",
        `tell application "Terminal" to do script \"cat \\\"${safeFile}\\\"\" in front window`,
      ]);
      return { ok: true, message: `已打开 Terminal 并注入提示词到 ${tool.name}` };
    }

    openTerminalAndRun(`${tool.command}`);
    return {
      ok: true,
      message: `已打开终端并启动 ${tool.name}。非 macOS 平台请手动粘贴提示词。`,
    };
  } catch (error: any) {
    return { ok: false, message: error?.message ?? "打开终端失败" };
  }
}

function getWorkspaceRoot() {
  // dist-electron 在 packages/desktop 下，回到仓库根目录 talkingTool
  return path.resolve(__dirname, "../../..");
}

function getBundledServerRoot() {
  return path.join(process.resourcesPath, "server");
}

function emitServerStatus(status: ServerStatus) {
  serverStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("server:status", status);
  }
}

function pushServerLog(line: string) {
  const now = new Date().toLocaleTimeString();
  const formatted = `[${now}] ${line}`;
  serverLogs.push(formatted);
  if (serverLogs.length > 500) serverLogs.shift();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("server:log", formatted);
  }
}

function getLanServerLinks(port = 3001) {
  const nets = networkInterfaces();
  const links: string[] = [];
  for (const key of Object.keys(nets)) {
    for (const item of nets[key] ?? []) {
      if (item.family === "IPv4" && !item.internal) {
        links.push(`http://${item.address}:${port}`);
      }
    }
  }
  return Array.from(new Set(links));
}

function openTerminalAndRun(command: string) {
  if (process.platform === "darwin") {
    const safe = command.replace(/"/g, '\\"');
    spawn(
      "osascript",
      [
        "-e",
        'tell application "Terminal" to activate',
        "-e",
        `tell application "Terminal" to do script "${safe}"`,
      ],
      { stdio: "ignore" },
    );
    return;
  }

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "cmd", "/k", command], {
      shell: true,
      windowsHide: false,
      stdio: "ignore",
    });
    return;
  }

  const linuxCandidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: "x-terminal-emulator", args: ["-e", command] },
    { cmd: "gnome-terminal", args: ["--", "bash", "-lc", command] },
    { cmd: "konsole", args: ["-e", "bash", "-lc", command] },
    { cmd: "xfce4-terminal", args: ["-e", `bash -lc \"${command}\"`] },
    { cmd: "xterm", args: ["-e", command] },
  ];

  for (const candidate of linuxCandidates) {
    const exists = spawnSync("which", [candidate.cmd], { stdio: "ignore" });
    if (exists.status === 0) {
      spawn(candidate.cmd, candidate.args, { stdio: "ignore" });
      return;
    }
  }

  throw new Error("未找到可用的终端程序");
}

function runUsbCommand(target: UsbCommandTarget) {
  const command = USB_COMMANDS[target];
  if (!command) {
    return { ok: false, message: "未知的 USB 命令类型", command: "" };
  }

  try {
    openTerminalAndRun(command);
    return { ok: true, command };
  } catch (error: any) {
    return {
      ok: false,
      command,
      message: error?.message ?? "执行失败",
    };
  }
}

function startServerProcess() {
  if (serverProcess) {
    return { ok: false, message: "server 已在运行中" };
  }

  emitServerStatus("starting");
  let child: ChildProcessWithoutNullStreams;
  const env = {
    ...process.env,
    IFLYTEK_DEBUG: process.env.IFLYTEK_DEBUG ?? "1",
  };

  if (isDev) {
    const workspaceRoot = getWorkspaceRoot();
    child = spawn("npm", ["run", "dev", "-w", "@talking-tool/server"], {
      cwd: workspaceRoot,
      shell: true,
      env,
    });
  } else {
    const serverRoot = getBundledServerRoot();
    const entry = path.join(serverRoot, "dist", "index.js");
    child = spawn(process.execPath, [entry], {
      cwd: serverRoot,
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        NODE_PATH: path.join(serverRoot, "node_modules"),
      },
    });
  }
  serverProcess = child;
  pushServerLog("启动 server 进程...");

  let runningMarked = false;
  child.stdout.on("data", (buffer) => {
    const text = String(buffer);
    text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .forEach((line) => pushServerLog(line));
    // tsx watch 启动后会输出此行
    if (!runningMarked && text.includes("同步服务已启动")) {
      runningMarked = true;
      emitServerStatus("running");
    }
  });
  child.stderr.on("data", (buffer) => {
    const text = String(buffer);
    text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .forEach((line) => pushServerLog(`[stderr] ${line}`));
    if (serverStatus !== "running") {
      emitServerStatus("error");
    }
  });

  child.on("close", () => {
    pushServerLog("server 进程已退出");
    serverProcess = null;
    if (serverStatus !== "stopping") {
      emitServerStatus(runningMarked ? "stopped" : "error");
    } else {
      emitServerStatus("stopped");
    }
  });

  // 如果启动日志没命中，给一个兜底状态
  setTimeout(() => {
    if (serverProcess && serverStatus === "starting") {
      emitServerStatus("running");
    }
  }, 1500);

  return { ok: true };
}

function stopServerProcess() {
  if (!serverProcess) {
    emitServerStatus("stopped");
    return { ok: false, message: "server 当前未运行" };
  }
  emitServerStatus("stopping");
  pushServerLog("正在停止 server 进程...");
  try {
    serverProcess.kill("SIGTERM");
  } catch {
    emitServerStatus("error");
    return { ok: false, message: "停止 server 失败" };
  }
  return { ok: true };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("server:getStatus", () => serverStatus);
  ipcMain.handle("server:start", () => startServerProcess());
  ipcMain.handle("server:stop", () => stopServerProcess());
  ipcMain.handle("server:getLanLinks", () => getLanServerLinks());
  ipcMain.handle("server:getLogs", () => serverLogs);
  ipcMain.handle("usb:runCommand", (_event, target: UsbCommandTarget) =>
    runUsbCommand(target),
  );
  ipcMain.handle("terminal:scan", () => ({
    terminals: getTerminalStatus(),
    aiTools: getAiToolStatus(),
  }));
  ipcMain.handle(
    "terminal:sendPrompt",
    (
      _event,
      payload: { terminalId: TerminalId; toolId: AiToolId; prompt: string },
    ) => sendPromptToTerminalTool(payload.terminalId, payload.toolId, payload.prompt),
  );
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (serverProcess) {
    try {
      serverProcess.kill("SIGTERM");
    } catch {}
  }
});
