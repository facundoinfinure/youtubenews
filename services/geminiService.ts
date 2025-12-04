import { GoogleGenAI, Modality } from "@google/genai";
import { NewsItem, ScriptLine, BroadcastSegment, VideoAssets, ViralMetadata, ChannelConfig, Scene, ScriptWithScenes, VideoMode, ShotType } from "../types";
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

// Import new services
import { 
  generateScriptWithGPT,
  generateViralMetadataWithGPT,
  generateViralHookWithGPT,
  generateTTSAudio,
  generateImageWithDALLE,
  checkOpenAIConfig,
  createTitleVariantFallback
} from "./openaiService";
import { 
  fetchNewsWithSerpAPI,
  fetchTrendingWithSerpAPI,
  checkSerpAPIConfig
} from "./serpApiService";
import { 
  generateScenePrompts, 
  ScenePrompt, 
  SCENE_BUILDER_DEFAULTS 
} from "./sceneBuilderService";
import { 
  ShotstackService, 
  checkShotstackConfig,
  createCompositionFromSegments,
  CompositionConfig,
  RenderResult
} from "./shotstackService";

const getApiKey = () => import.meta.env.VITE_GEMINI_API_KEY || window.env?.API_KEY || process.env.API_KEY || "";
const getAiClient = () => new GoogleGenAI({ apiKey: getApiKey() });

// Helper function to check if Wavespeed is configured (via proxy or direct API key)
const isWavespeedConfigured = () => {
  const config = checkWavespeedConfig();
  return config.configured;
};

// Channel-specific branding overrides (intro/outro assets)
const CHANNEL_BRANDING_OVERRIDES: Record<string, { intro: string; outro: string }> = {
  chimpnews: {
    intro: "https://dbtlmnvcrsbrtruipvyg.supabase.co/storage/v1/object/public/channel-assets/videos/intro_outros/chimp_news_intro.mp4",
    outro: "https://dbtlmnvcrsbrtruipvyg.supabase.co/storage/v1/object/public/channel-assets/videos/intro_outros/chimp_news_outro.mp4"
  }
};

