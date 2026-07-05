declare module 'react-native/Libraries/Blob/Blob' {
  class Blob {
    constructor(parts: Array<Blob | string>);

    get size(): number;
  }

  export default Blob;
}

declare module '*.png' {
  const value: any;
  export default value;
}

declare module '*.svg' {
  import React from 'react';
  import {SvgProps} from 'react-native-svg';
  const content: React.FC<SvgProps>;
  export default content;
}

declare module 'whisper.rn' {
  export type TranscribeOptions = {
    language?: string;
    translate?: boolean;
    [key: string]: unknown;
  };

  export type TranscribeResult = {
    result?: string;
    segments?: unknown[];
  };

  export type VadOptions = {
    threshold?: number;
    minSpeechDurationMs?: number;
    minSilenceDurationMs?: number;
    maxSpeechDurationS?: number;
    speechPadMs?: number;
    samplesOverlap?: number;
  };

  export interface WhisperContext {
    transcribeData(
      data: string | ArrayBuffer,
      options?: TranscribeOptions,
    ): {
      stop: () => Promise<void>;
      promise: Promise<TranscribeResult>;
    };
    release(): Promise<void>;
  }

  export interface WhisperVadContext {
    detectSpeechData(
      data: string | ArrayBuffer,
      options?: VadOptions,
    ): Promise<Array<{t0: number; t1: number}>>;
    release(): Promise<void>;
  }

  export function initWhisper(options: {
    filePath: string | number;
    isBundleAsset?: boolean;
    useGpu?: boolean;
    useCoreMLIos?: boolean;
    useFlashAttn?: boolean;
  }): Promise<WhisperContext>;

  export function initWhisperVad(options: {
    filePath: string | number;
    isBundleAsset?: boolean;
    useGpu?: boolean;
    nThreads?: number;
  }): Promise<WhisperVadContext>;
}

declare module 'whisper.rn/realtime-transcription/index' {
  import type {
    TranscribeOptions,
    TranscribeResult,
    VadOptions,
    WhisperContext,
    WhisperVadContext,
  } from 'whisper.rn';

  export interface AudioStreamData {
    data: Uint8Array;
    sampleRate: number;
    channels: number;
    timestamp: number;
  }

  export interface AudioStreamConfig {
    sampleRate?: number;
    channels?: number;
    bitsPerSample?: number;
    bufferSize?: number;
    audioSource?: number;
  }

  export interface AudioStreamInterface {
    initialize(config: AudioStreamConfig): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    isRecording(): boolean;
    onData(callback: (data: AudioStreamData) => void): void;
    onError(callback: (error: string) => void): void;
    onStatusChange(callback: (isRecording: boolean) => void): void;
    onEnd?(callback: () => void): void;
    release(): Promise<void>;
  }

  export interface RealtimeTranscribeEvent {
    type: 'start' | 'transcribe' | 'end' | 'error';
    sliceIndex: number;
    data?: TranscribeResult;
    isCapturing: boolean;
    processTime: number;
    recordingTime: number;
  }

  export class RealtimeTranscriber {
    constructor(
      dependencies: {
        whisperContext: WhisperContext;
        audioStream: AudioStreamInterface;
        vadContext?: unknown;
        fs?: unknown;
      },
      options?: {
        audioSliceSec?: number;
        audioMinSec?: number;
        maxSlicesInMemory?: number;
        transcribeOptions?: TranscribeOptions;
        realtimeProcessingPauseMs?: number;
      },
      callbacks?: {
        onSliceTranscriptionStabilized?: (text: string) => void;
        onTranscribe?: (event: RealtimeTranscribeEvent) => void;
        onError?: (error: string) => void;
      },
    );
    start(): Promise<void>;
    stop(): Promise<void>;
  }

  export class RingBufferVad {
    constructor(
      vadContext: WhisperVadContext,
      options?: {
        vadOptions?: VadOptions;
        vadPreset?: string;
        preRecordingBufferMs?: number;
        sampleRate?: number;
        inferenceIntervalMs?: number;
        speechRateThreshold?: number;
        logger?: (message: string) => void;
      },
    );
    reset(): Promise<void>;
  }
}
