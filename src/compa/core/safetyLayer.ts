/**
 * safetyLayer — corre ANTES del LLM en cada turno. Nunca confiamos
 * en el modelo para detectar una emergencia: regex primero.
 * También resuelve intents simples (hora, llamar) sin gastar inferencia.
 */
import {Alert, Linking} from 'react-native';

import type {NotificationAdapter} from '../adapters';
import {FAMILY_PHONE} from '../config/family';

export type TurnIntent =
  | {type: 'emergency'; reply: string; rule: string}
  | {type: 'tool'; tool: 'time' | 'call_family' | 'reminders_today'}
  | {type: 'chat'};

// — Emergencias: amplio a propósito. Falso positivo barato; falso negativo carísimo.
const EMERGENCY_RULES: Array<{rule: string; re: RegExp}> = [
  {
    rule: 'dolor_pecho',
    re: /duele.{0,15}(pecho|coraz[oó]n)|presi[oó]n en el pecho|me aprieta el pecho/i,
  },
  {
    rule: 'caida',
    re: /me ca[ií]|me he ca[ií]do|estoy en el (piso|suelo)|no me puedo (parar|levantar)/i,
  },
  {rule: 'respirar', re: /no puedo respirar|me falta (el )?aire|me ahogo/i},
  {
    rule: 'mareo_fuerte',
    re: /muy mareado|se me nubla|me voy a desmayar|me desmay[eé]/i,
  },
  {
    rule: 'ayuda',
    re: /\bayuda\b.{0,20}(por favor|r[aá]pido)|ll[aá]male? a (la ambulancia|emergencias|al doctor ya)/i,
  },
  {
    rule: 'malestar_grave',
    re: /me siento muy mal|algo anda muy mal|nunca me hab[ií]a sentido as[ií]/i,
  },
];

const EMERGENCY_DELIVERED_REPLY =
  'Aquí estoy con usted, no se me apure. Ya le estoy avisando a Mexi en este momento. ' +
  'Quédese donde está y sígame platicando, ¿sí? ¿Me dice qué siente?';

const EMERGENCY_PENDING_REPLY =
  'Aquí estoy con usted, no se me apure. Voy a intentar avisarle a Mexi en este momento.';

const EMERGENCY_FALLBACK_REPLY =
  'Aquí estoy con usted, no se me apure. No pude confirmar el SMS a Mexi, ' +
  'así que voy a abrir la llamada de emergencia en el teléfono. Quédese donde está y sígame platicando, ¿sí?';

const EMERGENCY_NO_PHONE_REPLY =
  'Aquí estoy con usted, no se me apure. No tengo configurado el teléfono de Mexi para enviar SMS. ' +
  'Voy a dejar el aviso visible en pantalla. Quédese donde está y sígame platicando, ¿sí?';

// — Intents de tool: respuesta instantánea sin LLM
const TOOL_RULES: Array<{
  tool: 'time' | 'call_family' | 'reminders_today';
  re: RegExp;
}> = [
  {
    tool: 'time',
    re: /qu[eé] horas? (es|son)|qu[eé] d[ií]a es|a c[oó]mo estamos/i,
  },
  {
    tool: 'call_family',
    re: /ll[aá]ma(le|me)?.{0,15}(a )?(mexi|mauricio|mi hijo)|quiero hablar con (mexi|mauricio|mi hijo)/i,
  },
  {
    tool: 'reminders_today',
    re: /qu[eé] (medicinas?|pastillas?) (me tocan?|tengo)|recordatorios de hoy/i,
  },
];

export function classifyTurn(userText: string): TurnIntent {
  for (const {rule, re} of EMERGENCY_RULES) {
    if (re.test(userText))
      return {type: 'emergency', reply: EMERGENCY_PENDING_REPLY, rule};
  }
  for (const {tool, re} of TOOL_RULES) {
    if (re.test(userText)) return {type: 'tool', tool};
  }
  return {type: 'chat'};
}

export type EmergencyRecord = {
  triggerText: string;
  rule: string;
  createdAt: number;
};

export type EmergencyRecorder = (event: EmergencyRecord) => Promise<void>;

export type EmergencyNotificationResult = {
  delivered: boolean;
  channel: string;
  fallbackVisible: boolean;
  reply: string;
};

function emergencySmsMessage(
  userText: string,
  rule: string,
  createdAt: number,
): string {
  return `Compa: tu papá dijo "${userText.slice(0, 120)}" (${rule}, ${new Date(
    createdAt,
  ).toLocaleTimeString('es-MX')}). Márcale.`;
}

async function showEmergencyFallback(): Promise<boolean> {
  const phoneForUrl = FAMILY_PHONE.replace(/[^\d+*#]/g, '');
  if (phoneForUrl) {
    try {
      await Linking.openURL(`tel:${phoneForUrl}`);
      return true;
    } catch (e) {
      console.warn('[safetyLayer] No se pudo abrir fallback tel:', e);
    }
  }

  Alert.alert(
    'Emergencia sin SMS',
    FAMILY_PHONE
      ? 'No se pudo confirmar el SMS de emergencia. Llame al contacto familiar desde este teléfono.'
      : 'COMPA_FAMILY_PHONE no está configurado. Configure el contacto familiar antes de confiar en SMS.',
  );
  return true;
}

/** Registra el evento por hook opcional y dispara la notificación por adapter. */
export async function fireEmergency(
  userText: string,
  rule: string,
  notification: NotificationAdapter,
  recordEmergency?: EmergencyRecorder,
): Promise<EmergencyNotificationResult> {
  const createdAt = Date.now();
  try {
    await recordEmergency?.({
      triggerText: userText.slice(0, 300),
      rule,
      createdAt,
    });
  } catch (e) {
    console.warn('[safetyLayer] No se pudo registrar emergencia local', e);
  }
  let delivered = false;
  let channel = 'sms';
  try {
    const result = await notification.notifyFamily(
      emergencySmsMessage(userText, rule, createdAt),
    );
    delivered = result.delivered;
    channel = result.channel;
  } catch (e) {
    console.warn('[safetyLayer] No se pudo enviar SMS de emergencia', e);
  }

  if (delivered) {
    return {
      delivered,
      channel,
      fallbackVisible: false,
      reply: EMERGENCY_DELIVERED_REPLY,
    };
  }

  const fallbackVisible = await showEmergencyFallback();
  return {
    delivered,
    channel,
    fallbackVisible,
    reply: FAMILY_PHONE ? EMERGENCY_FALLBACK_REPLY : EMERGENCY_NO_PHONE_REPLY,
  };
}
