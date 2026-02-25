declare module "@fugood/react-native-audio-pcm-stream" {
  type AudioInitOptions = {
    sampleRate?: number;
    channels?: 1 | 2;
    bitsPerSample?: 8 | 16;
    audioSource?: number;
    bufferSize?: number;
  };

  type AudioDataSubscription = { remove: () => void };

  const AudioRecord: {
    init: (options: AudioInitOptions) => void;
    start: () => void;
    stop: () => void;
    on: (event: "data", callback: (chunkBase64: string) => void) => AudioDataSubscription;
  };

  export default AudioRecord;
}
