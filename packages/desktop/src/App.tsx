import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import QRCode from "qrcode";

const SOCKET_URL = "http://localhost:3001";
type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";
type TabKey = "main" | "settings";
type TerminalItem = { id: "terminal"; name: string; installed: boolean };
type AiToolItem = {
  id: "codex" | "claude" | "gemini";
  name: string;
  command: string;
  installed: boolean;
};

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("main");
  const [serverStatus, setServerStatus] = useState<ServerStatus>("stopped");
  const [connected, setConnected] = useState(false);
  const [mobileOnline, setMobileOnline] = useState(0);
  const [mobileMode, setMobileMode] = useState<"usb" | "lan" | "unknown">(
    "unknown",
  );
  const [lanLinks, setLanLinks] = useState<string[]>([]);
  const [serverLogs, setServerLogs] = useState<string[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrSourceLink, setQrSourceLink] = useState("");
  const [usbActionMsg, setUsbActionMsg] = useState("");
  const [usbActionError, setUsbActionError] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [finalText, setFinalText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [terminals, setTerminals] = useState<TerminalItem[]>([]);
  const [aiTools, setAiTools] = useState<AiToolItem[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState<"terminal">("terminal");
  const [selectedAiTool, setSelectedAiTool] = useState<"codex" | "claude" | "gemini">("codex");
  const [terminalActionMsg, setTerminalActionMsg] = useState("");
  const [terminalActionError, setTerminalActionError] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const sttRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // 防止自己发出的 prompt:update 被回显覆盖
  const isLocalEditRef = useRef(false);

  const displayText =
    finalText + (interimText ? (finalText ? "\n" : "") + interimText : "");

  useEffect(() => {
    if (!window.desktopAPI) return;

    window.desktopAPI.getServerStatus().then(setServerStatus).catch(() => {});
    window.desktopAPI.getLanLinks().then(setLanLinks).catch(() => {});
    window.desktopAPI.getServerLogs().then(setServerLogs).catch(() => {});
    window.desktopAPI
      .scanTerminalTools()
      .then((data) => {
        setTerminals(data.terminals);
        setAiTools(data.aiTools);
        const firstInstalledTool = data.aiTools.find((item) => item.installed);
        if (firstInstalledTool) setSelectedAiTool(firstInstalledTool.id);
      })
      .catch(() => {});
    const dispose = window.desktopAPI.onServerStatusChange((status) => {
      setServerStatus(status);
      if (status === "running") {
        window.desktopAPI?.getLanLinks().then(setLanLinks).catch(() => {});
      }
    });
    const disposeLog = window.desktopAPI.onServerLog((line) => {
      setServerLogs((prev) => {
        const next = [...prev, line];
        if (next.length > 300) next.shift();
        return next;
      });
    });
    return () => {
      dispose();
      disposeLog();
    };
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("register", "desktop");
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setMobileOnline(0);
      setMobileMode("unknown");
    });

    // 在线状态
    socket.on(
      "clients:status",
      (data: { mobile: number; desktop: number; mobileMode?: "usb" | "lan" | "unknown" }) => {
        setMobileOnline(data.mobile);
        if (data.mobileMode) {
          setMobileMode(data.mobileMode);
        }
      },
    );

    // 接收语音转文字片段
    socket.on("stt:chunk", (data: { text: string; isFinal?: boolean }) => {
      if (data.isFinal) {
        setFinalText((prev) =>
          prev ? prev + "\n" + data.text : data.text,
        );
        setInterimText("");
      } else {
        setInterimText(data.text);
      }
    });

    socket.on("stt:clear", () => {
      setFinalText("");
      setInterimText("");
    });

    // 接收提示词同步（来自移动端）
    socket.on("prompt:update", (data: { content: string }) => {
      // 如果当前正在本地编辑，忽略远端同步以避免冲突
      if (isLocalEditRef.current) return;
      setPrompt(data.content);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // STT 区域自动滚动
  useEffect(() => {
    if (sttRef.current) {
      sttRef.current.scrollTop = sttRef.current.scrollHeight;
    }
  }, [finalText, interimText]);

  // 本地编辑提示词 — 同步到移动端
  const handlePromptChange = useCallback((value: string) => {
    isLocalEditRef.current = true;
    setPrompt(value);
    socketRef.current?.emit("prompt:update", { content: value });
    // 短暂窗口后恢复接收远端更新
    setTimeout(() => {
      isLocalEditRef.current = false;
    }, 300);
  }, []);

  const handleClearSTT = useCallback(() => {
    setFinalText("");
    setInterimText("");
    socketRef.current?.emit("stt:clear");
  }, []);

  const handleUseAsPrompt = useCallback(() => {
    const text = finalText || displayText;
    if (text) {
      const newPrompt = prompt ? `${prompt}\n${text}` : text;
      handlePromptChange(newPrompt);
    }
  }, [finalText, displayText, prompt, handlePromptChange]);

  const handleClearPrompt = useCallback(() => {
    handlePromptChange("");
  }, [handlePromptChange]);

  // 复制到剪贴板
  const handleCopyPrompt = useCallback(async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {}
  }, [prompt]);

  const handleSendPromptToTerminal = useCallback(async () => {
    if (!window.desktopAPI || !prompt.trim()) return;
    setTerminalActionMsg("");
    setTerminalActionError(false);
    try {
      const result = await window.desktopAPI.sendPromptToTerminal({
        terminalId: selectedTerminal,
        toolId: selectedAiTool,
        prompt,
      });
      setTerminalActionMsg(result.message ?? (result.ok ? "已发送" : "发送失败"));
      setTerminalActionError(!result.ok);
    } catch {
      setTerminalActionMsg("发送失败，请检查终端与 AI 工具安装状态");
      setTerminalActionError(true);
    }
  }, [prompt, selectedAiTool, selectedTerminal]);

  const handleToggleServer = useCallback(async () => {
    if (!window.desktopAPI) return;
    if (serverStatus === "running" || serverStatus === "starting") {
      await window.desktopAPI.stopServer();
    } else if (serverStatus === "stopped" || serverStatus === "error") {
      await window.desktopAPI.startServer();
    }
  }, [serverStatus]);

  const serverButtonText =
    serverStatus === "running" || serverStatus === "starting"
      ? "停止服务端"
      : "启动服务端";

  const handleRefreshLanLinks = useCallback(async () => {
    if (!window.desktopAPI) return;
    try {
      const links = await window.desktopAPI.getLanLinks();
      setLanLinks(links);
    } catch {}
  }, []);

  const handleCopyLanLink = useCallback(async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {}
  }, []);

  const handleClearLogs = useCallback(() => {
    setServerLogs([]);
  }, []);

  const handleGenerateQr = useCallback(async (link: string) => {
    try {
      const dataUrl = await QRCode.toDataURL(link, {
        margin: 1,
        width: 220,
      });
      setQrDataUrl(dataUrl);
      setQrSourceLink(link);
    } catch {}
  }, []);

  const handleUsbCommand = useCallback(
    async (target: "android" | "ios", fallbackCommand: string) => {
      if (!window.desktopAPI) return;
      setUsbActionMsg("");
      setUsbActionError(false);

      try {
        const result = await window.desktopAPI.runUsbCommand(target);
        if (result.ok) {
          setUsbActionMsg(`已打开终端并执行：${result.command}`);
          setUsbActionError(false);
          return;
        }
        await navigator.clipboard.writeText(fallbackCommand);
        setUsbActionMsg(
          `${result.message ?? "无法自动执行"}，已复制命令到剪贴板`,
        );
        setUsbActionError(true);
      } catch {
        try {
          await navigator.clipboard.writeText(fallbackCommand);
        } catch {}
        setUsbActionMsg("无法自动执行，已复制命令到剪贴板");
        setUsbActionError(true);
      }
    },
    [],
  );

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-6 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">
              AI 提示词优化工具
            </h1>
            <div className="mt-1 flex items-center gap-3">
              {/* 服务进程状态 */}
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    serverStatus === "running"
                      ? "bg-green-500"
                      : serverStatus === "starting" || serverStatus === "stopping"
                        ? "bg-yellow-400"
                        : serverStatus === "error"
                          ? "bg-red-500"
                          : "bg-gray-300"
                  }`}
                />
                <span className="text-xs text-gray-500">
                  {serverStatus === "running"
                    ? "服务端运行中"
                    : serverStatus === "starting"
                      ? "服务端启动中"
                      : serverStatus === "stopping"
                        ? "服务端停止中"
                        : serverStatus === "error"
                          ? "服务端异常"
                          : "服务端未启动"}
                </span>
              </span>

              {/* 服务连接状态 */}
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-400"}`}
                />
                <span className="text-xs text-gray-500">
                  {connected ? "服务已连接" : "未连接"}
                </span>
              </span>

              {/* 手机连接状态 */}
              {connected && (
                <span className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${mobileOnline > 0 ? "bg-blue-500" : "bg-gray-300"}`}
                  />
                  <span className="text-xs text-gray-500">
                    {mobileOnline > 0
                      ? `手机已连接 (${mobileOnline})`
                      : "等待手机连接"}
                  </span>
                </span>
              )}
              {connected && mobileOnline > 0 && (
                <span className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      mobileMode === "usb"
                        ? "bg-indigo-500"
                        : mobileMode === "lan"
                          ? "bg-emerald-500"
                          : "bg-gray-300"
                    }`}
                  />
                  <span className="text-xs text-gray-500">
                    {mobileMode === "usb"
                      ? "USB 模式"
                      : mobileMode === "lan"
                        ? "局域网模式"
                        : "连接方式未知"}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* 实时接收指示 */}
          <div className="flex items-center gap-2">
            {interimText && (
              <span className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                正在接收语音...
              </span>
            )}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setActiveTab("main")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              activeTab === "main"
                ? "bg-blue-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            主界面
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              activeTab === "settings"
                ? "bg-blue-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            设置
          </button>
        </div>
      </header>

      <main className="flex-1 p-6">
        {activeTab === "main" ? (
          <div className="mx-auto grid max-w-4xl gap-5">
            {/* 语音转文字 */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-700">
                  语音转文字（实时）
                </h2>
                <div className="flex gap-2">
                  {displayText && (
                    <>
                      <button
                        onClick={handleUseAsPrompt}
                        className="rounded-lg bg-green-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-600"
                      >
                        ↓ 填入提示词
                      </button>
                      <button
                        onClick={handleClearSTT}
                        className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-200"
                      >
                        清除
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div
                ref={sttRef}
                className="min-h-[120px] max-h-[300px] overflow-y-auto rounded-xl bg-gray-50 p-4"
              >
                {displayText ? (
                  <div className="whitespace-pre-wrap">
                    {finalText && (
                      <span className="text-sm leading-relaxed text-gray-800">
                        {finalText}
                      </span>
                    )}
                    {interimText && (
                      <span className="text-sm leading-relaxed italic text-blue-500">
                        {finalText ? "\n" : ""}
                        {interimText}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">
                    {mobileOnline > 0
                      ? "手机已连接，等待语音输入..."
                      : "等待手机连接后进行语音输入..."}
                  </p>
                )}
              </div>
            </section>

            {/* 提示词编辑 */}
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-gray-700">
                    提示词编辑
                  </h2>
                  {prompt && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">
                      {prompt.length} 字
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {prompt && (
                    <>
                      <button
                        onClick={handleCopyPrompt}
                        className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600"
                      >
                        复制
                      </button>
                      <button
                        onClick={handleClearPrompt}
                        className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-200"
                      >
                        清除
                      </button>
                    </>
                  )}
                </div>
              </div>
              <textarea
                ref={promptRef}
                className="w-full min-h-[200px] resize-y rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm leading-relaxed text-gray-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                placeholder={
                  mobileOnline > 0
                    ? "手机端输入的文字将实时同步到这里，也可以直接编辑..."
                    : "等待手机连接... 请在手机端设置中填入本机局域网地址"
                }
                value={prompt}
                onChange={(e) => handlePromptChange(e.target.value)}
              />

              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                <p className="mb-2 text-xs font-medium text-gray-600">发送到本机终端 AI 工具</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select
                    value={selectedTerminal}
                    onChange={(e) => setSelectedTerminal(e.target.value as "terminal")}
                    className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs text-gray-700"
                  >
                    {terminals.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} {item.installed ? "" : "(未安装)"}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedAiTool}
                    onChange={(e) =>
                      setSelectedAiTool(e.target.value as "codex" | "claude" | "gemini")
                    }
                    className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs text-gray-700"
                  >
                    {aiTools.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} {item.installed ? "" : "(未安装)"}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleSendPromptToTerminal}
                    disabled={!prompt.trim()}
                    className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    打开终端并注入提示词
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-gray-500">
                  会检测本机已安装 AI CLI（Codex/Claude/Gemini），并在终端启动对应工具后输入当前提示词。
                </p>
                {terminalActionMsg && (
                  <div
                    className={`mt-2 rounded-lg px-3 py-2 text-xs ${
                      terminalActionError
                        ? "bg-amber-50 text-amber-700"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {terminalActionMsg}
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="mx-auto grid max-w-4xl gap-5">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-700">Server 链接</h2>
                <div className="flex gap-2">
                  <button
                    onClick={handleToggleServer}
                    disabled={serverStatus === "starting" || serverStatus === "stopping"}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition ${
                      serverStatus === "running" || serverStatus === "starting"
                        ? "bg-red-500 hover:bg-red-600 disabled:opacity-60"
                        : "bg-blue-500 hover:bg-blue-600 disabled:opacity-60"
                    }`}
                  >
                    {serverButtonText}
                  </button>
                  <button
                    onClick={handleRefreshLanLinks}
                    className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
                  >
                    刷新地址
                  </button>
                </div>
              </div>

              <div className="mb-3 flex items-center gap-1.5">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    serverStatus === "running"
                      ? "bg-green-500"
                      : serverStatus === "starting" || serverStatus === "stopping"
                        ? "bg-yellow-400"
                        : serverStatus === "error"
                          ? "bg-red-500"
                          : "bg-gray-300"
                  }`}
                />
                <span className="text-xs text-gray-500">
                  {serverStatus === "running"
                    ? "服务端运行中"
                    : serverStatus === "starting"
                      ? "服务端启动中"
                      : serverStatus === "stopping"
                        ? "服务端停止中"
                        : serverStatus === "error"
                          ? "服务端异常"
                          : "服务端未启动"}
                </span>
              </div>

              <p className="mb-3 text-sm text-gray-500">
                手机端请在「我的 → 设置 → 桌面端连接」中填写以下任一局域网地址：
              </p>

              <div className="space-y-2">
                {lanLinks.length > 0 ? (
                  lanLinks.map((link) => (
                    <div
                      key={link}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                    >
                      <code className="text-xs text-gray-700">{link}</code>
                      <button
                        onClick={() => handleCopyLanLink(link)}
                        className="rounded bg-blue-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-600"
                      >
                        复制
                      </button>
                      <button
                        onClick={() => handleGenerateQr(link)}
                        className="rounded bg-emerald-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-600"
                      >
                        生成二维码
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    未检测到局域网地址，请确认电脑已连接 Wi-Fi/局域网后点击刷新。
                  </div>
                )}
              </div>

              {qrDataUrl && (
                <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs text-gray-500">扫码自动填入地址</p>
                    <button
                      onClick={() => setQrDataUrl("")}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      关闭
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <img
                      src={qrDataUrl}
                      alt="server link qrcode"
                      className="h-[140px] w-[140px] rounded-lg border border-gray-200 bg-white p-1"
                    />
                    <div className="text-xs text-gray-500">
                      <p className="mb-1 font-medium text-gray-700">当前二维码地址</p>
                      <code className="break-all">{qrSourceLink}</code>
                      <ol className="mt-3 list-decimal space-y-1 pl-4">
                        <li>手机打开「我的 → 设置」</li>
                        <li>点击「扫码填入地址」</li>
                        <li>扫描左侧二维码后即可自动填入</li>
                      </ol>
                    </div>
                  </div>
                </div>
              )}

              <ol className="mt-4 list-decimal space-y-1 pl-4 text-xs text-gray-500">
                <li>确保桌面端服务端状态为「运行中」。</li>
                <li>手机和电脑连接同一个 Wi-Fi（同一局域网）。</li>
                <li>手机点击「测试连接」，成功后保存。</li>
              </ol>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-700">
                  USB 有线连接（无局域网）
                </h2>
              </div>
              <p className="mb-3 text-sm text-gray-500">
                当公司内网无法访问局域网时，可通过 USB 端口转发让手机访问本机服务。
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-600">Android</p>
                  <code className="mt-2 block text-xs text-gray-700">
                    adb reverse tcp:3001 tcp:3001
                  </code>
                  <button
                    onClick={() =>
                      handleUsbCommand(
                        "android",
                        "adb reverse tcp:3001 tcp:3001",
                      )
                    }
                    className="mt-2 rounded-lg bg-blue-500 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-600"
                  >
                    打开终端并执行
                  </button>
                  <p className="mt-2 text-[11px] text-gray-400">
                    取消映射：adb reverse --remove tcp:3001
                  </p>
                </div>
                <div className="rounded-xl bg-gray-50 p-3">
                  <p className="text-xs font-medium text-gray-600">iOS</p>
                  <code className="mt-2 block text-xs text-gray-700">
                    iproxy 3001 3001
                  </code>
                  <button
                    onClick={() =>
                      handleUsbCommand("ios", "iproxy 3001 3001")
                    }
                    className="mt-2 rounded-lg bg-blue-500 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-blue-600"
                  >
                    打开终端并执行
                  </button>
                  <p className="mt-2 text-[11px] text-gray-400">
                    结束后按 Ctrl + C
                  </p>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                手机端请切换为 <code>http://127.0.0.1:3001</code> 后再测试连接。
              </div>
              {usbActionMsg && (
                <div
                  className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                    usbActionError
                      ? "bg-amber-50 text-amber-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {usbActionMsg}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-700">Server 日志</h2>
                <button
                  onClick={handleClearLogs}
                  className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
                >
                  清空
                </button>
              </div>
              <div className="max-h-[240px] overflow-y-auto rounded-lg bg-gray-900 p-3 font-mono text-[11px] leading-5 text-gray-100">
                {serverLogs.length > 0 ? (
                  serverLogs.map((line, idx) => <div key={`${idx}-${line}`}>{line}</div>)
                ) : (
                  <div className="text-gray-400">暂无日志，先启动服务端再测试讯飞识别。</div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* 底部状态 */}
      <footer className="border-t border-gray-100 bg-white px-6 py-3">
        <p className="text-center text-xs text-gray-400">
          服务地址: {SOCKET_URL} · 手机端请在「我的 → 设置」中填入电脑局域网 IP
        </p>
      </footer>
    </div>
  );
}

export default App;
