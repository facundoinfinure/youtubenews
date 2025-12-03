import { GoogleGenAI, Modality } from "@google/genai";
import { NewsItem, ScriptLine, BroadcastSegment, VideoAssets, ViralMetadata, ChannelConfig } from "../types";
import { ContentCache } from "./ContentCache";
import { retryWithBackoff } from "./retryUtils";
import { getModelForTask, getCostForTask } from "./modelStrategy";
import { CostTracker } from "./CostTracker";
import { 
  getChannelIntroOutro, 
  saveChannelIntroOutro,
  saveGeneratedVideo,
  findCachedVideo,
  findCachedVideoByDialogue,
  getCachedChannelVideos,
  createPromptHash,
  VideoType,
  VideoProvider,
  uploadAudioToStorage
} from "./supabaseService";
import { 
  createInfiniteTalkMultiTask,
  createInfiniteTalkSingleTask,
  pollInfiniteTalkTask,
  getSilentAudioUrl,
  createWavespeedImageTask, 
  pollWavespeedImageTask,
  checkWavespeedConfig 
} from "./wavespeedProxy";

const getApiKey = () => import.meta.env.VITE_GEMINI_API_KEY || window.env?.API_KEY || process.env.API_KEY || "";
const getAiClient = () => new GoogleGenAI({ apiKey: getApiKey() });

// Helper function to check if Wavespeed is configured (via proxy or direct API key)
const isWavespeedConfigured = () => {
  const config = checkWavespeedConfig();
  return config.configured;
};

// Helper function to clean and parse JSON from Gemini responses
// Gemini sometimes returns control characters inside strings which breaks JSON.parse
const cleanAndParseGeminiJSON = <T>(text: string, fallback: T): T => {
  // Cleanup markdown code blocks and trim
  let cleanText = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();
  
  // Fix control characters INSIDE JSON string values (common Gemini issue)
  // This regex finds string content between quotes and escapes control chars
  cleanText = cleanText.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
    return match.replace(/[\x00-\x1F\x7F]/g, (char) => {
      switch (char) {
        case '\n': return '\\n';
        case '\r': return '\\r';
        case '\t': return '\\t';
        default: return ''; // Remove other control characters
      }
    });
  });

  try {
    return JSON.parse(cleanText) as T;
  } catch (e) {
    console.error("JSON parsing error:", e);
    console.error("Cleaned text (first 300 chars):", cleanText.substring(0, 300));
    throw e;
  }
};

// Helper function to create a simple placeholder image as data URI
const createPlaceholderImage = (width: number = 1024, height: number = 1024): string => {
  if (typeof document === 'undefined') {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a1a1a');
    gradient.addColorStop(0.5, '#2a2a2a');
    gradient.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(40, 40, 40, 0.3)';
    ctx.fillRect(width * 0.2, height * 0.2, width * 0.6, height * 0.6);
  }
  return canvas.toDataURL('image/png');
};

// =============================================================================================
// INFINITETALK VIDEO GENERATION (WaveSpeed Only - No VEO3)
// =============================================================================================

/**
 * InfiniteTalk pricing (per 5 seconds):
 * - 480p: $0.15
 * - 720p: $0.30
 */
const INFINITETALK_COST_480P = 0.15;
const INFINITETALK_COST_720P = 0.30;

interface InfiniteTalkVideoOptions {
  channelId: string;
  productionId?: string;
  segmentIndex: number;
  audioUrl: string;           // URL to the audio file
  referenceImageUrl: string;  // URL to the reference image with both hosts
  speaker: string;            // Who is speaking: hostA name, hostB name, or "Both"
  dialogueText: string;       // The dialogue text for caching
  hostAName: string;          // Name of host A (left in image)
  hostBName: string;          // Name of host B (right in image)
  hostAVisualPrompt: string;  // Visual description of host A
  hostBVisualPrompt: string;  // Visual description of host B
  resolution?: '480p' | '720p';
}

/**
 * Generate a lip-sync video using WaveSpeed InfiniteTalk
 * Uses the MULTI model for two-character scenes
 * IMPORTANT: Uses strict prompts to maintain character consistency
 */
