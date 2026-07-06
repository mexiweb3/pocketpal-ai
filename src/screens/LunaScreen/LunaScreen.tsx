import React, {useCallback, useEffect, useRef, useState} from 'react';
import {PermissionsAndroid, Platform, View} from 'react-native';
import {Button, ActivityIndicator, Text} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';

import {
  LlamaRnAdapter,
  PocketPalTTSAdapter,
  SmsManagerAdapter,
  WhisperRnAdapter,
} from '../../compa/adapters';
import {FAMILY_PHONE} from '../../compa/config/family';
import {VoiceLoop, type LoopState} from '../../compa/core';
import type {EmergencyRecord} from '../../compa/core/safetyLayer';
import {memoryStore} from '../../compa/memory/MemoryStore';
import {buildSystemPrompt} from '../../compa/prompts/systemPrompt';
import {
  lunaNeedsProvisioning,
  provisionLunaAssets,
  type ProvisionProgress,
} from '../../compa/provisioning/LunaProvisioner';
import {runTool} from '../../compa/tools/companionTools';
import {
  createPocketPalSqliteExecutor,
  installCompaMemoryStoreExecutor,
} from '../../database';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';

const statusLabel: Record<LoopState, string> = {
  idle: 'Lista',
  listening: 'Escuchando',
  thinking: 'Pensando',
  speaking: 'Hablando',
};

const statusDetail: Record<LoopState, string> = {
  idle: 'Toca Iniciar para platicar con Luna.',
  listening: 'Luna esta oyendo.',
  thinking: 'Luna esta preparando respuesta local.',
  speaking: 'Luna esta respondiendo.',
};

