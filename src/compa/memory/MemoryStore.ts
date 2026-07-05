/**
 * SqliteMemoryStore — memoria local del Compa.
 * Guarda transcripts completos por sesion y hechos auditables para inyeccion
 * selectiva al prompt.
 */
import type {Fact, MemoryAdapter} from '../adapters';

export type SqliteResult = {rows?: any[] | {_array?: any[]; length?: number; item?: (i: number) => any}};
export type SqliteExecutor = {
  executeAsync(sql: string, params?: Array<string | number | null>): Promise<SqliteResult>;
};

const missingExecutor: SqliteExecutor = {
  async executeAsync(): Promise<SqliteResult> {
    throw new Error('SqliteMemoryStore requiere un SqliteExecutor del fork de PocketPal.');
  },
};

export type FactCategory =
  | 'salud' | 'familia' | 'gustos' | 'historia' | 'estado_animo' | 'otro';

export interface CompaFact {
  id: number;
  fact: string;
  category: FactCategory;
  salience: number; // 1-5
  confidence: number; // 0-1
  createdAt: number;
}

export type TranscriptRole = 'system' | 'user' | 'assistant';

export interface CompaSession {
  id: string;
  startedAt: number;
  endedAt?: number | null;
  turnCount: number;
}

export interface CompaMessage {
  id: number;
  sessionId: string;
  role: TranscriptRole;
  content: string;
  turnIndex: number;
  createdAt: number;
}

export type TranscriptTurn = {
  role: TranscriptRole;
  content: string;
  turnIndex?: number;
  createdAt?: number;
};

const MAX_INJECTED_FACTS = 20;
const MAX_ACTIVE_FACTS = 200;
const VALID_CATEGORIES: FactCategory[] = [
  'salud',
  'familia',
  'gustos',
  'historia',
  'estado_animo',
  'otro',
];