const normalizeChannelKey = (channelName?: string) =>
  (channelName || '').replace(/\s+/g, '').toLowerCase();

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
  // Scene metadata from v2.0 Narrative Engine
  sceneMetadata?: {
    video_mode: VideoMode;
    model: 'infinite_talk' | 'infinite_talk_multi';
    shot: ShotType;
    scenePrompt?: string; // Prompt from Scene Builder
  };
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
    resolution = '720p',
    sceneMetadata
  } = options;

  // Determine video type based on scene metadata or speaker name
  let videoType: VideoType = 'segment';
  let effectiveVideoMode: VideoMode | null = null;
  
  if (sceneMetadata?.video_mode) {
    effectiveVideoMode = sceneMetadata.video_mode;
    videoType = effectiveVideoMode === 'hostA' ? 'host_a' 
      : effectiveVideoMode === 'hostB' ? 'host_b' 
      : 'both_hosts';
  } else {
    // Fallback to speaker-based detection
    if (speaker === hostAName) {
      videoType = 'host_a';
      effectiveVideoMode = 'hostA';
    } else if (speaker === hostBName) {
      videoType = 'host_b';
      effectiveVideoMode = 'hostB';
    } else if (speaker === 'Both' || speaker.includes('Both')) {
      videoType = 'both_hosts';
      effectiveVideoMode = 'both';
    }
  }

  // Check cache first
  const cachedVideo = await findCachedVideoByDialogue(channelId, videoType, dialogueText, '16:9');
  if (cachedVideo && cachedVideo.video_url) {
    console.log(`✅ [InfiniteTalk] Using cached video for segment ${segmentIndex}`);
    return { url: cachedVideo.video_url, fromCache: true };
  }

  // Generate new video with InfiniteTalk Multi
  const silentAudioUrl = getSilentAudioUrl();
  
  // Determine which audio goes to which side based on video_mode
  // Host A = left, Host B = right (based on typical two-person shot)
  let leftAudio = silentAudioUrl;
  let rightAudio = silentAudioUrl;
  let order: 'left_first' | 'right_first' | 'meanwhile' = 'meanwhile';

  if (effectiveVideoMode === 'hostA') {
    leftAudio = audioUrl;
    order = 'left_first';
  } else if (effectiveVideoMode === 'hostB') {
    rightAudio = audioUrl;
    order = 'right_first';
  } else {
    // Both speaking - use same audio for simplicity (they speak in unison)
    leftAudio = audioUrl;
    rightAudio = audioUrl;
    order = 'meanwhile';
  }

  // Get shot type from scene metadata or default to medium
  const shotType = sceneMetadata?.shot || 'medium';
  const shotDescription = shotType === 'closeup' ? 'Close-up shot, tight framing' 
    : shotType === 'wide' ? 'Wide shot, showing full studio' 
    : 'Medium shot, standard framing';

  // Use scene prompt if available, otherwise build character-specific prompt
  // CRITICAL: Be very specific about the characters to avoid generating humans
  const characterPrompt = sceneMetadata?.scenePrompt || `
STRICT CHARACTER REQUIREMENTS - DO NOT DEVIATE:
- LEFT CHARACTER: ${hostAName} - ${hostAVisualPrompt}
- RIGHT CHARACTER: ${hostBName} - ${hostBVisualPrompt}

SCENE: Professional podcast news studio with two animated characters.
SHOT: ${shotDescription}
SPEAKING: ${effectiveVideoMode === 'hostA' ? hostAName : effectiveVideoMode === 'hostB' ? hostBName : 'Both hosts'} is currently speaking with lip-sync animation.
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
  // Use SerpAPI for news fetching (no more Gemini quota issues!)
  console.log(`📰 [News] Fetching news using SerpAPI...`);
  
  try {
    const news = await fetchNewsWithSerpAPI(targetDate, config);
    console.log(`✅ [News] Successfully fetched ${news.length} news items via SerpAPI`);
    return news;
  } catch (error) {
    console.error(`❌ [News] SerpAPI failed:`, (error as Error).message);
    throw error;
  }
};

/**
 * Convert ScriptWithScenes to ScriptLine[] for backwards compatibility
 * Extracts dialogue text from scenes and alternates between hostA and hostB
 */
export const convertScenesToScriptLines = (
  scriptWithScenes: ScriptWithScenes,
  config: ChannelConfig
): ScriptLine[] => {
  const lines: ScriptLine[] = [];
  const hostAName = config.characters.hostA.name;
  const hostBName = config.characters.hostB.name;
  
  Object.entries(scriptWithScenes.scenes)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .forEach(([_, scene]) => {
      // Parse dialogue from scene text - extract speaker labels if present
      const text = scene.text;
      
      // Check if scene text contains speaker labels like "Rusty:" or "Dani:"
      const dialoguePattern = new RegExp(`(${hostAName}|${hostBName}):\\s*([^${hostAName}${hostBName}]+)`, 'gi');
      const matches = [...text.matchAll(dialoguePattern)];
      
      if (matches.length > 0) {
        // Extract labeled dialogues
        matches.forEach(match => {
          const speaker = match[1];
          const dialogue = match[2].trim();
          if (dialogue) {
            lines.push({ speaker, text: dialogue });
          }
        });
      } else {
        // No labels found - assign based on video_mode
        const speaker = scene.video_mode === 'hostA' ? hostAName
          : scene.video_mode === 'hostB' ? hostBName
          : 'Both';
        lines.push({ speaker, text: text.trim() });
      }
    });
  
  return lines;
};

/**
 * Generate script with v2.0 Narrative Engine (returns full scene structure)
 */
export const generateScriptWithScenes = async (
  news: NewsItem[], 
  config: ChannelConfig, 
  viralHook?: string
): Promise<ScriptWithScenes> => {
  console.log(`📝 [Script v2.0] Generating script with Narrative Engine...`);
  
  try {
    const scriptWithScenes = await generateScriptWithGPT(news, config, viralHook);
    console.log(`✅ [Script v2.0] Generated ${Object.keys(scriptWithScenes.scenes).length} scenes using "${scriptWithScenes.narrative_used}" narrative`);
    return scriptWithScenes;
  } catch (error) {
    console.error(`❌ [Script v2.0] GPT-4o failed:`, (error as Error).message);
    throw error;
  }
};

/**
 * Legacy function for backwards compatibility - returns ScriptLine[]
 * Internally uses v2.0 Narrative Engine and converts to legacy format
 */
export const generateScript = async (news: NewsItem[], config: ChannelConfig, viralHook?: string): Promise<ScriptLine[]> => {
  // Use GPT-4o for script generation with v2.0 Narrative Engine
  console.log(`📝 [Script] Generating script using GPT-4o (v2.0)...`);
  
  try {
    const scriptWithScenes = await generateScriptWithGPT(news, config, viralHook);
    const scriptLines = convertScenesToScriptLines(scriptWithScenes, config);
    console.log(`✅ [Script] Successfully generated ${scriptLines.length} script lines via GPT-4o`);
    return scriptLines;
  } catch (error) {
    console.error(`❌ [Script] GPT-4o failed:`, (error as Error).message);
    throw error;
  }
};

export const fetchTrendingTopics = async (country: string): Promise<string[]> => {
  // Use SerpAPI for trending topics (no more Gemini quota issues!)
  console.log(`📈 [Trending] Fetching trending topics using SerpAPI...`);
  
  try {
    const topics = await fetchTrendingWithSerpAPI(country);
    console.log(`✅ [Trending] Successfully fetched ${topics.length} trending topics via SerpAPI`);
    return topics;
  } catch (error) {
    console.error(`❌ [Trending] SerpAPI failed:`, (error as Error).message);
    return []; // Return empty array on failure (non-critical)
  }
};

export const generateViralMetadata = async (news: NewsItem[], config: ChannelConfig, date: Date): Promise<ViralMetadata> => {
  // Use GPT-4o for metadata generation (no more Gemini quota issues!)
  console.log(`🏷️ [Metadata] Generating viral metadata using GPT-4o...`);
  
  // Get trending topics for SEO boost
  const trending = await fetchTrendingTopics(config.country);
  
  try {
    const metadata = await generateViralMetadataWithGPT(news, config, date, trending);
    console.log(`✅ [Metadata] Successfully generated metadata via GPT-4o`);
    return metadata;
  } catch (error) {
    console.error(`❌ [Metadata] GPT-4o failed:`, (error as Error).message);
    // Return defaults on failure
    const fallbackTitle = "Breaking News";
    return { 
      title: fallbackTitle, 
      titleVariants: [fallbackTitle, createTitleVariantFallback(fallbackTitle)], 
      description: "", 
      tags: [] 
    };
  }
};

// Helper function to import findCachedAudio dynamically to avoid circular dependency
let findCachedAudioFn: ((text: string, voiceName: string, channelId: string) => Promise<string | null>) | null = null;

export const setFindCachedAudioFunction = (fn: (text: string, voiceName: string, channelId: string) => Promise<string | null>) => {
  findCachedAudioFn = fn;
};

/**
 * Split "Both" dialogue lines into separate lines for each host
 * This ensures each host speaks their own part instead of speaking in unison
 */
const splitBothDialogues = (script: ScriptLine[], config: ChannelConfig): ScriptLine[] => {
  const result: ScriptLine[] = [];
  
  for (const line of script) {
    if (line.speaker === 'Both' || line.speaker.toLowerCase().includes('both')) {
      // Split the text into two parts
      const text = line.text.trim();
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
      
      if (sentences.length >= 2) {
        // If there are 2+ sentences, split between hosts
        const midpoint = Math.ceil(sentences.length / 2);
        const hostAText = sentences.slice(0, midpoint).join(' ').trim();
        const hostBText = sentences.slice(midpoint).join(' ').trim();
        
        if (hostAText) {
          result.push({ speaker: config.characters.hostA.name, text: hostAText });
        }
        if (hostBText) {
          result.push({ speaker: config.characters.hostB.name, text: hostBText });
        }
      } else {
        // Single sentence - split by comma or just alternate words
        const commaIndex = text.indexOf(',');
        if (commaIndex > text.length * 0.3 && commaIndex < text.length * 0.7) {
          // Split at comma if it's roughly in the middle
          result.push({ speaker: config.characters.hostA.name, text: text.substring(0, commaIndex + 1).trim() });
          result.push({ speaker: config.characters.hostB.name, text: text.substring(commaIndex + 1).trim() });
        } else {
          // Give the whole line to hostA (better than unison for lip-sync)
          result.push({ speaker: config.characters.hostA.name, text: text });
        }
      }
      
      console.log(`🔀 [Script] Split "Both" dialogue into separate host lines`);
    } else {
      result.push(line);
    }
  }
  
  return result;
};

export const generateSegmentedAudio = async (script: ScriptLine[], config: ChannelConfig): Promise<BroadcastSegment[]> => {
  return generateSegmentedAudioWithCache(script, config, '');
};

export const generateSegmentedAudioWithCache = async (
  script: ScriptLine[], 
  config: ChannelConfig,
  channelId: string = ''
): Promise<BroadcastSegment[]> => {
  // Split "Both" dialogues into separate lines for each host
  const processedScript = splitBothDialogues(script, config);
  
  // Use OpenAI TTS for audio generation (no more Gemini quota issues!)
  console.log(`🎙️ [Audio] Generating ${processedScript.length} audio segments using OpenAI TTS...`);

  // PARALLEL PROCESSING with cache support
  const audioPromises = processedScript.map(async (line) => {
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
          audioUrl: undefined
        } as any;
      }
    }

    // Generate new audio using OpenAI TTS
    try {
      const audioBase64 = await generateTTSAudio(line.text, character.voiceName);
      
      console.log(`✅ [Audio] Generated audio for "${line.text.substring(0, 30)}..."`);
      
      return {
        speaker: line.speaker,
        text: line.text,
        audioBase64: audioBase64,
        fromCache: false
      };
    } catch (error) {
      console.error(`❌ [Audio] Failed for "${line.text.substring(0, 30)}...":`, (error as Error).message);
      throw error;
    }
  });

  const results = await Promise.all(audioPromises);
  console.log(`✅ [Audio] Successfully generated ${results.length} audio segments via OpenAI TTS`);
  return results;
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
 * Now integrates with Scene Builder for professional-quality visual prompts.
 * 
 * @param segments - Array of segments with audio URLs
 * @param config - Channel configuration (needs referenceImageUrl)
 * @param channelId - Channel ID for caching
 * @param productionId - Production ID for caching
 * @param scriptWithScenes - Optional v2.0 script with scene metadata
 */
export const generateVideoSegmentsWithInfiniteTalk = async (
  segments: BroadcastSegment[],
  config: ChannelConfig,
  channelId: string,
  productionId?: string,
  scriptWithScenes?: ScriptWithScenes
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
  
  // === SCENE BUILDER INTEGRATION ===
  // Generate optimized visual prompts for each scene using Scene Builder
  let scenePrompts: ScenePrompt[] = [];
  if (scriptWithScenes) {
    console.log(`📖 [InfiniteTalk Multi] Using v2.0 Narrative Engine: ${scriptWithScenes.narrative_used}`);
    console.log(`📖 [InfiniteTalk Multi] Scene count: ${Object.keys(scriptWithScenes.scenes).length}`);
    
    // Generate scene prompts with Scene Builder (validates shot types and adds visual details)
    scenePrompts = generateScenePrompts(scriptWithScenes, config);
    console.log(`🎨 [Scene Builder] Generated ${scenePrompts.length} optimized visual prompts`);
    
    // Log shot corrections made by Scene Builder
    scenePrompts.forEach((sp, idx) => {
      const originalShot = Object.values(scriptWithScenes.scenes)[idx]?.shot;
      if (originalShot !== sp.scene.shot) {
        console.log(`🎬 [Scene Builder] Scene ${idx + 1}: Shot corrected from ${originalShot} to ${sp.scene.shot}`);
      }
    });
  }

  // Generate videos in batches with retry logic
  const BATCH_SIZE = 3; // Process 3 videos at a time to avoid rate limits
  const videoUrls: (string | null)[] = new Array(segments.length).fill(null);
  const failedIndices: number[] = [];
  const missingAudioIndices: number[] = [];
  
  // Build scene metadata lookup from scriptWithScenes (scene index -> metadata)
  // Now includes visual prompts from Scene Builder
  const sceneMetadataMap: Map<number, { 
    video_mode: VideoMode; 
    model: 'infinite_talk' | 'infinite_talk_multi'; 
    shot: ShotType;
    scenePrompt?: string;
    lightingMood?: string;
    expressionHint?: string;
  }> = new Map();
  
  if (scriptWithScenes?.scenes) {
    Object.entries(scriptWithScenes.scenes).forEach(([sceneNum, scene], idx) => {
      const scenePrompt = scenePrompts[idx];
      sceneMetadataMap.set(idx, {
        video_mode: scene.video_mode,
        model: scene.model,
        shot: scenePrompt?.scene.shot || scene.shot, // Use corrected shot from Scene Builder
        scenePrompt: scenePrompt?.visualPrompt, // Use optimized visual prompt
        lightingMood: scenePrompt?.lightingMood,
        expressionHint: scenePrompt?.expressionHint
      });
    });
  }

  // === PRE-VALIDATION: Check all audio URLs exist before starting ===
  segments.forEach((segment, idx) => {
    const audioUrl = (segment as any).audioUrl;
    if (!audioUrl) {
      missingAudioIndices.push(idx);
    }
  });
  
  if (missingAudioIndices.length > 0) {
    console.warn(`⚠️ [InfiniteTalk] ${missingAudioIndices.length} segments missing audio URLs: [${missingAudioIndices.join(', ')}]`);
    console.warn(`⚠️ [InfiniteTalk] These segments will be skipped. Ensure audio is uploaded before video generation.`);
  }

  // Process in batches
  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);
    const batchIndices = batch.map((_, idx) => i + idx);

    console.log(`🎬 [InfiniteTalk] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(segments.length / BATCH_SIZE)} (segments ${i + 1}-${Math.min(i + BATCH_SIZE, segments.length)})`);

    // Process batch with retry and continue on error
    const batchResults = await Promise.allSettled(
      batch.map(async (segment, batchIdx) => {
        const globalIndex = batchIndices[batchIdx];
        const audioUrl = (segment as any).audioUrl;
        
        if (!audioUrl) {
          // Already warned above, just skip
          return { index: globalIndex, url: null, reason: 'missing_audio' };
        }
        
        // Get scene metadata if available (now includes Scene Builder visual prompts)
        const sceneMetadata = sceneMetadataMap.get(globalIndex);

        // Use retry logic for video generation
        const { retryVideoGeneration } = await import('./retryUtils');
        const result = await retryVideoGeneration(
          async () => {
            const videoResult = await generateInfiniteTalkVideo({
              channelId,
              productionId,
              segmentIndex: globalIndex,
              audioUrl,
              referenceImageUrl: config.referenceImageUrl!,
              speaker: segment.speaker,
              dialogueText: segment.text,
              hostAName,
              hostBName,
              hostAVisualPrompt,
              hostBVisualPrompt,
              resolution: '720p',
              sceneMetadata
            });
            return videoResult.url;
          },
          {
            maxRetries: 2,
            continueOnError: true,
            onFailure: (error, attempt) => {
              console.warn(`⚠️ [InfiniteTalk] Segment ${globalIndex} failed (attempt ${attempt}):`, (error as Error).message);
            }
          }
        );

        if (result) {
          console.log(`✅ [InfiniteTalk] Segment ${globalIndex + 1}/${segments.length} complete`);
        } else {
          failedIndices.push(globalIndex);
        }

        return { index: globalIndex, url: result };
      })
    );

    // Process batch results
    batchResults.forEach((result, batchIdx) => {
      if (result.status === 'fulfilled') {
        videoUrls[result.value.index] = result.value.url;
      } else {
        const globalIndex = batchIndices[batchIdx];
        failedIndices.push(globalIndex);
        console.error(`❌ [InfiniteTalk] Segment ${globalIndex} failed:`, result.reason);
      }
    });

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < segments.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  const successCount = videoUrls.filter(url => url !== null).length;
  const skippedCount = missingAudioIndices.length;
  const failedCount = failedIndices.length - skippedCount;
  
  console.log(`✅ [InfiniteTalk Multi] Generated ${successCount}/${segments.length} videos`);
  if (skippedCount > 0) {
    console.log(`⏭️ [InfiniteTalk Multi] Skipped ${skippedCount} (missing audio)`);
  }
  if (failedCount > 0) {
    console.log(`❌ [InfiniteTalk Multi] Failed ${failedCount} (generation errors)`);
  }

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
  
  const normalizedChannel = normalizeChannelKey(config.channelName);
  const override = CHANNEL_BRANDING_OVERRIDES[normalizedChannel];
  const referenceImage = config.referenceImageUrl || null;

  if (override) {
    console.log(`✅ [Broadcast Visuals] Using fixed intro/outro for ${config.channelName}`);
  } else if (referenceImage) {
    console.log(`✅ [Broadcast Visuals] Using reference image for intro/outro`);
  } else {
    console.log(`⚠️ [Broadcast Visuals] No reference image - intro/outro will be empty`);
  }

  return {
    intro: override?.intro || referenceImage,
    outro: override?.outro || referenceImage,
    wide: referenceImage,
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
    // Use WaveSpeed Nano Banana Pro Edit as primary
    if (isWavespeedConfigured()) {
      console.log(`🖼️ [Image] Generating reference image using WaveSpeed Nano Banana Pro...`);
      
      const aspectRatio = config.format === '9:16' ? '9:16' : '16:9';
      const placeholderImage = createPlaceholderImage(
        aspectRatio === '9:16' ? 576 : 1024,
        aspectRatio === '9:16' ? 1024 : 576
      );
      const taskId = await createWavespeedImageTask(prompt, aspectRatio, placeholderImage);
      const imageUrl = await pollWavespeedImageTask(taskId);
      
      const dataUri = await imageUrlToDataUri(imageUrl);
      CostTracker.track('thumbnail', 'wavespeed/nano-banana-pro', 0.14);
      
      console.log(`✅ [Image] Reference image generated via WaveSpeed`);
      return dataUri;
    }
  } catch (wavespeedError) {
    console.error(`⚠️ [Image] WaveSpeed failed, trying DALL-E fallback:`, (wavespeedError as Error).message);
  }

  // Fallback to DALL-E 3
  try {
    console.log(`🖼️ [Image] Generating reference image using DALL-E 3 (fallback)...`);
    
    const size = config.format === '9:16' ? '1024x1792' : '1792x1024';
    const dalleImage = await generateImageWithDALLE(prompt, size as any);
    
    if (dalleImage) {
      console.log(`✅ [Image] Reference image generated via DALL-E 3`);
      return dalleImage;
    }
  } catch (dalleError) {
    console.error(`❌ [Image] DALL-E 3 also failed:`, (dalleError as Error).message);
  }

  return null;
};

export const generateThumbnail = async (newsContext: string, config: ChannelConfig): Promise<string | null> => {
  // Enhanced prompt for better thumbnail quality
  const prompt = `
  Create a high-impact YouTube thumbnail for a news video about: ${newsContext}.
  Channel Style: ${config.channelName} (${config.tone}).
  
  VISUAL REQUIREMENTS:
  - Bold, high contrast, breaking news style
  - Vibrant colors that pop on mobile screens
  - Professional news aesthetic with modern design
  - Clear focal point that draws the eye
  - Include text overlay if possible or just striking imagery
  - Aspect Ratio: 16:9 (1280x720)
  - No photorealistic faces of real politicians if restricted, use stylized or symbolic representations
  - Use icons, symbols, or abstract representations when needed
  - Ensure text is large and readable at thumbnail size
