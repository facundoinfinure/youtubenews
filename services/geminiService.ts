import { GoogleGenAI, Modality } from "@google/genai";
import { NewsItem, ScriptLine, BroadcastSegment, VideoAssets, ViralMetadata, ChannelConfig } from "../types";
import { ContentCache } from "./ContentCache";
import { retryWithBackoff } from "./retryUtils";
import { getModelForTask, getCostForTask, getWavespeedModel } from "./modelStrategy";
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
  VideoProvider
} from "./supabaseService";
import { createWavespeedVideoTask, pollWavespeedTask, createWavespeedImageTask, pollWavespeedImageTask } from "./wavespeedProxy";

const getApiKey = () => import.meta.env.VITE_GEMINI_API_KEY || window.env?.API_KEY || process.env.API_KEY || "";
const getWavespeedApiKey = () => import.meta.env.VITE_WAVESPEED_API_KEY || window.env?.WAVESPEED_API_KEY || process.env.WAVESPEED_API_KEY || "";
const getAiClient = () => new GoogleGenAI({ apiKey: getApiKey() });

// Helper function to check if Wavespeed should be used
const shouldUseWavespeed = () => {
  return !!getWavespeedApiKey();
};

// Helper function to create a simple placeholder image as data URI
// This creates a minimal image that Nano Banana Pro Edit can use as a starting point
const createPlaceholderImage = (width: number = 1024, height: number = 1024): string => {
  if (typeof document === 'undefined') {
    // Fallback for non-browser environments - return a minimal 1x1 PNG data URI
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Create a simple gradient background that represents a basic studio setting
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a1a1a');
    gradient.addColorStop(0.5, '#2a2a2a');
    gradient.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Add a subtle center area to suggest a studio space
    ctx.fillStyle = 'rgba(40, 40, 40, 0.3)';
    ctx.fillRect(width * 0.2, height * 0.2, width * 0.6, height * 0.6);
  }
  return canvas.toDataURL('image/png');
};

// Wrapper function to create video task with model from config
const createWavespeedTask = async (prompt: string, aspectRatio: '16:9' | '9:16', referenceImageUrl?: string): Promise<string> => {
  const model = getWavespeedModel();
  return createWavespeedVideoTask(prompt, aspectRatio, referenceImageUrl, model);
};

// =============================================================================================
// VIDEO GENERATION WITH CACHE AND FALLBACK
// =============================================================================================

interface VideoGenerationOptions {
  channelId: string;
  productionId?: string;
  videoType: VideoType;
  segmentIndex?: number;
  prompt: string;
  dialogueText?: string;
  aspectRatio: '16:9' | '9:16';
  referenceImageUrl?: string;
}

/**
 * Generate a video with intelligent caching and provider fallback
 * Order: Cache -> WaveSpeed -> VEO 3
 * Saves to cache after successful generation
 */
