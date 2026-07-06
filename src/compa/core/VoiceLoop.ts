/**
 * VoiceLoop — el corazón del Compa.
 * Orquesta: STTAdapter → safety/tools → LLMAdapter(streaming)
 *           → TTSAdapter(oración por oración) → barge-in.
 *
 * El core no importa internals de PocketPal ni runtimes concretos. Las
 * implementaciones default viven detrás de adapters: llama.rn on-device para
 * LLM v1, STT/TTS/notification/memory como integraciones verificables aparte.
 */
import type {
  LLMAdapter,
  MemoryAdapter,
  Msg,
  NotificationAdapter,
  STTAdapter,
  TTSAdapter,
} from '../adapters';
import {extractFactsFromSession} from '../memory/factExtractor';
import {
  classifyTurn,
  fireEmergency,
  type EmergencyRecorder,
  type TurnIntent,
} from './safetyLayer';

export type LoopState = 'idle' | 'listening' | 'thinking' | 'speaking';
type Turn = {role: 'user' | 'assistant'; content: string};
type ToolName = Extract<TurnIntent, {type: 'tool'}>['tool'];

export type ToolRunner = (tool: ToolName) => Promise<string>;
export type SystemPromptBuilder = () => Promise<string>;

export interface VoiceLoopAdapters {
  stt: STTAdapter;
  llm: LLMAdapter;
  tts: TTSAdapter;
  notification: NotificationAdapter;
  memory: MemoryAdapter;
}

export interface VoiceLoopOptions {
  onState: (s: LoopState) => void; // para la UI (cara/indicador)
  buildSystemPrompt: SystemPromptBuilder;
  runTool: ToolRunner;
  recordEmergency?: EmergencyRecorder;
  /** Transcript para la UI de chat: se emite para turnos de voz Y de texto. */
  onUserTurn?: (text: string) => void;
  /** Respuesta en streaming (texto acumulado hasta ahora). */
  onAssistantDelta?: (textSoFar: string) => void;
  /** Respuesta final del turno (ya persistida en historial). */
  onAssistantTurn?: (text: string) => void;
  /** Fallo de un turno (LLM caido, contexto ocupado, etc.) para mostrarlo
   *  en la UI en vez de tragarlo en silencio. */
  onTurnError?: (error: unknown) => void;
}

const WINDOW_TURNS = 12; // ventana de historial para el 4B
const SESSION_IDLE_MS = 5 * 60_000;
const SPEECH_DONE_TIMEOUT_MS = 30_000;

export class VoiceLoop {
  private state: LoopState = 'idle';
  private history: Turn[] = [];
  private sessionId = `s_${Date.now()}`;
  private memorySessionStarted = false;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private turnPromise: Promise<void> = Promise.resolve();
  private turnSerial = 0;
  private stopListening: () => Promise<void> = async () => {};
  private destroyed = false;
  private voiceActive = false;

  constructor(
    private adapters: VoiceLoopAdapters,
    private options: VoiceLoopOptions,
  ) {}

  /** Arranca escucha por adapter. El loop decide el half-duplex:
   *  solo acepta STT mientras está en listening. */
  async start(): Promise<void> {
    if (this.destroyed) return;
    await this.startMemorySession();
    if (this.destroyed) return;
    // voiceActive ANTES del await: si un turno de texto termina mientras
    // Whisper inicializa, su restingState() ya debe decir 'listening' (si no,
    // el mic quedaria encendido pero sordo: state='idle' gatea los finales).
    this.voiceActive = true;
    this.setState('listening');
    try {
      await this.startStt();
    } catch (e) {
      this.voiceActive = false;
      this.setState('idle');
      throw e;
    }
  }

