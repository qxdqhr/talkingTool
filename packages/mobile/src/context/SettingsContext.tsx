import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ALL_ENGINE_OPTIONS,
  DEFAULT_SERVER_URL,
  USB_SERVER_URL,
  type STTEngine,
} from "../constants";

interface SettingsContextValue {
  /** 各引擎的可见性 */
  engineVisibility: Record<STTEngine, boolean>;
  /** 切换某个引擎的可见性 */
  toggleEngine: (key: STTEngine) => void;
  /** 当前可见的引擎选项列表 */
  visibleEngineOptions: typeof ALL_ENGINE_OPTIONS;
  /** 服务器地址 */
  serverUrl: string;
  /** 修改服务器地址 */
  setServerUrl: (url: string) => void;
  /** USB 模式 */
  usbMode: boolean;
  /** 切换 USB 模式 */
  setUsbMode: (value: boolean) => void;
  /** 自动填入提示词 */
  autoFill: boolean;
  /** 修改自动填入 */
  setAutoFill: (value: boolean) => void;
  /** 录音方式 */
  recordMode: "hold" | "toggle";
  /** 修改录音方式 */
  setRecordMode: (mode: "hold" | "toggle") => void;
  /** 设置是否已经从本地恢复 */
  isHydrated: boolean;
}

type PersistedSettings = {
  engineVisibility: Record<STTEngine, boolean>;
  serverUrl: string;
  usbMode?: boolean;
  lastLanUrl?: string;
  autoFill?: boolean;
  recordMode?: "hold" | "toggle";
};

const SETTINGS_STORAGE_KEY = "talkingTool.mobile.settings.v1";

const DEFAULT_ENGINE_VISIBILITY: Record<STTEngine, boolean> = {
  system: true,
  iflytek: true,
  "whisper-tiny": true,
  "whisper-base": true,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function normalizeEngineVisibility(
  value?: Partial<Record<STTEngine, boolean>>,
): Record<STTEngine, boolean> {
  const merged = {
    ...DEFAULT_ENGINE_VISIBILITY,
    ...value,
  };
  if (!Object.values(merged).some(Boolean)) {
    return DEFAULT_ENGINE_VISIBILITY;
  }
  return merged;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [engineVisibility, setEngineVisibility] = useState<
    Record<STTEngine, boolean>
  >(DEFAULT_ENGINE_VISIBILITY);
  const [serverUrl, setServerUrlState] = useState(DEFAULT_SERVER_URL);
  const [usbMode, setUsbModeState] = useState(false);
  const [lastLanUrl, setLastLanUrl] = useState(DEFAULT_SERVER_URL);
  const [autoFill, setAutoFill] = useState(false);
  const [recordMode, setRecordMode] = useState<"hold" | "toggle">("hold");
  const [isHydrated, setIsHydrated] = useState(false);

  // 首次加载时从本地缓存恢复设置
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw) as PersistedSettings;
        if (cancelled) return;

        setEngineVisibility(normalizeEngineVisibility(parsed.engineVisibility));

        const parsedServer =
          typeof parsed.serverUrl === "string" && parsed.serverUrl.trim()
            ? parsed.serverUrl.trim()
            : "";

        if (typeof parsed.lastLanUrl === "string" && parsed.lastLanUrl.trim()) {
          setLastLanUrl(parsed.lastLanUrl.trim());
        } else if (parsedServer && parsedServer !== USB_SERVER_URL) {
          setLastLanUrl(parsedServer);
        }

        if (typeof parsed.usbMode === "boolean") {
          setUsbModeState(parsed.usbMode);
        }

        if (parsed.usbMode) {
          setServerUrlState(USB_SERVER_URL);
        } else if (parsedServer) {
          setServerUrlState(parsedServer);
        }

        if (typeof parsed.autoFill === "boolean") {
          setAutoFill(parsed.autoFill);
        }

        if (parsed.recordMode === "hold" || parsed.recordMode === "toggle") {
          setRecordMode(parsed.recordMode);
        }
      } catch {
        // 忽略损坏缓存，继续使用默认值
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
    }

    hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  // 当设置变化时写入本地缓存
  useEffect(() => {
    if (!isHydrated) return;

    const data: PersistedSettings = {
      engineVisibility,
      serverUrl,
      usbMode,
      lastLanUrl,
      autoFill,
      recordMode,
    };

    AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data)).catch(() => {
      // 缓存失败不阻塞主流程
    });
  }, [engineVisibility, serverUrl, autoFill, recordMode, isHydrated]);

  const toggleEngine = useCallback((key: STTEngine) => {
    setEngineVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      const visibleCount = Object.values(next).filter(Boolean).length;
      if (visibleCount === 0) return prev;
      return next;
    });
  }, []);

  const visibleEngineOptions = useMemo(
    () => ALL_ENGINE_OPTIONS.filter((opt) => engineVisibility[opt.key]),
    [engineVisibility],
  );

  const setServerUrl = useCallback(
    (url: string) => {
      const next = url.trim();
      if (!next) return;
      setServerUrlState(next);
      if (next === USB_SERVER_URL) {
        setUsbModeState(true);
      } else {
        setUsbModeState(false);
        setLastLanUrl(next);
      }
    },
    [],
  );

  const setUsbMode = useCallback(
    (value: boolean) => {
      setUsbModeState(value);
      if (value) {
        setServerUrlState(USB_SERVER_URL);
      } else {
        setServerUrlState(lastLanUrl || DEFAULT_SERVER_URL);
      }
    },
    [lastLanUrl],
  );

  const value = useMemo(
    () => ({
      engineVisibility,
      toggleEngine,
      visibleEngineOptions,
      serverUrl,
      setServerUrl,
      usbMode,
      setUsbMode,
      autoFill,
      setAutoFill,
      recordMode,
      setRecordMode,
      isHydrated,
    }),
    [
      engineVisibility,
      toggleEngine,
      visibleEngineOptions,
      serverUrl,
      setServerUrl,
      usbMode,
      setUsbMode,
      autoFill,
      setAutoFill,
      recordMode,
      setRecordMode,
      isHydrated,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