const generateVideoWithCacheAndFallback = async (
  options: VideoGenerationOptions
): Promise<{ url: string | null; provider: VideoProvider; fromCache: boolean }> => {
  const { channelId, productionId, videoType, segmentIndex, prompt, dialogueText, aspectRatio, referenceImageUrl } = options;
  const promptHash = createPromptHash(prompt);

  // Step 1: Check cache first
  let cachedVideo = null;
  
  if (dialogueText) {
    // For lip-sync videos, match by dialogue text
    cachedVideo = await findCachedVideoByDialogue(channelId, videoType, dialogueText, aspectRatio);
  } else {
    // For non-dialogue videos (intro/outro), match by prompt hash
    cachedVideo = await findCachedVideo(channelId, videoType, promptHash, aspectRatio);
  }

  if (cachedVideo && cachedVideo.video_url) {
    console.log(`✅ [Video Cache] Using cached ${videoType} video`);
    return { url: cachedVideo.video_url, provider: cachedVideo.provider as VideoProvider, fromCache: true };
  }

  // Step 2: Try WaveSpeed first (primary provider for lip-sync)
  if (shouldUseWavespeed()) {
    try {
      console.log(`🎬 [WaveSpeed] Generating ${videoType} video...`);
      const taskId = await createWavespeedTask(prompt, aspectRatio, referenceImageUrl);
      const videoUrl = await pollWavespeedTask(taskId);
      
      if (videoUrl) {
        CostTracker.track('video', getWavespeedModel(), getCostForTask('video'));
        
        // Save to cache
        await saveGeneratedVideo({
          channel_id: channelId,
          production_id: productionId || null,
          video_type: videoType,
          segment_index: segmentIndex ?? null,
          prompt_hash: promptHash,
          dialogue_text: dialogueText || null,
          video_url: videoUrl,
          provider: 'wavespeed',
          aspect_ratio: aspectRatio,
          duration_seconds: null,
          status: 'completed',
          error_message: null,
          reference_image_hash: referenceImageUrl ? createPromptHash(referenceImageUrl.substring(0, 100)) : null,
          expires_at: null
        });

        console.log(`✅ [WaveSpeed] ${videoType} video generated and cached`);
        return { url: videoUrl, provider: 'wavespeed', fromCache: false };
      }
    } catch (wavespeedError) {
      console.warn(`⚠️ [WaveSpeed] Failed for ${videoType}:`, (wavespeedError as Error).message);
      // Continue to VEO 3 fallback
    }
  }

  // Step 3: Fallback to VEO 3
  try {
    console.log(`🎬 [VEO 3] Fallback: Generating ${videoType} video...`);
    const ai = getAiClient();
    const operation = await ai.models.generateVideos({
      model: getModelForTask('video'),
      prompt: prompt,
      config: {
        aspectRatio: aspectRatio,
        ...(referenceImageUrl ? { referenceImage: referenceImageUrl } : {})
      }
    });

    CostTracker.track('video', getModelForTask('video'), getCostForTask('video'));

    if (operation) {
      const videoUrl = await pollForVideo(operation);
      
      if (videoUrl) {
        // Save to cache
        await saveGeneratedVideo({
          channel_id: channelId,
          production_id: productionId || null,
          video_type: videoType,
          segment_index: segmentIndex ?? null,
          prompt_hash: promptHash,
          dialogue_text: dialogueText || null,
          video_url: videoUrl,
          provider: 'veo3',
          aspect_ratio: aspectRatio,
          duration_seconds: null,
          status: 'completed',
          error_message: null,
          reference_image_hash: referenceImageUrl ? createPromptHash(referenceImageUrl.substring(0, 100)) : null,
          expires_at: null
        });

        console.log(`✅ [VEO 3] ${videoType} video generated and cached`);
        return { url: videoUrl, provider: 'veo3', fromCache: false };
      }
    }
  } catch (veo3Error) {
    console.error(`❌ [VEO 3] Failed for ${videoType}:`, (veo3Error as Error).message);
  }

  // All providers failed
  console.error(`❌ All video providers failed for ${videoType}`);
  return { url: null, provider: 'other', fromCache: false };
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

      const prompt = `Find EXACTLY 15 impactful economic or political news stories from ${dateString} relevant to ${config.country}. 
  Focus on major market moves, inflation, politics, or social issues. 
  
  Return a strictly formatted JSON array of objects with these keys: 
  - "headline" (string, in ${config.language})
  - "source" (string)
  - "url" (string, use grounding or best guess)
  - "summary" (string, 1 short sentence in ${config.language})
  - "viralScore" (number, 1-100 based on controversy or impact)
  - "imageKeyword" (string, 2-3 words visual description of the topic for image generation, e.g. "bitcoin crash", "stock market bull")
  - "imageUrl" (string, optional - URL of the article's main image from Google News if available. Use the image URL from the Google News search results.)

  CRITICAL REQUIREMENTS:
  1. You MUST return EXACTLY 15 items in the JSON array. Count them carefully.
  2. If you cannot find 15 unique stories, find related stories, variations, or follow-up stories to reach 15.
  3. Include imageUrl from Google News search results when available - these images are important for display.
  4. Do not include markdown formatting like \`\`\`json - return pure JSON only.
  
  Example format: [{"headline":"...","source":"...","url":"...","summary":"...","viralScore":85,"imageKeyword":"...","imageUrl":"..."}, ...]`;

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
      const jsonStr = text.replace(/```json\n|\n```/g, "").replace(/```/g, "");

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
    const text = response.text || "[]";
    // Cleanup markdown code blocks and trim
    const cleanText = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();

    return JSON.parse(cleanText) as ScriptLine[];
  } catch (e) {
    console.error("Script parsing error", e);
    const text = response.text || "[]";
    console.error("Response text (first 200 chars):", text.substring(0, 200));
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
        const topics = JSON.parse(response.text || "[]");
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

      const metadata = JSON.parse(response.text || "{}");

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

// Helper for video polling
const pollForVideo = async (operation: any): Promise<string> => {
  const ai = getAiClient();
  let retries = 0;
  while (!operation.done && retries < 60) { // Increased timeout for VEO
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await ai.operations.getVideosOperation({ operation });
    retries++;
  }
  if (!operation.done) throw new Error("Video generation timed out");
  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) throw new Error("No video URI");
  // Append Key here using the getter helper logic, not process.env directly
  return `${videoUri}&key=${getApiKey()}`;
};

// =============================================================================================
// STRUCTURED VIDEO GENERATION FUNCTIONS
// =============================================================================================

/**
 * Generate intro video (generic, no dialogue) - reusable per channel
 * Uses intelligent caching: Cache -> WaveSpeed -> VEO 3
 */
export const generateIntroVideo = async (
  config: ChannelConfig,
  channelId: string,
  productionId?: string
): Promise<string | null> => {
  const referenceImageContext = config.referenceImageUrl 
    ? `\nCRITICAL REFERENCE IMAGE: Use the provided reference image as the EXACT visual template. Match the exact podcast studio setting, character appearances, lighting, and composition from the reference image.\n` 
    : '';

  const prompt = `
Create a professional ${config.format} intro video for "${config.channelName}".

SCENE DESCRIPTION:
- Two chimpanzees (${config.characters.hostA.name} and ${config.characters.hostB.name}) in a modern podcast studio
- Both hosts visible in frame, sitting at a desk with microphones
- Professional studio environment with branding elements
- Camera: Wide shot showing both chimpanzees
- Setting: Indoor podcast studio (NOT outdoor or landscape)

CHARACTERS:
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}

CHANNEL: ${config.channelName}
TAGLINE: ${config.tagline}
BRANDING COLORS: ${config.logoColor1} and ${config.logoColor2}

STYLE: ${config.tone}, professional podcast-style news studio
DURATION: 5-6 seconds
ACTION: Both hosts looking at camera, welcoming gesture, no dialogue (intro music will play)
BRANDING: Include channel name "${config.channelName}" and tagline "${config.tagline}" visually in the scene. Use brand colors ${config.logoColor1} and ${config.logoColor2} in graphics, logos, or on-screen elements.
${referenceImageContext}

IMPORTANT: This is an intro video with NO dialogue. The hosts should be visible and welcoming, but not speaking. The scene must be an indoor podcast studio.
  `.trim();

  return retryWithBackoff(async () => {
    try {
      const result = await generateVideoWithCacheAndFallback({
        channelId,
        productionId,
        videoType: 'intro',
        prompt,
        aspectRatio: config.format,
        referenceImageUrl: config.referenceImageUrl
      });

      if (result.url) {
        // Save to channel cache (legacy support)
        const { outroUrl } = await getChannelIntroOutro(channelId);
        await saveChannelIntroOutro(channelId, result.url, outroUrl);
        
        if (result.fromCache) {
          console.log(`✅ [Intro] Using cached video`);
        } else {
          console.log(`✅ [Intro] Generated with ${result.provider}`);
        }
        
        return result.url;
      }
      return null;
    } catch (e) {
      console.error("Intro video generation failed", e);
      return null;
    }
  }, {
    maxRetries: 2,
    baseDelay: 5000,
    onRetry: (attempt) => console.log(`🎬 Retrying intro video generation (${attempt}/2)...`)
  });
};

/**
 * Generate outro video (generic, no dialogue) - reusable per channel
 * Uses intelligent caching: Cache -> WaveSpeed -> VEO 3
 */
export const generateOutroVideo = async (
  config: ChannelConfig,
  channelId: string,
  productionId?: string
): Promise<string | null> => {
  const referenceImageContext = config.referenceImageUrl 
    ? `\nCRITICAL REFERENCE IMAGE: Use the provided reference image as the EXACT visual template. Match the exact podcast studio setting, character appearances, lighting, and composition from the reference image.\n` 
    : '';

  const prompt = `
Create a professional ${config.format} outro video for "${config.channelName}".

SCENE DESCRIPTION:
- Two chimpanzees (${config.characters.hostA.name} and ${config.characters.hostB.name}) in a modern podcast studio
- Both hosts visible in frame, sitting at a desk with microphones
- Professional studio environment with branding elements
- Camera: Wide shot showing both chimpanzees
- Setting: Indoor podcast studio (NOT outdoor or landscape)

CHARACTERS:
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}

