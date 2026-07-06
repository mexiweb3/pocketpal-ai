/**
 * Ensambla la carta de identidad con memoria y recordatorios locales.
 */
import {memoryStore} from '../memory/MemoryStore';
import {getTodayReminders} from '../tools/companionTools';
import {CARTA_IDENTIDAD} from './carta';

export async function buildSystemPrompt(): Promise<string> {
  const now = new Date();
  const fecha = now.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  // Parte del dia en vez de hora con minutos: el system prompt es el prefijo
  // del contexto y llama.cpp reutiliza el KV-cache solo si el prefijo es
  // IDENTICO entre turnos. Una hora que cambia cada minuto invalidaba el
  // cache y obligaba a re-procesar toda la carta (~60s en telefono) en cada
  // turno. La granularidad "madrugada/manana/tarde/noche" es estable durante
  // la conversacion y suficiente para la conciencia temporal de Luna.
  const h = now.getHours();
  const hora =
    h < 6 ? 'la madrugada' : h < 12 ? 'la mañana' : h < 19 ? 'la tarde' : 'la noche';

  let memoria = memoryStore.formatForPrompt([]);
  let recordatorios: string | null = '';
  try {
    const facts = await memoryStore.getFactsForPrompt();
    memoria = memoryStore.formatForPrompt(facts);
  } catch (error) {
    console.warn('[Luna] No se pudo leer memoria para el prompt', error);
  }
  try {
    recordatorios = await getTodayReminders();
  } catch (error) {
    console.warn(
      '[Luna] No se pudieron leer recordatorios para el prompt',
      error,
    );
    recordatorios = null;
  }
  const recordatoriosPrompt =
    recordatorios === null
      ? '(no pude revisar recordatorios)'
      : recordatorios || '(ninguno pendiente)';

  return CARTA_IDENTIDAD.replaceAll('{{fecha}}', fecha)
    .replaceAll('{{hora}}', hora)
    .replace('{{memoria}}', memoria)
    .replace('{{recordatorios}}', recordatoriosPrompt);
}
