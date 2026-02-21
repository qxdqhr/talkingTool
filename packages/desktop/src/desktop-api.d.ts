export {};

type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

declare global {
  interface Window {
    desktopAPI?: {
      getServerStatus: () => Promise<ServerStatus>;
      startServer: () => Promise<{ ok: boolean; message?: string }>;
      stopServer: () => Promise<{ ok: boolean; message?: string }>;
      getLanLinks: () => Promise<string[]>;
      getServerLogs: () => Promise<string[]>;
      onServerStatusChange: (callback: (status: ServerStatus) => void) => () => void;
      onServerLog: (callback: (line: string) => void) => () => void;
    };
  }
}

