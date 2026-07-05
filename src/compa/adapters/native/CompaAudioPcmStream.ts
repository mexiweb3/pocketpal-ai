import {NativeEventEmitter, NativeModules} from 'react-native';
import {toByteArray} from 'base64-js';
import type {
  AudioStreamConfig,
  AudioStreamData,
  AudioStreamInterface,
} from 'whisper.rn/realtime-transcription';

type NativeAudioPcmStream = {
  initialize(config: AudioStreamConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRecording(): Promise<boolean>;
  release(): Promise<void>;
};

type NativeDataEvent = {
  data: string;
  sampleRate: number;
  channels: number;
  timestamp: number;
};

const nativeModule = NativeModules.CompaAudioPcmStream as
  | NativeAudioPcmStream
  | undefined;
const emitter = nativeModule ? new NativeEventEmitter(nativeModule as any) : null;

export class CompaAudioPcmStream implements AudioStreamInterface {
  private recording = false;
  private dataCallback: (data: AudioStreamData) => void = () => {};
  private errorCallback: (error: string) => void = () => {};
  private statusCallback: (isRecording: boolean) => void = () => {};
  private endCallback: () => void = () => {};
  private subscriptions: Array<{remove: () => void}> = [];

  async initialize(config: AudioStreamConfig): Promise<void> {
    if (!nativeModule || !emitter) {
      throw new Error('CompaAudioPcmStream native module no esta disponible.');
    }
    await nativeModule.initialize(config);
    this.subscriptions = [
      emitter.addListener('CompaAudioPcmStreamData', (event: NativeDataEvent) => {
        this.dataCallback({
          data: toByteArray(event.data),
          sampleRate: event.sampleRate,
          channels: event.channels,
          timestamp: event.timestamp,
        });
      }),
      emitter.addListener('CompaAudioPcmStreamError', (event: {error: string}) => {
        this.errorCallback(event.error);
      }),
      emitter.addListener(
        'CompaAudioPcmStreamStatus',
        (event: {isRecording: boolean}) => {
          this.recording = event.isRecording;
          this.statusCallback(event.isRecording);
          if (!event.isRecording) {
            this.endCallback();
          }
        },
      ),
    ];
  }

  async start(): Promise<void> {
    if (!nativeModule) {
      throw new Error('CompaAudioPcmStream native module no esta disponible.');
    }
    await nativeModule.start();
    this.recording = true;
  }

  async stop(): Promise<void> {
    if (!nativeModule) {
      return;
    }
    await nativeModule.stop();
    this.recording = false;
  }

  isRecording(): boolean {
    return this.recording;
  }

  onData(callback: (data: AudioStreamData) => void): void {
    this.dataCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.errorCallback = callback;
  }

  onStatusChange(callback: (isRecording: boolean) => void): void {
    this.statusCallback = callback;
  }

  onEnd(callback: () => void): void {
    this.endCallback = callback;
  }

  async release(): Promise<void> {
    this.subscriptions.forEach(subscription => subscription.remove());
    this.subscriptions = [];
    await nativeModule?.release();
    this.recording = false;
  }
}