`.trim();

  // Try WaveSpeed generation model first (no placeholder needed)
  if (isWavespeedConfigured()) {
    try {
      console.log(`🎨 [Thumbnail] Generating thumbnail using WaveSpeed (generation model)...`);
      
      // Try generation model first (no input image)
      const taskId = await createWavespeedImageTask(prompt, '16:9');
      const imageUrl = await pollWavespeedImageTask(taskId);
      
      const dataUri = await imageUrlToDataUri(imageUrl);
      CostTracker.track('thumbnail', 'wavespeed/nano-banana-pro', 0.14);
      
      console.log(`✅ [Thumbnail] Generated via WaveSpeed`);
      return dataUri;
    } catch (wavespeedError) {
      console.error(`⚠️ [Thumbnail] WaveSpeed generation failed, trying edit model:`, (wavespeedError as Error).message);
      
      // Fallback to edit model with placeholder
      try {
        console.log(`🎨 [Thumbnail] Trying WaveSpeed edit model with placeholder...`);
        const placeholderImage = createPlaceholderImage(1024, 576);
        const taskId = await createWavespeedImageTask(prompt, '16:9', placeholderImage);
        const imageUrl = await pollWavespeedImageTask(taskId);
        
        const dataUri = await imageUrlToDataUri(imageUrl);
        CostTracker.track('thumbnail', 'wavespeed/nano-banana-pro', 0.14);
        
        console.log(`✅ [Thumbnail] Generated via WaveSpeed (edit model)`);
        return dataUri;
      } catch (editError) {
        console.error(`⚠️ [Thumbnail] WaveSpeed edit model also failed, trying DALL-E:`, (editError as Error).message);
      }
    }
  }

  // Enhanced DALL-E prompt for better quality
  const enhancedDallePrompt = `
  Create a professional, high-impact YouTube thumbnail image for a news video.
  
  TOPIC: ${newsContext}
  CHANNEL: ${config.channelName} (${config.tone} tone)
  
  DESIGN SPECIFICATIONS:
  - Style: Modern news broadcast aesthetic, similar to CNN, BBC, or Fox News thumbnails
  - Composition: Bold, eye-catching layout with strong visual hierarchy
  - Colors: High contrast, vibrant palette that works on mobile (avoid muted tones)
  - Typography: Large, bold text overlay if applicable, highly readable at small sizes
  - Visual elements: Use icons, symbols, charts, or abstract graphics rather than photorealistic people when possible
  - Lighting: Dramatic, professional studio lighting with clear shadows and highlights
  - Mood: Urgent, breaking news atmosphere
  
  TECHNICAL:
  - Aspect ratio: 16:9 (1280x720 equivalent)
  - Resolution: High quality, sharp details
  - No watermarks, no text that might be cut off
  - Professional news channel aesthetic
  
  Make it CLICK-WORTHY and visually striking!
