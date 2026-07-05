export interface STTAdapter {
  start(opts: {lang: string; onPartial?: (t: string) => void;
               onFinal: (t: string) => void}): Promise<void>;
  stop(): Promise<void>;
}
