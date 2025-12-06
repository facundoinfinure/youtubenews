/**
 * OpenAI Service
 * 
 * Provides GPT-4o for text generation and OpenAI TTS for audio.
 * Uses the /api/openai proxy for all requests.
 */

import { ScriptLine, NewsItem, ViralMetadata, ChannelConfig, ScriptWithScenes, NarrativeType, Scene } from "../types";
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
): Promise<ScriptWithScenes> => {
  // Limit news items to reduce context size and latency
  const limitedNews = news.slice(0, 5);
  const newsContext = limitedNews.map(n => `- ${n.headline} (${n.source}): ${n.summary?.substring(0, 160) || ''}`).join('\n');

  const hostA = config.characters.hostA;
  const hostB = config.characters.hostB;

  const hostProfilePrompt = `
hostA:
- name: ${hostA.name}
- voice: ${hostA.voiceName}
- outfit: ${hostA.outfit || 'dark hoodie'}
- personality: ${hostA.personality || hostA.bio}
- gender: ${hostA.gender || 'male'}

hostB:
- name: ${hostB.name}
- voice: ${hostB.voiceName}
- outfit: ${hostB.outfit || 'teal blazer and white shirt'}
- personality: ${hostB.personality || hostB.bio}
- gender: ${hostB.gender || 'female'}
`.trim();

  const narrativeInstructions = `
Choose ONE narrative structure based on the complexity of the news:
Classic Arc (6 scenes)
Double Conflict Arc (7 scenes)
Hot Take Compressed (4 scenes)
Perspective Clash (6 scenes)

Logic:
- Use Double Conflict if multiple drivers or volatile news
- Use Hot Take if the story is simple or meme-like
- Use Perspective Clash if the story has two clear interpretations
- Otherwise use Classic
`.trim();

  const dialogueRules = `
Dialogue Rules:
- Alternate dialogue strictly (${hostA.name} then ${hostB.name})
- No narration, stage directions, or camera cues
- Tone: conversational podcast banter (${config.tone})
- 80–130 words per scene (40–80 for Hot Take scenes)
- Reference news sources naturally in dialogue
`.trim();

  const metadataRules = `
For EACH scene provide:
- title: Short, catchy title for the lower-third overlay (e.g., "Market Outlook Explained", "Why Tech Is Surging", "The Bitcoin Debate")
  - Keep it 3-6 words, punchy and descriptive
  - Should summarize what THIS scene is about
- video_mode: "hostA" | "hostB" | "both"
- model: "infinite_talk" for solo, "infinite_talk_multi" for both
- shot: default "medium", "closeup" for Hook/Conflict, "wide" for Payoff

IMPORTANT - Dialogue format depends on video_mode:
- If video_mode is "hostA" or "hostB": use "text" field with that host's dialogue
- If video_mode is "both": use BOTH "hostA_text" AND "hostB_text" fields with SEPARATE dialogues for each host
  - Also include "order": "left_first" if ${hostA.name} speaks first, "right_first" if ${hostB.name} speaks first
  - Each host should have 40-65 words in their dialogue (not the same text!)
`.trim();

  const outputFormat = `
Return STRICT JSON (no markdown) with this exact format:
{
  "title": "Episode title",
  "narrative_used": "classic | double_conflict | hot_take | perspective_clash",
  "scenes": {
    "1": {
      "title": "Scene Title Here",
      "text": "dialogue for single host scene",
      "video_mode": "hostA | hostB",
      "model": "infinite_talk",
      "shot": "medium | closeup | wide"
    },
    "2": {
      "title": "Another Scene Title",
      "hostA_text": "${hostA.name}'s dialogue (40-65 words)",
      "hostB_text": "${hostB.name}'s dialogue (40-65 words)",
      "order": "left_first | right_first",
      "text": "",
      "video_mode": "both",
      "model": "infinite_talk_multi",
      "shot": "medium | closeup | wide"
    }
  }
}

NOTE: For "both" scenes, hostA_text and hostB_text are REQUIRED and must be DIFFERENT dialogues.
The "text" field should be empty or a combination for backwards compatibility.
IMPORTANT: Each scene MUST have a unique "title" for the lower-third overlay.
`.trim();

  const systemPrompt = `
You are the head writer of "${config.channelName}", a daily business/markets podcast hosted by two animated chimpanzees.

${hostProfilePrompt}

${narrativeInstructions}

${dialogueRules}

${metadataRules}

${outputFormat}
`.trim();

  const userPrompt = `
Generate a complete narrative using the instructions above.
Language: ${config.language}
Tone: ${config.tone}
${viralHook ? `Hook reference: "${viralHook}"` : ''}

Today's news:
${newsContext}
`.trim();

  const requestBody = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
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

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content) as ScriptWithScenes;
      validateScriptWithScenes(parsed);
      console.log(`[Script] ✅ Success with ${model}`);
      return parsed;
    } catch (error: any) {
      console.warn(`[Script] ⚠️ ${model} failed:`, error.message);
      lastError = error;
      // Continue to next model
    }
  }

  console.error("[Script] ❌ All models failed");
  throw lastError || new Error('Script generation failed');
};

