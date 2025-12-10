/**
 * ElevenLabs TTS Service
 * 
 * Provides high-quality text-to-speech using ElevenLabs API.
 * Supports Argentine Spanish voices for authentic regional accent.
 * 
 * Voice IDs:
 * - HostA: FrrTxu4nrplZwLlMy2kD
 * - HostB: CDrROTHWaKY3O9vD3F3t
 * 
 * Pricing: ~$0.30 per 1000 characters (varies by subscription tier)
 * 
 * API Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
 */

import { CostTracker } from "./CostTracker";

// =============================================================================================
// CONFIGURATION
// =============================================================================================

/**
 * ElevenLabs Voice IDs for Argentine Spanish
 */
export const ELEVENLABS_VOICES = {
  // Argentine voices
  hostA: 'FrrTxu4nrplZwLlMy2kD', // Male Argentine voice
  hostB: 'CDrROTHWaKY3O9vD3F3t', // Female Argentine voice
  
  // Fallback voices (ElevenLabs default voices)
  fallbackMale: 'pNInz6obpgDQGcFmaJgB', // Adam
  fallbackFemale: 'EXAVITQu4vr4xnSDxMaL', // Sarah
} as const;

/**
 * ElevenLabs model IDs
 * - eleven_multilingual_v2: Best quality, supports 29 languages
 * - eleven_turbo_v2_5: Fastest, good for streaming
 * - eleven_turbo_v2: Fast, optimized for English
 */
export const ELEVENLABS_MODELS = {
  multilingual_v2: 'eleven_multilingual_v2', // Best for Spanish
  turbo_v2_5: 'eleven_turbo_v2_5', // Fast streaming
  turbo_v2: 'eleven_turbo_v2', // Legacy fast model
} as const;

/**
 * Voice settings for TTS generation
 */
export interface ElevenLabsVoiceSettings {
  stability: number;        // 0-1, lower = more expressive, higher = more consistent
  similarity_boost: number; // 0-1, higher = closer to original voice
  style?: number;           // 0-1, only for some models (expressiveness)
  use_speaker_boost?: boolean; // Enhances voice clarity
}

/**
 * Default voice settings optimized for news broadcast
 */
export const DEFAULT_VOICE_SETTINGS: ElevenLabsVoiceSettings = {
  stability: 0.5,           // Balanced expression
  similarity_boost: 0.75,   // High similarity to voice
  style: 0.5,               // Moderate expressiveness
  use_speaker_boost: true,  // Enhanced clarity
};

/**
 * Voice presets for different speaking styles
 */
export const VOICE_PRESETS = {
  energetic: {
    stability: 0.35,
    similarity_boost: 0.70,
    style: 0.75,
    use_speaker_boost: true,
  },
  calm: {
    stability: 0.70,
    similarity_boost: 0.80,
    style: 0.25,
    use_speaker_boost: true,
  },
  dramatic: {
    stability: 0.25,
    similarity_boost: 0.65,
    style: 0.90,
    use_speaker_boost: true,
  },
  neutral: DEFAULT_VOICE_SETTINGS,
} as const;

// =============================================================================================
// PROXY CONFIGURATION
// =============================================================================================

/**
 * Get proxy URL for ElevenLabs API
 */
const getProxyUrl = (): string => {
  const explicitUrl = import.meta.env.VITE_BACKEND_URL || "";
  if (explicitUrl) return explicitUrl;
  
  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    if (origin.includes('vercel.app') || origin.includes('localhost')) {
      return origin;
    }
  }
  return "";
};

/**
 * Make a request to ElevenLabs via proxy
 */
