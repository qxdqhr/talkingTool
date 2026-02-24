import { contextBridge, ipcRenderer } from "electron";

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

contextBridge.exposeInMainWorld("desktopAPI", {
  getServerStatus: (): Promise<ServerStatus> =>
    ipcRenderer.invoke("server:getStatus"),
  startServer: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke("server:start"),
  stopServer: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke("server:stop"),
  getLanLinks: (): Promise<string[]> => ipcRenderer.invoke("server:getLanLinks"),
  getServerLogs: (): Promise<string[]> => ipcRenderer.invoke("server:getLogs"),
  runUsbCommand: (
    target: "android" | "ios",
  ): Promise<{ ok: boolean; command: string; message?: string }> =>
    ipcRenderer.invoke("usb:runCommand", target),
  onServerStatusChange: (callback: (status: ServerStatus) => void) => {
    const listener = (_event: unknown, status: ServerStatus) => callback(status);
    ipcRenderer.on("server:status", listener);
    return () => ipcRenderer.removeListener("server:status", listener);
  },
  onServerLog: (callback: (line: string) => void) => {
    const listener = (_event: unknown, line: string) => callback(line);
    ipcRenderer.on("server:log", listener);
    return () => ipcRenderer.removeListener("server:log", listener);
  },
});
