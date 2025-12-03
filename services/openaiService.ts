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
 * Make a request to OpenAI via proxy with retry logic
 */
const openaiRequest = async (
  endpoint: string,
  body: any,
  options: { retries?: number; timeout?: number } = {}
): Promise<any> => {
  const { retries = 2, timeout = 55000 } = options; // 55s to leave room before Vercel timeout
  const proxyUrl = getProxyUrl().replace(/\/$/, '');
  const url = `${proxyUrl}/api/openai?endpoint=${encodeURIComponent(endpoint)}`;
  
  console.log(`[OpenAI] 🔗 Calling: ${endpoint}`);
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || 'Unknown error';
        
        // If timeout or server error, allow retry
        if (response.status >= 500 && attempt < retries) {
          console.warn(`[OpenAI] ⚠️ Attempt ${attempt + 1} failed (${response.status}), retrying...`);
          lastError = new Error(`OpenAI API error: ${response.status} - ${errorMsg}`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
          continue;
        }
        
        throw new Error(`OpenAI API error: ${response.status} - ${errorMsg}`);
      }
      
      return response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`[OpenAI] ⏱️ Request timeout after ${timeout}ms`);
        lastError = new Error('Request timeout');
      } else {
        lastError = error;
      }
      
      if (attempt < retries) {
        console.warn(`[OpenAI] ⚠️ Attempt ${attempt + 1} failed, retrying...`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
  }
  
  throw lastError || new Error('OpenAI request failed after retries');
};

// =============================================================================================
// TEXT GENERATION (GPT-4o)
// =============================================================================================

/**
 * Generate a script from selected news with fallback to gpt-4o-mini
 */
export const generateScriptWithGPT = async (
  news: NewsItem[], 
  config: ChannelConfig, 
  viralHook?: string
): Promise<ScriptLine[]> => {
  // Limit news items to reduce context size and latency
  const limitedNews = news.slice(0, 5);
  const newsContext = limitedNews.map(n => `- ${n.headline} (${n.source}): ${n.summary?.substring(0, 100) || ''}`).join('\n');

  const systemPrompt = `You are the showrunner for "${config.channelName}", a 1-minute news segment hosted by: 
1. "${config.characters.hostA.name}" (${config.characters.hostA.bio}).
2. "${config.characters.hostB.name}" (${config.characters.hostB.bio}).

Tone: ${config.tone}. Language: ${config.language}.

SCRIPT STRUCTURE (60 seconds):
- 0-10s: HOOK${viralHook ? ` "${viralHook}"` : ''}
- 10-40s: CONTENT (cite sources)
- 40-50s: PAYOFF
- 50-60s: CTA

Rules:
- MAX 150 WORDS TOTAL
- CITE the news source in dialogue
- JSON Array: [{"speaker": "${config.characters.hostA.name}", "text": "..."}, ...]
- Use "Both" for intro/outro
- STRICT JSON. NO MARKDOWN.`;

  const requestBody = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Today's news:\n${newsContext}\n\nWrite the script as JSON.` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7
  };

  // Try GPT-4o first, fallback to gpt-4o-mini if it fails
  const models = ['gpt-4o', 'gpt-4o-mini'];
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      console.log(`[Script] 🎬 Trying ${model}...`);
      const response = await openaiRequest('chat/completions', {
        model,
        ...requestBody
      }, { timeout: model === 'gpt-4o' ? 45000 : 30000 }); // Shorter timeout for first try

      CostTracker.track('script', model, model === 'gpt-4o' ? 0.01 : 0.002);

      const content = response.choices[0]?.message?.content || '{"script":[]}';
      const parsed = JSON.parse(content);
      console.log(`[Script] ✅ Success with ${model}`);
      return Array.isArray(parsed) ? parsed : parsed.script || [];
    } catch (error: any) {
      console.warn(`[Script] ⚠️ ${model} failed:`, error.message);
      lastError = error;
      // Continue to next model
    }
  }

  console.error("[Script] ❌ All models failed");
  throw lastError || new Error('Script generation failed');
};

/**
 * Generate viral metadata (title, description, tags) with fallback
 */
export const generateViralMetadataWithGPT = async (
  news: NewsItem[], 
  config: ChannelConfig, 
  date: Date,
  trendingTopics: string[] = []
): Promise<ViralMetadata> => {
  // Limit news to top 3 for faster processing
  const topNews = news.slice(0, 3);
  const newsContext = topNews.map(n => `- ${n.headline} (Score: ${n.viralScore})`).join('\n');
  const dateStr = date.toLocaleDateString();

  const prompt = `You are a VIRAL YouTube SEO expert with 10+ years optimizing for maximum CTR and discoverability.

Create HIGH-PERFORMANCE metadata for this news broadcast video:

NEWS STORIES:
${newsContext}

TRENDING TOPICS: ${trendingTopics.slice(0, 5).join(', ')}
DATE: ${dateStr}
CHANNEL: ${config.tagline}

Generate metadata following YouTube SEO best practices:

TITLE (70-80 characters):
- Start with POWER WORDS: BREAKING, SHOCKING, EXPOSED, URGENT, REVEALED
- Include main keyword from top story
- Add 1-2 relevant emojis for visual appeal
- Create curiosity gap without clickbait

DESCRIPTION (500-700 characters):
- Line 1: Compelling hook summarizing the main story (this shows in search results)
- Line 2-3: Key details and context about the news
- Include date: ${dateStr}
- Include channel branding: "${config.tagline}"
- Add relevant keywords naturally
- End with call-to-action: subscribe, like, comment prompt

TAGS (20 tags):
- Mix of broad and specific keywords
- Include trending topics if relevant
- Must include: ${(config.defaultTags || []).slice(0, 5).join(', ')}

Return ONLY valid JSON: {"title": "...", "description": "...", "tags": [...]}`;

  const requestBody = {
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.8
  };

  // Try GPT-4o first, fallback to gpt-4o-mini
  const models = ['gpt-4o', 'gpt-4o-mini'];

  for (const model of models) {
    try {
      console.log(`[Metadata] 🏷️ Trying ${model}...`);
      const response = await openaiRequest('chat/completions', {
        model,
        ...requestBody
      }, { timeout: model === 'gpt-4o' ? 30000 : 20000 });

      CostTracker.track('metadata', model, model === 'gpt-4o' ? 0.015 : 0.003);

      const content = response.choices[0]?.message?.content || '{}';
      const metadata = JSON.parse(content);
      console.log(`[Metadata] ✅ Success with ${model}`);
      
      return {
        title: metadata.title?.substring(0, 100) || "Breaking News",
        description: metadata.description?.substring(0, 1000) || "",
        tags: Array.isArray(metadata.tags) ? metadata.tags.slice(0, 20) : []
      };
    } catch (error: any) {
      console.warn(`[Metadata] ⚠️ ${model} failed:`, error.message);
    }
  }

  console.error("[Metadata] ❌ All models failed, using defaults");
  return { title: "Breaking News", description: "", tags: config.defaultTags || [] };
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