  private async startStt(): Promise<void> {
    await this.adapters.stt.start({
      lang: 'es',
      onPartial: text => {
        if (this.destroyed || !text.trim() || !this.acceptsSttInput()) return;
        console.log('[VoiceLoop] parcial:', JSON.stringify(text.slice(0, 80)));
      },
      onFinal: text => {
        const trimmed = text.trim();
        if (this.destroyed || !trimmed) return;
        if (!this.acceptsSttInput()) {
          console.warn(
            '[VoiceLoop] final DESCARTADO (state=' + this.state + '):',
            JSON.stringify(trimmed.slice(0, 80)),
          );
          return;
        }
        console.log('[VoiceLoop] final aceptado:', JSON.stringify(trimmed));
        this.enqueueUtterance(trimmed, {speak: true, echoUser: true});
      },
    });
    console.log('[VoiceLoop] STT iniciado; esperando voz');
    this.stopListening = () => this.adapters.stt.stop();
  }

  /** Apaga solo el modo voz (STT + TTS en curso); el chat de texto sigue vivo. */
  async stopVoice(): Promise<void> {
    if (this.destroyed || !this.voiceActive) return;
    this.voiceActive = false;
    this.generation += 1;
    this.adapters.tts.stop();
    try {
      await this.stopListening();
    } catch (e) {
      console.warn('[VoiceLoop] No se pudo detener STT', e);
    }
    this.stopListening = async () => {};
    this.setState('idle');
  }

  /** Entrada de texto (chat): mismo cerebro que la voz — safety, tools,
   *  carta, memoria — pero sin exigir microfono. Solo habla la respuesta
   *  si el modo voz esta activo; la UI siempre la recibe via callbacks. */
  submitText(text: string): void {
    const trimmed = text.trim();
    if (this.destroyed || !trimmed) return;
    // echoUser:false — la UI de chat ya pinto el mensaje del usuario al enviarlo.
    this.enqueueUtterance(trimmed, {speak: this.voiceActive, echoUser: false});
  }

  private acceptsSttInput(): boolean {
    return this.state === 'listening';
  }

  private restingState(): LoopState {
    return this.voiceActive ? 'listening' : 'idle';
  }

  private enqueueUtterance(
    text: string,
    opts: {speak: boolean; echoUser?: boolean},
  ): void {
    if (this.destroyed) return;
    const previousTurn = this.turnPromise;
    const turnSerial = ++this.turnSerial;
    // Barge-in SOLO en modo voz. En chat puro, un segundo mensaje del usuario
    // no debe cancelar la respuesta en curso al primero: los turnos ya se
    // serializan via turnPromise y ambas respuestas llegan.
    if (this.voiceActive) {
      this.interrupt('thinking');
    } else {
      this.setState('thinking');
    }

    const turn = (async () => {
      await previousTurn.catch(() => undefined);
      if (this.destroyed) return;
      await this.handleUtterance(text, opts);
    })();

    this.turnPromise = turn
      .catch(e => {
        console.warn('[VoiceLoop] Fallo al procesar turno', e);
        if (!this.destroyed) {
          this.options.onTurnError?.(e);
        }
      })
      .finally(() => {
        if (
          !this.destroyed &&
          turnSerial === this.turnSerial &&
          this.state !== 'idle'
        ) {
          this.setState(this.restingState());
        }
      });
  }