const generateInfiniteTalkVideo = async (
  options: InfiniteTalkVideoOptions
): Promise<{ url: string | null; fromCache: boolean }> => {
  const { 
    channelId, 
    productionId, 
    segmentIndex,
    audioUrl, 
    referenceImageUrl, 
    speaker,
    dialogueText,
    hostAName,
    hostBName,
    hostAVisualPrompt,
    hostBVisualPrompt,
    resolution = '720p'
  } = options;

  // Determine video type based on speaker
  let videoType: VideoType = 'segment';
  if (speaker === hostAName) {
    videoType = 'host_a';
  } else if (speaker === hostBName) {
    videoType = 'host_b';
  } else if (speaker === 'Both' || speaker.includes('Both')) {
    videoType = 'both_hosts';
  }

  // Check cache first
  const cachedVideo = await findCachedVideoByDialogue(channelId, videoType, dialogueText, '16:9');
  if (cachedVideo && cachedVideo.video_url) {
    console.log(`✅ [InfiniteTalk] Using cached video for segment ${segmentIndex}`);
    return { url: cachedVideo.video_url, fromCache: true };
  }

  // Generate new video with InfiniteTalk Multi
  const silentAudioUrl = getSilentAudioUrl();
  
  // Determine which audio goes to which side
  // Host A = left, Host B = right (based on typical two-person shot)
  let leftAudio = silentAudioUrl;
  let rightAudio = silentAudioUrl;
  let order: 'left_first' | 'right_first' | 'meanwhile' = 'meanwhile';

  if (speaker === hostAName) {
    leftAudio = audioUrl;
    order = 'left_first';
  } else if (speaker === hostBName) {
    rightAudio = audioUrl;
    order = 'right_first';
  } else {
    // Both speaking - use same audio for simplicity (they speak in unison)
    leftAudio = audioUrl;
    rightAudio = audioUrl;
    order = 'meanwhile';
  }

  // Build strict character-specific prompt
  // CRITICAL: Be very specific about the characters to avoid generating humans
  const characterPrompt = `
STRICT CHARACTER REQUIREMENTS - DO NOT DEVIATE:
- LEFT CHARACTER: ${hostAName} - ${hostAVisualPrompt}
- RIGHT CHARACTER: ${hostBName} - ${hostBVisualPrompt}

SCENE: Professional podcast news studio with two animated characters.
SPEAKING: ${speaker} is currently speaking with lip-sync animation.
STYLE: Maintain exact character appearances from the reference image.

CRITICAL: These are NOT human beings. They are animated/CGI characters as described above. 
Keep character consistency with the reference image at all times.
`.trim();

  try {
    console.log(`🎬 [InfiniteTalk Multi] Generating video for segment ${segmentIndex} (${speaker})`);
    console.log(`📝 [InfiniteTalk Multi] Character prompt: ${hostAName} (${hostAVisualPrompt.substring(0, 50)}...) & ${hostBName}`);
    
    const taskId = await createInfiniteTalkMultiTask({
      leftAudioUrl: leftAudio,
      rightAudioUrl: rightAudio,
      imageUrl: referenceImageUrl,
      order,
      resolution,
      prompt: characterPrompt
    });

    const videoUrl = await pollInfiniteTalkTask(taskId);

    if (videoUrl) {
      // Track cost
      const cost = resolution === '720p' ? INFINITETALK_COST_720P : INFINITETALK_COST_480P;
      CostTracker.track('video', 'infinitetalk-multi', cost);

      // Save to cache
      await saveGeneratedVideo({
        channel_id: channelId,
        production_id: productionId || null,
        video_type: videoType,
        segment_index: segmentIndex,
        prompt_hash: createPromptHash(dialogueText),
        dialogue_text: dialogueText,
        video_url: videoUrl,
        provider: 'wavespeed',
        aspect_ratio: '16:9',
        duration_seconds: null,
        status: 'completed',
        error_message: null,
        reference_image_hash: createPromptHash(referenceImageUrl.substring(0, 100)),
        expires_at: null
      });

      console.log(`✅ [InfiniteTalk Multi] Video generated and cached for segment ${segmentIndex}`);
      return { url: videoUrl, fromCache: false };
    }
  } catch (error) {
    console.error(`❌ [InfiniteTalk Multi] Failed for segment ${segmentIndex}:`, (error as Error).message);
  }

  return { url: null, fromCache: false };
};

