/**
 * factExtractor — pase de extracción de memoria post-conversación.
 * Persiste el transcript completo y luego extrae hechos con JSON estricto.
 * JSON inválido nunca debe tirar la app.
 */
import type {Fact, LLMAdapter, MemoryAdapter, Msg, TranscriptTurn} from '../adapters';

const EXTRACTION_PROMPT = `Eres un extractor de datos. Analiza la conversación entre un señor mayor y su acompañante.
Extrae SOLO hechos nuevos y concretos sobre el señor: salud, familia, gustos, historias, estado de ánimo.

Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{"facts":[{"fact":"...","category":"salud|familia|gustos|historia|estado_animo|otro","salience":1-5,"confidence":0-1,"supersedes":"texto del hecho anterior si este lo actualiza, o null"}],"mood":"bien|regular|bajo","weekly_note":"resumen de 1 línea de la plática para la familia"}

Reglas:
- salience 5: salud o familia importante. 3: gustos/historias. 1: trivial.
- confidence mide qué tan seguro estás del hecho, entre 0 y 1.
- Si no hay nada nuevo: {"facts":[],"mood":"bien","weekly_note":"..."}
- Máximo 6 hechos. Hechos en tercera persona, breves.`;

const REPAIR_PROMPT = `Convierte el texto del usuario a JSON válido que cumpla EXACTAMENTE este esquema:
{"facts":[{"fact":"...","category":"salud|familia|gustos|historia|estado_animo|otro","salience":1-5,"confidence":0-1,"supersedes":"... o null"}],"mood":"bien|regular|bajo","weekly_note":"..."}
Responde solo JSON. Si no se puede recuperar nada, responde {"facts":[],"mood":"bien","weekly_note":""}.`;

const CATEGORIES = ['salud', 'familia', 'gustos', 'historia', 'estado_animo', 'otro'];
const MOODS = ['bien', 'regular', 'bajo'];

type ExtractionJson = {
  facts: Fact[];
  mood: 'bien' | 'regular' | 'bajo';
  weekly_note: string;
};

type TranscriptMemoryAdapter = MemoryAdapter & {
  addWeeklyNote?: (note: string, mood: 'bien' | 'regular' | 'bajo') => Promise<void>;
};

export async function extractFactsFromSession(
  llm: LLMAdapter,
  memory: MemoryAdapter,
  transcript: Array<{role: 'user' | 'assistant'; content: string}>,
  sessionId: string,
): Promise<void> {
  await persistTranscript(memory, sessionId, transcript);

  if (transcript.length < 2) return;

  const recent = transcript.slice(-20)
    .map(t => `${t.role === 'user' ? 'SEÑOR' : 'COMPA'}: ${t.content}`)
    .join('\n');

  let raw = '';
  try {
    raw = await completeJson(llm, [
      {role: 'system', content: EXTRACTION_PROMPT},
      {role: 'user', content: recent},
    ]);
  } catch (e) {
    console.warn('[factExtractor] Falló la extracción de hechos', e);
    return;
  }

  const parsed = await parseWithRetry(llm, raw);
  if (!parsed) return;

  try {
    if (parsed.facts.length) {
      await memory.addFacts(parsed.facts, sessionId);
    }
    if (parsed.weekly_note) {
      await (memory as TranscriptMemoryAdapter).addWeeklyNote?.(parsed.weekly_note, parsed.mood);
    }
  } catch (e) {
    console.warn('[factExtractor] No se pudo persistir memoria extraída', e);
  }
}

async function persistTranscript(
  memory: MemoryAdapter,
  sessionId: string,
  transcript: Array<{role: 'user' | 'assistant'; content: string}>,
): Promise<void> {
  try {
    await memory.saveTranscript(
      sessionId,
      transcript.map((turn, index) => ({
        role: turn.role,
        content: turn.content,
        turnIndex: index + 1,
        createdAt: Date.now(),
      })),
    );
  } catch (e) {
    console.warn('[factExtractor] No se pudo guardar transcript completo', e);
  }
}

async function completeJson(llm: LLMAdapter, messages: Msg[]): Promise<string> {
  let generated = '';
  const result = await llm.completion(
    messages,
    {
      nPredict: 512,
      temperature: 0.1,
      stop: ['\n\n\n'],
    },
    tok => {
      generated += tok;
      return true;
    },
  );
  return (result || generated).trim();
}

async function parseWithRetry(llm: LLMAdapter, raw: string): Promise<ExtractionJson | null> {
  try {
    return parseExtraction(raw);
  } catch (firstError) {
    try {
      const repaired = await completeJson(llm, [
        {role: 'system', content: REPAIR_PROMPT},
        {role: 'user', content: raw},
      ]);
      return parseExtraction(repaired);
    } catch (retryError) {
      console.warn('[factExtractor] JSON inválido tras reintento; se omite extracción', {
        firstError,
        retryError,
      });
      return null;
    }
  }
}

function parseExtraction(raw: string): ExtractionJson {
  const cleaned = stripFence(raw);
  const parsed = JSON.parse(cleaned) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON raíz no es objeto');
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.facts)) {
    throw new Error('facts debe ser arreglo');
  }

  const mood = typeof obj.mood === 'string' && MOODS.includes(obj.mood)
    ? obj.mood as ExtractionJson['mood']
    : 'bien';
  const weekly_note = typeof obj.weekly_note === 'string' ? obj.weekly_note.slice(0, 300) : '';
  const facts = obj.facts.slice(0, 6).map(parseFact).filter((f): f is Fact => Boolean(f));

  return {facts, mood, weekly_note};
}

function stripFence(raw: string): string {
  return raw.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseFact(value: unknown): Fact | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const factText = obj.fact;
  const category = obj.category;
  const salience = obj.salience;
  const confidence = obj.confidence;
  const supersedes = obj.supersedes;

  if (typeof factText !== 'string' || !factText.trim()) {
    return null;
  }
  if (typeof category !== 'string' || !CATEGORIES.includes(category)) {
    return null;
  }
  if (typeof salience !== 'number' || !Number.isFinite(salience)) {
    return null;
  }
  if (confidence !== undefined && (typeof confidence !== 'number' || !Number.isFinite(confidence))) {
    return null;
  }

  const fact: Fact = {
    fact: factText.trim().slice(0, 300),
    category,
    salience: Math.min(5, Math.max(1, Math.round(salience))),
    confidence: confidence === undefined ? 0.5 : Math.min(1, Math.max(0, confidence)),
  };

  if (typeof supersedes === 'string' && supersedes.trim()) {
    fact.supersedes = supersedes.trim().slice(0, 300);
  }
  return fact;
}
