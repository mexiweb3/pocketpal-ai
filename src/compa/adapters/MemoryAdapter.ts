export type Fact = {
  id?: number;
  fact: string;
  category: string;
  salience: number;
  confidence?: number;
  supersedes?: string | null;
};

export type TranscriptRole = 'system' | 'user' | 'assistant';

export type TranscriptTurn = {
  role: TranscriptRole;
  content: string;
  turnIndex?: number;
  createdAt?: number;
};

export type TranscriptSession = {
  id: string;
  startedAt: number;
  endedAt?: number | null;
  turnCount: number;
};

export type TranscriptMessage = {
  id: number;
  sessionId: string;
  role: TranscriptRole;
  content: string;
  turnIndex: number;
  createdAt: number;
};

export interface MemoryAdapter {
  getFactsForPrompt(n: number): Promise<Fact[]>;
  addFacts(facts: Fact[], sessionId: string): Promise<void>; // valida JSON + dedup
  auditFacts(): Promise<Fact[]>;          // listar para revisión humana
  editFact(id: number, patch: Partial<Fact>): Promise<void>;
  deleteFact(id: number): Promise<void>;  // borrar memoria sensible
  startSession(sessionId?: string): Promise<string>;
  appendMessage(sessionId: string, turn: TranscriptTurn): Promise<void>;
  saveTranscript(sessionId: string, turns: TranscriptTurn[]): Promise<void>;
  getTranscript(sessionId: string): Promise<TranscriptMessage[]>;
  listSessions(limit?: number): Promise<TranscriptSession[]>;
}