const VALID_NARRATIVES: NarrativeType[] = ['classic', 'double_conflict', 'hot_take', 'perspective_clash'];
const VALID_VIDEO_MODES: Scene['video_mode'][] = ['hostA', 'hostB', 'both'];
const VALID_SHOTS: Scene['shot'][] = ['medium', 'closeup', 'wide'];
const VALID_ORDERS: Scene['order'][] = ['left_first', 'right_first', 'meanwhile'];

const validateScriptWithScenes = (script: ScriptWithScenes) => {
  if (!script || typeof script !== 'object') {
    throw new Error('Invalid script payload (not an object)');
  }

  if (!script.title || typeof script.title !== 'string') {
    throw new Error('Script missing title');
  }

  if (!VALID_NARRATIVES.includes(script.narrative_used as NarrativeType)) {
    throw new Error(`Invalid narrative_used "${script.narrative_used}"`);
  }

  if (!script.scenes || typeof script.scenes !== 'object' || Object.keys(script.scenes).length === 0) {
    throw new Error('Script missing scenes');
  }

  for (const [sceneId, scene] of Object.entries(script.scenes)) {
    if (!scene || typeof scene !== 'object') {
      throw new Error(`Scene ${sceneId} is invalid`);
    }
    
    if (!VALID_VIDEO_MODES.includes(scene.video_mode)) {
      throw new Error(`Scene ${sceneId} has invalid video_mode "${scene.video_mode}"`);
    }
    
    // For "both" scenes, validate hostA_text and hostB_text
    if (scene.video_mode === 'both') {
      if (!scene.hostA_text || typeof scene.hostA_text !== 'string' || scene.hostA_text.trim().length === 0) {
        // Fallback: if text exists, split it for backwards compatibility
        if (scene.text && scene.text.trim().length > 0) {
          console.warn(`Scene ${sceneId}: "both" mode missing hostA_text, will split from text`);
        } else {
          throw new Error(`Scene ${sceneId} with video_mode "both" missing hostA_text`);
        }
      }
      if (!scene.hostB_text || typeof scene.hostB_text !== 'string' || scene.hostB_text.trim().length === 0) {
        // Fallback: if text exists, split it for backwards compatibility
        if (scene.text && scene.text.trim().length > 0) {
          console.warn(`Scene ${sceneId}: "both" mode missing hostB_text, will split from text`);
        } else {
          throw new Error(`Scene ${sceneId} with video_mode "both" missing hostB_text`);
        }
      }
      // Validate order if provided
      if (scene.order && !VALID_ORDERS.includes(scene.order)) {
        throw new Error(`Scene ${sceneId} has invalid order "${scene.order}"`);
      }
    } else {
      // For single host scenes, text is required
    if (!scene.text || typeof scene.text !== 'string') {
      throw new Error(`Scene ${sceneId} missing text`);
    }
    }
    
    if (!scene.model || (scene.model !== 'infinite_talk' && scene.model !== 'infinite_talk_multi')) {
      throw new Error(`Scene ${sceneId} has invalid model "${scene.model}"`);
    }
    if (!VALID_SHOTS.includes(scene.shot)) {
      throw new Error(`Scene ${sceneId} has invalid shot "${scene.shot}"`);
    }
  }
};