export const fetchEconomicNews = async (targetDate: Date | undefined, config: ChannelConfig): Promise<NewsItem[]> => {
  // Use caching for same-day news
  let dateToQuery = new Date();
  if (targetDate) {
    dateToQuery = new Date(targetDate);
  } else {
    dateToQuery.setDate(dateToQuery.getDate() - 1);
  }

  const cacheKey = `news_${dateToQuery.toISOString().split('T')[0]}_${config.country}_v3`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {
      const ai = getAiClient();

      // Fix Timezone Issue: Create date from input string but force it to be treated as local date
      // by appending time to middle of day to avoid UTC midnight shift
      let dateToQuery = new Date();
      if (targetDate) {
        const d = new Date(targetDate);
        // Create a new date using the local year, month, date to ensure it matches the user's intent
        // regardless of how the input date was parsed (UTC vs Local)
        // Actually, the safest way if targetDate is a Date object from an input type="date" (which is usually YYYY-MM-DD UTC)
        // is to just use the UTC components if we want that exact date, OR just add a buffer.
        // Let's try appending T12:00:00 if it's a string, but here it is a Date.
        // Let's just use the UTC date string which matches the input.
        dateToQuery = d;
      } else {
        dateToQuery.setDate(dateToQuery.getDate() - 1);
      }

      // Use UTC date string for the prompt to avoid "yesterday" shift in Western Hemisphere
      const dateString = dateToQuery.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });

      const prompt = `Search for news from ${dateString} relevant to ${config.country}.

IMPORTANT: Search specifically for news FROM ${dateString}. Do NOT use today's date - use the exact date specified: ${dateString}.

Find EXACTLY 15 impactful economic or political news stories from that date.
Focus on major market moves, inflation, politics, or social issues.

RESPONSE FORMAT - CRITICAL:
- Return ONLY a JSON array, no explanations or text before/after
- Start your response with [ and end with ]
- Do NOT include any text like "The current date is..." or "I will search for..."

JSON structure for each item:
- "headline" (string, in ${config.language})
- "source" (string)
- "url" (string, use grounding or best guess)
- "summary" (string, 1 short sentence in ${config.language})
- "viralScore" (number, 1-100 based on controversy or impact)
- "imageKeyword" (string, 2-3 words visual description for image generation)
- "imageUrl" (string, optional - URL of the article's main image if available)

REQUIREMENTS:
1. Return EXACTLY 15 items
2. Include imageUrl when available from search results
3. NO markdown formatting, NO explanatory text
4. Start response with [ character immediately

Example: [{"headline":"...","source":"...","url":"...","summary":"...","viralScore":85,"imageKeyword":"...","imageUrl":"..."}, ...]`;

      const response = await ai.models.generateContent({
        model: getModelForTask('news'),
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      CostTracker.track('news', getModelForTask('news'), getCostForTask('news'));

      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const text = response.text || "";
      
      // Extract JSON from response - Gemini with googleSearch sometimes returns text before the JSON
      // Look for the JSON array pattern in the response
      let jsonStr = text.replace(/```json\n?|\n?```/g, "").trim();
      
      // Find the first '[' and last ']' to extract just the JSON array
      const firstBracket = jsonStr.indexOf('[');
      const lastBracket = jsonStr.lastIndexOf(']');
      
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        // Log if there was text before the JSON (for debugging)
        if (firstBracket > 0) {
          console.log(`⚠️ Stripped ${firstBracket} chars of text before JSON array`);
        }
        jsonStr = jsonStr.substring(firstBracket, lastBracket + 1);
      }

      try {
        let news: NewsItem[] = JSON.parse(jsonStr);

        // CRITICAL: Validate we got 15 items as requested
        if (news.length < 15) {
          console.warn(`⚠️ Only received ${news.length} news items, expected 15`);
          console.warn(`Response text (first 500 chars): ${text.substring(0, 500)}`);
          
          // Log warning but continue with what we have - better than failing completely
          if (news.length === 0) {
            throw new Error(`No news items returned. The API may not have data for this date.`);
          }
          
          // If we have fewer than 15 but at least some items, log and continue
          // The UI will display whatever we have
          console.log(`📝 Continuing with ${news.length} news items (expected 15)`);
        }

        // Create a map of URLs to grounding chunks for better matching
        const urlToGroundingMap = new Map<string, any>();
        groundingChunks.forEach((chunk: any) => {
          if (chunk?.web?.uri) {
            urlToGroundingMap.set(chunk.web.uri, chunk);
          }
        });

        const processedNews = news.map((item, index) => {
          // Prioritize grounding URL if available and missing in item
          let finalUrl = item.url;
          let matchedGrounding: any = null;
          
          // Try to match by index first
          if (groundingChunks[index]?.web?.uri) {
            matchedGrounding = groundingChunks[index];
            if ((!finalUrl || finalUrl === "#")) {
              finalUrl = groundingChunks[index].web.uri;
            }
          } else if (finalUrl && urlToGroundingMap.has(finalUrl)) {
            // Try to match by URL
            matchedGrounding = urlToGroundingMap.get(finalUrl);
          } else if (groundingChunks.length > 0) {
            // Fallback: use first available grounding chunk
            matchedGrounding = groundingChunks[0];
            if ((!finalUrl || finalUrl === "#") && matchedGrounding?.web?.uri) {
              finalUrl = matchedGrounding.web.uri;
            }
          }

          // Extract image URL from grounding metadata - improved extraction
          let imageUrl = item.imageUrl;
          if (!imageUrl && matchedGrounding?.web) {
            const webChunk = matchedGrounding.web as any;
            // Try multiple possible image fields
            imageUrl = webChunk?.image || 
                      webChunk?.imageUrl || 
                      webChunk?.thumbnail || 
                      webChunk?.ogImage ||
                      webChunk?.metaImage ||
                      webChunk?.previewImage;
            
            if (imageUrl) {
              console.log(`✅ Found image for "${item.headline}": ${imageUrl}`);
            }
          }
          
          // Also check grounding metadata at root level
          if (!imageUrl && matchedGrounding) {
            const meta = matchedGrounding as any;
            imageUrl = meta?.image || meta?.imageUrl || meta?.thumbnail;
            if (imageUrl) {
              console.log(`✅ Found image (root level) for "${item.headline}": ${imageUrl}`);
            }
          }
          
          // Log if no image found for debugging
          if (!imageUrl) {
            console.log(`⚠️ No image found for "${item.headline}" - will use placeholder`);
          }

          return {
            ...item,
            url: finalUrl,
            imageUrl: imageUrl || undefined, // Ensure undefined instead of empty string
            // Fallbacks
            viralScore: item.viralScore || Math.floor(Math.random() * 40) + 60,
            summary: item.summary || item.headline,
            imageKeyword: item.imageKeyword || "breaking news"
          };
        });

        // Sort by viral score descending
        return processedNews.sort((a, b) => b.viralScore - a.viralScore);

      } catch (e) {
        console.error("Failed to parse news JSON", e);
        console.error("Response text (first 500 chars):", text.substring(0, 500));
        throw new Error(`Failed to parse news from Gemini: ${(e as Error).message}`);
      }
    },
    3600000, // 1 hour TTL
    0.05 // Estimated cost per call
  );
};

