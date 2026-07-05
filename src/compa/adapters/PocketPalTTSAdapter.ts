import type {SupertonicLanguage} from '@pocketpalai/react-native-speech';

import {
  getEngine,
  SUPERTONIC_VOICES,
  type StreamingHandle,
  type SupertonicEngine,
  type Voice,
} from '../../services/tts';
import {ttsStore} from '../../store/TTSStore';
import type {TTSAdapter} from './TTSAdapter';

const FINALIZE_IDLE_MS = 1200;

export class PocketPalTTSAdapter implements TTSAdapter {
  private handle: StreamingHandle | null = null;
  private handlePromise: Promise<StreamingHandle | null> | null = null;
  private finalizingHandle: StreamingHandle | null = null;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private voicePromise: Promise<Voice | null> | null = null;
  private speaking = false;
  private stopToken = 0;
  private doneListeners = new Set<() => void>();

  speakStreaming(textChunk: string): void {
    const chunk = textChunk.trim();
    if (!chunk) {
      return;
    }
    this.speaking = true;
    void this.append(chunk).catch(err => {
      console.warn('[PocketPalTTSAdapter] append failed:', err);
      this.finishIfIdle();
    });
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  onDone(callback: () => void): () => void {
    this.doneListeners.add(callback);
    return () => {
      this.doneListeners.delete(callback);
    };
  }

  stop(): void {
    this.stopToken += 1;
    if (this.finalizeTimer) {
      clearTimeout(this.finalizeTimer);
      this.finalizeTimer = null;
    }
    const pendingHandle = this.handlePromise;
    this.handlePromise = null;
    const handles = [this.handle, this.finalizingHandle].filter(
      (h): h is StreamingHandle => h != null,
    );
    this.handle = null;
    this.finalizingHandle = null;
    const wasSpeaking = this.speaking;
    this.speaking = false;
    handles.forEach(handle => {
      void handle.cancel();
    });
    void pendingHandle
      ?.then(handle => {
        if (handle) {
          void handle.cancel();
        }
      })
      .catch(err => {
        console.warn('[PocketPalTTSAdapter] pending handle cancel failed:', err);
      });
    void ttsStore.stop();
    if (wasSpeaking) {
      this.emitDone();
    }
  }

  private async append(textChunk: string): Promise<void> {
    const chunk = textChunk.trim();
    const token = this.stopToken;
    const handle = await this.getOrCreateHandle(token);
    if (!handle) {
      this.finishIfIdle();
      return;
    }
    if (token !== this.stopToken || this.handle !== handle || !this.speaking) {
      return;
    }

    handle.appendText(`${chunk} `);
    this.scheduleFinalize();
  }

  private async getOrCreateHandle(
    token: number,
  ): Promise<StreamingHandle | null> {
    if (this.handle) {
      return this.handle;
    }
    if (!this.handlePromise) {
      const promise = this.createHandle(token);
      this.handlePromise = promise;
      void promise
        .finally(() => {
          if (this.handlePromise === promise) {
            this.handlePromise = null;
          }
        })
        .catch(() => undefined);
    }
    return this.handlePromise;
  }

  private async createHandle(token: number): Promise<StreamingHandle | null> {
    const voice = await this.getVoice();
    if (!voice || token !== this.stopToken || !this.speaking) {
      return null;
    }
    const engine = getEngine(voice.engine);
    const stopDone = ttsStore.stop().catch(err => {
      console.warn('[PocketPalTTSAdapter] stop before stream failed:', err);
    });
    const handle =
      voice.engine === 'supertonic'
        ? (engine as SupertonicEngine).playStreaming(voice, stopDone, {
            language: 'es' as SupertonicLanguage,
            inferenceSteps: ttsStore.supertonicSteps,
          })
        : engine.playStreaming(voice, stopDone);
    if (token !== this.stopToken || !this.speaking) {
      void handle.cancel();
      return null;
    }
    this.handle = handle;
    return handle;
  }

  private scheduleFinalize(): void {
    if (this.finalizeTimer) {
      clearTimeout(this.finalizeTimer);
    }
    this.finalizeTimer = setTimeout(() => {
      const handle = this.handle;
      this.handle = null;
      this.finalizeTimer = null;
      if (!handle) {
        this.finishIfIdle();
        return;
      }
      this.finalizingHandle = handle;
      void handle
        .finalize()
        .catch(err => {
          console.warn('[PocketPalTTSAdapter] finalize failed:', err);
        })
        .finally(() => {
          if (this.finalizingHandle === handle) {
            this.finalizingHandle = null;
          }
          this.finishIfIdle();
        });
    }, FINALIZE_IDLE_MS);
  }

  private finishIfIdle(): void {
    if (
      this.handle ||
      this.handlePromise ||
      this.finalizingHandle ||
      this.finalizeTimer ||
      !this.speaking
    ) {
      return;
    }
    this.speaking = false;
    this.emitDone();
  }

  private emitDone(): void {
    for (const listener of Array.from(this.doneListeners)) {
      listener();
    }
  }

  private getVoice(): Promise<Voice | null> {
    if (!this.voicePromise) {
      this.voicePromise = this.resolveVoice();
    }
    return this.voicePromise;
  }

  private async resolveVoice(): Promise<Voice | null> {
    await ttsStore.init();
    const current = ttsStore.currentVoice;
    if (
      current &&
      current.language?.toLowerCase().startsWith('es') &&
      current.gender !== 'm'
    ) {
      return current;
    }

    const systemVoices = await getEngine('system').getVoices();
    const spanishSystemVoice =
      systemVoices.find(voice => {
        const language = voice.language?.toLowerCase() ?? '';
        const name = voice.name.toLowerCase();
        return (
          language.startsWith('es') &&
          !/(male|hombre|masculin|diego|jorge|juan|carlos|pablo)/.test(name)
        );
      }) ?? systemVoices.find(voice => voice.language?.toLowerCase().startsWith('es'));
    if (spanishSystemVoice) {
      return spanishSystemVoice;
    }

    if (await getEngine('supertonic').isInstalled()) {
      return SUPERTONIC_VOICES.find(voice => voice.gender === 'f') ?? null;
    }

    return current ?? systemVoices[0] ?? null;
  }
}
