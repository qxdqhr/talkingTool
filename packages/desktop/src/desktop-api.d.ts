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
      runUsbCommand: (
        target: "android" | "ios",
      ) => Promise<{ ok: boolean; command: string; message?: string }>;
      scanTerminalTools: () => Promise<{
        terminals: Array<{ id: "terminal"; name: string; installed: boolean }>;
        aiTools: Array<{
          id: "codex" | "claude" | "gemini";
          name: string;
          command: string;
          installed: boolean;
        }>;
      }>;
      sendPromptToTerminal: (payload: {
        terminalId: "terminal";
        toolId: "codex" | "claude" | "gemini";
        prompt: string;
      }) => Promise<{ ok: boolean; message?: string }>;
      onServerStatusChange: (callback: (status: ServerStatus) => void) => () => void;
      onServerLog: (callback: (line: string) => void) => () => void;
    };
  }
}