/**
 * Generate viral metadata (title, description, tags) with fallback
 */
export const createTitleVariantFallback = (primary: string): string => {
  const base = primary?.trim() || "Breaking Market Shake-Up";
  const cleaned = base.replace(/^BREAKING[:\-–]\s*/i, '').trim();
  const emphasis = cleaned.length > 0 ? cleaned : base;
  const templates = [
    (copy: string) => `BREAKING UPDATE ⚡ ${copy}`,
    (copy: string) => `SHOCKING REVERSAL: ${copy}`,
    (copy: string) => `EXPLAINED 👉 ${copy}`
  ];
  const index = Math.abs(emphasis.length % templates.length);
  return templates[index](emphasis).substring(0, 100);
};

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

TITLE VARIANTS (provide two options for A/B testing):
- Output an array "title_variants" with TWO unique hooks
- Variation B must emphasize a different emotion or curiosity gap
- Keep both under 80 characters and punchy
- The first element MUST match the TITLE exactly

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

Return ONLY valid JSON: {"title": "...", "title_variants": ["...", "..."], "description": "...", "tags": [...]}`;

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
      
      const rawTitle = metadata.title || metadata.title_primary || metadata.primaryTitle;
      const rawVariants: string[] = Array.isArray(metadata.title_variants) ? metadata.title_variants : [];
      const variantCandidates = [
        rawTitle,
        ...(rawVariants || []),
        metadata.variant_title,
        metadata.altTitle
      ].filter((value): value is string => Boolean(value)).map((value: string) => value.substring(0, 100));

      const uniqueVariants: string[] = [];
      for (const title of variantCandidates) {
        if (title && !uniqueVariants.some(existing => existing.toLowerCase() === title.toLowerCase())) {
          uniqueVariants.push(title);
        }
      }

      if (uniqueVariants.length === 0 && rawTitle) {
        uniqueVariants.push(rawTitle.substring(0, 100));
      }

      if (uniqueVariants.length < 2 && uniqueVariants[0]) {
        uniqueVariants.push(createTitleVariantFallback(uniqueVariants[0]));
      }

      return {
        title: uniqueVariants[0]?.substring(0, 100) || "Breaking News",
        titleVariants: uniqueVariants.slice(0, 2),
        description: metadata.description?.substring(0, 1000) || "",
        tags: Array.isArray(metadata.tags) ? metadata.tags.slice(0, 20) : []
      };
    } catch (error: any) {
      console.warn(`[Metadata] ⚠️ ${model} failed:`, error.message);
    }
  }

  console.error("[Metadata] ❌ All models failed, using defaults");
  const fallbackTitle = "Breaking News";
  return { 
    title: fallbackTitle, 
    titleVariants: [fallbackTitle, createTitleVariantFallback(fallbackTitle)], 
    description: "", 
    tags: config.defaultTags || [] 
  };
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

/**
 * OpenAI TTS Voices (as per ChimpNews Spec v2.0):
 * - hostA (Rusty) → echo (male, warm)
 * - hostB (Dani) → shimmer (female, expressive)
 * 
 * Available OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
 */
type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

// Direct OpenAI voices - no mapping needed
const DIRECT_OPENAI_VOICES: OpenAIVoice[] = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

// Legacy voice name mappings (for backwards compatibility)
const LEGACY_VOICE_MAP: Record<string, OpenAIVoice> = {
  // Legacy male voices → echo
  'Kore': 'echo',
  'Puck': 'onyx',
  'Charon': 'onyx',
  'Fenrir': 'echo',
  'Orus': 'fable',
  // Legacy female voices → shimmer  
  'Leda': 'shimmer',
  'Aoede': 'nova',
  'Zephyr': 'nova',
  'Elara': 'shimmer',
  'Hera': 'alloy',
};

/**
 * Get OpenAI voice from character voice name
 * Simplified: if voice is already an OpenAI voice, use it directly
 * Otherwise, check legacy mapping or default to alloy
 */
const getOpenAIVoice = (voiceName: string): OpenAIVoice => {
  const normalized = voiceName.toLowerCase().trim();
  
  // Check if it's already a direct OpenAI voice (spec compliant: echo/shimmer)
  if (DIRECT_OPENAI_VOICES.includes(normalized as OpenAIVoice)) {
    return normalized as OpenAIVoice;
  }
  
  // Check legacy mapping for backwards compatibility
  if (voiceName in LEGACY_VOICE_MAP) {
    return LEGACY_VOICE_MAP[voiceName];
  }
  
  // Default: echo for unrecognized male-sounding, shimmer for female-sounding
  if (normalized.includes('female') || normalized.includes('woman') || normalized.includes('girl')) {
    return 'shimmer';
  }
  if (normalized.includes('male') || normalized.includes('man') || normalized.includes('boy')) {
    return 'echo';
  }
  
  // Ultimate fallback
  return 'alloy';
};

/**
 * Sanitize text for TTS - remove problematic characters and validate
 */
const sanitizeTextForTTS = (text: string): string => {
  if (!text || typeof text !== 'string') {
    throw new Error('TTS input text is empty or invalid');
  }
  
  // Trim and normalize whitespace
  let sanitized = text.trim().replace(/\s+/g, ' ');
  
  // Remove or replace problematic characters
  sanitized = sanitized
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .replace(/[""]/g, '"') // Normalize smart quotes
    .replace(/['']/g, "'") // Normalize smart apostrophes
    .replace(/[–—]/g, '-') // Normalize dashes
    .replace(/…/g, '...') // Normalize ellipsis
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
  
  // Validate minimum content
  if (sanitized.length === 0) {
    throw new Error('TTS input text is empty after sanitization');
  }
  
  // OpenAI TTS has a character limit (4096 characters)
  if (sanitized.length > 4096) {
    console.warn(`[OpenAI TTS] ⚠️ Text truncated from ${sanitized.length} to 4096 characters`);
    sanitized = sanitized.substring(0, 4096);
  }
  
  return sanitized;
};

/**
 * Generate TTS audio for a single line
 * Returns base64-encoded MP3
 * 
 * Per ChimpNews Spec v2.0:
 * - hostA uses "echo" voice
 * - hostB uses "shimmer" voice
 */
export const generateTTSAudio = async (
  text: string,
  voiceName: string
): Promise<string> => {
  // Validate and sanitize input text
  let sanitizedText: string;
  try {
    sanitizedText = sanitizeTextForTTS(text);
  } catch (error) {
    console.error(`[OpenAI TTS] ❌ Invalid input text: "${text?.substring(0, 50)}..."`, (error as Error).message);
    throw new Error(`TTS failed: ${(error as Error).message}`);
  }
  
  const voice = getOpenAIVoice(voiceName);
  
  console.log(`[OpenAI TTS] 🎙️ Generating audio with voice: ${voice}${voice !== voiceName.toLowerCase() ? ` (from ${voiceName})` : ''}`);
  
  try {
    const response = await openaiRequest('audio/speech', {
      model: 'tts-1',
      input: sanitizedText,
      voice: voice,
      response_format: 'mp3'
    });
    
    // Cost: ~$0.015 per 1000 characters
    const charCount = sanitizedText.length;
    const cost = (charCount / 1000) * 0.015;
    CostTracker.track('audio', 'openai-tts-1', cost);
    
    // The proxy returns { audio: base64, format: 'mp3' }
    if (!response.audio) {
      throw new Error('TTS response missing audio data');
    }
    
    return response.audio;
  } catch (error) {
    const errorMsg = (error as Error).message;
    // Provide more context for 400 errors
    if (errorMsg.includes('400')) {
      console.error(`[OpenAI TTS] ❌ 400 error - Input text (${sanitizedText.length} chars): "${sanitizedText.substring(0, 100)}..."`);
      throw new Error(`TTS API rejected the input (400). Text length: ${sanitizedText.length}. First 50 chars: "${sanitizedText.substring(0, 50)}"`);
    }
    throw error;
  }
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

// =============================================================================================
// VIRAL SCORE ANALYSIS (GPT-4o)
// =============================================================================================

/**
 * Calculate viral score for a news item using GPT-4o analysis
 * Analyzes multiple factors: emotional impact, controversy, relevance, click-worthiness, etc.
 */
export const calculateViralScoreWithGPT = async (
  headline: string,
  summary: string,
  source: string,
  date?: string
): Promise<{ score: number; reasoning: string }> => {
  const prompt = `You are an expert at predicting viral content performance on social media and YouTube.

