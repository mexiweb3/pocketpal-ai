export interface TTSAdapter {
  speakStreaming(textChunk: string): void;  // encola por oración
  isSpeaking(): boolean;
  onDone(callback: () => void): () => void;
  stop(): void;                              // barge-in
}
