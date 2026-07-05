import {HuggingFaceModel, Model, ModelOrigin, ModelType} from '../utils/types';
import {chatTemplates} from '../utils/chat';
import {defaultCompletionParams} from '../utils/completionSettingsVersions';

const LUNA_QWEN_REPO = 'Qwen/Qwen2.5-3B-Instruct-GGUF';
const LUNA_QWEN_FILENAME = 'qwen2.5-3b-instruct-q4_k_m.gguf';

export const LUNA_QWEN_MODEL_ID = `${LUNA_QWEN_REPO}/${LUNA_QWEN_FILENAME}`;

const LUNA_QWEN_HF_MODEL = {
  id: LUNA_QWEN_REPO,
  author: 'Qwen',
  url: `https://huggingface.co/${LUNA_QWEN_REPO}`,
  specs: {gguf: {total: 3085938688}},
  siblings: [
    {
      rfilename: LUNA_QWEN_FILENAME,
      url: `https://huggingface.co/${LUNA_QWEN_REPO}/resolve/main/${LUNA_QWEN_FILENAME}`,
      size: 2080000000,
    },
  ],
} as unknown as HuggingFaceModel;

export const LUNA_QWEN_MODEL: Model = {
  id: LUNA_QWEN_MODEL_ID,
  author: 'Qwen',
  repo: 'Qwen2.5-3B-Instruct-GGUF',
  name: 'Qwen2.5 3B Instruct (Q4_K_M)',
  type: 'Qwen2.5',
  capabilities: ['instructions', 'questionAnswering', 'multilingual'],
  size: 2080000000,
  params: 3085938688,
  isDownloaded: false,
  downloadUrl: `https://huggingface.co/${LUNA_QWEN_REPO}/resolve/main/${LUNA_QWEN_FILENAME}`,
  hfUrl: `https://huggingface.co/${LUNA_QWEN_REPO}`,
  progress: 0,
  filename: LUNA_QWEN_FILENAME,
  isLocal: false,
  origin: ModelOrigin.HF,
  modelType: ModelType.LLM,
  defaultChatTemplate: chatTemplates.qwen25,
  chatTemplate: chatTemplates.qwen25,
  defaultCompletionSettings: {
    ...defaultCompletionParams,
    n_predict: 180,
    temperature: 0.8,
  },
  completionSettings: {
    ...defaultCompletionParams,
    n_predict: 180,
    temperature: 0.8,
  },
  defaultStopWords: ['<|im_end|>', '<|endoftext|>'],
  stopWords: ['<|im_end|>', '<|endoftext|>'],
  hfModel: LUNA_QWEN_HF_MODEL,
  hfModelFile: {
    rfilename: LUNA_QWEN_FILENAME,
    url: `https://huggingface.co/${LUNA_QWEN_REPO}/resolve/main/${LUNA_QWEN_FILENAME}`,
    size: 2080000000,
    canFitInStorage: true,
  },
  isRulePreset: false,
};

// The SmolVLM repo subset hfAsModel/addHFModel read: the LLM file plus both
// mmproj siblings. Carrying this lets the download warning route through
// downloadHFModel→addHFModel, which materializes the LLM + mmproj Models into
// the store and downloads both, instead of looking up an id that was never
// reconciled in.
const LOOKIE_HF_MODEL = {
  id: 'ggml-org/SmolVLM-500M-Instruct-GGUF',
  author: 'ggml-org',
  url: 'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF',
  siblings: [
    {
      rfilename: 'SmolVLM-500M-Instruct-Q8_0.gguf',
      url: 'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf',
      size: 436806912,
    },
    {
      rfilename: 'mmproj-SmolVLM-500M-Instruct-Q8_0.gguf',
      url: 'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf',
      size: 108783360,
    },
    {
      rfilename: 'mmproj-SmolVLM-500M-Instruct-f16.gguf',
      url: 'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-500M-Instruct-f16.gguf',
      size: 199468800,
    },
  ],
} as unknown as HuggingFaceModel;

// Default model for the built-in Lookie pal. It is a vision model outside the
// device-rule tiers, so it ships as a self-contained offline constant rather
// than being resolved over the network at pal init.
export const LOOKIE_DEFAULT_MODEL: Model = {
  id: 'ggml-org/SmolVLM-500M-Instruct-GGUF/SmolVLM-500M-Instruct-Q8_0.gguf',
  author: 'ggml-org',
  repo: 'SmolVLM-500M-Instruct-GGUF',
  name: 'SmolVLM2-500M-Instruct (Q8_0)',
  type: 'SmolVLM',
  capabilities: ['vision'],
  visionEnabled: true,
  size: 436806912,
  params: 409252800,
  isDownloaded: false,
  downloadUrl:
    'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf',
  hfUrl: 'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF',
  progress: 0,
  filename: 'SmolVLM-500M-Instruct-Q8_0.gguf',
  isLocal: false,
  origin: ModelOrigin.HF,
  modelType: ModelType.VISION,
  defaultChatTemplate: chatTemplates.smolVLM,
  chatTemplate: chatTemplates.smolVLM,
  defaultCompletionSettings: {
    ...defaultCompletionParams,
    n_predict: 500,
    temperature: 0.7,
  },
  completionSettings: {
    ...defaultCompletionParams,
    n_predict: 500,
    temperature: 0.7,
  },
  defaultStopWords: ['<|endoftext|>', '<|im_end|>', '<end_of_utterance>'],
  stopWords: ['<|endoftext|>', '<|im_end|>', '<end_of_utterance>'],
  hfModel: LOOKIE_HF_MODEL,
  hfModelFile: {
    rfilename: 'SmolVLM-500M-Instruct-Q8_0.gguf',
    url: 'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf',
    size: 436806912,
    canFitInStorage: true,
  },
  supportsMultimodal: true,
  compatibleProjectionModels: [
    'ggml-org/SmolVLM-500M-Instruct-GGUF/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf',
    'ggml-org/SmolVLM-500M-Instruct-GGUF/mmproj-SmolVLM-500M-Instruct-f16.gguf',
  ],
  defaultProjectionModel:
    'ggml-org/SmolVLM-500M-Instruct-GGUF/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf',
};