const elevenlabsRequest = async (
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: any,
  options: { timeout?: number } = {}
): Promise<any> => {
  const { timeout = 60000 } = options;
  const proxyUrl = getProxyUrl().replace(/\/$/, '');
  const url = `${proxyUrl}/api/elevenlabs?endpoint=${encodeURIComponent(endpoint)}`;
  
  console.log(`[ElevenLabs] 🔗 Calling: ${endpoint}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    }
    
    return response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`ElevenLabs request timeout after ${timeout}ms`);
    }
    throw error;
  }
};

// =============================================================================================
// TTS GENERATION
// =============================================================================================

/**
 * Sanitize text for TTS - remove problematic characters
 */
const sanitizeTextForTTS = (text: string): string => {
  if (!text || typeof text !== 'string') {
    throw new Error('TTS input text is empty or invalid');
  }
  
  let sanitized = text.trim().replace(/\s+/g, ' ');
  
  // Normalize special characters
  sanitized = sanitized
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .replace(/[""]/g, '"') // Normalize smart quotes
    .replace(/['']/g, "'") // Normalize smart apostrophes
    .replace(/[–—]/g, '-') // Normalize dashes
    .replace(/…/g, '...') // Normalize ellipsis
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
  
  if (sanitized.length === 0) {
    throw new Error('TTS input text is empty after sanitization');
  }
  
  // ElevenLabs has a character limit (5000 characters per request)
  if (sanitized.length > 5000) {
    console.warn(`[ElevenLabs] ⚠️ Text truncated from ${sanitized.length} to 5000 characters`);
    sanitized = sanitized.substring(0, 5000);
  }
  
  return sanitized;
};

/**
 * Estimate audio duration from text (approximate)
 * Average speaking rate: ~150 words per minute = 2.5 words per second
 */
export const estimateAudioDuration = (text: string): number => {
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
  const wordsPerSecond = 2.5;
  return Math.max(1, Math.ceil(wordCount / wordsPerSecond));
};

/**
 * Get voice ID from voice name or host identifier
 */
export const getElevenLabsVoiceId = (
  voiceNameOrId: string,
  hostAVoiceId?: string,
  hostBVoiceId?: string
): string => {
  const normalized = voiceNameOrId.toLowerCase().trim();
  
  // Check if it's already a valid ElevenLabs voice ID (24 char alphanumeric)
  if (/^[a-zA-Z0-9]{20,30}$/.test(voiceNameOrId)) {
    return voiceNameOrId;
  }
  
  // Check for hostA/hostB references
  if (normalized === 'hosta' || normalized.includes('host a') || normalized.includes('host_a')) {
    return hostAVoiceId || ELEVENLABS_VOICES.hostA;
  }
  if (normalized === 'hostb' || normalized.includes('host b') || normalized.includes('host_b')) {
    return hostBVoiceId || ELEVENLABS_VOICES.hostB;
  }
  
  // Check for gender hints
  if (normalized.includes('female') || normalized.includes('woman') || normalized.includes('girl')) {
    return ELEVENLABS_VOICES.hostB;
  }
  if (normalized.includes('male') || normalized.includes('man') || normalized.includes('boy')) {
    return ELEVENLABS_VOICES.hostA;
  }
  
  // Default to hostA
  return ELEVENLABS_VOICES.hostA;
};

export interface TTSResult {
  audioBase64: string;
  audioDuration: number; // Duration in seconds
  characterCount: number;
  voiceId: string;
  modelId: string;
}

/**
 * Generate TTS audio using ElevenLabs
 * Returns base64-encoded MP3
 * 
 * @param text - The text to convert to speech
 * @param voiceId - ElevenLabs voice ID
 * @param settings - Voice settings (stability, similarity, etc.)
 * @param modelId - Model to use (default: multilingual_v2 for Spanish)
 */
export const generateElevenLabsTTS = async (
  text: string,
  voiceId: string,
  settings: ElevenLabsVoiceSettings = DEFAULT_VOICE_SETTINGS,
  modelId: string = ELEVENLABS_MODELS.multilingual_v2
): Promise<TTSResult> => {
  // Validate and sanitize input
  const sanitizedText = sanitizeTextForTTS(text);
  
  console.log(`[ElevenLabs] 🎙️ Generating audio with voice: ${voiceId}, model: ${modelId}`);
  console.log(`[ElevenLabs] 📝 Text length: ${sanitizedText.length} characters`);
  
  const endpoint = `v1/text-to-speech/${voiceId}`;
  
  const requestBody = {
    text: sanitizedText,
    model_id: modelId,
    voice_settings: {
      stability: settings.stability,
      similarity_boost: settings.similarity_boost,
      style: settings.style,
      use_speaker_boost: settings.use_speaker_boost,
    },
    // Request timing info for accurate duration
    output_format: 'mp3_44100_128', // High quality MP3
  };
  
  try {
    const response = await elevenlabsRequest(endpoint, 'POST', requestBody, { timeout: 90000 });
    
    if (!response.audio) {
      throw new Error('ElevenLabs TTS response missing audio data');
    }
    
    // Get actual duration from response or estimate
    const audioDuration = response.duration || estimateAudioDuration(sanitizedText);
    
    // Track cost (~$0.30 per 1000 characters for Creator tier)
    const cost = (sanitizedText.length / 1000) * 0.30;
    CostTracker.track('audio', 'elevenlabs-tts', cost);
    
    console.log(`[ElevenLabs] ✅ Audio generated successfully (${audioDuration}s, ${sanitizedText.length} chars)`);
    
    return {
      audioBase64: response.audio,
      audioDuration: audioDuration,
      characterCount: sanitizedText.length,
      voiceId,
      modelId,
    };
  } catch (error: any) {
    console.error(`[ElevenLabs] ❌ TTS failed:`, error.message);
    throw error;
  }
};

/**
 * Generate TTS for a broadcast segment
 * Automatically selects voice based on speaker/host
 */
export const generateSegmentTTS = async (
  text: string,
  speaker: string,
  voiceStyle: 'energetic' | 'calm' | 'dramatic' | 'neutral' = 'neutral',
  hostAVoiceId?: string,
  hostBVoiceId?: string
): Promise<TTSResult> => {
  const voiceId = getElevenLabsVoiceId(speaker, hostAVoiceId, hostBVoiceId);
  const settings = VOICE_PRESETS[voiceStyle];
  
  return generateElevenLabsTTS(text, voiceId, settings);
};

/**
 * Generate TTS audio for multiple segments in parallel
 */
export const generateTTSBatch = async (
  segments: Array<{
    text: string;
    speaker: string;
    voiceStyle?: 'energetic' | 'calm' | 'dramatic' | 'neutral';
  }>,
  hostAVoiceId?: string,
  hostBVoiceId?: string
): Promise<TTSResult[]> => {
  console.log(`[ElevenLabs] 🎙️ Generating ${segments.length} audio segments in parallel`);
  
  const promises = segments.map(segment => 
    generateSegmentTTS(
      segment.text,
      segment.speaker,
      segment.voiceStyle || 'neutral',
      hostAVoiceId,
      hostBVoiceId
    )
  );
  
  return Promise.all(promises);
};

// =============================================================================================
// CONFIGURATION CHECK
// =============================================================================================

/**
 * Check if ElevenLabs is properly configured
 */
export const checkElevenLabsConfig = (): { configured: boolean; message: string } => {
  const proxyUrl = getProxyUrl();
  
  if (proxyUrl) {
    return {
      configured: true,
      message: `✅ Using ElevenLabs proxy at ${proxyUrl}/api/elevenlabs`
    };
  }
  
  return {
    configured: false,
    message: `❌ No proxy URL configured. Set VITE_BACKEND_URL or deploy to Vercel.`
  };
};

// =============================================================================================
// EXPORTS
// =============================================================================================

export const ElevenLabsService = {
  generateTTS: generateElevenLabsTTS,
  generateSegmentTTS,
  generateTTSBatch,
  getVoiceId: getElevenLabsVoiceId,
  estimateDuration: estimateAudioDuration,
  checkConfig: checkElevenLabsConfig,
  VOICES: ELEVENLABS_VOICES,
  MODELS: ELEVENLABS_MODELS,
  PRESETS: VOICE_PRESETS,
};