export const generateScript = async (news: NewsItem[], config: ChannelConfig, viralHook?: string): Promise<ScriptLine[]> => {
  const ai = getAiClient();

  const newsContext = news.map(n => `- ${n.headline} (Source: ${n.source}). Summary: ${n.summary}`).join('\n');

  const systemPrompt = `
  You are the showrunner for "${config.channelName}", a short 1-minute news segment hosted by: 
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
  - Be creative, use puns related to the characters (e.g. if one is a gorilla, use banana puns; if a penguin, ice puns).
  - Pattern interrupt every 15 seconds
  - Use "you" language
  - STRICT JSON OUTPUT. NO MARKDOWN.
  `;

  const response = await ai.models.generateContent({
    model: getModelForTask('script'),
    contents: `Here is the selected news for today's episode:\n${newsContext}\n\nWrite the script in JSON format.`,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json"
    }
  });

  CostTracker.track('script', getModelForTask('script'), getCostForTask('script'));

  try {
    return cleanAndParseGeminiJSON<ScriptLine[]>(response.text || "[]", []);
  } catch (e) {
    throw new Error(`Failed to parse script from Gemini: ${(e as Error).message}`);
  }
};

export const fetchTrendingTopics = async (country: string): Promise<string[]> => {
  const cacheKey = `trending_${country}_${new Date().toISOString().split('T')[0]}`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: getModelForTask('trending'),
        contents: `What are the top 10 trending topics on YouTube in ${country} today? Focus on news, finance, and current events. Return as JSON array of strings.`,
        config: {
          tools: [{ googleSearch: {} }]
          // responseMimeType: "application/json" // Conflict with tools in some models
        }
      });

      CostTracker.track('trending', getModelForTask('trending'), getCostForTask('trending'));

      try {
        const topics = cleanAndParseGeminiJSON<string[]>(response.text || "[]", []);
        return Array.isArray(topics) ? topics : [];
      } catch {
        return [];
      }
    },
    7200000, // 2 hour TTL
    0.02
  );
};

