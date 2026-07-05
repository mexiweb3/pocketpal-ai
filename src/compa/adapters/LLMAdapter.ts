export type Msg = {role: 'system' | 'user' | 'assistant'; content: string};

// DEFAULT v1: LlamaRnAdapter sobre llama.rn on-device (Qwen2.5-3B-Instruct Q4_K_M).
// LATENTE/DESHABILITADO: OpenAICompatAdapter contra endpoint local OpenAI-compatible.
export interface LLMAdapter {
  completion(messages: Msg[], opts: {nPredict: number; temperature: number;
             stop?: string[]},
             onToken: (tok: string) => boolean /* false = cancelar */): Promise<string>;
}
