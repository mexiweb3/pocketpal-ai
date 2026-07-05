/**
 * Tools locales del Compa v1.
 */
import {Linking} from 'react-native';

import {createPocketPalSqliteExecutor} from '../../database';
import {FAMILY_PHONE} from '../config/family';

export type CompanionTool = 'time' | 'call_family' | 'reminders_today';

function rowsFrom(
  result: Awaited<
    ReturnType<ReturnType<typeof createPocketPalSqliteExecutor>['executeAsync']>
  >,
): any[] {
  const rows = result.rows;
  if (!rows) {
    return [];
  }
  if (Array.isArray(rows)) {
    return rows;
  }
  if (Array.isArray(rows._array)) {
    return rows._array;
  }
  if (typeof rows.length === 'number' && typeof rows.item === 'function') {
    return Array.from({length: rows.length}, (_, i) => rows.item?.(i));
  }
  return [];
}

export async function runTool(tool: CompanionTool): Promise<string> {
  switch (tool) {
    case 'time': {
      const now = new Date();
      const hora = now.toLocaleTimeString('es-MX', {
        hour: 'numeric',
        minute: '2-digit',
      });
      const fecha = now.toLocaleDateString('es-MX', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
      return `Son las ${hora} de hoy ${fecha}.`;
    }
    case 'call_family': {
      if (FAMILY_PHONE) {
        void Linking.openURL(`tel:${FAMILY_PHONE}`).catch(error => {
          console.warn('[companionTools] No se pudo abrir llamada familiar', error);
        });
        return 'Claro que sí, ahorita le marco a Mexi. Ahí le va la llamada.';
      }
      return 'No tengo configurado todavía el teléfono de Mexi. Voy a quedarme con usted aquí.';
    }
    case 'reminders_today': {
      const reminders = await getTodayReminders();
      if (reminders === null) {
        return 'Permítame, no pude revisar sus recordatorios ahorita.';
      }
      return reminders
        ? `Hoy le toca: ${reminders}.`
        : 'Hoy ya no tiene pendientes de medicinas.';
    }
  }
}

export async function getTodayReminders(): Promise<string | null> {
  try {
    const dayBit = 1 << new Date().getDay();
    const db = createPocketPalSqliteExecutor();
    const rows = await db.executeAsync(
      `SELECT label, time_hhmm FROM compa_reminders
        WHERE enabled = 1 AND (days_mask & ?) != 0
        ORDER BY time_hhmm`,
      [dayBit],
    );
    return rowsFrom(rows)
      .filter((row: any) => row?.label && row?.time_hhmm)
      .map((row: any) => `${row.label} a las ${row.time_hhmm}`)
      .join(', ');
  } catch (error) {
    console.warn('[companionTools] No se pudieron leer recordatorios', error);
    return null;
  }
}