export const generateViralMetadata = async (news: NewsItem[], config: ChannelConfig, date: Date): Promise<ViralMetadata> => {
  const ai = getAiClient();

  // Get trending topics for SEO boost
  const trending = await fetchTrendingTopics(config.country);
  const newsContext = news.map(n => `- ${n.headline} (Viral Score: ${n.viralScore})`).join('\n');
  const dateStr = date.toLocaleDateString();

  const prompt = `
You are a VIRAL YouTube expert with 100M+ views across channels.

NEWS STORIES:
${newsContext}

TRENDING NOW IN ${config.country}:
${trending.join(', ')}

Create HIGH-CTR metadata:

TITLE RULES (max 60 chars):
- Use power words: SHOCKING, BREAKING, EXPOSED, WATCH, URGENT, REVEALED
- Include numbers/percentages if relevant
- Create curiosity gap (tease but don't reveal)
- Add ONE emoji that fits the tone
- Examples:
  * "MARKET CRASH: 40% Drop INCOMING?! 📉"
  * "They're HIDING This From You! 🚨"
  * "BREAKING: 5 Stocks to BUY NOW 💰"

DESCRIPTION RULES (max 250 chars):
- Hook in first 10 words
- Include keywords: ${news.map(n => n.imageKeyword).join(', ')}
- Add trending terms: ${trending.slice(0, 3).join(', ')}
- Include date: ${dateStr}
- Call to action
- Timestamp preview: "0:00 Intro | 0:15 Analysis | 0:45 Prediction"
- End with tagline: "${config.tagline}"

TAGS RULES (exactly 20 tags):
- Mix broad + specific
- Include: ${(config.defaultTags || []).join(', ')}
- Add trending: ${trending.slice(0, 5).join(', ')}
- Long-tail keywords
- Event-specific tags

Return JSON: { title, description, tags }
  `.trim();

  const cacheKey = `metadata_${news.map(n => n.headline).join('_').substring(0, 50)}_${dateStr}`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {

      const response = await ai.models.generateContent({
        model: getModelForTask('metadata'),
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      CostTracker.track('metadata', getModelForTask('metadata'), getCostForTask('metadata'));

      const metadata = cleanAndParseGeminiJSON<{title?: string; description?: string; tags?: string[]}>(response.text || "{}", {});

      // Validate and ensure defaults
      return {
        title: metadata.title?.substring(0, 60) || "Breaking News",
        description: metadata.description?.substring(0, 250) || "",
        tags: Array.isArray(metadata.tags) ? metadata.tags.slice(0, 20) : []
      };
    },
    1800000, // 30 min TTL
    0.03
  );
};

// Helper function to import findCachedAudio dynamically to avoid circular dependency
let findCachedAudioFn: ((text: string, voiceName: string, channelId: string) => Promise<string | null>) | null = null;

export const setFindCachedAudioFunction = (fn: (text: string, voiceName: string, channelId: string) => Promise<string | null>) => {
  findCachedAudioFn = fn;
};

export const generateSegmentedAudio = async (script: ScriptLine[], config: ChannelConfig): Promise<BroadcastSegment[]> => {
  return generateSegmentedAudioWithCache(script, config, '');
};

export const generateSegmentedAudioWithCache = async (
  script: ScriptLine[], 
  config: ChannelConfig,
  channelId: string = ''
): Promise<BroadcastSegment[]> => {
  const ai = getAiClient();

  // PARALLEL PROCESSING with cache support - much faster
  const audioPromises = script.map(async (line) => {
    let character = config.characters.hostA; // Default
    if (line.speaker === config.characters.hostA.name) {
      character = config.characters.hostA;
    } else if (line.speaker === config.characters.hostB.name) {
      character = config.characters.hostB;
    }

    // Check cache first if function is available
    if (findCachedAudioFn && channelId) {
      const cachedAudio = await findCachedAudioFn(line.text, character.voiceName, channelId);
      if (cachedAudio) {
        console.log(`✅ Cache hit for audio: "${line.text.substring(0, 30)}..."`);
        return {
          speaker: line.speaker,
          text: line.text,
          audioBase64: cachedAudio,
          fromCache: true,
          audioUrl: undefined // Will be set later if needed
        } as any;
      }
    }

    // Generate new audio if not in cache
    return retryWithBackoff(async () => {
      const response = await ai.models.generateContent({
        model: getModelForTask('audio'),
        contents: line.text,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: character.voiceName,
                // Enhanced voice parameters
                ...(character.voiceStyle && { style: character.voiceStyle }),
                ...(character.speakingRate && { speakingRate: character.speakingRate }),
                ...(character.pitch && { pitch: character.pitch })
              }
            }
          }
        }
      });

      CostTracker.track('audio', getModelForTask('audio'), getCostForTask('audio'));

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error('No audio data received');

      return {
        speaker: line.speaker,
        text: line.text,
        audioBase64: base64Audio,
        fromCache: false
      };
    }, {
      maxRetries: 2,
      baseDelay: 1000,
      onRetry: (attempt) => console.log(`🎙️ Retrying audio for "${line.text.substring(0, 30)}..." (${attempt}/2)`)
    });
  });

  return Promise.all(audioPromises);
};

// =============================================================================================
// INFINITETALK VIDEO GENERATION FUNCTIONS (WaveSpeed Only)
// =============================================================================================

/**
 * For intro/outro, we use the reference image as a static frame
 * InfiniteTalk requires audio, so intro/outro will just use the reference image
 * The actual lip-sync videos are generated per segment
 */
export const generateIntroVideo = async (
  config: ChannelConfig,
  channelId: string,
  productionId?: string
): Promise<string | null> => {
  // For intro, we just return the reference image URL
  // The BroadcastPlayer will handle displaying it as a static intro
  if (config.referenceImageUrl) {
    console.log(`✅ [Intro] Using reference image as intro frame`);
    return config.referenceImageUrl;
  }
  
  // If no reference image, return null (no intro video)
  console.log(`⚠️ [Intro] No reference image available for intro`);
  return null;
};

/**
 * Generate outro video - uses reference image as static frame
 */
export const generateOutroVideo = async (
  config: ChannelConfig,
  channelId: string,
  productionId?: string
): Promise<string | null> => {
  // For outro, we just return the reference image URL
  if (config.referenceImageUrl) {
    console.log(`✅ [Outro] Using reference image as outro frame`);
    return config.referenceImageUrl;
  }
  
  console.log(`⚠️ [Outro] No reference image available for outro`);
  return null;
};

