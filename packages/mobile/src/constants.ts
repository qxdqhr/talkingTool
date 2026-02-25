export const DEFAULT_SERVER_URL = "http://192.168.0.100:3001";
export const USB_SERVER_URL = "http://127.0.0.1:3001";

export type STTEngine =
  | "system"
  | "iflytek"
  | "whisper-tiny"
  | "whisper-base";

export const ALL_ENGINE_OPTIONS: {
  key: STTEngine;
  label: string;
  desc: string;
}[] = [
  { key: "system", label: "系统语音识别", desc: "依赖 Google 服务，需联网" },
  {
    key: "iflytek",
    label: "讯飞语音识别（在线）",
    desc: "适合中文场景，需原生构建并联网",
  },
  {
    key: "whisper-tiny",
    label: "Whisper Tiny（离线）",
    desc: "体积小，速度快，精度一般（74MB）",
  },
  {
    key: "whisper-base",
    label: "Whisper Base（离线）",
    desc: "体积适中，精度更高（141MB）",
  },
];

export const WHISPER_MODELS: Record<
  "whisper-tiny" | "whisper-base",
  { asset: number; label: string }
> = {
  "whisper-tiny": {
    asset: require("../assets/ggml-tiny.bin"),
    label: "Whisper Tiny（离线）",
  },
  "whisper-base": {
    asset: require("../assets/ggml-base.bin"),
    label: "Whisper Base（离线）",
  },
};
