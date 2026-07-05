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
  const hora = now.toLocaleTimeString('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
  });

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
