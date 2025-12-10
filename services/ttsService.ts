/**
 * TTS Service - Unified Text-to-Speech Interface
 * 
 * Provides a unified interface for TTS generation that can use
 * either OpenAI TTS or ElevenLabs TTS based on configuration.
 * 
 * Supports:
 * - OpenAI TTS (default): Good for English, fast
 * - ElevenLabs TTS: Better for Spanish/Argentine accent, more natural
 */

import { TTSProvider, ChannelConfig, CharacterProfile } from "../types";
import { generateTTSAudio as generateOpenAITTS } from "./openaiService";
import { 
  generateElevenLabsTTS, 
  getElevenLabsVoiceId, 
  ELEVENLABS_VOICES,
  VOICE_PRESETS,
  estimateAudioDuration,
  checkElevenLabsConfig
} from "./elevenlabsService";

// =============================================================================================
// TYPES
// =============================================================================================

export interface TTSResult {
  audioBase64: string;
  audioDuration: number; // Duration in seconds
  provider: TTSProvider;
  voiceId: string;
}

export interface TTSOptions {
  provider?: TTSProvider;
  language?: string;
  voiceStyle?: 'energetic' | 'calm' | 'dramatic' | 'neutral';
}

// =============================================================================================
// PROVIDER DETECTION
// =============================================================================================

/**
 * Check if ElevenLabs is configured and available
 */
export const isElevenLabsAvailable = (): boolean => {
  const config = checkElevenLabsConfig();
  return config.configured;
};

/**
 * Get the best available TTS provider
 * Prefers ElevenLabs for Spanish, falls back to OpenAI
 */
export const getBestTTSProvider = (language?: string): TTSProvider => {
  // For Spanish/Argentine, prefer ElevenLabs if available
  const preferElevenLabs = language?.toLowerCase().includes('spanish') || 
                          language?.toLowerCase().includes('español') ||
                          language?.toLowerCase().includes('es');
  
  if (preferElevenLabs && isElevenLabsAvailable()) {
    return 'elevenlabs';
  }
  
  return 'openai';
};

// =============================================================================================
// UNIFIED TTS GENERATION
// =============================================================================================

/**
 * Generate TTS audio using the specified or best available provider
 * 
 * @param text - Text to convert to speech
 * @param voiceName - Voice name or ID
 * @param character - Optional character profile for voice settings
 * @param options - TTS options including provider preference
 */
export const generateTTS = async (
  text: string,
  voiceName: string,
  character?: CharacterProfile,
  options: TTSOptions = {}
): Promise<TTSResult> => {
  const provider = options.provider || getBestTTSProvider(options.language);
  const language = options.language;
  const voiceStyle = options.voiceStyle || character?.voiceStyle || 'neutral';
  
  console.log(`🎙️ [TTS] Generating audio with provider: ${provider}`);
  
  if (provider === 'elevenlabs') {
    return generateWithElevenLabs(text, voiceName, character, voiceStyle);
  }
  
  return generateWithOpenAI(text, voiceName, language);
};

/**
 * Generate TTS using OpenAI
 */
const generateWithOpenAI = async (
  text: string,
  voiceName: string,
  language?: string
): Promise<TTSResult> => {
  try {
    const audioBase64 = await generateOpenAITTS(text, voiceName, language);
    
    // Estimate duration from text
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const audioDuration = Math.max(1, wordCount / 2.5);
    
    return {
      audioBase64,
      audioDuration,
      provider: 'openai',
      voiceId: voiceName
    };
  } catch (error) {
    console.error(`❌ [TTS] OpenAI TTS failed:`, (error as Error).message);
    throw error;
  }
};

/**
 * Generate TTS using ElevenLabs
 */
const generateWithElevenLabs = async (
  text: string,
  voiceName: string,
  character?: CharacterProfile,
  voiceStyle: 'energetic' | 'calm' | 'dramatic' | 'neutral' = 'neutral'
): Promise<TTSResult> => {
  try {
    // Get ElevenLabs voice ID from character profile or voice name
    let voiceId: string;
    
    if (character?.elevenLabsVoiceId) {
      voiceId = character.elevenLabsVoiceId;
    } else {
      voiceId = getElevenLabsVoiceId(voiceName);
    }
    
    const settings = VOICE_PRESETS[voiceStyle];
    
    const result = await generateElevenLabsTTS(text, voiceId, settings);
    
    return {
      audioBase64: result.audioBase64,
      audioDuration: result.audioDuration,
      provider: 'elevenlabs',
      voiceId
    };
  } catch (error) {
    console.error(`❌ [TTS] ElevenLabs TTS failed:`, (error as Error).message);
    
    // Fallback to OpenAI if ElevenLabs fails
    console.log(`⚠️ [TTS] Falling back to OpenAI TTS...`);
    return generateWithOpenAI(text, voiceName);
  }
};

/**
 * Generate TTS for a broadcast segment with automatic provider selection
 */
export const generateSegmentTTS = async (
  text: string,
  speaker: string,
  config: ChannelConfig
): Promise<TTSResult> => {
  // Determine which character is speaking
  const isHostA = speaker === config.characters.hostA.name;
  const character = isHostA ? config.characters.hostA : config.characters.hostB;
  
  // Get provider from channel config or use best available
  const provider = config.ttsProvider || getBestTTSProvider(config.language);
  
  return generateTTS(text, character.voiceName, character, {
    provider,
    language: config.language,
    voiceStyle: character.voiceStyle
  });
};

/**
 * Generate TTS for multiple segments in parallel
 */
export const generateTTSBatch = async (
  segments: Array<{ text: string; speaker: string }>,
  config: ChannelConfig
): Promise<TTSResult[]> => {
  console.log(`🎙️ [TTS] Generating ${segments.length} audio segments...`);
  
  const promises = segments.map(segment => 
    generateSegmentTTS(segment.text, segment.speaker, config)
  );
  
  const results = await Promise.all(promises);
  
  const totalDuration = results.reduce((acc, r) => acc + r.audioDuration, 0);
  console.log(`✅ [TTS] Generated ${results.length} segments (total duration: ${totalDuration.toFixed(1)}s)`);
  
  return results;
};

// =============================================================================================
// EXPORTS
// =============================================================================================

export const TTSService = {
  generate: generateTTS,
  generateSegment: generateSegmentTTS,
  generateBatch: generateTTSBatch,
  isElevenLabsAvailable,
  getBestProvider: getBestTTSProvider,
  estimateDuration: estimateAudioDuration,
  ELEVENLABS_VOICES
};