Analyze this news story and calculate a viral score from 0-100:

HEADLINE: "${headline}"
SUMMARY: "${summary}"
SOURCE: "${source}"
${date ? `DATE: ${date}` : ''}

Evaluate these factors (0-100 scale):
1. **Emotional Impact** (shock, anger, joy, fear) - How strong is the emotional reaction?
2. **Controversy/Polarization** - Will this divide opinions and generate debate?
3. **Relevance/Timeliness** - How current and relevant is this to today's audience?
4. **Click-worthiness** - How compelling is the headline? Does it create curiosity?
5. **Shareability** - Would people want to share this? Does it make them look informed/entertaining?
6. **Uniqueness** - Is this breaking news or a fresh angle on a story?
7. **Source Credibility** - Major trusted sources (CNN, BBC, NYT, Reuters) get bonus points

Return ONLY a JSON object with this exact format:
{
  "viral_score": <number 0-100>,
  "reasoning": "<brief explanation>",
  "factors": {
    "emotional_impact": <0-100>,
    "controversy": <0-100>,
    "relevance": <0-100>,
    "click_worthiness": <0-100>,
    "shareability": <0-100>,
    "uniqueness": <0-100>,
    "source_credibility": <0-100>
  }
}

Be strict: Average news = 40-60, Breaking/controversial = 70-85, Highly viral = 85-100.`;

  try {
    const response = await openaiRequest('chat/completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3 // Lower temperature for more consistent scoring
    }, { timeout: 15000 }); // Shorter timeout for faster processing

    CostTracker.track('viralScore', 'gpt-4o', 0.002); // ~$0.002 per analysis

    const content = response.choices[0]?.message?.content || '{}';
    const analysis = JSON.parse(content);
    
    const score = Math.round(analysis.viral_score || 50);
    const reasoning = analysis.reasoning || 'No explanation provided';
    console.log(`[Viral Score] 📊 "${headline.substring(0, 50)}..." = ${score} (${reasoning.substring(0, 50)})`);
    
    // Ensure score is between 0-100
    return {
      score: Math.max(0, Math.min(100, score)),
      reasoning: reasoning
    };
  } catch (error: any) {
    console.error(`[Viral Score] ❌ GPT analysis failed:`, error.message);
    // Fallback to basic calculation
    const fallbackScore = calculateBasicViralScore(headline, summary, source, date);
    return {
      score: fallbackScore,
      reasoning: 'Score calculated using basic algorithm (GPT analysis unavailable)'
    };
  }
};

/**
 * Batch calculate viral scores for multiple news items
 * Uses a SINGLE OpenAI API call to analyze ALL items at once (avoids rate limits)
 */
export const calculateViralScoresBatch = async (
  newsItems: Array<{ headline: string; summary: string; source: string; date?: string }>
): Promise<Array<{ score: number; reasoning: string }>> => {
  console.log(`[Viral Score] 🔥 Analyzing ${newsItems.length} news items with a single GPT-4o call...`);
  
  if (newsItems.length === 0) {
    return [];
  }
  
  // Build a single prompt with all news items
  const newsListFormatted = newsItems.map((item, index) => 
    `[${index + 1}] HEADLINE: "${item.headline}"
    SUMMARY: "${item.summary}"
    SOURCE: "${item.source}"
    ${item.date ? `DATE: ${item.date}` : ''}`
  ).join('\n\n');
  
  const prompt = `You are an expert at predicting viral content performance on social media and YouTube.

