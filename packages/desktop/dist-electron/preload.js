"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("desktopAPI", {
    getServerStatus: () => electron_1.ipcRenderer.invoke("server:getStatus"),
    startServer: () => electron_1.ipcRenderer.invoke("server:start"),
    stopServer: () => electron_1.ipcRenderer.invoke("server:stop"),
    getLanLinks: () => electron_1.ipcRenderer.invoke("server:getLanLinks"),
    getServerLogs: () => electron_1.ipcRenderer.invoke("server:getLogs"),
    onServerStatusChange: (callback) => {
        const listener = (_event, status) => callback(status);
        electron_1.ipcRenderer.on("server:status", listener);
        return () => electron_1.ipcRenderer.removeListener("server:status", listener);
    },
    onServerLog: (callback) => {
        const listener = (_event, line) => callback(line);
        electron_1.ipcRenderer.on("server:log", listener);
        return () => electron_1.ipcRenderer.removeListener("server:log", listener);
    },
});