`.trim();

  // Fallback to DALL-E 3 with enhanced prompt
  try {
    console.log(`🎨 [Thumbnail] Generating thumbnail using DALL-E 3 (enhanced prompt)...`);
    const dalleImage = await generateImageWithDALLE(enhancedDallePrompt, '1792x1024');
    
    if (dalleImage) {
      console.log(`✅ [Thumbnail] Generated via DALL-E 3`);
      return dalleImage;
    }
  } catch (dalleError) {
    console.error(`❌ [Thumbnail] DALL-E 3 failed:`, (dalleError as Error).message);
  }

  return null;
};

export const generateThumbnailVariants = async (
  newsContext: string,
  config: ChannelConfig,
  viralMeta: ViralMetadata
): Promise<{ primary: string | null; variant: string | null }> => {
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
Create a VIRAL, high-performance YouTube thumbnail image.

HEADLINE: "${viralMeta.title}"
TOPIC: ${newsContext}
CHANNEL: ${config.channelName} (${config.tone} tone)

THUMBNAIL STYLE: ${style.name}
${style.prompt}

DESIGN REQUIREMENTS:
- Aspect ratio: 16:9 (1280x720 equivalent)
- Text overlay: Large, bold, highly readable text displaying "${viralMeta.title.substring(0, 40)}"
- Color scheme: Use brand colors ${config.logoColor1} and ${config.logoColor2} prominently, with high contrast
- Mobile optimization: Must be clear and impactful when viewed at small sizes (thumbnails are tiny!)
- Emotional impact: Evoke shock, curiosity, or urgency through visual composition
- Professional quality: News channel aesthetic (like CNN, BBC, Fox News style thumbnails)
- Visual elements: Use icons, symbols, charts, or stylized graphics - avoid photorealistic politicians
- Typography: Bold sans-serif font, white or yellow text with dark outline for maximum readability
- Composition: Strong focal point, rule of thirds, visual hierarchy that guides the eye

TECHNICAL:
- High resolution, sharp details
- No watermarks or logos
- Professional lighting and shadows
- Modern, clean design aesthetic

Make it MAXIMUM CLICK-THROUGH RATE - this thumbnail needs to stand out in YouTube search results!
`.trim();

  // Helper function to generate a single thumbnail with WaveSpeed + DALL-E fallback
  const generateSingleThumbnail = async (prompt: string): Promise<string | null> => {
    // Try WaveSpeed generation model first (no placeholder)
    if (isWavespeedConfigured()) {
      try {
        console.log(`🎨 [Thumbnail Variant] Trying WaveSpeed generation model...`);
        const taskId = await createWavespeedImageTask(prompt, '16:9');
        const imageUrl = await pollWavespeedImageTask(taskId);
        const dataUri = await imageUrlToDataUri(imageUrl);
        CostTracker.track('thumbnail', 'wavespeed/nano-banana-pro', 0.14);
        console.log(`✅ [Thumbnail Variant] Generated via WaveSpeed`);
        return dataUri;
      } catch (genError) {
        console.warn(`⚠️ WaveSpeed generation failed, trying edit model:`, (genError as Error).message);
        
        // Fallback to edit model with placeholder
        try {
          console.log(`🎨 [Thumbnail Variant] Trying WaveSpeed edit model...`);
          const placeholderImage = createPlaceholderImage(1024, 576);
          const taskId = await createWavespeedImageTask(prompt, '16:9', placeholderImage);
          const imageUrl = await pollWavespeedImageTask(taskId);
          const dataUri = await imageUrlToDataUri(imageUrl);
          CostTracker.track('thumbnail', 'wavespeed/nano-banana-pro', 0.14);
          console.log(`✅ [Thumbnail Variant] Generated via WaveSpeed (edit)`);
          return dataUri;
        } catch (editError) {
          console.warn(`⚠️ WaveSpeed edit model also failed, trying DALL-E:`, (editError as Error).message);
        }
      }
    }

    // Enhanced DALL-E fallback with better prompt
    try {
      console.log(`🎨 [Thumbnail Variant] Using DALL-E 3 with enhanced prompt...`);
      const dalleImage = await generateImageWithDALLE(prompt, '1792x1024');
      if (dalleImage) {
        console.log(`✅ [Thumbnail Variant] Generated via DALL-E 3`);
      }
      return dalleImage;
    } catch (e) {
      console.error(`❌ DALL-E thumbnail failed:`, (e as Error).message);
      return null;
    }
  };

  console.log(`🎨 [Thumbnails] Generating 2 thumbnail variants...`);

  try {
    const [primary, variant] = await Promise.all([
      generateSingleThumbnail(basePrompt(primaryStyle)),
      generateSingleThumbnail(basePrompt(variantStyle))
    ]);

    console.log(`✅ [Thumbnails] Generated ${primary ? 1 : 0} primary + ${variant ? 1 : 0} variant`);
    return { primary, variant };
  } catch (e) {
    console.error("Thumbnail variants generation failed", e);
    const fallback = await generateThumbnail(newsContext, config);
    return { primary: fallback, variant: null };
  }
};