CHANNEL: ${config.channelName}
TAGLINE: ${config.tagline}
BRANDING COLORS: ${config.logoColor1} and ${config.logoColor2}

STYLE: ${config.tone}, professional podcast-style news studio
DURATION: 5-6 seconds
ACTION: Both hosts looking at camera, thanking gesture, no dialogue (outro music will play)
BRANDING: Include channel name "${config.channelName}" and tagline "${config.tagline}" visually in the scene. Use brand colors ${config.logoColor1} and ${config.logoColor2} in graphics, logos, or on-screen elements. Include "Subscribe" and "Like" call-to-action elements.
${referenceImageContext}

IMPORTANT: This is an outro video with NO dialogue. The hosts should be visible and thanking the audience, but not speaking. The scene must be an indoor podcast studio.
  `.trim();

  return retryWithBackoff(async () => {
    try {
      const result = await generateVideoWithCacheAndFallback({
        channelId,
        productionId,
        videoType: 'outro',
        prompt,
        aspectRatio: config.format,
        referenceImageUrl: config.referenceImageUrl
      });

      if (result.url) {
        // Save to channel cache (legacy support)
        const { introUrl } = await getChannelIntroOutro(channelId);
        await saveChannelIntroOutro(channelId, introUrl, result.url);
        
        if (result.fromCache) {
          console.log(`✅ [Outro] Using cached video`);
        } else {
          console.log(`✅ [Outro] Generated with ${result.provider}`);
        }
        
        return result.url;
      }
      return null;
    } catch (e) {
      console.error("Outro video generation failed", e);
      return null;
    }
  }, {
    maxRetries: 2,
    baseDelay: 5000,
    onRetry: (attempt) => console.log(`🎬 Retrying outro video generation (${attempt}/2)...`)
  });
};

/**
 * Generate video of a single host with lip-sync for specific dialogue
 * Uses intelligent caching: Cache -> WaveSpeed -> VEO 3
 */
const generateHostVideoWithLipSync = async (
  hostName: string,
  character: any,
  dialogueText: string,
  config: ChannelConfig,
  channelId: string,
  productionId?: string,
  segmentIndex?: number,
  cameraAngle: string = 'front-facing',
  action: string = 'Speaking naturally to camera'
): Promise<string | null> => {
  const referenceImageContext = config.referenceImageUrl 
    ? `\nCRITICAL REFERENCE IMAGE: Use the provided reference image as the EXACT visual template. Match the exact podcast studio setting, character appearance, lighting, and composition from the reference image.\n` 
    : '';

  const prompt = `
