import { useEffect, useState, useRef, useCallback } from "react";
import {
  Text,
  View,
  Pressable,
  ScrollView,
  TextInput,
  Platform,
  LogBox,
} from "react-native";
import { io, Socket } from "socket.io-client";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { IflytekSTT, type AudioRecorder } from "sa2kit/iflytek";
import { useSettings } from "../context/SettingsContext";
import { type STTEngine } from "../constants";

let _audioRecorder: AudioRecorder | null = null;
async function getAudioRecorder(): Promise<AudioRecorder> {
  if (_audioRecorder) return _audioRecorder;
  LogBox.ignoreLogs([
    "`new NativeEventEmitter()` was called with a non-null argument without the required `addListener` method.",
    "`new NativeEventEmitter()` was called with a non-null argument without the required `removeListeners` method.",
  ]);
  const mod = await import("@fugood/react-native-audio-pcm-stream");
  _audioRecorder = (mod.default ?? mod) as AudioRecorder;
  return _audioRecorder;
}

export default function HomeScreen() {
  const { visibleEngineOptions, serverUrl, autoFill, recordMode, usbMode } =
    useSettings();

  const [connected, setConnected] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<STTEngine>(
    () => visibleEngineOptions[0]?.key ?? "system",
  );
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const sttScrollRef = useRef<ScrollView>(null);
  const permissionGrantedRef = useRef(false);
  const autoFillRef = useRef(autoFill);
  const engineRef = useRef<STTEngine>(engine);
  const handleFinalResultRef = useRef<(text: string) => void>(() => {});
  const handleInterimResultRef = useRef<(text: string) => void>(() => {});

  // sa2kit 讯飞 STT 实例
  const sttRef = useRef<IflytekSTT | null>(null);

  useEffect(() => {
    autoFillRef.current = autoFill;
  }, [autoFill]);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);

  useEffect(() => {
    const isCurrentVisible = visibleEngineOptions.some(
      (o) => o.key === engine,
    );
    if (!isCurrentVisible && visibleEngineOptions.length > 0) {
      setEngine(visibleEngineOptions[0].key);
    }
  }, [visibleEngineOptions, engine]);

  const displayText =
    finalText + (interimText ? (finalText ? "\n" : "") + interimText : "");

  // ========== Socket 连接 ==========
  useEffect(() => {
    const socket = io(serverUrl);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("register", { type: "mobile", mode: usbMode ? "usb" : "lan" });
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("prompt:update", (data: { content: string }) => {
      setPrompt(data.content);
    });
    socket.on("stt:clear", () => {
      setFinalText("");
      setInterimText("");
    });

    return () => {
      // 切换 serverUrl 时释放旧的 STT 实例
      sttRef.current?.dispose();
      sttRef.current = null;
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [serverUrl, usbMode]);

  useEffect(() => {
    if (connected && socketRef.current) {
      socketRef.current.emit("register", {
        type: "mobile",
        mode: usbMode ? "usb" : "lan",
      });
    }
  }, [usbMode, connected]);

  const appendToPrompt = useCallback((text: string) => {
    setPrompt((prev) => {
      const newPrompt = prev ? prev + "\n" + text : text;
      socketRef.current?.emit("prompt:update", { content: newPrompt });
      return newPrompt;
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(
      () => sttScrollRef.current?.scrollToEnd({ animated: true }),
      50,
    );
  }, []);

  // ========== 通用结果处理 ==========
  const handleFinalResult = useCallback(
    (transcript: string) => {
      setFinalText((prev) => (prev ? prev + "\n" + transcript : transcript));
      setInterimText("");
      socketRef.current?.emit("stt:chunk", {
        sessionId:
          engineRef.current === "iflytek"
            ? sttRef.current?.sessionId
            : undefined,
        text: transcript,
        isFinal: true,
      });
      if (autoFillRef.current) {
        appendToPrompt(transcript);
      }
      scrollToBottom();
    },
    [appendToPrompt, scrollToBottom],
  );

  const handleInterimResult = useCallback(
    (transcript: string) => {
      setInterimText(transcript);
      socketRef.current?.emit("stt:chunk", {
        sessionId:
          engineRef.current === "iflytek"
            ? sttRef.current?.sessionId
            : undefined,
        text: transcript,
        isFinal: false,
      });
      scrollToBottom();
    },
    [scrollToBottom],
  );

  useEffect(() => {
    handleFinalResultRef.current = handleFinalResult;
    handleInterimResultRef.current = handleInterimResult;
  }, [handleFinalResult, handleInterimResult]);

  // ========== 系统语音识别事件 ==========
  useSpeechRecognitionEvent("start", () => {
    if (engine === "system") {
      setRecognizing(true);
      setError(null);
    }
  });

  useSpeechRecognitionEvent("end", () => {
    if (engine === "system") {
      setRecognizing(false);
      setInterimText("");
    }
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (engine !== "system") return;
    const transcript = event.results[0]?.transcript ?? "";
    if (event.isFinal) {
      handleFinalResult(transcript);
    } else {
      handleInterimResult(transcript);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (engine !== "system") return;
    if (event.error === "aborted") return;
    if (event.error === "network") {
      setError("网络错误：Google 语音服务不可达，请切换到讯飞引擎");
    } else {
      setError(`${event.error}: ${event.message}`);
    }
  });

  // ========== 按住录音：开始 ==========
  const startRecording = useCallback(async () => {
    if (recognizing) return;
    if (!permissionGrantedRef.current) {
      const result =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        setError("未授予麦克风/语音识别权限");
        return;
      }
      permissionGrantedRef.current = true;
    }

    setInterimText("");
    setError(null);

    if (engine === "system") {
      const supportsLocal =
        ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      ExpoSpeechRecognitionModule.start({
        lang: "zh-CN",
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        requiresOnDeviceRecognition: supportsLocal,
        ...(Platform.OS === "android" && {
          androidIntentOptions: {
            EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 10000,
            EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 60000,
            EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 10000,
          },
        }),
      });
    } else if (engine === "iflytek") {
      try {
        const recorder = await getAudioRecorder();
        const socket = socketRef.current;
        if (!socket) {
          setError("未连接到服务器");
          return;
        }

        // 每次 pressIn 创建新的 IflytekSTT 实例（确保状态干净）
        sttRef.current?.dispose();
        const stt = new IflytekSTT({
          transport: socket,
          recorder,
          debug: true,
        });
        stt.on({
          onInterimResult: (text) => handleInterimResultRef.current(text),
          onFinalResult: (text) => {
            handleFinalResultRef.current(text);
            setRecognizing(false);
          },
          onPhaseChange: (phase) => {
            if (phase === "idle") setRecognizing(false);
          },
          onError: (msg) => {
            setError(msg);
            setRecognizing(false);
          },
        });
        sttRef.current = stt;

        if (stt.start()) {
          setRecognizing(true);
        }
      } catch (e: any) {
        setRecognizing(false);
        setError(
          `讯飞适配层不可用：${e?.message ?? "请使用 Development Build"}`,
        );
      }
    }
  }, [
    engine,
    handleInterimResult,
    recognizing,
  ]);

  // ========== 按住录音：结束 ==========
  const stopRecording = useCallback(() => {
    if (engine === "iflytek") {
      sttRef.current?.stop();
      return;
    }

    if (!recognizing) return;
    if (engine === "system") {
      ExpoSpeechRecognitionModule.stop();
    }
  }, [recognizing, engine]);

  // ========== 其他操作 ==========
  const handleClearSTT = useCallback(() => {
    setFinalText("");
    setInterimText("");
    socketRef.current?.emit("stt:clear");
  }, []);

  const handlePromptChange = useCallback((text: string) => {
    setPrompt(text);
    socketRef.current?.emit("prompt:update", { content: text });
  }, []);

  const handleUseAsPrompt = useCallback(() => {
    const text = finalText || displayText;
    if (text) {
      handlePromptChange(prompt ? `${prompt}\n${text}` : text);
    }
  }, [finalText, displayText, prompt, handlePromptChange]);

  const currentLabel =
    visibleEngineOptions.find((o) => o.key === engine)?.label ?? "选择引擎";

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerClassName="px-5 pt-14 pb-6"
    >
      {/* 标题栏 */}
      <View className="mb-5 flex-row items-center justify-between">
        <View>
          <Text className="text-2xl font-bold text-gray-800">
            AI 提示词优化工具
          </Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <View
              className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-400"}`}
            />
            <Text className="text-xs text-gray-500">
              {connected ? "已连接" : "未连接"}
            </Text>
            <View className="mx-1 h-3 w-px bg-gray-200" />
            <View
              className={`rounded-full px-2 py-0.5 ${
                usbMode ? "bg-indigo-100" : "bg-emerald-100"
              }`}
            >
              <Text
                className={`text-[10px] font-medium ${
                  usbMode ? "text-indigo-600" : "text-emerald-600"
                }`}
              >
                {usbMode ? "USB 模式" : "局域网模式"}
              </Text>
            </View>
          </View>
        </View>
        {recognizing && (
          <View className="flex-row items-center gap-1.5 rounded-full bg-red-100 px-3 py-1.5">
            <View className="h-2.5 w-2.5 rounded-full bg-red-500" />
            <Text className="text-xs font-medium text-red-600">录音中</Text>
          </View>
        )}
      </View>

      {/* 语音转文字区域 */}
      <View className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-base font-semibold text-gray-700">
            语音转文字
          </Text>
          {displayText ? (
            <Pressable onPress={handleClearSTT}>
              <Text className="text-xs text-gray-400">清除</Text>
            </Pressable>
          ) : null}
        </View>

        {/* 引擎选择下拉菜单 */}
        {visibleEngineOptions.length > 1 && (
          <View className="relative mb-3 z-50">
            <Pressable
              onPress={() => setEngineMenuOpen(!engineMenuOpen)}
              className="flex-row items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5"
            >
              <Text className="text-sm text-gray-700">{currentLabel}</Text>
              <Text className="text-xs text-gray-400">
                {engineMenuOpen ? "▲" : "▼"}
              </Text>
            </Pressable>

            {engineMenuOpen && (
              <View className="absolute left-0 right-0 top-[44px] rounded-lg border border-gray-200 bg-white shadow-lg">
                {visibleEngineOptions.map((opt) => (
                  <Pressable
                    key={opt.key}
                    onPress={() => {
                      setEngine(opt.key);
                      setEngineMenuOpen(false);
                    }}
                    className={`px-3 py-2.5 ${
                      opt.key === engine ? "bg-blue-50" : ""
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        opt.key === engine
                          ? "font-medium text-blue-600"
                          : "text-gray-700"
                      }`}
                    >
                      {opt.label}
                    </Text>
                    {opt.desc && (
                      <Text className="mt-0.5 text-xs text-gray-400">
                        {opt.desc}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {visibleEngineOptions.length === 1 && (
          <View className="mb-3 rounded-lg bg-gray-50 px-3 py-2.5">
            <Text className="text-sm text-gray-500">{currentLabel}</Text>
          </View>
        )}

        {/* STT 文本显示 */}
        <ScrollView
          ref={sttScrollRef}
          className="mb-3 min-h-[100px] max-h-[220px] rounded-xl bg-gray-50 px-4 py-3"
        >
          {displayText ? (
            <View>
              {finalText ? (
                <Text className="text-sm leading-5 text-gray-800">
                  {finalText}
                </Text>
              ) : null}
              {interimText ? (
                <Text className="text-sm leading-5 italic text-blue-500">
                  {interimText}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text className="text-sm text-gray-400">
              {recognizing
                ? "正在聆听，请说话..."
                : recordMode === "toggle"
                  ? "点击下方按钮开始语音输入"
                  : "按住下方按钮开始语音输入"}
            </Text>
          )}
        </ScrollView>

        {error && (
          <Text className="mb-3 text-xs text-red-500">{error}</Text>
        )}

        {/* 按钮 */}
        <View className="gap-2.5">
          <Pressable
            onPress={
              recordMode === "toggle"
                ? () => {
                    if (recognizing) {
                      stopRecording();
                    } else {
                      void startRecording();
                    }
                  }
                : undefined
            }
            onPressIn={
              recordMode === "hold"
                ? () => {
                    void startRecording();
                  }
                : undefined
            }
            onPressOut={recordMode === "hold" ? stopRecording : undefined}
            className={`items-center justify-center rounded-xl py-4 ${
              recognizing
                ? "bg-red-500 active:bg-red-600"
                : "bg-blue-500 active:bg-blue-600"
            }`}
          >
            <Text className="text-base font-semibold text-white">
              {recordMode === "toggle"
                ? recognizing
                  ? "🎤 点击停止"
                  : "🎤 点击录音"
                : recognizing
                  ? "🎤 松开结束"
                  : "🎤 按住录音"}
            </Text>
            {!recognizing && (
              <Text className="mt-0.5 text-xs text-blue-200">
                {recordMode === "toggle"
                  ? "点击开始，再次点击结束"
                  : "按住说话，松开结束"}
              </Text>
            )}
          </Pressable>

          {!autoFill && displayText && !recognizing ? (
            <Pressable
              onPress={handleUseAsPrompt}
              className="items-center justify-center rounded-xl bg-green-500 py-3 active:bg-green-600"
            >
              <Text className="text-sm font-medium text-white">
                ↓ 填入提示词
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* 提示词编辑 */}
      <View className="rounded-2xl border border-gray-200 bg-white p-4">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-base font-semibold text-gray-700">
            提示词编辑
          </Text>
          {prompt ? (
            <Pressable onPress={() => handlePromptChange("")}>
              <Text className="text-xs text-gray-400">清除</Text>
            </Pressable>
          ) : null}
        </View>
        <TextInput
          className="min-h-[120px] rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-5 text-gray-800"
          placeholder="在此编辑提示词，内容将同步到桌面端..."
          placeholderTextColor="#9ca3af"
          value={prompt}
          onChangeText={handlePromptChange}
          multiline
          textAlignVertical="top"
        />
      </View>
    </ScrollView>
  );
}