  private async handleUtterance(
    text: string,
    opts: {speak: boolean; echoUser?: boolean},
  ): Promise<void> {
    if (this.destroyed) return;
    this.resetIdleTimer();
    this.history.push({role: 'user', content: text});
    if (opts.echoUser) {
      this.options.onUserTurn?.(text);
    }
    await this.persistTurn({role: 'user', content: text}, this.history.length);
    if (this.destroyed) return;

    // 1) Safety / tools — sin LLM
    const intent = classifyTurn(text);
    if (intent.type === 'emergency') {
      const emergency = await fireEmergency(
        text,
        intent.rule,
        this.adapters.notification,
        this.options.recordEmergency,
      );
      if (this.destroyed) return;
      this.history.push({role: 'assistant', content: emergency.reply});
      await this.persistTurn(
        {role: 'assistant', content: emergency.reply},
        this.history.length,
      );
      this.options.onAssistantTurn?.(emergency.reply);
      return this.deliverReply(emergency.reply, opts.speak);
    }
    if (intent.type === 'tool') {
      const reply = await this.runTool(intent.tool);
      if (this.destroyed) return;
      this.history.push({role: 'assistant', content: reply});
      await this.persistTurn(
        {role: 'assistant', content: reply},
        this.history.length,
      );
      this.options.onAssistantTurn?.(reply);
      return this.deliverReply(reply, opts.speak);
    }

    // 2) LLM con streaming: oración-por-oración → TTS (voz) y delta → UI (chat)
    this.setState('thinking');
    const myGen = ++this.generation;
    const system = await this.options.buildSystemPrompt();
    if (this.isGenerationCancelled(myGen)) return;

    let pending = '';
    let fullReply = '';
    let lastDeltaAt = 0;
    const speakChunk = (chunk: string) => {
      // Re-verificar voiceActive al MOMENTO de hablar: opts.speak se congelo
      // al encolar y el usuario pudo apagar el mic mientras tanto.
      if (!opts.speak || !this.voiceActive) return;
      if (this.isGenerationCancelled(myGen) || !chunk.trim()) return;
      this.setState('speaking');
      this.adapters.tts.speakStreaming(chunk);
    };

    const messages: Msg[] = [
      {role: 'system', content: system},
      ...this.history.slice(-WINDOW_TURNS),
    ];

    const result = await this.adapters.llm.completion(
      messages,
      {
        nPredict: 160, // respuestas cortas por contrato
        temperature: 0.8,
        stop: ['SEÑOR:', '\n\n'],
      },
      tok => {
        if (this.isGenerationCancelled(myGen)) return false; // corta generación
        pending += tok;
        fullReply += tok;
        // Throttle del delta a la UI (~6/s): un re-render por token satura un
        // telefono modesto. onAssistantTurn hace el flush final completo.
        const now = Date.now();
        if (now - lastDeltaAt >= 150) {
          lastDeltaAt = now;
          this.options.onAssistantDelta?.(fullReply);
        }
        // despacha al TTS en cuanto hay oración completa
        const m = pending.match(/^(.+?[.!?…])\s/s);
        if (m) {
          speakChunk(m[1]);
          pending = pending.slice(m[0].length);
        }
        return true;
      },
    );

    fullReply = fullReply || result;
    const cancelled = this.isGenerationCancelled(myGen);
    if (!cancelled && pending.trim()) speakChunk(pending);
    // Persistir TAMBIEN el parcial de un turno cancelado (barge-in/stopVoice):
    // lo que Luna alcanzo a decir queda en historial y la burbuja draft de la
    // UI se finaliza en vez de quedar fantasma.
    if (fullReply.trim()) {
      const assistantTurn = {
        role: 'assistant' as const,
        content: fullReply.trim(),
      };
      this.history.push(assistantTurn);
      await this.persistTurn(assistantTurn, this.history.length);
      this.options.onAssistantTurn?.(assistantTurn.content);
    }
    if (opts.speak && this.voiceActive && !this.isGenerationCancelled(myGen)) {
      await this.waitForSpeechDone(myGen);
    }
    if (!this.isGenerationCancelled(myGen)) {
      this.setState(this.restingState());
    }
  }

  /** Entrega una respuesta ya lista: por voz si el modo voz SIGUE activo al
   *  momento de entregarla, y regresa al estado de reposo. */
  private async deliverReply(text: string, speak: boolean): Promise<void> {
    if (this.destroyed) return;
    if (speak && this.voiceActive) {
      return this.speak(text);
    }
    this.setState(this.restingState());
  }

  private async runTool(tool: ToolName): Promise<string> {
    try {
      const reply = await this.options.runTool(tool);
      const trimmed = reply.trim();
      if (trimmed) {
        return trimmed;
      }
      if (tool === 'reminders_today') {
        return 'Permítame, no pude revisar sus recordatorios ahorita.';
      }
      return 'Permítame, reviso.';
    } catch (e) {
      console.warn('[VoiceLoop] Falló tool local', {tool, error: e});
      if (tool === 'reminders_today') {
        return 'Permítame, no pude revisar sus recordatorios ahorita.';
      }
      return 'Permítame, reviso. No pude completar eso ahorita.';
    }
  }