Analyze ALL the following news stories and calculate a viral score from 0-100 for EACH one.

Evaluate these factors for each (0-100 scale):
1. **Emotional Impact** (shock, anger, joy, fear) - How strong is the emotional reaction?
2. **Controversy/Polarization** - Will this divide opinions and generate debate?
3. **Relevance/Timeliness** - How current and relevant is this to today's audience?
4. **Click-worthiness** - How compelling is the headline? Does it create curiosity?
5. **Shareability** - Would people want to share this?
6. **Uniqueness** - Is this breaking news or a fresh angle?
7. **Source Credibility** - Major trusted sources (CNN, BBC, NYT, Reuters) get bonus points

NEWS STORIES TO ANALYZE:
${newsListFormatted}

Return ONLY a JSON object with this exact format:
{
  "results": [
    { "index": 1, "viral_score": <0-100>, "reasoning": "<brief explanation in 10-15 words>" },
    { "index": 2, "viral_score": <0-100>, "reasoning": "<brief explanation>" },
    ...
  ]
}

IMPORTANT:
- Return results for ALL ${newsItems.length} news items in the SAME order
- Be strict: Average news = 40-60, Breaking/controversial = 70-85, Highly viral = 85-100
- Keep reasoning brief (10-15 words max per item)`;

  try {
    const response = await openaiRequest('chat/completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3
    }, { timeout: 60000 }); // Longer timeout for batch processing

    // Cost estimate: ~$0.01-0.02 for batch analysis (much cheaper than individual calls)
    CostTracker.track('viralScoreBatch', 'gpt-4o', 0.015);

    const content = response.choices[0]?.message?.content || '{}';
    const analysis = JSON.parse(content);
    
    const results: Array<{ score: number; reasoning: string }> = [];
    
    // Map results back to original order
    for (let i = 0; i < newsItems.length; i++) {
      const resultItem = analysis.results?.find((r: any) => r.index === i + 1);
      
      if (resultItem) {
        results.push({
          score: Math.max(0, Math.min(100, Math.round(resultItem.viral_score || 50))),
          reasoning: resultItem.reasoning || 'No explanation provided'
        });
      } else {
        // Fallback for missing items
        const fallbackScore = calculateBasicViralScore(
          newsItems[i].headline,
          newsItems[i].summary,
          newsItems[i].source,
          newsItems[i].date
        );
        results.push({
          score: fallbackScore,
          reasoning: 'Score calculated using basic algorithm (GPT result missing)'
        });
      }
    }
    
    const scores = results.map(r => r.score);
    console.log(`[Viral Score] ✅ Analyzed ${results.length} items in ONE API call. Range: ${Math.min(...scores)}-${Math.max(...scores)}`);
    return results;
    
  } catch (error: any) {
    console.error(`[Viral Score] ❌ Batch GPT analysis failed:`, error.message);
    
    // Fallback: calculate all scores using basic algorithm
    console.log(`[Viral Score] ⚠️ Using basic algorithm for all ${newsItems.length} items...`);
    return newsItems.map(item => ({
      score: calculateBasicViralScore(item.headline, item.summary, item.source, item.date),
      reasoning: 'Score calculated using basic algorithm (GPT batch analysis unavailable)'
    }));
  }
};

/**
 * Fallback basic viral score calculation (used if GPT fails)
 */
const calculateBasicViralScore = (
  headline: string,
  summary: string,
  source: string,
  date?: string
): number => {
  let score = 50; // Base score
  
  const text = `${headline} ${summary}`.toLowerCase();
  
  // Viral keywords
  const viralKeywords = ['breaking', 'urgent', 'shocking', 'exclusive', 'just in', 'update', 'revealed', 'exposed'];
  viralKeywords.forEach(keyword => {
    if (text.includes(keyword)) score += 10;
  });
  
  // Major sources
  const majorSources = ['reuters', 'bloomberg', 'cnn', 'bbc', 'nytimes', 'wsj', 'ap news', 'associated press'];
  if (majorSources.some(s => source.toLowerCase().includes(s))) score += 15;
  
  // Recency
  if (date) {
    try {
      const newsDate = new Date(date);
      const hoursAgo = (Date.now() - newsDate.getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 6) score += 20;
      else if (hoursAgo < 12) score += 10;
    } catch {
      // Invalid date, skip
    }
  }
  
  return Math.min(score, 100);
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
