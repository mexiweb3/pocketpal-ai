import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  initWhisper,
  initWhisperVad,
  type WhisperContext,
  type WhisperVadContext,
} from 'whisper.rn';
import {
  RealtimeTranscriber,
  RingBufferVad,
} from 'whisper.rn/realtime-transcription/index';
import type {AudioStreamInterface} from 'whisper.rn/realtime-transcription/index';

import type {STTAdapter} from './STTAdapter';
import {CompaAudioPcmStream} from './native/CompaAudioPcmStream';

const DEFAULT_WHISPER_MODEL_PATH =
  `${RNFS.DocumentDirectoryPath}/models/whisper/ggml-small-q5_1.bin`;
const DEFAULT_VAD_MODEL_PATH =
  `${RNFS.DocumentDirectoryPath}/models/whisper/ggml-silero-v6.2.0.bin`;
const FINAL_DEBOUNCE_MS = 350;
const FINAL_DEDUP_WINDOW_MS = 12_000;

function isSilenceHallucination(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¡!¿?.,…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === '' || normalized === 'gracias';
}

function dedupKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¡!¿?.,…;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class WhisperRnAdapter implements STTAdapter {
  private context: WhisperContext | null = null;
  private vadContext: WhisperVadContext | null = null;
  private realtimeVad: RingBufferVad | null = null;
  private transcriber: RealtimeTranscriber | null = null;
  private pendingFinalText: string | null = null;
  private pendingFinalTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFinalKey = '';
  private lastFinalAt = 0;

  constructor(
    private modelPath: string = DEFAULT_WHISPER_MODEL_PATH,
    private audioStream: AudioStreamInterface = new CompaAudioPcmStream(),
    private vadModelPath: string = DEFAULT_VAD_MODEL_PATH,
  ) {}

  async start(opts: {
    lang: string;
    onPartial?: (t: string) => void;
    onFinal: (t: string) => void;
  }): Promise<void> {
    if (!(await RNFS.exists(this.modelPath))) {
      throw new Error(
        `No existe el modelo Whisper en ${this.modelPath}. Copie un GGML Whisper ahi antes de usar Luna offline.`,
      );
    }
    if (!(await RNFS.exists(this.vadModelPath))) {
      throw new Error(
        `No existe el modelo VAD Silero en ${this.vadModelPath}. Copie ggml-silero-v6.2.0.bin ahi antes de usar Luna offline.`,
      );
    }

    if (!this.context) {
      this.context = await initWhisper({
        filePath: this.modelPath,
        useGpu: false,
      });
    }
    if (!this.vadContext) {
      this.vadContext = await initWhisperVad({
        filePath: this.vadModelPath,
        useGpu: false,
        nThreads: 2,
      });
    }
    this.realtimeVad = new RingBufferVad(this.vadContext, {
      vadPreset: 'default',
      vadOptions: {
        minSilenceDurationMs: 650,
        speechPadMs: 80,
        maxSpeechDurationS: 12,
      },
      preRecordingBufferMs: 1200,
      sampleRate: 16000,
      inferenceIntervalMs: 500,
      speechRateThreshold: 0.3,
      logger: () => {},
    });
    this.clearPendingFinal();
    this.lastFinalKey = '';
    this.lastFinalAt = 0;

    this.transcriber = new RealtimeTranscriber(
      {
        whisperContext: this.context,
        vadContext: this.realtimeVad,
        audioStream: this.audioStream,
      },
      {
        audioSliceSec: 8,
        audioMinSec: 1,
        maxSlicesInMemory: 3,
        transcribeOptions: {
          language: opts.lang,
          translate: false,
        },
        realtimeProcessingPauseMs: 700,
      },
      {
        onSliceTranscriptionStabilized: text => {
          const trimmed = text.trim();
          if (trimmed && !isSilenceHallucination(trimmed)) {
            this.queueFinal(trimmed, opts.onFinal);
          }
        },
        onTranscribe: event => {
          if (event.type !== 'transcribe') {
            return;
          }
          const text = event.data?.result?.trim();
          if (text && !isSilenceHallucination(text)) {
            opts.onPartial?.(text);
          }
        },
        onError: error => {
          console.warn('[WhisperRnAdapter] realtime transcription error:', error);
        },
      },
    );
    await this.transcriber.start();
  }

  async stop(): Promise<void> {
    this.clearPendingFinal();
    await this.transcriber?.stop();
    this.clearPendingFinal();
    this.transcriber = null;
    await this.realtimeVad?.reset();
  }

  async release(): Promise<void> {
    await this.stop();
    await this.context?.release();
    await this.vadContext?.release();
    this.context = null;
    this.vadContext = null;
    this.realtimeVad = null;
  }

  private queueFinal(text: string, onFinal: (t: string) => void): void {
    this.pendingFinalText = text;
    if (this.pendingFinalTimer) {
      clearTimeout(this.pendingFinalTimer);
    }
    this.pendingFinalTimer = setTimeout(() => {
      const finalText = this.pendingFinalText;
      this.clearPendingFinal();
      if (!finalText) {
        return;
      }
      const key = dedupKey(finalText);
      const now = Date.now();
      if (
        key &&
        key === this.lastFinalKey &&
        now - this.lastFinalAt < FINAL_DEDUP_WINDOW_MS
      ) {
        return;
      }
      this.lastFinalKey = key;
      this.lastFinalAt = now;
      onFinal(finalText);
    }, FINAL_DEBOUNCE_MS);
  }

  private clearPendingFinal(): void {
    if (this.pendingFinalTimer) {
      clearTimeout(this.pendingFinalTimer);
      this.pendingFinalTimer = null;
    }
    this.pendingFinalText = null;
  }
}