Professional news broadcast video segment showing ${character.name} (a chimpanzee) in a podcast studio setting.

CHARACTER: ${character.name} - ${character.visualPrompt}
SCENE: Podcast-style news studio. Single character shot, close-up.
Camera Angle: ${cameraAngle}
Action: ${action}
Dialogue for Lip-Sync: "${dialogueText}"
Duration: 10-15 seconds of continuous speaking
Emotion/Tone: ${config.tone}
Setting: Professional podcast-style news studio (INDOOR, NOT outdoor or landscape). ${character.name} presenting news in a modern studio environment with microphone, desk, and professional lighting. ${config.format} format.
Lighting: Professional studio lighting, high quality, consistent with podcast aesthetic.
Expression: Natural, engaging, appropriate for news content.
${referenceImageContext}

CRITICAL REQUIREMENTS:
- MUST show a chimpanzee in a podcast studio setting (NOT a generic landscape or outdoor scene)
- The character must be speaking the exact dialogue provided for proper lip-sync
- Maintain visual consistency with the podcast studio setting and reference image
- Setting must be an indoor podcast studio, not an outdoor or generic scene
  `.trim();

  // Determine video type based on host
  const videoType: VideoType = hostName === config.characters.hostA.name ? 'host_a' : 'host_b';

  return retryWithBackoff(async () => {
    try {
      const result = await generateVideoWithCacheAndFallback({
        channelId,
        productionId,
        videoType,
        segmentIndex,
        prompt,
        dialogueText, // Include dialogue for cache matching
        aspectRatio: config.format,
        referenceImageUrl: config.referenceImageUrl
      });

      if (result.url) {
        if (result.fromCache) {
          console.log(`✅ [${hostName}] Using cached video`);
        } else {
          console.log(`✅ [${hostName}] Generated with ${result.provider}`);
        }
        return result.url;
      }
      return null;
    } catch (e) {
      console.warn(`Failed to generate video for ${hostName}`, e);
      return null;
    }
  }, {
    maxRetries: 2,
    baseDelay: 5000,
    onRetry: (attempt) => console.log(`🎬 Retrying video generation for ${hostName} (${attempt}/2)...`)
  });
};

/**
 * Generate video of both hosts together with lip-sync for dialogue
 * Uses intelligent caching: Cache -> WaveSpeed -> VEO 3
 */
const generateTwoHostsVideoWithLipSync = async (
  dialogueText: string,
  config: ChannelConfig,
  channelId: string,
  productionId?: string,
  segmentIndex?: number
): Promise<string | null> => {
  const referenceImageContext = config.referenceImageUrl 
    ? `\nCRITICAL REFERENCE IMAGE: Use the provided reference image as the EXACT visual template. Match the exact podcast studio setting, character appearances (2 chimpanzees in podcast studio), lighting, and composition from the reference image.\n` 
    : '';

  const prompt = `
