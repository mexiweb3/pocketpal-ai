/**
 * LunaProvisioner — deja el telefono listo sin que el usuario decida nada.
 *
 * Descarga (solo si faltan) los tres assets que Luna necesita para operar
 * 100% offline: Whisper GGML (los oidos), Silero VAD (detector de voz) y el
 * LLM Qwen2.5-3B (el cerebro, via el ModelStore/DownloadManager de PocketPal).
 * Idempotente: en arranques posteriores solo verifica que los archivos existan
 * y no toca la red. Pensado para el primer arranque asistido (el hijo prepara
 * el telefono con WiFi; despues todo corre en modo avion).
 */
import * as RNFS from '@dr.pogodin/react-native-fs';

import {modelStore} from '../../store/ModelStore';
import {LUNA_QWEN_MODEL_ID} from '../../store/builtinPalModels';

const WHISPER_DIR = `${RNFS.DocumentDirectoryPath}/models/whisper`;

type BinAsset = {
  label: string;
  url: string;
  dest: string;
  bytes: number;
};

// Rutas EXACTAS que espera WhisperRnAdapter (src/compa/adapters/WhisperRnAdapter.ts).
const WHISPER_BIN: BinAsset = {
  label: 'los oidos de Luna',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin',
  dest: `${WHISPER_DIR}/ggml-small-q5_1.bin`,
  bytes: 190085487,
};

const VAD_BIN: BinAsset = {
  label: 'el detector de voz',
  url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin',
  dest: `${WHISPER_DIR}/ggml-silero-v6.2.0.bin`,
  bytes: 885098,
};

const QWEN_BYTES = 2080000000;
const QWEN_LABEL = 'el cerebro de Luna';

export type ProvisionProgress = {
  /** Que se esta descargando, en lenguaje humano. */
  label: string;
  /** Avance global 0..1 ponderado por bytes de todo lo pendiente. */
  fraction: number;
};

type OnProgress = (p: ProvisionProgress) => void;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function binMissing(asset: BinAsset): Promise<boolean> {
  return !(await RNFS.exists(asset.dest));
}

function findQwen() {
  return modelStore.models.find(m => m.id === LUNA_QWEN_MODEL_ID);
}

function qwenReady(): boolean {
  const qwen = findQwen();
  return !!qwen && (qwen.isDownloaded || qwen.isLocal);
}

/** true si falta algo por descargar (primer arranque o instalacion a medias). */
export async function lunaNeedsProvisioning(): Promise<boolean> {
  if (await binMissing(WHISPER_BIN)) {
    return true;
  }
  if (await binMissing(VAD_BIN)) {
    return true;
  }
  return !qwenReady();
}

async function downloadBin(
  asset: BinAsset,
  onBytes: (bytes: number) => void,
): Promise<void> {
  await RNFS.mkdir(WHISPER_DIR);
  // Descarga a .tmp + rename: nunca dejamos un .bin final a medias.
  const tmp = `${asset.dest}.tmp`;
  if (await RNFS.exists(tmp)) {
    await RNFS.unlink(tmp);
  }
  const {promise} = RNFS.downloadFile({
    fromUrl: asset.url,
    toFile: tmp,
    progressInterval: 400,
    progress: p => onBytes(p.bytesWritten),
  });
  const result = await promise;
  if (result.statusCode && result.statusCode >= 400) {
    throw new Error(
      `No pude descargar ${asset.label} (HTTP ${result.statusCode}). Revise el internet y toque Iniciar de nuevo.`,
    );
  }
  await RNFS.moveFile(tmp, asset.dest);
  onBytes(asset.bytes);
}

/**
 * Espera a que ensureLunaQwenModel() (corre en ModelStore.initializeStore al
 * hidratar) registre el modelo. En frio puede tardar unos segundos.
 */
async function waitForQwenRegistration(timeoutMs = 15000) {
  const started = Date.now();
  let qwen = findQwen();
  while (!qwen) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        'El modelo de lenguaje no aparecio en el catalogo. Cierre y abra la app.',
      );
    }
    await sleep(300);
    qwen = findQwen();
  }
  return qwen;
}

async function downloadQwen(onBytes: (bytes: number) => void): Promise<void> {
  let qwen = await waitForQwenRegistration();
  if (qwen.isDownloaded || qwen.isLocal) {
    onBytes(QWEN_BYTES);
    return;
  }
  await modelStore.checkSpaceAndDownload(qwen.id);
  // checkSpaceAndDownload puede resolver antes de terminar la transferencia:
  // el avance real vive en model.progress (0..100) y onComplete marca
  // isDownloaded. Sondeamos hasta completar o detectar descarga muerta.
  let stalledChecks = 0;
  for (;;) {
    await sleep(700);
    qwen = findQwen() ?? qwen;
    if (qwen.isDownloaded || qwen.isLocal) {
      onBytes(QWEN_BYTES);
      return;
    }
    const pct = qwen.progress ?? 0;
    onBytes(Math.floor((pct / 100) * QWEN_BYTES));
    if (modelStore.isDownloading(qwen.id)) {
      stalledChecks = 0;
      continue;
    }
    // Margen: los callbacks de onComplete pueden tardar un tick en marcar
    // isDownloaded despues de que el job sale de activeJobs.
    stalledChecks += 1;
    if (stalledChecks >= 3) {
      await modelStore.refreshDownloadStatuses();
      if (qwenReady()) {
        onBytes(QWEN_BYTES);
        return;
      }
      throw new Error(
        'La descarga del cerebro de Luna se detuvo. Revise el internet y toque Iniciar de nuevo.',
      );
    }
  }
}

/**
 * Descarga todo lo que falte reportando progreso global ponderado por bytes.
 * Lanza Error con mensaje en espanol si algo falla (la UI lo muestra tal cual).
 * Reintentable: lo ya descargado no se vuelve a bajar.
 */
export async function provisionLunaAssets(
  onProgress: OnProgress,
): Promise<void> {
  const pending: Array<{
    bytes: number;
    label: string;
    run: (onBytes: (b: number) => void) => Promise<void>;
  }> = [];

  if (await binMissing(WHISPER_BIN)) {
    pending.push({
      bytes: WHISPER_BIN.bytes,
      label: WHISPER_BIN.label,
      run: onBytes => downloadBin(WHISPER_BIN, onBytes),
    });
  }
  if (await binMissing(VAD_BIN)) {
    pending.push({
      bytes: VAD_BIN.bytes,
      label: VAD_BIN.label,
      run: onBytes => downloadBin(VAD_BIN, onBytes),
    });
  }
  if (!qwenReady()) {
    pending.push({
      bytes: QWEN_BYTES,
      label: QWEN_LABEL,
      run: onBytes => downloadQwen(onBytes),
    });
  }
  if (!pending.length) {
    return;
  }

  const totalBytes = pending.reduce((acc, task) => acc + task.bytes, 0);
  let doneBytes = 0;
  for (const task of pending) {
    const base = doneBytes;
    onProgress({label: task.label, fraction: base / totalBytes});
    await task.run(bytes => {
      const clamped = Math.min(Math.max(bytes, 0), task.bytes);
      onProgress({label: task.label, fraction: (base + clamped) / totalBytes});
    });
    doneBytes += task.bytes;
    onProgress({label: task.label, fraction: doneBytes / totalBytes});
  }
}
