/**
 * OpenAI Service
 * 
 * Provides GPT-4o for text generation and OpenAI TTS for audio.
 * Uses the /api/openai proxy for all requests.
 */

import { ScriptLine, NewsItem, ViralMetadata, ChannelConfig } from "../types";
import { CostTracker } from "./CostTracker";

// Get proxy URL (auto-detect in production)
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
 * Make a request to OpenAI via proxy
 */
const openaiRequest = async (
  endpoint: string,
  body: any
): Promise<any> => {
  const proxyUrl = getProxyUrl().replace(/\/$/, '');
  const url = `${proxyUrl}/api/openai?endpoint=${encodeURIComponent(endpoint)}`;
  
  console.log(`[OpenAI] 🔗 Calling: ${endpoint}`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
  }
  
  return response.json();
};

// =============================================================================================
// TEXT GENERATION (GPT-4o)
// =============================================================================================

/**
 * Generate a script from selected news
 */
export const generateScriptWithGPT = async (
  news: NewsItem[], 
  config: ChannelConfig, 
  viralHook?: string
): Promise<ScriptLine[]> => {
  const newsContext = news.map(n => `- ${n.headline} (Source: ${n.source}). Summary: ${n.summary}`).join('\n');

  const systemPrompt = `You are the showrunner for "${config.channelName}", a short 1-minute news segment hosted by: 
1. "${config.characters.hostA.name}" (${config.characters.hostA.bio}).
2. "${config.characters.hostB.name}" (${config.characters.hostB.bio}).

Tone: ${config.tone}.
Language: ${config.language}.

They are discussing the selected news.

SCRIPT STRUCTURE (60 seconds):
- 0-10s: HOOK (grab attention)${viralHook ? ` Use this: "${viralHook}"` : ''}
- 10-40s: CONTENT (deliver value, cite sources)
- 40-50s: PAYOFF (answer the hook)
- 50-60s: CTA (subscribe/like)

Rules:
- KEEP IT UNDER 150 WORDS TOTAL (approx 1 minute).
- CITATION REQUIRED: You MUST explicitly mention the source of the news in the dialogue.
- Structure the output as a JSON Array of objects: [{"speaker": "${config.characters.hostA.name}", "text": "..."}, {"speaker": "${config.characters.hostB.name}", "text": "..."}].
- Use "Both" as speaker for the intro/outro if they speak together.
- Be creative, use puns related to the characters.
- Pattern interrupt every 15 seconds
- Use "you" language
- STRICT JSON OUTPUT. NO MARKDOWN.`;

  const response = await openaiRequest('chat/completions', {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Here is the selected news for today's episode:\n${newsContext}\n\nWrite the script in JSON format.` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7
  });

  // Track cost (~500 input + ~300 output tokens)
  CostTracker.track('script', 'gpt-4o', 0.01);

  try {
    const content = response.choices[0]?.message?.content || '{"script":[]}';
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : parsed.script || [];
  } catch (e) {
    console.error("Failed to parse script from GPT-4o:", e);
    throw new Error(`Failed to parse script: ${(e as Error).message}`);
  }
};

/**
 * Generate viral metadata (title, description, tags)
 */
export const generateViralMetadataWithGPT = async (
  news: NewsItem[], 
  config: ChannelConfig, 
  date: Date,
  trendingTopics: string[] = []
): Promise<ViralMetadata> => {
  const newsContext = news.map(n => `- ${n.headline} (Viral Score: ${n.viralScore})`).join('\n');
  const dateStr = date.toLocaleDateString();

  const prompt = `You are a VIRAL YouTube expert with 100M+ views across channels.

NEWS STORIES:
${newsContext}

TRENDING NOW IN ${config.country}:
${trendingTopics.join(', ')}

Create HIGH-CTR metadata in JSON format with these fields:
- title (max 60 chars): Use power words like SHOCKING, BREAKING, EXPOSED. Include emoji.
- description (max 250 chars): Hook in first 10 words, include date: ${dateStr}, end with "${config.tagline}"
- tags (exactly 20): Mix broad + specific, include ${(config.defaultTags || []).join(', ')}

Return ONLY valid JSON: {"title": "...", "description": "...", "tags": ["...", ...]}`;

  const response = await openaiRequest('chat/completions', {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.8
  });

  CostTracker.track('metadata', 'gpt-4o', 0.015);

  try {
    const content = response.choices[0]?.message?.content || '{}';
    const metadata = JSON.parse(content);
    
    return {
      title: metadata.title?.substring(0, 60) || "Breaking News",
      description: metadata.description?.substring(0, 250) || "",
      tags: Array.isArray(metadata.tags) ? metadata.tags.slice(0, 20) : []
    };
  } catch (e) {
    console.error("Failed to parse metadata from GPT-4o:", e);
    return { title: "Breaking News", description: "", tags: [] };
  }
};

/**
 * Generate a viral hook for the intro
 */