async function requestRecordAudioPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }

  const current = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  if (current) {
    return true;
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

async function requestSendSmsPermission(familyPhone: string): Promise<boolean> {
  if (!familyPhone || Platform.OS !== 'android') {
    return false;
  }

  const current = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.SEND_SMS,
  );
  if (current) {
    return true;
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.SEND_SMS,
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

async function recordEmergency(event: EmergencyRecord): Promise<void> {
  const db = createPocketPalSqliteExecutor();
  await db.executeAsync(
    `INSERT INTO compa_safety_events
      (trigger_text, rule, notified, created_at)
     VALUES (?, ?, 0, ?)`,
    [event.triggerText, event.rule, event.createdAt],
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export const LunaScreen: React.FC = () => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const loopRef = useRef<VoiceLoop | null>(null);
  const mountedRef = useRef(true);
  const bootedRef = useRef(false);
  const [loopState, setLoopState] = useState<LoopState>('idle');
  const [isStarting, setIsStarting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [provision, setProvision] = useState<ProvisionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopLoop = useCallback(async () => {
    const loop = loopRef.current;
    loopRef.current = null;
    setIsRunning(false);
    setIsStarting(false);
    try {
      await loop?.destroy();
    } catch (err) {
      if (mountedRef.current) {
        setError(errorMessage(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoopState('idle');
      }
    }
  }, []);

  const startLoop = useCallback(async () => {
    if (loopRef.current || isStarting) {
      return;
    }

    setIsStarting(true);
    setError(null);
    try {
      const hasAudioPermission = await requestRecordAudioPermission();
      if (!hasAudioPermission) {
        throw new Error('Permiso de microfono denegado.');
      }
      const hasSmsPermission = await requestSendSmsPermission(FAMILY_PHONE);
      const familyPhone = hasSmsPermission ? FAMILY_PHONE : '';

      installCompaMemoryStoreExecutor();
      const loop = new VoiceLoop(
        {
          stt: new WhisperRnAdapter(),
          llm: new LlamaRnAdapter(),
          tts: new PocketPalTTSAdapter(),
          notification: new SmsManagerAdapter(familyPhone),
          memory: memoryStore,
        },
        {
          buildSystemPrompt,
          runTool,
          recordEmergency,
          onState: state => {
            if (mountedRef.current) {
              setLoopState(state);
            }
          },
        },
      );

      loopRef.current = loop;
      await loop.start();
      if (mountedRef.current) {
        setIsRunning(true);
        if (FAMILY_PHONE && Platform.OS === 'android' && !hasSmsPermission) {
          setError(
            'Permiso de SMS denegado. Luna abrira un fallback visible si detecta emergencia.',
          );
        }
      }
    } catch (err) {
      const loop = loopRef.current;
      loopRef.current = null;
      await loop?.destroy().catch(() => undefined);
      if (mountedRef.current) {
        setError(errorMessage(err));
        setLoopState('idle');
        setIsRunning(false);
      }
    } finally {
      if (mountedRef.current) {
        setIsStarting(false);
      }
    }
  }, [isStarting]);

  /** Provisioning + arranque: descarga lo que falte (primer uso) y abre el
   *  microfono solo, sin que el usuario decida nada. Reintentable con Iniciar. */
  const bootstrap = useCallback(async () => {
    if (loopRef.current || isStarting) {
      return;
    }
    setError(null);
    try {
      if (await lunaNeedsProvisioning()) {
        setProvision({label: 'lo necesario', fraction: 0});
        await provisionLunaAssets(p => {
          if (mountedRef.current) {
            setProvision(p);
          }
        });
      }
    } catch (err) {
      if (mountedRef.current) {
        setProvision(null);
        setError(errorMessage(err));
      }
      return;
    }
    if (mountedRef.current) {
      setProvision(null);
      await startLoop();
    }
  }, [isStarting, startLoop]);

  useEffect(() => {
    if (!bootedRef.current) {
      bootedRef.current = true;
      void bootstrap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const loop = loopRef.current;
      loopRef.current = null;
      void loop?.destroy().catch(error => {
        console.warn('[LunaScreen] No se pudo cerrar VoiceLoop', error);
      });
    };
  }, []);

  const active = isRunning || isStarting;
  const busy = active || provision !== null;
  const provisionPct = provision ? Math.round(provision.fraction * 100) : 0;
  const dotColor =
    loopState === 'idle'
      ? theme.colors.outline
      : loopState === 'thinking'
        ? theme.colors.tertiary
        : theme.colors.primary;

  return (
    <SafeAreaView edges={['bottom']} style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text variant="headlineMedium" style={styles.title}>
            Luna
          </Text>
          <Text variant="bodyMedium" style={styles.subtitle}>
            Platique con Luna. Todo queda en este telefono.
          </Text>
        </View>

        <View style={styles.statusBand}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, {backgroundColor: dotColor}]} />
            <Text variant="titleMedium" style={styles.statusText}>
              {provision
                ? 'Preparando a Luna'
                : isStarting
                  ? 'Iniciando'
                  : statusLabel[loopState]}
            </Text>
          </View>
          <Text variant="bodyMedium" style={styles.detailText}>
            {provision
              ? `Descargando ${provision.label}: ${provisionPct}%`
              : isStarting
                ? 'Abriendo el microfono.'
                : statusDetail[loopState]}
          </Text>
          {provision || isStarting || loopState === 'thinking' ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator animating color={theme.colors.primary} />
              <Text variant="bodySmall" style={styles.detailText}>
                {provision
                  ? 'Solo esta primera vez, con internet.'
                  : 'Procesando'}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.controls}>
          <Button
            mode="contained"
            icon="microphone"
            disabled={busy}
            onPress={bootstrap}
            style={styles.button}
            testID="luna-start-button">
            Iniciar
          </Button>
          <Button
            mode="outlined"
            icon="stop-circle-outline"
            disabled={!active}
            onPress={stopLoop}
            style={styles.button}
            testID="luna-stop-button">
            Detener
          </Button>
        </View>

        {error ? (
          <Text variant="bodyMedium" style={styles.error} testID="luna-error">
            {error}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
};