/**
 * Generate lip-sync videos for each segment using WaveSpeed InfiniteTalk Multi
 * 
 * This function takes segments WITH audio already generated and creates
 * lip-sync videos for each segment using InfiniteTalk Multi API.
 * 
 * IMPORTANT: Segments must have audioUrl (uploaded to storage) before calling this.
 * 
 * @param segments - Array of segments with audio URLs
 * @param config - Channel configuration (needs referenceImageUrl)
 * @param channelId - Channel ID for caching
 * @param productionId - Production ID for caching
 */
export const generateVideoSegmentsWithInfiniteTalk = async (
  segments: BroadcastSegment[],
  config: ChannelConfig,
  channelId: string,
  productionId?: string
): Promise<(string | null)[]> => {
  if (!config.referenceImageUrl) {
    console.error(`❌ [InfiniteTalk] No reference image URL provided. Cannot generate lip-sync videos.`);
    console.error(`❌ [InfiniteTalk] Please set a reference image in the channel settings.`);
    return new Array(segments.length).fill(null);
  }

  if (!isWavespeedConfigured()) {
    const configStatus = checkWavespeedConfig();
    console.error(`❌ [InfiniteTalk] WaveSpeed not configured: ${configStatus.message}`);
    return new Array(segments.length).fill(null);
  }

  console.log(`🎬 [InfiniteTalk Multi] Generating ${segments.length} lip-sync videos`);
  console.log(`🖼️ [InfiniteTalk Multi] Reference image: ${config.referenceImageUrl.substring(0, 60)}...`);
  
  // Log character descriptions to verify they're being used
  const hostAName = config.characters.hostA.name;
  const hostBName = config.characters.hostB.name;
  const hostAVisualPrompt = config.characters.hostA.visualPrompt;
  const hostBVisualPrompt = config.characters.hostB.visualPrompt;
  
  console.log(`👤 [InfiniteTalk Multi] Host A: ${hostAName} - ${hostAVisualPrompt}`);
  console.log(`👤 [InfiniteTalk Multi] Host B: ${hostBName} - ${hostBVisualPrompt}`);

  // Generate videos for each segment (one video per segment)
  const videoPromises = segments.map(async (segment, index) => {
    // Get audio URL - it should be in segment.audioUrl after being uploaded
    const audioUrl = (segment as any).audioUrl;
    
    if (!audioUrl) {
      console.warn(`⚠️ [InfiniteTalk] Segment ${index} has no audio URL, skipping video generation`);
      return null;
    }

    try {
      const result = await generateInfiniteTalkVideo({
        channelId,
        productionId,
        segmentIndex: index,
        audioUrl,
        referenceImageUrl: config.referenceImageUrl!,
        speaker: segment.speaker,
        dialogueText: segment.text,
        hostAName,
        hostBName,
        hostAVisualPrompt,  // Pass visual description
        hostBVisualPrompt,  // Pass visual description
        resolution: '720p'
      });

      console.log(`✅ [InfiniteTalk] Segment ${index + 1}/${segments.length} complete${result.fromCache ? ' (cached)' : ''}`);
      return result.url;
    } catch (error) {
      console.error(`❌ [InfiniteTalk] Segment ${index} failed:`, (error as Error).message);
      return null;
    }
  });

  const videoUrls = await Promise.all(videoPromises);
  
  const successCount = videoUrls.filter(url => url !== null).length;
  console.log(`✅ [InfiniteTalk Multi] Generated ${successCount}/${segments.length} videos`);

  return videoUrls;
};

/**
 * Legacy function for compatibility - now just returns empty arrays
 * Actual video generation happens in generateVideoSegmentsWithInfiniteTalk
 */
export const generateVideoSegments = async (
  script: ScriptLine[],
  config: ChannelConfig,
  channelId: string,
  productionId?: string
): Promise<(string | null)[]> => {
  console.log(`⚠️ [Video Generation] generateVideoSegments called but videos are generated separately with InfiniteTalk`);
  console.log(`⚠️ [Video Generation] Use generateVideoSegmentsWithInfiniteTalk after audio is uploaded`);
  return new Array(script.length).fill(null);
};

/**
 * Generate or retrieve intro/outro for a channel
 * For InfiniteTalk, we just use the reference image as static intro/outro frames
 */
export const generateBroadcastVisuals = async (
  newsContext: string,
  config: ChannelConfig,
  script: ScriptLine[],
  channelId: string,
  productionId?: string
): Promise<VideoAssets> => {
  console.log(`[Broadcast Visuals] Setting up intro/outro for channel ${channelId}`);
  
  // For InfiniteTalk workflow, intro/outro are just the reference image
  // The actual lip-sync videos are generated per segment
  const introOutroUrl = config.referenceImageUrl || null;
  
  if (introOutroUrl) {
    console.log(`✅ [Broadcast Visuals] Using reference image for intro/outro`);
  } else {
    console.log(`⚠️ [Broadcast Visuals] No reference image - intro/outro will be empty`);
  }
  
  return {
    wide: introOutroUrl,
    hostA: [],
    hostB: []
  };
};