export const generateViralHook = async (
  news: NewsItem[],
  config: ChannelConfig
): Promise<string> => {
  // Use GPT-4o for viral hook (no more Gemini quota issues!)
  console.log(`🎣 [Hook] Generating viral hook using GPT-4o...`);
  
  try {
    const hook = await generateViralHookWithGPT(news, config);
    console.log(`✅ [Hook] Successfully generated hook via GPT-4o`);
    return hook;
  } catch (error) {
    console.error(`❌ [Hook] GPT-4o failed:`, (error as Error).message);
    return `Breaking news about ${news[0]?.headline?.substring(0, 30) || 'today'}...`;
  }
};

// =============================================================================================
// VIDEO COMPOSITION (Shotstack - Cloud FFmpeg)
// =============================================================================================

/**
 * Check if video composition is available
 */
export const isCompositionAvailable = (): boolean => {
  const config = checkShotstackConfig();
  return config.configured;
};

/**
 * Compose final video from segments using Shotstack
 * This creates a professional video with transitions, normalized audio, etc.
 * 
 * Call this AFTER generateVideoSegmentsWithInfiniteTalk to combine all clips
 * 
 * @param segments - Broadcast segments with video URLs
 * @param videoUrls - Array of video URLs (from InfiniteTalk)
 * @param videos - Video assets (intro/outro)
 * @param config - Channel config
 * @param options - Composition options
 */