export const generateViralHookWithGPT = async (
  news: NewsItem[],
  config: ChannelConfig
): Promise<string> => {
  const topStory = news[0];

  const prompt = `You are a VIRAL content scriptwriter (100M+ views).

Create an ATTENTION-GRABBING opening hook (2-3 sentences, max 30 words) for this news:
"${topStory.headline}"

HOOK FORMULA:
1. Shocking statement OR urgent question
2. Promise immediate value
3. Create curiosity gap

POWER WORDS: YOU, THIS, NOW, SHOCKING, BREAKING, EXPOSED, REVEALED

Channel tone: ${config.tone}
Language: ${config.language}

Return ONLY the hook text, no explanation, no quotes.`;

  const response = await openaiRequest('chat/completions', {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.9
  });

  CostTracker.track('viralHook', 'gpt-4o', 0.005);

  return response.choices[0]?.message?.content?.trim() || "You won't believe this news...";
};

// =============================================================================================
// TEXT-TO-SPEECH (OpenAI TTS)
// =============================================================================================

// Voice mapping - map character voice names to OpenAI voices
const OPENAI_VOICES = {
  // Male voices
  'Puck': 'onyx',      // Deep male
  'Charon': 'onyx',
  'Kore': 'echo',      // Warm male
  'Fenrir': 'echo',
  'Orus': 'fable',     // British male
  
  // Female voices
  'Aoede': 'nova',     // Warm female
  'Zephyr': 'nova',
  'Leda': 'shimmer',   // Expressive female
  'Elara': 'shimmer',
  'Hera': 'alloy',     // Neutral female
  
  // Default mappings
  'default_male': 'onyx',
  'default_female': 'nova'
} as const;

type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

/**
 * Map a character voice name to an OpenAI voice
 */
const mapVoiceToOpenAI = (voiceName: string): OpenAIVoice => {
  // Direct mapping
  if (voiceName in OPENAI_VOICES) {
    return OPENAI_VOICES[voiceName as keyof typeof OPENAI_VOICES] as OpenAIVoice;
  }
  
  // Try to detect gender from name
  const lowerName = voiceName.toLowerCase();
  if (lowerName.includes('female') || lowerName.includes('woman')) {
    return 'nova';
  }
  if (lowerName.includes('male') || lowerName.includes('man')) {
    return 'onyx';
  }
  
  // Default to alloy (neutral)
  return 'alloy';
};

/**
 * Generate TTS audio for a single line
 * Returns base64-encoded MP3
 */
export const generateTTSAudio = async (
  text: string,
  voiceName: string
): Promise<string> => {
  const voice = mapVoiceToOpenAI(voiceName);
  
  console.log(`[OpenAI TTS] 🎙️ Generating audio with voice: ${voice} (mapped from ${voiceName})`);
  
  const response = await openaiRequest('audio/speech', {
    model: 'tts-1',
    input: text,
    voice: voice,
    response_format: 'mp3'
  });
  
  // Cost: ~$0.015 per 1000 characters
  const charCount = text.length;
  const cost = (charCount / 1000) * 0.015;
  CostTracker.track('audio', 'openai-tts-1', cost);
  
  // The proxy returns { audio: base64, format: 'mp3' }
  return response.audio;
};

/**
 * Generate TTS audio for multiple lines in parallel
 */
export const generateTTSBatch = async (
  lines: { text: string; voiceName: string }[]
): Promise<string[]> => {
  console.log(`[OpenAI TTS] 🎙️ Generating ${lines.length} audio segments in parallel`);
  
  const promises = lines.map(line => generateTTSAudio(line.text, line.voiceName));
  return Promise.all(promises);
};

// =============================================================================================
// IMAGE GENERATION (DALL-E 3 - Fallback)
// =============================================================================================

/**
 * Generate an image using DALL-E 3
 * Used as fallback when WaveSpeed Nano Banana fails
 */
export const generateImageWithDALLE = async (
  prompt: string,
  size: '1024x1024' | '1792x1024' | '1024x1792' = '1792x1024'
): Promise<string | null> => {
  console.log(`[DALL-E 3] 🎨 Generating image...`);
  
  try {
    const response = await openaiRequest('images/generations', {
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: size,
      quality: 'standard',
      response_format: 'b64_json'
    });
    
    // Cost: $0.04 for standard, $0.08 for HD
    CostTracker.track('thumbnail', 'dall-e-3', 0.04);
    
    const imageData = response.data?.[0]?.b64_json;
    if (imageData) {
      return `data:image/png;base64,${imageData}`;
    }
    return null;
  } catch (error) {
    console.error("[DALL-E 3] ❌ Image generation failed:", error);
    return null;
  }
};

/**
 * Check if OpenAI proxy is configured
 */
export const checkOpenAIConfig = (): { configured: boolean; message: string } => {
  const proxyUrl = getProxyUrl();
  
  if (proxyUrl) {
    return {
      configured: true,
      message: `✅ Using OpenAI proxy at ${proxyUrl}/api/openai`
    };
  }
  
  return {
    configured: false,
    message: `❌ No proxy URL configured. Set VITE_BACKEND_URL or deploy to Vercel.`
  };
};
