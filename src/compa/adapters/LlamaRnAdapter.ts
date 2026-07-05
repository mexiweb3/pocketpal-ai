import {modelStore} from '../../store/ModelStore';
import {LUNA_QWEN_MODEL_ID} from '../../store/builtinPalModels';
import type {LLMAdapter, Msg} from './LLMAdapter';

export class LlamaRnAdapter implements LLMAdapter {
  private async ensureEngine() {
    if (modelStore.engine) {
      return modelStore.engine;
    }

    const qwen = modelStore.models.find(model => model.id === LUNA_QWEN_MODEL_ID);
    if (!qwen) {
      throw new Error('Qwen2.5-3B-Instruct no esta registrado en ModelStore.');
    }
    if (!qwen.isDownloaded && !qwen.isLocal) {
      throw new Error(
        'Qwen2.5-3B-Instruct Q4_K_M debe estar descargado antes de usar Luna en modo avion.',
      );
    }
    await modelStore.selectModel(qwen);
    if (!modelStore.engine) {
      throw new Error('No se pudo cargar el contexto llama.rn para Luna.');
    }
    return modelStore.engine;
  }

  async completion(
    messages: Msg[],
    opts: {nPredict: number; temperature: number; stop?: string[]},
    onToken: (tok: string) => boolean,
  ): Promise<string> {
    const engine = await this.ensureEngine();
    let stopped = false;
    let lastAccumulated = '';

    modelStore.setInferencing(true);
    modelStore.setIsStreaming(true);

    const completionPromise = engine.completion(
      {
        messages,
        n_predict: opts.nPredict,
        temperature: opts.temperature,
        stop: opts.stop,
      },
      data => {
        let token = data.token;
        if (!token && data.accumulated_text) {
          token = data.accumulated_text.startsWith(lastAccumulated)
            ? data.accumulated_text.slice(lastAccumulated.length)
            : data.accumulated_text;
          lastAccumulated = data.accumulated_text;
        }
        if (!token) {
          return;
        }
        const keepGoing = onToken(token);
        if (!keepGoing && !stopped) {
          stopped = true;
          void engine.stopCompletion();
        }
      },
    );

    modelStore.registerCompletionPromise(completionPromise);
    try {
      const result = await completionPromise;
      return result.text || result.content || lastAccumulated;
    } finally {
      modelStore.clearCompletionPromise();
      modelStore.setInferencing(false);
      modelStore.setIsStreaming(false);
    }
  }
}