export const composeVideoWithShotstack = async (
  segments: BroadcastSegment[],
  videoUrls: (string | null)[],
  videos: VideoAssets,
  config: ChannelConfig,
  options: {
    resolution?: '1080' | 'hd' | 'sd';
    transition?: 'fade' | 'dissolve' | 'wipeLeft' | 'slideLeft';
    transitionDuration?: number;
    watermarkUrl?: string;
    callbackUrl?: string;
  } = {}
): Promise<RenderResult> => {
  // Check if Shotstack is configured
  const shotstackConfig = checkShotstackConfig();
  if (!shotstackConfig.configured) {
    console.warn('⚠️ [Composition] Shotstack not configured');
    console.warn('⚠️ [Composition] Set VITE_SHOTSTACK_API_KEY to enable video composition');
    return {
      success: false,
      error: 'Shotstack not configured. Set VITE_SHOTSTACK_API_KEY in your environment.'
    };
  }

  // Filter out null video URLs
  const validVideoCount = videoUrls.filter(url => url !== null).length;
  if (validVideoCount === 0) {
    console.error('❌ [Composition] No valid video URLs to compose');
    return {
      success: false,
      error: 'No valid video URLs to compose'
    };
  }

  console.log(`🎬 [Composition] Starting video composition with Shotstack...`);
  console.log(`🎬 [Composition] ${validVideoCount}/${videoUrls.length} valid video segments`);
  console.log(`🎬 [Composition] Intro: ${videos.intro ? 'Yes' : 'No'}, Outro: ${videos.outro ? 'Yes' : 'No'}`);

  try {
    // Create composition config
    const compositionConfig = createCompositionFromSegments(
      segments,
      videoUrls,
      videos,
      config,
      {
        resolution: options.resolution || '1080',
        transition: options.transition ? {
          type: options.transition,
          duration: options.transitionDuration || 0.3
        } : { type: 'dissolve', duration: 0.3 },
        watermarkUrl: options.watermarkUrl,
        callbackUrl: options.callbackUrl
      }
    );

    // Submit render job
    const result = await ShotstackService.render(compositionConfig);

    if (result.success) {
      console.log(`✅ [Composition] Video composed successfully!`);
      console.log(`🎥 [Composition] URL: ${result.videoUrl}`);
      console.log(`🖼️ [Composition] Poster: ${result.posterUrl}`);
      console.log(`⏱️ [Composition] Duration: ${result.duration}s`);
      console.log(`💰 [Composition] Cost: $${result.cost?.toFixed(4) || '?'}`);
    } else {
      console.error(`❌ [Composition] Failed: ${result.error}`);
    }

    return result;
  } catch (error) {
    console.error('❌ [Composition] Error:', (error as Error).message);
    return {
      success: false,
      error: (error as Error).message
    };
  }
};

/**
 * Quick composition check - returns what's available
 */
export const getCompositionStatus = () => {
  const shotstack = checkShotstackConfig();
  
  return {
    shotstack: {
      available: shotstack.configured,
      message: shotstack.message,
      pricing: '~$0.05/min of video'
    },
    recommendation: shotstack.configured 
      ? 'Use Shotstack for professional video composition'
      : 'Configure Shotstack API key for video composition'
  };
};