// Helper function to convert image URL to data URI
const imageUrlToDataUri = async (imageUrl: string): Promise<string> => {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Failed to convert image URL to data URI:", error);
    throw error;
  }
};

export const generateReferenceImage = async (
  config: ChannelConfig,
  sceneDescription?: string
): Promise<string | null> => {
  // Build comprehensive prompt based on channel config and optional scene description
  const defaultScene = sceneDescription || `Professional news studio setting with ${config.tone} atmosphere`;
  
  // CRITICAL: Extract character type from visual prompts to enforce in the image
  const hostADesc = config.characters.hostA.visualPrompt;
  const hostBDesc = config.characters.hostB.visualPrompt;
  
  const prompt = `
STRICT IMAGE GENERATION REQUIREMENTS - READ CAREFULLY:

=== CHARACTERS (MANDATORY - DO NOT CHANGE) ===
LEFT CHARACTER (${config.characters.hostA.name}): ${hostADesc}
RIGHT CHARACTER (${config.characters.hostB.name}): ${hostBDesc}

=== CRITICAL RESTRICTIONS ===
- DO NOT generate human beings under any circumstances
- DO NOT replace the characters with humans
- MUST create exactly the characters described above
- Both characters MUST be clearly visible and recognizable
- Position: ${config.characters.hostA.name} on the LEFT, ${config.characters.hostB.name} on the RIGHT

=== SCENE SETUP ===
- Setting: Professional podcast/news broadcast studio
- Layout: Two-person desk setup with microphones
- Lighting: Professional studio lighting
- Background: Modern news studio with screens/monitors
- Aspect Ratio: ${config.format}
- Quality: High resolution, broadcast quality

=== CHANNEL BRANDING ===
- Channel: ${config.channelName}
- Tagline: ${config.tagline}
- Tone: ${config.tone}

=== COMPOSITION ===
- Both characters seated at a professional desk
- Microphones visible in front of each character
- Studio monitors or screens in background
- Professional news studio environment
- Characters should appear ready to present news

FINAL CHECK: Verify the image contains EXACTLY the characters described (${hostADesc} and ${hostBDesc}), NOT humans.
`.trim();

  try {
    // Use WaveSpeed Nano Banana Pro Edit if API key is available
    if (isWavespeedConfigured()) {
      console.log(`[Wavespeed] Generating reference image using Nano Banana Pro Edit`);
      
      const aspectRatio = config.format === '9:16' ? '9:16' : '16:9';
      // Create placeholder image for Nano Banana Pro Edit (requires input image)
      const placeholderImage = createPlaceholderImage(
        aspectRatio === '9:16' ? 576 : 1024,
        aspectRatio === '9:16' ? 1024 : 576
      );
      const taskId = await createWavespeedImageTask(prompt, aspectRatio, placeholderImage);
      const imageUrl = await pollWavespeedImageTask(taskId);
      
      // Convert image URL to data URI for consistency with the rest of the app
      const dataUri = await imageUrlToDataUri(imageUrl);
      
      // Track cost (Nano Banana Pro Edit 2k resolution is $0.14)
      CostTracker.track('thumbnail', 'google/nano-banana-pro/edit', 0.14);
      
      return dataUri;
    } else {
      // Fallback to Google Gemini API
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: getModelForTask('thumbnail'),
        contents: prompt,
        config: {
          responseModalities: ["IMAGE" as any],
        }
      });

      CostTracker.track('thumbnail', getModelForTask('thumbnail'), getCostForTask('thumbnail'));

      const imageBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (imageBase64) {
        return `data:image/png;base64,${imageBase64}`;
      }
      return null;
    }
  } catch (e) {
    console.error("Reference image generation failed", e);
    return null;
  }
};

export const generateThumbnail = async (newsContext: string, config: ChannelConfig): Promise<string | null> => {
  const ai = getAiClient();

  const prompt = `
  Create a high-impact YouTube thumbnail for a news video about: ${newsContext}.
  Channel Style: ${config.channelName} (${config.tone}).
  Visuals: Bold, high contrast, breaking news style. 
  Include text overlay if possible or just striking imagery.
  Aspect Ratio: 16:9.
  No photorealistic faces of real politicians if restricted, use stylized or symbolic representations.
`;

  try {
    const response = await ai.models.generateContent({
      model: getModelForTask('thumbnail'),
      contents: prompt,
      config: {
        responseModalities: ["IMAGE" as any],
      }
    });

    CostTracker.track('thumbnail', getModelForTask('thumbnail'), getCostForTask('thumbnail'));

    const imageBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (imageBase64) {
      return `data:image/png;base64,${imageBase64}`;
    }
    return null;
  } catch (e) {
    console.error("Thumbnail generation failed", e);
    return null;
  }
};

