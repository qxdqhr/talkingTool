"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Electron 主进程
 */
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const os_1 = require("os");
const isDev = process.env.NODE_ENV !== "production";
let mainWindow = null;
let serverProcess = null;
let serverStatus = "stopped";
const serverLogs = [];
function getWorkspaceRoot() {
    // dist-electron 在 packages/desktop 下，回到仓库根目录 talkingTool
    return path_1.default.resolve(__dirname, "../../..");
}
function emitServerStatus(status) {
    serverStatus = status;
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("server:status", status);
    }
}
function pushServerLog(line) {
    const now = new Date().toLocaleTimeString();
    const formatted = `[${now}] ${line}`;
    serverLogs.push(formatted);
    if (serverLogs.length > 500)
        serverLogs.shift();
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("server:log", formatted);
    }
}
function getLanServerLinks(port = 3001) {
    const nets = (0, os_1.networkInterfaces)();
    const links = [];
    for (const key of Object.keys(nets)) {
        for (const item of nets[key] ?? []) {
            if (item.family === "IPv4" && !item.internal) {
                links.push(`http://${item.address}:${port}`);
            }
        }
    }
    return Array.from(new Set(links));
}
function startServerProcess() {
    if (serverProcess) {
        return { ok: false, message: "server 已在运行中" };
    }
    emitServerStatus("starting");
    const workspaceRoot = getWorkspaceRoot();
    const child = (0, child_process_1.spawn)("npm", ["run", "dev", "-w", "@talking-tool/server"], {
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
        }
        else {
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
    }
    catch {
        emitServerStatus("error");
        return { ok: false, message: "停止 server 失败" };
    }
    return { ok: true };
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path_1.default.join(__dirname, "preload.js"),
        },
    });
    if (isDev) {
        mainWindow.loadURL("http://localhost:5173");
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, "../dist/index.html"));
    }
}
electron_1.app.whenReady().then(() => {
    electron_1.ipcMain.handle("server:getStatus", () => serverStatus);
    electron_1.ipcMain.handle("server:start", () => startServerProcess());
    electron_1.ipcMain.handle("server:stop", () => stopServerProcess());
    electron_1.ipcMain.handle("server:getLanLinks", () => getLanServerLinks());
    electron_1.ipcMain.handle("server:getLogs", () => serverLogs);
    createWindow();
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
electron_1.app.on("activate", () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
electron_1.app.on("before-quit", () => {
    if (serverProcess) {
        try {
            serverProcess.kill("SIGTERM");
        }
        catch { }
    }
});
