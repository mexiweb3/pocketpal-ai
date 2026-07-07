import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  FlatList,
  PermissionsAndroid,
  Platform,
  TextInput,
  View,
} from 'react-native';
import {KeyboardStickyView} from 'react-native-keyboard-controller';
import {ActivityIndicator, Button, IconButton, Text} from 'react-native-paper';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';

import {
  LlamaRnAdapter,
  PocketPalTTSAdapter,
  SmsManagerAdapter,
  WhisperRnAdapter,
} from '../../compa/adapters';
import type {Msg} from '../../compa/adapters';
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
import {modelStore} from '../../store/ModelStore';
import {LUNA_QWEN_MODEL_ID} from '../../store/builtinPalModels';
import {createStyles, LUNA_COLORS} from './styles';

type ChatMsg = {id: string; role: 'user' | 'assistant'; text: string};

const statusLabel: Record<LoopState, string> = {
  idle: 'Lista',
  listening: 'Escuchando',
  thinking: 'Escribiendo',
  speaking: 'Hablando',
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

/** Carga el modelo a RAM y procesa la carta una vez (KV cache tibio) para que
 *  el primer mensaje real no pague ni la carga (7s) ni el prompt (~1 min). */
async function preloadBrain(): Promise<void> {
  const qwen = modelStore.models.find(m => m.id === LUNA_QWEN_MODEL_ID);
  if (qwen && (qwen.isDownloaded || qwen.isLocal) && !modelStore.engine) {
    await modelStore.selectModel(qwen);
  }
  const warm = new LlamaRnAdapter();
  const system = await buildSystemPrompt();
  const messages: Msg[] = [
    {role: 'system', content: system},
    {role: 'user', content: 'Hola'},
  ];
  await warm.completion(messages, {nPredict: 1, temperature: 0}, () => true);
}

export const LunaScreen: React.FC = () => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const loopRef = useRef<VoiceLoop | null>(null);
  const mountedRef = useRef(true);
  const bootedRef = useRef(false);
  const msgSerial = useRef(0);
  const listRef = useRef<FlatList<ChatMsg>>(null);

  const [loopState, setLoopState] = useState<LoopState>('idle');
  const [provision, setProvision] = useState<ProvisionProgress | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pushMessage = useCallback((role: ChatMsg['role'], text: string) => {
    msgSerial.current += 1;
    const id = `m${msgSerial.current}`;
    setMessages(prev => [...prev, {id, role, text}]);
  }, []);

  const ensureLoop = useCallback(
    (familyPhone: string): VoiceLoop => {
      if (loopRef.current) {
        return loopRef.current;
      }
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
              // Al volver a reposo, cualquier draft huerfano (turno cancelado
              // o fallido) se limpia; el turno normal ya lo vacio en
              // onAssistantTurn antes de llegar aqui.
              if (state === 'idle' || state === 'listening') {
                setDraft('');
              }
            }
          },
          onTurnError: () => {
            if (mountedRef.current) {
              setDraft('');
              setError('Luna no pudo responder. Intente de nuevo.');
            }
          },
          onUserTurn: text => {
            if (mountedRef.current) {
              pushMessage('user', text);
            }
          },
          onAssistantDelta: textSoFar => {
            if (mountedRef.current) {
              setDraft(textSoFar);
            }
          },
          onAssistantTurn: text => {
            if (mountedRef.current) {
              setDraft('');
              pushMessage('assistant', text);
            }
          },
        },
      );
      loopRef.current = loop;
      return loop;
    },
    [pushMessage],
  );

  /** Provisioning (primer uso) + loop de chat listo + cerebro precargado. */
  const bootstrap = useCallback(async () => {
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
    if (!mountedRef.current) {
      return;
    }
    setProvision(null);

    try {
      // SMS para emergencias (aplica a chat y voz). Si se niega, hay fallback.
      const hasSms = await requestSendSmsPermission(FAMILY_PHONE);
      if (!mountedRef.current) {
        return;
      }
      ensureLoop(hasSms ? FAMILY_PHONE : '');
      setChatReady(true);
    } catch (err) {
      if (mountedRef.current) {
        setError(errorMessage(err));
      }
      return;
    }

    // Precarga en segundo plano: el chat ya funciona, solo que el primer
    // mensaje seria lento; esto lo absorbe aqui.
    setPreparing(true);
    try {
      await preloadBrain();
    } catch (err) {
      console.warn('[LunaScreen] Precarga del cerebro fallo (no fatal)', err);
    } finally {
      if (mountedRef.current) {
        setPreparing(false);
      }
    }
  }, [ensureLoop]);

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
      void loop?.destroy().catch(err => {
        console.warn('[LunaScreen] No se pudo cerrar VoiceLoop', err);
      });
    };
  }, []);

  const send = useCallback(() => {
    const loop = loopRef.current;
    const text = input.trim();
    if (!loop || !text || !chatReady) {
      return;
    }
    setInput('');
    setError(null);
    pushMessage('user', text);
    loop.submitText(text);
  }, [input, chatReady, pushMessage]);

  const toggleVoice = useCallback(async () => {
    const loop = loopRef.current;
    if (!loop || voiceBusy || !chatReady) {
      return;
    }
    setVoiceBusy(true);
    setError(null);
    try {
      if (voiceOn) {
        await loop.stopVoice();
        if (mountedRef.current) {
          setDraft('');
          setVoiceOn(false);
        }
      } else {
        const ok = await requestRecordAudioPermission();
        if (!ok) {
          throw new Error('Permiso de microfono denegado.');
        }
        await loop.start();
        if (mountedRef.current) {
          setVoiceOn(true);
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(errorMessage(err));
      }
    } finally {
      if (mountedRef.current) {
        setVoiceBusy(false);
      }
    }
  }, [voiceOn, voiceBusy, chatReady]);

  const busyIndicator =
    provision !== null || preparing || loopState === 'thinking' || voiceBusy;
  const statusText = provision
    ? `Preparando a Luna: descargando ${provision.label} (${Math.round(
        provision.fraction * 100,
      )}%)`
    : preparing
      ? 'Luna se esta preparando...'
      : statusLabel[loopState];
  const dotColor =
    loopState === 'idle'
      ? theme.colors.outline
      : loopState === 'thinking'
        ? theme.colors.tertiary
        : theme.colors.primary;

  const listData: ChatMsg[] = draft
    ? [...messages, {id: 'draft', role: 'assistant', text: draft}]
    : messages;

  return (
    <SafeAreaView edges={['bottom']} style={styles.container}>
      <View style={styles.container}>
        <View style={styles.statusStrip}>
          <View style={[styles.statusDot, {backgroundColor: dotColor}]} />
          <Text variant="bodyMedium" style={styles.statusStripText}>
            {statusText}
          </Text>
          {busyIndicator ? (
            <ActivityIndicator
              animating
              size={16}
              color={theme.colors.primary}
            />
          ) : null}
        </View>

        {error ? (
          <Text variant="bodyMedium" style={styles.error} testID="luna-error">
            {error}
          </Text>
        ) : null}
        {error && !chatReady ? (
          <Button
            mode="contained"
            style={styles.retryButton}
            onPress={() => void bootstrap()}
            testID="luna-retry-button">
            Reintentar
          </Button>
        ) : null}

        <FlatList
          ref={listRef}
          data={listData}
          keyExtractor={m => m.id}
          style={styles.chatList}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({animated: false})
          }
          ListEmptyComponent={
            <Text style={styles.emptyHint}>
              {chatReady
                ? 'Luna esta lista. Escribale aqui abajo, o toque el microfono para hablarle.'
                : 'Un momento, Luna se esta preparando...'}
            </Text>
          }
          renderItem={({item}) => (
            <View
              style={[
                styles.bubble,
                item.role === 'user' ? styles.bubbleUser : styles.bubbleLuna,
              ]}>
              <Text
                style={[
                  styles.bubbleName,
                  item.role === 'user' ? styles.bubbleNameUser : null,
                ]}>
                {item.role === 'user' ? 'Usted' : 'Luna'}
              </Text>
              <Text
                style={[
                  styles.bubbleText,
                  item.role === 'user' ? styles.bubbleTextUser : null,
                ]}>
                {item.text}
              </Text>
            </View>
          )}
        />

        {/* La barra de escritura se pega SOBRE el teclado (como el chat de
            PocketPal) para que el señor siempre vea lo que teclea. */}
        <KeyboardStickyView offset={{closed: 0, opened: insets.bottom}}>
          <View style={styles.inputRow}>
            <IconButton
              icon={voiceOn ? 'microphone' : 'microphone-outline'}
              mode={voiceOn ? 'contained' : 'outlined'}
              size={26}
              disabled={!chatReady || voiceBusy}
              onPress={toggleVoice}
              testID="luna-voice-toggle"
            />
            <TextInput
              style={styles.textInput}
              value={input}
              onChangeText={setInput}
              placeholder="Escribale a Luna..."
              placeholderTextColor={LUNA_COLORS.textDim}
              multiline
              editable={chatReady}
              testID="luna-chat-input"
            />
            <IconButton
              icon="send"
              mode="contained"
              size={26}
              disabled={!chatReady || !input.trim()}
              onPress={send}
              testID="luna-send-button"
            />
          </View>
        </KeyboardStickyView>
      </View>
    </SafeAreaView>
  );
};