  private async speak(text: string): Promise<void> {
    if (this.destroyed) return;
    const myGen = this.generation;
    this.setState('speaking');
    this.adapters.tts.speakStreaming(text);
    await this.waitForSpeechDone(myGen);
    if (!this.isGenerationCancelled(myGen)) {
      this.setState(this.restingState());
    }
  }

  /** Barge-in: el papá interrumpe → se calla y se cancela generación. */
  private interrupt(nextState: LoopState = 'listening'): void {
    if (this.destroyed) return;
    this.generation += 1;
    this.adapters.tts.stop();
    this.setState(nextState);
  }

  /** Cierre de sesión: extracción de memoria con el mismo LLMAdapter. */
  private resetIdleTimer(): void {
    if (this.destroyed) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.destroyed) void this.endSession();
    }, SESSION_IDLE_MS);
  }

  private async startMemorySession(): Promise<void> {
    if (this.destroyed || this.memorySessionStarted) return;
    try {
      this.sessionId = await this.adapters.memory.startSession(this.sessionId);
      if (this.destroyed) return;
      this.memorySessionStarted = true;
    } catch (e) {
      console.warn('[VoiceLoop] No se pudo iniciar sesión de memoria', e);
    }
  }

  private async persistTurn(turn: Turn, turnIndex: number): Promise<void> {
    if (this.destroyed) return;
    try {
      await this.startMemorySession();
      if (this.destroyed) return;
      await this.adapters.memory.appendMessage(this.sessionId, {
        role: turn.role,
        content: turn.content,
        turnIndex,
        createdAt: Date.now(),
      });
      this.memorySessionStarted = true;
    } catch (e) {
      console.warn('[VoiceLoop] No se pudo persistir turno', e);
    }
  }

  async endSession(): Promise<void> {
    if (this.destroyed) return;
    if (this.history.length >= 2) {
      await extractFactsFromSession(
        this.adapters.llm,
        this.adapters.memory,
        this.history,
        this.sessionId,
      );
    }
    if (this.destroyed) return;
    this.history = [];
    this.sessionId = `s_${Date.now()}`;
    this.memorySessionStarted = false;
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.generation += 1;
    this.voiceActive = false;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    this.destroyed = true;
    this.adapters.tts.stop();
    try {
      await this.stopListening();
    } catch (e) {
      console.warn('[VoiceLoop] No se pudo detener STT al destruir', e);
    }
    await this.turnPromise.catch(() => undefined);
    await this.endSession();
    this.history = [];
    this.sessionId = `s_${Date.now()}`;
    this.memorySessionStarted = false;
    this.state = 'idle';
  }

  private setState(s: LoopState): void {
    if (this.destroyed) return;
    this.state = s;
    this.options.onState(s);
  }

  private isGenerationCancelled(generation: number): boolean {
    return this.destroyed || generation !== this.generation;
  }

  private async waitForSpeechDone(generation: number): Promise<void> {
    if (this.isGenerationCancelled(generation) || !this.adapters.tts.isSpeaking()) {
      return;
    }
    let unsubscribe: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const donePromise = new Promise<'done'>(resolve => {
      unsubscribe = this.adapters.tts.onDone(() => resolve('done'));
    });
    const timeoutPromise = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), SPEECH_DONE_TIMEOUT_MS);
    });
    if (
      this.isGenerationCancelled(generation) ||
      !this.adapters.tts.isSpeaking()
    ) {
      unsubscribe();
      if (timer) clearTimeout(timer);
      return;
    }
    const result = await Promise.race([donePromise, timeoutPromise]);
    unsubscribe();
    if (timer) clearTimeout(timer);
    if (
      result === 'timeout' &&
      !this.isGenerationCancelled(generation) &&
      this.adapters.tts.isSpeaking()
    ) {
      console.warn('[VoiceLoop] TTS no terminó a tiempo; cancelando audio');
      this.adapters.tts.stop();
    }
  }
}
