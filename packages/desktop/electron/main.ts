/**
 * Electron 主进程
 */
import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";
import { networkInterfaces } from "os";

const isDev = process.env.NODE_ENV !== "production";
type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";
type UsbCommandTarget = "android" | "ios";

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcessWithoutNullStreams | null = null;
let serverStatus: ServerStatus = "stopped";
const serverLogs: string[] = [];
const USB_COMMANDS: Record<UsbCommandTarget, string> = {
  android: "adb reverse tcp:3001 tcp:3001",
  ios: "iproxy 3001 3001",
};

function getWorkspaceRoot() {
  // dist-electron 在 packages/desktop 下，回到仓库根目录 talkingTool
  return path.resolve(__dirname, "../../..");
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

  const linuxCandidates = [
    ["x-terminal-emulator", ["-e", command]],
    ["gnome-terminal", ["--", "bash", "-lc", command]],
    ["konsole", ["-e", "bash", "-lc", command]],
    ["xfce4-terminal", ["-e", `bash -lc "${command}"`]],
    ["xterm", ["-e", command]],
  ] as const;

  for (const [cmd, args] of linuxCandidates) {
    const exists = spawnSync("which", [cmd], { stdio: "ignore" });
    if (exists.status === 0) {
      spawn(cmd, args as string[], { stdio: "ignore" });
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
  const workspaceRoot = getWorkspaceRoot();
  const child = spawn("npm", ["run", "dev", "-w", "@talking-tool/server"], {
    cwd: workspaceRoot,
    shell: true,
    env: {
      ...process.env,
      // 默认打开讯飞调试日志，便于桌面端直接排查
      IFLYTEK_DEBUG: process.env.IFLYTEK_DEBUG ?? "1",
    },
  });
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
