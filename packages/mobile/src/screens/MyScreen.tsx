import { useState, useCallback, useRef, useEffect } from "react";
import {
  Text,
  View,
  Pressable,
  ScrollView,
  Modal,
  Switch,
  TextInput,
  ActivityIndicator,
  Keyboard,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import * as Network from "expo-network";
import StaticServer from "react-native-static-server";
import { useSettings } from "../context/SettingsContext";
import { ALL_ENGINE_OPTIONS, USB_SERVER_URL } from "../constants";

function Toast({ message, visible }: { message: string; visible: boolean }) {
  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible>
      <View
        style={StyleSheet.absoluteFillObject}
        className="items-center justify-center"
        pointerEvents="none"
      >
        <View className="max-w-[280px] rounded-2xl bg-black/85 px-7 py-5 shadow-lg">
          <Text className="text-center text-[14px] leading-5 text-white">
            {message}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

type ConnStatus = "idle" | "testing" | "ok" | "fail";
type InstallerStatus = "idle" | "starting" | "running" | "error";

function normalizeServerUrl(input: string) {
  const value = input.trim().replace(/\/+$/, "");
  if (!value) {
    return { ok: false as const, reason: "请输入服务器地址" };
  }
  if (!/^https?:\/\//i.test(value)) {
    return {
      ok: false as const,
      reason: "地址必须以 http:// 或 https:// 开头",
    };
  }
  try {
    const url = new URL(value);
    return {
      ok: true as const,
      url: `${url.protocol}//${url.host}`,
    };
  } catch {
    return { ok: false as const, reason: "地址格式无效" };
  }
}

export default function MyScreen() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const {
    engineVisibility,
    toggleEngine,
    serverUrl,
    setServerUrl,
    usbMode,
    setUsbMode,
    autoFill,
    setAutoFill,
    recordMode,
    setRecordMode,
    isHydrated,
  } = useSettings();

  const [urlDraft, setUrlDraft] = useState(serverUrl);
  const [connStatus, setConnStatus] = useState<ConnStatus>("idle");
  const [installerStatus, setInstallerStatus] = useState<InstallerStatus>("idle");
  const [installerUrl, setInstallerUrl] = useState("");
  const [installerLanUrl, setInstallerLanUrl] = useState("");
  const [installerError, setInstallerError] = useState("");
  const visibleCount = Object.values(engineVisibility).filter(Boolean).length;
  const insets = useSafeAreaInsets();
  const installerServerRef = useRef<StaticServer | null>(null);
  const installerPort = 8787;

  const installerAssets: {
    key: "win" | "mac";
    label: string;
    fileName: string;
    notesFileName: string;
    asset?: number;
    notesAsset?: number;
    downloadUrl?: string;
  }[] = [
    {
      key: "win",
      label: "Windows 安装包",
      fileName: "desktop-win.exe",
      notesFileName: "desktop-win.notes.txt",
      notesAsset: require("../../assets/installers/desktop-win.notes.txt"),
      downloadUrl: "https://github.com/qxdqhr/talkingTool/releases/latest",
    },
    {
      key: "mac",
      label: "macOS 安装包",
      fileName: "desktop-mac.dmg",
      notesFileName: "desktop-mac.notes.txt",
      notesAsset: require("../../assets/installers/desktop-mac.notes.txt"),
      downloadUrl: "https://github.com/qxdqhr/talkingTool/releases/latest",
    },
  ];

  useEffect(() => {
    if (settingsOpen) {
      setUrlDraft(serverUrl);
      setConnStatus("idle");
    }
  }, [settingsOpen, serverUrl]);

  useEffect(() => {
    if (settingsOpen) {
      setUrlDraft(serverUrl);
    }
  }, [serverUrl, settingsOpen]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      if (installerServerRef.current) {
        installerServerRef.current.stop();
        installerServerRef.current = null;
      }
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastVisible(false);
    }, 1800);
  }, []);

  const ensureInstallerFiles = useCallback(async () => {
    const baseDir = `${FileSystem.documentDirectory}installers`;
    await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
    const fileMap: {
      fileName: string;
      label: string;
      version: string;
      notes?: string;
      notesFileName?: string;
      downloadUrl?: string;
      hasLocal: boolean;
    }[] = [];

    const parseVersionFromFileName = (fileName: string) => {
      const match = fileName.match(/v?(\\d+\\.\\d+\\.\\d+(?:[-+._\\w]*)?)/i);
      return match?.[1] ?? "未知版本";
    };

    const escapeHtml = (input: string) =>
      input
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    for (const item of installerAssets) {
      let hasLocal = false;
      if (item.asset) {
        const asset = Asset.fromModule(item.asset);
        await asset.downloadAsync();
        if (asset.localUri) {
          const target = `${baseDir}/${item.fileName}`;
          const info = await FileSystem.getInfoAsync(target);
          if (!info.exists) {
            await FileSystem.copyAsync({ from: asset.localUri, to: target });
          }
          hasLocal = true;
        }
      }
      let notes: string | undefined;
      if (item.notesAsset && item.notesFileName) {
        const notesAsset = Asset.fromModule(item.notesAsset);
        await notesAsset.downloadAsync();
        if (notesAsset.localUri) {
          const notesTarget = `${baseDir}/${item.notesFileName}`;
          const notesInfo = await FileSystem.getInfoAsync(notesTarget);
          if (!notesInfo.exists) {
            await FileSystem.copyAsync({ from: notesAsset.localUri, to: notesTarget });
          }
          try {
            const rawNotes = await FileSystem.readAsStringAsync(notesTarget);
            if (rawNotes.trim()) {
              notes = escapeHtml(rawNotes.trim());
            }
          } catch {}
        }
      }
      fileMap.push({
        fileName: item.fileName,
        label: item.label,
        version: parseVersionFromFileName(item.fileName),
        notes,
        notesFileName: item.notesFileName,
        downloadUrl: item.downloadUrl,
        hasLocal,
      });
    }

    const rows = fileMap
      .map(
        (item) => {
          const notesBlock = item.notes
            ? `<details><summary>更新日志</summary><pre>${item.notes}</pre></details>`
            : `<div class="muted">更新日志：暂无</div>`;
          const linkTarget = item.hasLocal
            ? item.fileName
            : item.downloadUrl || "#";
          const linkLabel = item.hasLocal ? item.label : `${item.label}（跳转下载）`;
          const linkAttr = item.hasLocal ? "" : ' target="_blank" rel="noreferrer"';
          return `<li class="item">
  <div class="title">
    <a href="${linkTarget}"${linkAttr}>${linkLabel}</a>
    <span class="version">v${item.version}</span>
  </div>
  ${notesBlock}
</li>`;
        },
      )
      .join("");
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>桌面端安装包</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; padding: 24px; }
    .card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); max-width: 520px; margin: 0 auto; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { font-size: 13px; color: #475569; margin: 0 0 14px; }
    ul { margin: 0; padding-left: 0; list-style: none; }
    .item { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
    .title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    a { color: #2563eb; text-decoration: none; font-weight: 600; }
    .version { font-size: 12px; color: #64748b; }
    details { margin-top: 8px; }
    summary { cursor: pointer; font-size: 12px; color: #475569; }
    pre { white-space: pre-wrap; background: #f8fafc; border-radius: 8px; padding: 8px; font-size: 11px; color: #334155; }
    .muted { font-size: 11px; color: #94a3b8; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>桌面端安装包下载</h1>
    <p>请选择与你的电脑系统匹配的安装包下载并安装。</p>
    <ul>${rows}</ul>
  </div>
</body>
</html>`;
    await FileSystem.writeAsStringAsync(`${baseDir}/index.html`, html, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    return baseDir;
  }, [installerAssets]);

  const handleStartInstallerServer = useCallback(async () => {
    setInstallerError("");
    if (installerServerRef.current) {
      setInstallerStatus("running");
      return;
    }
    setInstallerStatus("starting");
    try {
      const baseDir = await ensureInstallerFiles();
      const server = new StaticServer(installerPort, baseDir, {
        localOnly: false,
      });
      const url = await server.start();
      installerServerRef.current = server;
      setInstallerStatus("running");
      setInstallerUrl(`http://127.0.0.1:${installerPort}/index.html`);
      setInstallerLanUrl("");
      try {
        const ip = await Network.getIpAddressAsync();
        if (ip) {
          setInstallerLanUrl(`http://${ip}:${installerPort}/index.html`);
        }
      } catch {}
      if (url) {
        // 保留 url 但不依赖库返回值
      }
    } catch (e: any) {
      setInstallerStatus("error");
      setInstallerError(e?.message ?? "启动失败");
    }
  }, [ensureInstallerFiles]);

  const handleStopInstallerServer = useCallback(() => {
    if (installerServerRef.current) {
      installerServerRef.current.stop();
      installerServerRef.current = null;
    }
    setInstallerStatus("idle");
  }, []);

  const handleSaveUrl = useCallback(() => {
    Keyboard.dismiss();
    if (usbMode) {
      showToast("USB 模式已开启，关闭后再保存局域网地址");
      return;
    }
    const normalized = normalizeServerUrl(urlDraft);
    if (!normalized.ok) {
      showToast(normalized.reason);
      return;
    }
    if (normalized.url === serverUrl) {
      showToast("地址未变化，无需保存");
      return;
    }

    setServerUrl(normalized.url);
    setUrlDraft(normalized.url);
    setConnStatus("idle");
    showToast("服务器地址已保存到本地");
  }, [urlDraft, serverUrl, setServerUrl, showToast, usbMode]);

  const runConnectionTest = useCallback(
    async (inputUrl: string, label?: string) => {
      Keyboard.dismiss();
      const normalized = normalizeServerUrl(inputUrl);
      if (!normalized.ok) {
        showToast(normalized.reason);
        return;
      }

      setConnStatus("testing");
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(
          `${normalized.url}/socket.io/?EIO=4&transport=polling`,
          { signal: controller.signal },
        );
        clearTimeout(timeout);

        if (res.ok) {
          setConnStatus("ok");
          showToast(label ? `${label}连接成功` : "连接成功，局域网可达");
        } else {
          setConnStatus("fail");
          showToast(`连接失败：HTTP ${res.status}`);
        }
      } catch (e: any) {
        setConnStatus("fail");
        if (e.name === "AbortError") {
          showToast("连接超时，请检查地址和网络");
        } else {
          showToast(`连接失败：${e.message}`);
        }
      }
    },
    [showToast],
  );

  const handleToggleUsbMode = useCallback(
    (value: boolean) => {
      setUsbMode(value);
      setConnStatus("idle");
      showToast(value ? "USB 模式已开启" : "USB 模式已关闭");
      if (value) {
        setTimeout(() => {
          void runConnectionTest(USB_SERVER_URL, "USB ");
        }, 200);
      }
    },
    [setUsbMode, showToast, runConnectionTest],
  );

  const handleTestConnection = useCallback(() => {
    return runConnectionTest(urlDraft);
  }, [runConnectionTest, urlDraft]);

  const handleOpenScanner = useCallback(async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        showToast("未授予相机权限，无法扫码");
        return;
      }
    }
    setHasScanned(false);
    setScanOpen(true);
  }, [cameraPermission?.granted, requestCameraPermission, showToast]);

  const handleScanned = useCallback(
    ({ data }: { data: string }) => {
      if (hasScanned) return;
      setHasScanned(true);
      const normalized = normalizeServerUrl(data);
      if (!normalized.ok) {
        showToast("二维码内容不是有效服务器地址");
        return;
      }
      setUrlDraft(normalized.url);
      setServerUrl(normalized.url);
      setConnStatus("idle");
      setScanOpen(false);
      showToast("扫码成功，地址已填入并保存");
    },
    [hasScanned, setServerUrl, showToast],
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerClassName="px-5 pt-14 pb-12"
    >
      <Text className="mb-8 text-3xl font-bold text-gray-800">我的</Text>

      <View className="rounded-2xl border border-gray-200 bg-white">
        <Pressable
          onPress={() => setSettingsOpen(true)}
          className="flex-row items-center justify-between px-4 py-4 active:bg-gray-50"
        >
          <View className="flex-row items-center gap-3.5">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-blue-50">
              <Text className="text-[18px]">⚙️</Text>
            </View>
            <View>
              <Text className="text-[15px] font-medium text-gray-800">设置</Text>
              <Text className="mt-0.5 text-xs text-gray-400">
                服务器连接、语音引擎
              </Text>
            </View>
          </View>
          <Text className="text-lg text-gray-300">›</Text>
        </Pressable>
      </View>

      <Modal
        visible={settingsOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View className="flex-1 bg-gray-50">
          <View
            className="bg-white border-b border-gray-100 px-4 pb-4"
            style={{ paddingTop: insets.top + 12 }}
          >
            <View className="relative h-10 flex-row items-center">
              <Pressable
                onPress={() => setSettingsOpen(false)}
                className="absolute left-0 z-10 h-10 w-10 items-center justify-center rounded-full active:bg-gray-100"
              >
                <Text className="text-[22px] text-gray-600">‹</Text>
              </Pressable>
              <View className="absolute left-0 right-0 h-10 items-center justify-center">
                <Text className="text-[17px] font-bold text-gray-800">设置</Text>
              </View>
            </View>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerClassName="px-5 pt-8 pb-16"
            keyboardShouldPersistTaps="handled"
          >
            <View className="mb-3 ml-1 flex-row items-center gap-2">
              <Text className="text-[13px] font-semibold tracking-wide text-gray-400">
                桌面端连接
              </Text>
              {!isHydrated && (
                <Text className="text-[11px] text-gray-300">恢复中...</Text>
              )}
            </View>

            <View className="mb-2 rounded-2xl border border-gray-200 bg-white p-4">
              <View className="mb-3 rounded-lg bg-gray-50 px-3 py-2.5">
                <Text className="text-[12px] text-gray-400">当前已保存</Text>
                <Text className="mt-1 text-[13px] text-gray-700">{serverUrl}</Text>
              </View>

              <Text className="mb-2 text-[13px] text-gray-500">新地址（局域网电脑）</Text>
              <TextInput
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[14px] text-gray-800"
                value={urlDraft}
                onChangeText={setUrlDraft}
                placeholder="http://192.168.x.x:3001"
                placeholderTextColor="#9ca3af"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                editable={!usbMode}
                onSubmitEditing={handleSaveUrl}
              />

              <View className="mt-3 flex-row gap-2.5">
                <Pressable
                  onPress={handleOpenScanner}
                  className="flex-1 items-center justify-center rounded-lg bg-emerald-500 py-2.5 active:bg-emerald-600"
                >
                  <Text className="text-[14px] font-medium text-white">
                    扫码填入地址
                  </Text>
                </Pressable>
              </View>

              <View className="mt-2 flex-row gap-2.5">
                <Pressable
                  onPress={handleTestConnection}
                  disabled={connStatus === "testing"}
                  className={`flex-1 flex-row items-center justify-center gap-2 rounded-lg py-2.5 ${
                    connStatus === "testing"
                      ? "bg-gray-100"
                      : connStatus === "ok"
                        ? "bg-green-50 active:bg-green-100"
                        : connStatus === "fail"
                          ? "bg-red-50 active:bg-red-100"
                          : "bg-blue-50 active:bg-blue-100"
                  }`}
                >
                  {connStatus === "testing" ? (
                    <ActivityIndicator size="small" color="#3b82f6" />
                  ) : (
                    <Text className="text-[13px]">
                      {connStatus === "ok"
                        ? "✅"
                        : connStatus === "fail"
                          ? "❌"
                          : "📡"}
                    </Text>
                  )}
                  <Text
                    className={`text-[14px] font-medium ${
                      connStatus === "testing"
                        ? "text-gray-400"
                        : connStatus === "ok"
                          ? "text-green-600"
                          : connStatus === "fail"
                            ? "text-red-600"
                            : "text-blue-600"
                    }`}
                  >
                    测试连接
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handleSaveUrl}
                  disabled={usbMode}
                  className="flex-1 items-center justify-center rounded-lg bg-blue-500 py-2.5 active:bg-blue-600"
                >
                  <Text className="text-[14px] font-medium text-white">
                    保存并应用
                  </Text>
                </Pressable>
              </View>
            </View>

            <View className="mb-2 rounded-2xl border border-gray-200 bg-white p-4">
              <View className="mb-2 flex-row items-center justify-between">
                <View className="mr-3 flex-1">
                  <Text className="text-[13px] font-medium text-gray-800">
                    USB 模式
                  </Text>
                  <Text className="mt-1 text-[12px] leading-4 text-gray-400">
                    通过 USB 端口转发连接桌面端（无局域网时使用）。
                  </Text>
                </View>
                <Switch
                  value={usbMode}
                  onValueChange={handleToggleUsbMode}
                  trackColor={{ false: "#d1d5db", true: "#86efac" }}
                  thumbColor={usbMode ? "#22c55e" : "#f4f4f5"}
                />
              </View>
              <View className="mb-2">
                <Text className="text-[13px] font-medium text-gray-800">
                  USB 有线连接
                </Text>
                <Text className="mt-1 text-[12px] leading-4 text-gray-400">
                  在公司内网无法使用 Wi-Fi 时，使用 USB 端口转发连接桌面端。
                </Text>
              </View>

              <View className="rounded-lg bg-gray-50 px-3 py-2">
                <Text className="text-[12px] text-gray-400">Android 命令</Text>
                <Text className="mt-1 text-[12px] text-gray-700">
                  adb reverse tcp:3001 tcp:3001
                </Text>
              </View>

              <View className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
                <Text className="text-[12px] text-gray-400">iOS 命令</Text>
                <Text className="mt-1 text-[12px] text-gray-700">
                  iproxy 3001 3001
                </Text>
              </View>

              <View className="mt-3 rounded-lg bg-indigo-50 px-3 py-2">
                <Text className="text-[12px] text-indigo-600">
                  当前 USB 地址：{USB_SERVER_URL}
                </Text>
              </View>
            </View>

            <View className="mb-2 rounded-2xl border border-gray-200 bg-white p-4">
              <View className="mb-2">
                <Text className="text-[13px] font-medium text-gray-800">
                  桌面端安装包分发页
                </Text>
                <Text className="mt-1 text-[12px] leading-4 text-gray-400">
                  在电脑浏览器打开下方地址即可下载桌面端安装包。
                </Text>
              </View>

              <View className="rounded-lg bg-gray-50 px-3 py-2">
                <Text className="text-[12px] text-gray-400">局域网访问</Text>
                <Text className="mt-1 text-[12px] text-gray-700">
                  {installerLanUrl || "尚未启动"}
                </Text>
              </View>

              <View className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
                <Text className="text-[12px] text-gray-400">USB 访问</Text>
                <Text className="mt-1 text-[12px] text-gray-700">
                  {installerUrl || `http://127.0.0.1:${installerPort}/index.html`}
                </Text>
              </View>

              <View className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
                <Text className="text-[12px] text-gray-400">Android 命令</Text>
                <Text className="mt-1 text-[12px] text-gray-700">
                  adb forward tcp:{installerPort} tcp:{installerPort}
                </Text>
              </View>

              <View className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
                <Text className="text-[12px] text-gray-400">iOS 命令</Text>
                <Text className="mt-1 text-[12px] text-gray-700">
                  iproxy {installerPort} {installerPort}
                </Text>
              </View>

              {installerError ? (
                <Text className="mt-2 text-[12px] text-red-500">
                  {installerError}
                </Text>
              ) : null}

              <View className="mt-3 flex-row gap-2">
                <Pressable
                  onPress={handleStartInstallerServer}
                  disabled={installerStatus === "starting"}
                  className={`flex-1 items-center justify-center rounded-lg py-2.5 ${
                    installerStatus === "running"
                      ? "bg-emerald-500 active:bg-emerald-600"
                      : "bg-blue-500 active:bg-blue-600"
                  }`}
                >
                  <Text className="text-[14px] font-medium text-white">
                    {installerStatus === "running" ? "分发中" : "启动分发页"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={handleStopInstallerServer}
                  className="flex-1 items-center justify-center rounded-lg bg-gray-100 py-2.5 active:bg-gray-200"
                >
                  <Text className="text-[14px] font-medium text-gray-600">
                    停止分发
                  </Text>
                </Pressable>
              </View>
            </View>

            <View className="mb-3 ml-1 mt-8 flex-row items-center gap-2">
              <Text className="text-[13px] font-semibold tracking-wide text-gray-400">
                录音设置
              </Text>
            </View>

            <View className="mb-2 rounded-2xl border border-gray-200 bg-white">
              <View className="flex-row items-center justify-between px-4 py-4 border-b border-gray-100">
                <View className="mr-4 flex-1">
                  <Text className="text-[15px] font-medium text-gray-800">
                    自动填入提示词
                  </Text>
                  <Text className="mt-1 text-[12px] leading-4 text-gray-400">
                    识别结果自动追加到提示词编辑区
                  </Text>
                </View>
                <Switch
                  value={autoFill}
                  onValueChange={setAutoFill}
                  trackColor={{ false: "#d1d5db", true: "#86efac" }}
                  thumbColor={autoFill ? "#22c55e" : "#f4f4f5"}
                />
              </View>

              <View className="flex-row items-center justify-between px-4 py-4">
                <View className="mr-4 flex-1">
                  <Text className="text-[15px] font-medium text-gray-800">
                    录音方式（按住/开关）
                  </Text>
                  <Text className="mt-1 text-[12px] leading-4 text-gray-400">
                    开关模式启用后点击开始，再次点击结束
                  </Text>
                </View>
                <Switch
                  value={recordMode === "toggle"}
                  onValueChange={(value) =>
                    setRecordMode(value ? "toggle" : "hold")
                  }
                  trackColor={{ false: "#d1d5db", true: "#86efac" }}
                  thumbColor={recordMode === "toggle" ? "#22c55e" : "#f4f4f5"}
                />
              </View>
            </View>

            <View className="mb-3 ml-1 mt-8 flex-row items-center gap-2">
              <Text className="text-[13px] font-semibold tracking-wide text-gray-400">
                语音识别引擎
              </Text>
              <Pressable
                onPress={() =>
                  showToast("控制首页下拉菜单中显示哪些引擎，至少保留一项")
                }
                className="h-[18px] w-[18px] items-center justify-center rounded-full bg-gray-200"
              >
                <Text className="text-[11px] font-bold text-gray-500">?</Text>
              </Pressable>
            </View>

            <View className="mb-2 rounded-lg bg-amber-50 px-3 py-2">
              <Text className="text-[12px] leading-4 text-amber-700">
                讯飞引擎需要原生模块支持，请使用 Development Build 运行（例如
                `npx expo run:android`），Expo Go 中不可用。
              </Text>
            </View>

            <View className="mb-2 rounded-lg bg-amber-50 px-3 py-2">
              <Text className="text-[12px] leading-4 text-amber-700">
                讯飞引擎通过“官方 WebSocket + 本地服务端适配层”工作，请先在服务端
                配置 IFLYTEK_APP_ID / IFLYTEK_API_KEY / IFLYTEK_API_SECRET。
              </Text>
            </View>

            <View className="rounded-2xl border border-gray-200 bg-white">
              {ALL_ENGINE_OPTIONS.map((opt, idx) => {
                const isVisible = engineVisibility[opt.key];
                const isLast = visibleCount === 1 && isVisible;
                const isEnd = idx === ALL_ENGINE_OPTIONS.length - 1;

                return (
                  <View
                    key={opt.key}
                    className={`flex-row items-center justify-between px-4 py-4 ${
                      !isEnd ? "border-b border-gray-100" : ""
                    }`}
                  >
                    <View className="mr-4 flex-1">
                      <Text className="text-[15px] font-medium text-gray-800">
                        {opt.label}
                      </Text>
                      <Text className="mt-1 text-[12px] leading-4 text-gray-400">
                        {opt.desc}
                      </Text>
                    </View>
                    <Switch
                      value={isVisible}
                      onValueChange={() => toggleEngine(opt.key)}
                      disabled={isLast}
                      trackColor={{ false: "#d1d5db", true: "#86efac" }}
                      thumbColor={isVisible ? "#22c55e" : "#f4f4f5"}
                    />
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <Toast message={toastMsg} visible={toastVisible} />

          <Modal visible={scanOpen} animationType="slide" onRequestClose={() => setScanOpen(false)}>
            <View className="flex-1 bg-black">
              <View
                className="absolute left-0 right-0 top-0 z-10 flex-row items-center justify-between px-4 pb-3"
                style={{ paddingTop: insets.top + 10 }}
              >
                <Pressable
                  onPress={() => setScanOpen(false)}
                  className="rounded-full bg-black/40 px-3 py-1.5"
                >
                  <Text className="text-sm text-white">关闭</Text>
                </Pressable>
                <Text className="text-sm font-medium text-white">扫描桌面端二维码</Text>
                <View className="w-14" />
              </View>

              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={handleScanned}
              />

              <View className="absolute bottom-10 left-6 right-6 rounded-xl bg-black/45 px-4 py-3">
                <Text className="text-center text-xs leading-5 text-white">
                  将桌面端「设置 → Server 链接」生成的二维码放入取景框
                </Text>
              </View>
            </View>
          </Modal>
        </View>
      </Modal>
    </ScrollView>
  );
}