function rowsFrom<T>(result: any): T[] {
  const rows = result?.rows;
  if (!rows) return [];
  if (Array.isArray(rows)) return rows as T[];
  if (Array.isArray(rows._array)) return rows._array as T[];
  if (typeof rows.length === 'number' && typeof rows.item === 'function') {
    return Array.from({length: rows.length}, (_, i) => rows.item(i) as T);
  }
  return [];
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeFactText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCategory(category: unknown): FactCategory {
  return VALID_CATEGORIES.includes(category as FactCategory)
    ? category as FactCategory
    : 'otro';
}

export class SqliteMemoryStore implements MemoryAdapter {
  private schemaReady?: Promise<void>;

  constructor(private db: SqliteExecutor = missingExecutor) {}

  setExecutor(db: SqliteExecutor): void {
    this.db = db;
    this.schemaReady = undefined;
  }

  async getFactsForPrompt(n = MAX_INJECTED_FACTS): Promise<CompaFact[]> {
    await this.ensureSchema();
    const rows = await this.db.executeAsync(
      `SELECT id, fact, category, salience, COALESCE(confidence, 0.5) as confidence,
              created_at as createdAt
         FROM compa_facts
        WHERE superseded_by IS NULL
        ORDER BY
          CASE category WHEN 'salud' THEN 0 WHEN 'familia' THEN 1 ELSE 2 END,
          salience DESC,
          COALESCE(confidence, 0.5) DESC,
          created_at DESC
        LIMIT ?`,
      [n],
    );
    return rowsFrom<CompaFact>(rows);
  }

  /** Render para la seccion {{memoria}} de la carta. */
  formatForPrompt(facts: CompaFact[]): string {
    if (!facts.length) return '(Primera plática: todavía no lo conoces. Preséntate con calma.)';
    const byCat: Record<string, string[]> = {};
    for (const f of facts) (byCat[f.category] ??= []).push(f.fact);
    return Object.entries(byCat)
      .map(([cat, list]) => `${cat.toUpperCase()}: ${list.join('; ')}`)
      .join('\n');
  }

  async addFacts(facts: Fact[], sessionId: string): Promise<void> {
    await this.ensureSchema();
    const now = Date.now();
    for (const incoming of facts.slice(0, 6)) {
      const factText = String(incoming.fact ?? '').trim().slice(0, 300);
      if (!factText) continue;

      const category = normalizeCategory(incoming.category);
      const salience = clampInt(incoming.salience, 1, 5, 3);
      const confidence = clampFloat(incoming.confidence, 0, 1, 0.5);
      const duplicate = await this.findDuplicate(category, factText);

      if (duplicate) {
        await this.db.executeAsync(
          `UPDATE compa_facts
              SET salience = ?, confidence = ?, last_referenced_at = ?,
                  times_referenced = COALESCE(times_referenced, 0) + 1
            WHERE id = ?`,
          [
            Math.max(duplicate.salience ?? 3, salience),
            Math.max(duplicate.confidence ?? 0.5, confidence),
            now,
            duplicate.id,
          ],
        );
        continue;
      }

      const insertedId = await this.insertFact(
        factText,
        category,
        salience,
        confidence,
        now,
        sessionId,
      );

      if (incoming.supersedes) {
        await this.markSuperseded(String(incoming.supersedes), insertedId);
      }
    }
    await this.prune();
  }

  async auditFacts(): Promise<CompaFact[]> {
    await this.ensureSchema();
    const rows = await this.db.executeAsync(
      `SELECT id, fact, category, salience, COALESCE(confidence, 0.5) as confidence,
              created_at as createdAt
         FROM compa_facts
        ORDER BY superseded_by IS NOT NULL, salience DESC, created_at DESC`,
    );
    return rowsFrom<CompaFact>(rows);
  }

  async editFact(id: number, patch: Partial<Fact>): Promise<void> {
    await this.ensureSchema();
    const sets: string[] = [];
    const params: Array<string | number | null> = [];

    if (patch.fact !== undefined) {
      const fact = String(patch.fact).trim().slice(0, 300);
      if (fact) {
        sets.push('fact = ?');
        params.push(fact);
      }
    }
    if (patch.category !== undefined) {
      sets.push('category = ?');
      params.push(normalizeCategory(patch.category));
    }
    if (patch.salience !== undefined) {
      sets.push('salience = ?');
      params.push(clampInt(patch.salience, 1, 5, 3));
    }
    if (patch.confidence !== undefined) {
      sets.push('confidence = ?');
      params.push(clampFloat(patch.confidence, 0, 1, 0.5));
    }

    if (!sets.length) return;
    params.push(id);
    await this.db.executeAsync(
      `UPDATE compa_facts SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );
  }

  async deleteFact(id: number): Promise<void> {
    await this.ensureSchema();
    await this.deleteFactIdsCascade([id]);
  }

  async startSession(sessionId = `s_${Date.now()}`): Promise<string> {
    await this.ensureSchema();
    await this.db.executeAsync(
      `INSERT OR IGNORE INTO compa_sessions (id, started_at, turn_count)
       VALUES (?, ?, 0)`,
      [sessionId, Date.now()],
    );
    return sessionId;
  }

  async appendMessage(sessionId: string, message: TranscriptTurn): Promise<void> {
    await this.ensureSchema();
    await this.startSession(sessionId);
    const turnIndex = message.turnIndex ?? await this.nextTurnIndex(sessionId);
    await this.db.executeAsync(
      `INSERT INTO compa_messages (session_id, role, content, turn_index, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        sessionId,
        message.role,
        message.content,
        turnIndex,
        message.createdAt ?? Date.now(),
      ],
    );
    await this.db.executeAsync(
      `UPDATE compa_sessions SET turn_count = MAX(COALESCE(turn_count, 0), ?) WHERE id = ?`,
      [turnIndex, sessionId],
    );
  }

  async saveTranscript(sessionId: string, transcript: TranscriptTurn[]): Promise<void> {
    await this.ensureSchema();
    const startedAt = transcript[0]?.createdAt ?? Date.now();
    await this.db.executeAsync(
      `INSERT OR IGNORE INTO compa_sessions (id, started_at, turn_count)
       VALUES (?, ?, 0)`,
      [sessionId, startedAt],
    );
    await this.db.executeAsync(`DELETE FROM compa_messages WHERE session_id = ?`, [sessionId]);
    for (let i = 0; i < transcript.length; i += 1) {
      const turn = transcript[i];
      if (!turn) continue;
      await this.db.executeAsync(
        `INSERT INTO compa_messages (session_id, role, content, turn_index, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          sessionId,
          turn.role,
          turn.content,
          turn.turnIndex ?? i + 1,
          turn.createdAt ?? Date.now(),
        ],
      );
    }
    await this.db.executeAsync(
      `UPDATE compa_sessions SET ended_at = ?, turn_count = ? WHERE id = ?`,
      [Date.now(), transcript.length, sessionId],
    );
  }

  async listSessions(limit = 20): Promise<CompaSession[]> {
    await this.ensureSchema();
    const rows = await this.db.executeAsync(
      `SELECT id, started_at as startedAt, ended_at as endedAt,
              COALESCE(turn_count, 0) as turnCount
         FROM compa_sessions
        ORDER BY started_at DESC
        LIMIT ?`,
      [limit],
    );
    return rowsFrom<CompaSession>(rows);
  }

  async getTranscript(sessionId: string): Promise<CompaMessage[]> {
    await this.ensureSchema();
    const rows = await this.db.executeAsync(
      `SELECT id, session_id as sessionId, role, content, turn_index as turnIndex,
              created_at as createdAt
         FROM compa_messages
        WHERE session_id = ?
        ORDER BY turn_index ASC, id ASC`,
      [sessionId],
    );
    return rowsFrom<CompaMessage>(rows);
  }

  /** Nota para el resumen semanal a la familia. */
  async addWeeklyNote(note: string, mood: 'bien' | 'regular' | 'bajo'): Promise<void> {
    await this.ensureSchema();
    await this.db.executeAsync(
      `INSERT INTO compa_weekly_notes (note, mood, created_at) VALUES (?, ?, ?)`,
      [note.slice(0, 300), mood, Date.now()],
    );
  }

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.createSchema().catch(e => {
        this.schemaReady = undefined;
        throw e;
      });
    }
    await this.schemaReady;
  }

  private async createSchema(): Promise<void> {
    await this.db.executeAsync(
      `CREATE TABLE IF NOT EXISTS compa_sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        turn_count INTEGER DEFAULT 0
      )`,
    );
    await this.db.executeAsync(
      `CREATE TABLE IF NOT EXISTS compa_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES compa_sessions(id) ON DELETE CASCADE
      )`,
    );
    await this.db.executeAsync(
      `CREATE INDEX IF NOT EXISTS idx_compa_messages_session
        ON compa_messages (session_id, turn_index, id)`,
    );
    await this.db.executeAsync(
      `CREATE TABLE IF NOT EXISTS compa_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact TEXT NOT NULL,
        category TEXT NOT NULL,
        salience INTEGER DEFAULT 3,
        confidence REAL DEFAULT 0.5,
        created_at INTEGER NOT NULL,
        last_referenced_at INTEGER,
        times_referenced INTEGER DEFAULT 0,
        superseded_by INTEGER REFERENCES compa_facts(id),
        source_session TEXT
      )`,
    );
    await this.tryExecute(`ALTER TABLE compa_facts ADD COLUMN confidence REAL DEFAULT 0.5`);
    await this.db.executeAsync(
      `CREATE INDEX IF NOT EXISTS idx_facts_active
        ON compa_facts (superseded_by, salience DESC, created_at DESC)`,
    );
    await this.db.executeAsync(
      `CREATE TABLE IF NOT EXISTS compa_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        time_hhmm TEXT NOT NULL,
        days_mask INTEGER DEFAULT 127,
        enabled INTEGER DEFAULT 1,
        last_fired_at INTEGER
      )`,
    );
    await this.db.executeAsync(
      `CREATE TABLE IF NOT EXISTS compa_weekly_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note TEXT NOT NULL,
        mood TEXT,
        created_at INTEGER NOT NULL,
        reported INTEGER DEFAULT 0
      )`,
    );
    await this.db.executeAsync(
      `CREATE TABLE IF NOT EXISTS compa_safety_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trigger_text TEXT NOT NULL,
        rule TEXT NOT NULL,
        notified INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
    );
  }

  private async tryExecute(sql: string): Promise<void> {
    try {
      await this.db.executeAsync(sql);
    } catch {
      // ALTER TABLE duplicado en SQLite viejo: seguro ignorarlo.
    }
  }

  private async findDuplicate(
    category: FactCategory,
    fact: string,
  ): Promise<{id: number; fact: string; salience: number; confidence: number} | undefined> {
    const rows = await this.db.executeAsync(
      `SELECT id, fact, salience, COALESCE(confidence, 0.5) as confidence
         FROM compa_facts
        WHERE superseded_by IS NULL AND category = ?`,
      [category],
    );
    const target = normalizeFactText(fact);
    return rowsFrom<{id: number; fact: string; salience: number; confidence: number}>(rows)
      .find(row => normalizeFactText(row.fact) === target);
  }

  private async insertFact(
    fact: string,
    category: FactCategory,
    salience: number,
    confidence: number,
    createdAt: number,
    sessionId: string,
  ): Promise<number> {
    const rows = await this.db.executeAsync(
      `INSERT INTO compa_facts
        (fact, category, salience, confidence, created_at, source_session)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [fact, category, salience, confidence, createdAt, sessionId],
    );
    return rowsFrom<{id: number}>(rows)[0]?.id ?? -1;
  }

  private async markSuperseded(supersedes: string, replacementId: number): Promise<void> {
    if (replacementId < 0) return;
    const target = normalizeFactText(supersedes);
    if (!target) return;
    const rows = await this.db.executeAsync(
      `SELECT id, fact
         FROM compa_facts
        WHERE superseded_by IS NULL AND id <> ?`,
      [replacementId],
    );
    const ids = rowsFrom<{id: number; fact: string}>(rows)
      .filter(row => normalizeFactText(row.fact) === target)
      .map(row => row.id);
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(', ');
    await this.db.executeAsync(
      `UPDATE compa_facts
          SET superseded_by = ?
        WHERE id IN (${placeholders})`,
      [replacementId, ...ids],
    );
  }

  private async nextTurnIndex(sessionId: string): Promise<number> {
    const rows = await this.db.executeAsync(
      `SELECT COALESCE(MAX(turn_index), 0) + 1 as nextIndex
         FROM compa_messages
        WHERE session_id = ?`,
      [sessionId],
    );
    return rowsFrom<{nextIndex: number}>(rows)[0]?.nextIndex ?? 1;
  }

  /** Mantiene la memoria sana: max ~200 hechos activos, compatible con SQLite viejo. */
  private async prune(): Promise<void> {
    const countRows = await this.db.executeAsync(
      `SELECT COUNT(*) as activeCount FROM compa_facts WHERE superseded_by IS NULL`,
    );
    const activeCount = rowsFrom<{activeCount: number}>(countRows)[0]?.activeCount ?? 0;
    const excess = activeCount - MAX_ACTIVE_FACTS;
    if (excess <= 0) return;

    const victimRows = await this.db.executeAsync(
      `SELECT id
         FROM compa_facts
        WHERE superseded_by IS NULL
        ORDER BY salience ASC, COALESCE(times_referenced, 0) ASC, created_at ASC
        LIMIT ?`,
      [excess],
    );
    const ids = rowsFrom<{id: number}>(victimRows).map(row => row.id);
    if (!ids.length) return;

    await this.deleteFactIdsCascade(ids);
  }

  private async deleteFactIdsCascade(rootIds: number[]): Promise<void> {
    const ids = new Set(rootIds.filter(id => Number.isFinite(id)));
    let frontier = Array.from(ids);

    while (frontier.length) {
      const placeholders = frontier.map(() => '?').join(', ');
      const rows = await this.db.executeAsync(
        `SELECT id FROM compa_facts WHERE superseded_by IN (${placeholders})`,
        frontier,
      );
      frontier = rowsFrom<{id: number}>(rows)
        .map(row => row.id)
        .filter(id => {
          if (ids.has(id)) return false;
          ids.add(id);
          return true;
        });
    }

    if (!ids.size) return;
    const deleteIds = Array.from(ids);
    const placeholders = deleteIds.map(() => '?').join(', ');
    await this.db.executeAsync(
      `DELETE FROM compa_facts WHERE id IN (${placeholders})`,
      deleteIds,
    );
  }
}

export class MemoryStore extends SqliteMemoryStore {}

export const memoryStore = new SqliteMemoryStore();