export const generateThumbnailVariants = async (
  newsContext: string,
  config: ChannelConfig,
  viralMeta: ViralMetadata
): Promise<{ primary: string | null; variant: string | null }> => {
  const ai = getAiClient();

  // Define 3 proven thumbnail styles
  const styles = [
    {
      name: "Shocked Face + Bold Text",
      prompt: "Close-up shocked/surprised expression with mouth open, bold oversized text overlay with the headline, high contrast bright colors, dramatic lighting from one side"
    },
    {
      name: "Split Screen Comparison",
      prompt: "Split-screen vertical composition showing before/after or two contrasting elements, bold arrows pointing between them, numbers/percentages overlaid, contrasting color schemes on each side"
    },
    {
      name: "Symbolic + Urgency",
      prompt: "Symbolic representation of the topic (money, charts, danger symbols), urgent red/yellow color scheme, text with exclamation marks, clock or fire emoji elements"
    }
  ];

  // Rotate style based on date (simple A/B pattern)
  const styleIndex = new Date().getDate() % styles.length;
  const primaryStyle = styles[styleIndex];
  const variantStyle = styles[(styleIndex + 1) % styles.length];

  const basePrompt = (style: typeof styles[0]) => `
Create a VIRAL YouTube thumbnail for: "${viralMeta.title}"

Topic: ${newsContext}
Channel: ${config.channelName}

STYLE: ${style.name}
${style.prompt}

REQUIREMENTS:
- 16:9 ratio (1280x720)
- Bold readable text: "${viralMeta.title.substring(0, 30)}"
- Brand colors: ${config.logoColor1}, ${config.logoColor2}
- High contrast (mobile-friendly)
- Evoke emotion: shock, curiosity, urgency
- NO photorealistic politicians (use icons/symbols)
- Professional news aesthetic

Make it CLICK-WORTHY!
`.trim();

  try {
    const [primary, variant] = await Promise.all([
      retryWithBackoff(async () => {
        const response = await ai.models.generateContent({
          model: getModelForTask('thumbnail'),
          contents: basePrompt(primaryStyle),
          config: { responseModalities: ["IMAGE" as any] }
        });

        CostTracker.track('thumbnail', getModelForTask('thumbnail'), getCostForTask('thumbnail'));

        const imageBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!imageBase64) throw new Error('No image data');
        return `data:image/png;base64,${imageBase64}`;
      }, { maxRetries: 2, baseDelay: 2000 }),

      retryWithBackoff(async () => {
        const response = await ai.models.generateContent({
          model: getModelForTask('thumbnail'),
          contents: basePrompt(variantStyle),
          config: { responseModalities: ["IMAGE" as any] }
        });

        CostTracker.track('thumbnail', getModelForTask('thumbnail'), getCostForTask('thumbnail'));

        const imageBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!imageBase64) throw new Error('No image data');
        return `data:image/png;base64,${imageBase64}`;
      }, { maxRetries: 2, baseDelay: 2000 })
    ]);

    return { primary, variant };
  } catch (e) {
    console.error("Thumbnail variants generation failed", e);
    // Fallback to single thumbnail
    const fallback = await generateThumbnail(newsContext, config);
    return { primary: fallback, variant: null };
  }
};

export const generateViralHook = async (
  news: NewsItem[],
  config: ChannelConfig
): Promise<string> => {
  const ai = getAiClient();

  const topStory = news[0];

  const prompt = `
You are a VIRAL content scriptwriter (100M+ views).

Create an ATTENTION-GRABBING opening hook (2-3 sentences, max 30 words) for this news:
"${topStory.headline}"

HOOK FORMULA:
1. Shocking statement OR urgent question
2. Promise immediate value
3. Create curiosity gap

POWER WORDS: YOU, THIS, NOW, SHOCKING, BREAKING, EXPOSED, REVEALED

EXAMPLES:
- "You WON'T believe what just happened to the stock market. In 60 seconds, I'll show you how this affects YOUR money."
- "BREAKING: This could change EVERYTHING. Here's what the news won't tell you."
- "They tried to hide THIS from you. Watch before it's deleted."

Channel tone: ${config.tone}
Return ONLY the hook text, no explanation.
`.trim();

  try {
    const response = await ai.models.generateContent({
      model: getModelForTask('viralHook'),
      contents: prompt
    });

    CostTracker.track('viralHook', getModelForTask('viralHook'), getCostForTask('viralHook'));

    return response.text?.trim() || "You won't believe this news...";
  } catch (e) {
    console.error("Viral hook generation failed", e);
    return `Breaking news about ${topStory.headline.substring(0, 30)}...`;
  }
};