Professional news broadcast video segment showing TWO CHIMPANZEES in a PODCAST-STYLE STUDIO.

SCENE DESCRIPTION:
- Two chimpanzees (${config.characters.hostA.name} and ${config.characters.hostB.name}) in a modern podcast studio
- Both hosts visible in frame, sitting at a desk with microphones
- Camera: Wide shot showing both chimpanzees
- Setting: Indoor podcast studio (NOT outdoor or landscape)

CHARACTERS:
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}

Dialogue for Lip-Sync: "${dialogueText}"
Duration: 10-15 seconds
Emotion/Tone: ${config.tone}
Setting: Professional podcast-style news studio. ${config.format} format.
Lighting: Professional studio lighting, high quality.
${referenceImageContext}

CRITICAL REQUIREMENTS:
- MUST show two chimpanzees in a podcast studio setting (NOT a generic landscape or outdoor scene)
- Both characters must be speaking the exact dialogue provided for proper lip-sync
- Maintain visual consistency with the podcast studio setting and reference image
- Setting must be an indoor podcast studio, not an outdoor or generic scene
  `.trim();

  return retryWithBackoff(async () => {
    try {
      const result = await generateVideoWithCacheAndFallback({
        channelId,
        productionId,
        videoType: 'both_hosts',
        segmentIndex,
        prompt,
        dialogueText, // Include dialogue for cache matching
        aspectRatio: config.format,
        referenceImageUrl: config.referenceImageUrl
      });

      if (result.url) {
        if (result.fromCache) {
          console.log(`✅ [Both Hosts] Using cached video`);
        } else {
          console.log(`✅ [Both Hosts] Generated with ${result.provider}`);
        }
        return result.url;
      }
      return null;
    } catch (e) {
      console.warn(`Failed to generate two hosts video`, e);
      return null;
    }
  }, {
    maxRetries: 2,
    baseDelay: 5000,
    onRetry: (attempt) => console.log(`🎬 Retrying two hosts video generation (${attempt}/2)...`)
  });
};

/**
 * Group consecutive segments by the same speaker for efficient video generation
 */
const groupSegmentsBySpeaker = (script: ScriptLine[]): Array<{ speaker: string; text: string; startIndex: number; endIndex: number }> => {
  const groups: Array<{ speaker: string; text: string; startIndex: number; endIndex: number }> = [];
  
  if (script.length === 0) return groups;
  
  let currentGroup = {
    speaker: script[0].speaker,
    text: script[0].text,
    startIndex: 0,
    endIndex: 0
  };
  
  for (let i = 1; i < script.length; i++) {
    if (script[i].speaker === currentGroup.speaker) {
      // Same speaker, append text
      currentGroup.text += ' ' + script[i].text;
      currentGroup.endIndex = i;
    } else {
      // Different speaker, save current group and start new one
      groups.push(currentGroup);
      currentGroup = {
        speaker: script[i].speaker,
        text: script[i].text,
        startIndex: i,
        endIndex: i
      };
    }
  }
  
  // Don't forget the last group
  groups.push(currentGroup);
  
  return groups;
};

export const generateVideoSegments = async (
  script: ScriptLine[],
  config: ChannelConfig,
  channelId: string,
  productionId?: string
): Promise<(string | null)[]> => {
  // Group consecutive segments by speaker to generate longer videos with lip-sync
  const groupedSegments = groupSegmentsBySpeaker(script);
  
  console.log(`[Video Generation] Grouped ${script.length} segments into ${groupedSegments.length} video groups`);
  console.log(`[Video Generation] Using cache-first strategy: Cache -> WaveSpeed -> VEO 3`);
  
  // Track character variations for visual variety
  const characterVariationCount: Record<string, number> = {
    [config.characters.hostA.name]: 0,
    [config.characters.hostB.name]: 0,
    'Both': 0
  };
  
  // Camera angles and actions for variety
  const cameraAngles = ['front-facing', 'slight 3/4 angle left', 'slight 3/4 angle right', 'front with slight lean', 'front with hand gesture'];
  const actions = [
    'Speaking naturally to camera with confident expression',
    'Speaking to camera with subtle hand gestures emphasizing key points',
    'Speaking to camera with slight head movements for emphasis',
    'Speaking to camera with engaged, animated expression',
    'Speaking to camera with professional, authoritative presence'
  ];
  
  // Generate videos for each group (with incremental saving to cache)
  const videoPromises = groupedSegments.map(async (group, groupIndex) => {
    const isWideShot = group.speaker === 'Both' || group.speaker.includes('Both');
    
    // Determine character
    let character = config.characters.hostA;
    if (group.speaker === config.characters.hostB.name) {
      character = config.characters.hostB;
    }
    
    // Track variation for visual variety
    const speakerKey = isWideShot ? 'Both' : character.name;
    characterVariationCount[speakerKey] = (characterVariationCount[speakerKey] || 0) + 1;
    const variationNumber = characterVariationCount[speakerKey] % 5;
    const cameraAngle = cameraAngles[variationNumber];
    const action = actions[variationNumber];
    
    // Generate video with lip-sync (includes caching and fallback)
    let videoUrl: string | null = null;
    
    if (isWideShot) {
      // Both hosts together
      videoUrl = await generateTwoHostsVideoWithLipSync(
        group.text, 
        config,
        channelId,
        productionId,
        group.startIndex
      );
    } else {
      // Single host
      videoUrl = await generateHostVideoWithLipSync(
        group.speaker,
        character,
        group.text,
        config,
        channelId,
        productionId,
        group.startIndex,
        cameraAngle,
        action
      );
    }
    
    // Log progress after each video is generated/cached
    console.log(`[Video Generation] Segment group ${groupIndex + 1}/${groupedSegments.length} complete`);
    
    // Return video URL for all segments in this group
    return {
      videoUrl,
      startIndex: group.startIndex,
      endIndex: group.endIndex
    };
  });
  
  const videoResults = await Promise.all(videoPromises);
  
  // Map grouped videos back to individual segments
  const segmentVideos: (string | null)[] = new Array(script.length).fill(null);
  
  videoResults.forEach((result) => {
    // Assign the same video URL to all segments in this group
    for (let i = result.startIndex; i <= result.endIndex; i++) {
      segmentVideos[i] = result.videoUrl;
    }
  });
  
  const cachedCount = videoResults.filter(r => r.videoUrl).length;
  console.log(`[Video Generation] Completed: ${cachedCount} videos for ${script.length} segments`);
  
  return segmentVideos;
};
/**
 * Generate or retrieve intro/outro videos for a channel
 * This function now only handles intro/outro caching, not the main content videos
 * Uses intelligent caching: Cache -> WaveSpeed -> VEO 3
 */
export const generateBroadcastVisuals = async (
  newsContext: string,
  config: ChannelConfig,
  script: ScriptLine[],
  channelId: string,
  productionId?: string
): Promise<VideoAssets> => {
  console.log(`[Broadcast Visuals] Getting intro/outro videos for channel ${channelId}`);
  console.log(`[Broadcast Visuals] Using cache-first strategy: Cache -> WaveSpeed -> VEO 3`);
  
  // Check generated_videos cache first (new system)
  const cachedChannelVideos = await getCachedChannelVideos(channelId, config.format);
  
  // Also check legacy channel cache
  const { introUrl: legacyIntroUrl, outroUrl: legacyOutroUrl } = await getChannelIntroOutro(channelId);
  
  let finalIntroUrl = cachedChannelVideos.intro?.video_url || legacyIntroUrl;
  let finalOutroUrl = cachedChannelVideos.outro?.video_url || legacyOutroUrl;
  
  // Generate intro if not cached
  if (!finalIntroUrl) {
    console.log(`[Broadcast Visuals] No cached intro found, generating new intro...`);
    finalIntroUrl = await generateIntroVideo(config, channelId, productionId);
  } else {
    console.log(`[Broadcast Visuals] ✅ Using cached intro video`);
  }
  
  // Generate outro if not cached
  if (!finalOutroUrl) {
    console.log(`[Broadcast Visuals] No cached outro found, generating new outro...`);
    finalOutroUrl = await generateOutroVideo(config, channelId, productionId);
  } else {
    console.log(`[Broadcast Visuals] ✅ Using cached outro video`);
  }
  
  // Return VideoAssets structure
  // Note: hostA and hostB arrays will be populated by generateVideoSegments()
  return {
    wide: finalIntroUrl || finalOutroUrl || null, // Use intro/outro for wide shot (used during intro/outro phases)
    hostA: [], // Will be populated by generateVideoSegments
    hostB: []  // Will be populated by generateVideoSegments
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
  
  const prompt = `
Create a high-quality reference image for a news broadcast studio.

CHANNEL: ${config.channelName}
TAGLINE: ${config.tagline}
STYLE: ${config.tone}

CHARACTERS TO INCLUDE:
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}

SCENE DESCRIPTION: ${defaultScene}
- Both characters should be visible in the scene
- Professional news studio setting
- ${config.format} aspect ratio
- Studio lighting, high quality
- Show the complete setting including background, furniture, equipment
- Maintain visual consistency for future video generation

IMPORTANT: This image will be used as a reference for maintaining visual consistency across all video generations. Ensure both characters are clearly visible and the scene is well-composed.
`.trim();

  try {
    // Use WaveSpeed Nano Banana Pro Edit if API key is available
    if (shouldUseWavespeed()) {
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
