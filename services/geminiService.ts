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
  uploadAudioToStorage,
  // Pending video task management
  findPendingVideoTask,
  saveVideoTaskPending,
  updateVideoTaskCompleted,
  updateVideoTaskFailed,
  // Thumbnail cache
  findCachedThumbnail,
  saveThumbnailToCache
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
  createTitleVariantFallback,
  analyzeScriptForShorts
} from "./openaiService";
import type { ScriptAnalysis } from "./openaiService";
import { 
  generateElevenLabsTTS,
  checkElevenLabsConfig
} from "./elevenlabsService";
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
  RenderResult,
  // Podcast-style composition (following shockstack.md guide)
  renderPodcastVideo,
  PodcastScene
} from "./shotstackService";

const getApiKey = () => import.meta.env.VITE_GEMINI_API_KEY || window.env?.API_KEY || process.env.API_KEY || "";
const getAiClient = () => new GoogleGenAI({ apiKey: getApiKey() });

// Helper function to check if Wavespeed is configured (via proxy or direct API key)
const isWavespeedConfigured = () => {
  const config = checkWavespeedConfig();
  return config.configured;
};

// Helper function to get seed image URL based on channel format (16:9 or 9:16)
const getSeedImageUrl = (
  config: ChannelConfig, 
  imageType: 'hostA' | 'hostB' | 'twoShot'
): string | undefined => {
  const isVertical = config.format === '9:16';
  const seedImages = config.seedImages;
  
  if (!seedImages) return undefined;
  
  if (imageType === 'hostA') {
    // Prefer format-specific image, fallback to other format if not available
    return isVertical 
      ? (seedImages.hostASoloUrl_9_16 || seedImages.hostASoloUrl)
      : (seedImages.hostASoloUrl || seedImages.hostASoloUrl_9_16);
  } else if (imageType === 'hostB') {
    return isVertical 
      ? (seedImages.hostBSoloUrl_9_16 || seedImages.hostBSoloUrl)
      : (seedImages.hostBSoloUrl || seedImages.hostBSoloUrl_9_16);
  } else {
    return isVertical 
      ? (seedImages.twoShotUrl_9_16 || seedImages.twoShotUrl)
      : (seedImages.twoShotUrl || seedImages.twoShotUrl_9_16);
  }
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
  audioUrl: string;           // URL to the audio file (primary, or hostA for "both" scenes)
  referenceImageUrl: string;  // URL to the reference image
  speaker: string;            // Who is speaking: hostA name, hostB name, or "Both"
  dialogueText: string;       // The dialogue text for caching
  hostAName: string;          // Name of host A (left in image)
  hostBName: string;          // Name of host B (right in image)
  hostAVisualPrompt: string;  // Visual description of host A
  hostBVisualPrompt: string;  // Visual description of host B
  resolution?: '480p' | '720p';
  aspectRatio?: '16:9' | '9:16'; // Video aspect ratio based on channel format
  // For "both" scenes - separate audio URLs
  hostA_audioUrl?: string;    // Audio URL for Host A (left side)
  hostB_audioUrl?: string;    // Audio URL for Host B (right side)
  order?: 'left_first' | 'right_first' | 'meanwhile';  // Who speaks first
  // Scene metadata from v2.0 Narrative Engine
  sceneMetadata?: {
    video_mode: VideoMode;
    model: 'infinite_talk' | 'infinite_talk_multi';
    shot: ShotType;
    scenePrompt?: string; // Prompt from Scene Builder
  };
  // Duration from audio for accurate video timing
  audioDuration?: number; // Duration in seconds
}

/**
 * Generate a lip-sync video using WaveSpeed InfiniteTalk
 * 
 * MODEL SELECTION:
 * - InfiniteTalk Single: For scenes with ONE host (hostA or hostB alone)
 * - InfiniteTalk Multi: For scenes with BOTH hosts in frame
 * 
 * IMPORTANT: Uses strict prompts to maintain character consistency
 */
const generateInfiniteTalkVideo = async (
  options: InfiniteTalkVideoOptions
): Promise<{ url: string | null; fromCache: boolean; durationSeconds?: number }> => {
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
    aspectRatio = '16:9',  // Default to landscape
    hostA_audioUrl,  // Separate audio for Host A (for "both" scenes)
    hostB_audioUrl,  // Separate audio for Host B (for "both" scenes)
    order: providedOrder,  // Who speaks first
    sceneMetadata,
    audioDuration  // Duration from audio for accurate timing
  } = options;

  // Determine video type and model based on scene metadata or speaker
  let videoType: VideoType = 'segment';
  let effectiveVideoMode: VideoMode | null = null;
  let useMultiModel: boolean = false;
  
  if (sceneMetadata?.video_mode) {
    // Convert legacy "both" to hostA for backwards compatibility
    effectiveVideoMode = (sceneMetadata.video_mode as string) === 'both' ? 'hostA' : sceneMetadata.video_mode;
    videoType = effectiveVideoMode === 'hostA' ? 'host_a' : 'host_b';
    // Always use single character mode (no multi model)
    useMultiModel = false;
  } else {
    // Fallback to speaker-based detection
    if (speaker === hostAName) {
      videoType = 'host_a';
      effectiveVideoMode = 'hostA';
      useMultiModel = false;
    } else if (speaker === hostBName) {
      videoType = 'host_b';
      effectiveVideoMode = 'hostB';
      useMultiModel = false;
    } else if (speaker === 'Both' || speaker.includes('Both')) {
      // Convert legacy "Both" speaker to hostA
      videoType = 'host_a';
      effectiveVideoMode = 'hostA';
      useMultiModel = false;
    }
  }
  
  // Override with explicit model from scene metadata if provided
  if (sceneMetadata?.model) {
    useMultiModel = sceneMetadata.model === 'infinite_talk_multi';
  }

  // Check cache first - look for completed videos
  const cachedVideo = await findCachedVideoByDialogue(channelId, videoType, dialogueText, '16:9');
  if (cachedVideo && cachedVideo.video_url) {
    console.log(`✅ [InfiniteTalk] Using cached video for segment ${segmentIndex}`);
    return { url: cachedVideo.video_url, fromCache: true };
  }

  // Check for pending tasks - resume polling if task was started but not completed
  const pendingTask = await findPendingVideoTask(channelId, dialogueText, segmentIndex);
  if (pendingTask) {
    console.log(`🔄 [InfiniteTalk] Resuming pending task: ${pendingTask.taskId}`);
    try {
      const videoUrl = await pollInfiniteTalkTask(pendingTask.taskId);
      if (videoUrl) {
        // Update task to completed with duration from audio
        await updateVideoTaskCompleted(pendingTask.taskId, videoUrl, audioDuration);
        
        // Track cost (estimate based on typical segment)
        const baseCost = resolution === '720p' ? INFINITETALK_COST_720P : INFINITETALK_COST_480P;
        CostTracker.track('video', 'infinitetalk-resumed', baseCost);
        
        console.log(`✅ [InfiniteTalk] Resumed task completed for segment ${segmentIndex} (duration: ${audioDuration}s)`);
        return { url: videoUrl, fromCache: false, durationSeconds: audioDuration };
      }
    } catch (resumeError) {
      console.warn(`⚠️ [InfiniteTalk] Failed to resume task ${pendingTask.taskId}:`, (resumeError as Error).message);
      await updateVideoTaskFailed(pendingTask.taskId, (resumeError as Error).message);
      // Fall through to create new task
    }
  }

  // Get shot type from scene metadata or default to medium
  const shotType = sceneMetadata?.shot || 'medium';
  const shotDescription = shotType === 'closeup' ? 'Close-up shot, tight framing' 
    : shotType === 'wide' ? 'Wide shot, showing full studio' 
    : 'Medium shot, standard framing';

  // Declare outside try block so they're accessible in catch
  let taskId: string | undefined;
  let modelName: string = useMultiModel ? 'InfiniteTalk Multi' : 'InfiniteTalk Single';
  let savedTaskId: string | null = null; // Track if we saved the pending task

  try {
    if (useMultiModel) {
      // ===== INFINITETALK MULTI (Two characters in frame) =====
      modelName = 'InfiniteTalk Multi';
  const silentAudioUrl = getSilentAudioUrl();
  
      // For "both" scenes, use the SEPARATE audios if provided
      // Host A = left, Host B = right
      let leftAudio: string;
      let rightAudio: string;
      let order: 'left_first' | 'right_first' | 'meanwhile';
      
      if (hostA_audioUrl && hostB_audioUrl) {
        // ✅ NEW: Both hosts have separate audio - use them!
        leftAudio = hostA_audioUrl;
        rightAudio = hostB_audioUrl;
        order = providedOrder || 'left_first';
        console.log(`🎙️ [${modelName}] Using SEPARATE audios for both hosts!`);
      } else {
        // Fallback: Only one audio provided, determine which side based on speaker
        const isHostASpeaking = speaker === hostAName;
        const isHostBSpeaking = speaker === hostBName;

        if (isHostASpeaking) {
    leftAudio = audioUrl;
          rightAudio = silentAudioUrl;
    order = 'left_first';
        } else if (isHostBSpeaking) {
          leftAudio = silentAudioUrl;
    rightAudio = audioUrl;
    order = 'right_first';
  } else {
          // Unknown speaker - default to left
    leftAudio = audioUrl;
          rightAudio = silentAudioUrl;
          order = 'left_first';
          console.warn(`⚠️ [${modelName}] Segment ${segmentIndex}: Unknown speaker '${speaker}', defaulting to left`);
        }
      }

  const characterPrompt = sceneMetadata?.scenePrompt || `
STRICT CHARACTER REQUIREMENTS - DO NOT DEVIATE:
- LEFT CHARACTER: ${hostAName} - ${hostAVisualPrompt}
- RIGHT CHARACTER: ${hostBName} - ${hostBVisualPrompt}

SCENE: Professional podcast news studio with two animated characters.
SHOT: ${shotDescription}
SPEAKING: ${effectiveVideoMode === 'hostA' ? hostAName : effectiveVideoMode === 'hostB' ? hostBName : 'Both hosts alternating'} with lip-sync animation.
STYLE: Maintain exact character appearances from the reference image.

CRITICAL: These are NOT human beings. They are animated/CGI characters as described above. 
Keep character consistency with the reference image at all times.
`.trim();

      console.log(`🎬 [${modelName}] Generating video for segment ${segmentIndex} (${speaker})`);
      console.log(`📝 [${modelName}] Left: ${hostAName}, Right: ${hostBName}`);
      console.log(`🎙️ [${modelName}] Order: ${order}, Left audio: ${leftAudio !== silentAudioUrl ? 'ACTIVE' : 'silent'}, Right audio: ${rightAudio !== silentAudioUrl ? 'ACTIVE' : 'silent'}`);
      
      taskId = await createInfiniteTalkMultiTask({
      leftAudioUrl: leftAudio,
      rightAudioUrl: rightAudio,
      imageUrl: referenceImageUrl,
      order,
      resolution,
      prompt: characterPrompt
    });
      
    } else {
      // ===== INFINITETALK SINGLE (One character in frame) =====
      modelName = 'InfiniteTalk Single';
      
      const speakingHost = effectiveVideoMode === 'hostA' ? hostAName : hostBName;
      const visualPrompt = effectiveVideoMode === 'hostA' ? hostAVisualPrompt : hostBVisualPrompt;
      
      const characterPrompt = sceneMetadata?.scenePrompt || `
CHARACTER: ${speakingHost} - ${visualPrompt}
SCENE: Professional podcast news studio.
SHOT: ${shotDescription}
ACTION: ${speakingHost} is speaking with natural lip-sync animation.
STYLE: Maintain exact character appearance from the reference image.

CRITICAL: This is NOT a human being. This is an animated/CGI character as described above.
`.trim();

      console.log(`🎬 [${modelName}] Generating video for segment ${segmentIndex} (${speaker})`);
      console.log(`📝 [${modelName}] Character: ${speakingHost}`);
      console.log(`🖼️ [${modelName}] Image: ${referenceImageUrl.substring(0, 60)}...`);
      
      taskId = await createInfiniteTalkSingleTask(
        audioUrl,
        referenceImageUrl,
        resolution,
        characterPrompt
      );
    }

    // ⭐ Save task as pending BEFORE polling - allows resume if interrupted
    savedTaskId = await saveVideoTaskPending({
      channel_id: channelId,
      production_id: productionId || null,
      video_type: videoType,
      segment_index: segmentIndex,
      prompt_hash: createPromptHash(dialogueText),
      dialogue_text: dialogueText,
      provider: 'wavespeed',
      aspect_ratio: aspectRatio, // Use channel format (16:9 or 9:16)
      duration_seconds: null,
      status: 'generating',
      error_message: null,
      reference_image_hash: createPromptHash(referenceImageUrl.substring(0, 100)),
      expires_at: null,
      task_id: taskId
    });
    
    console.log(`💾 [${modelName}] Task ${taskId} saved as pending for segment ${segmentIndex}`);

    // Now poll for completion
    const videoUrl = await pollInfiniteTalkTask(taskId);

    if (videoUrl) {
      // Track cost (Multi is slightly more expensive)
      const baseCost = resolution === '720p' ? INFINITETALK_COST_720P : INFINITETALK_COST_480P;
      const cost = useMultiModel ? baseCost * 1.2 : baseCost; // Multi is ~20% more
      CostTracker.track('video', useMultiModel ? 'infinitetalk-multi' : 'infinitetalk-single', cost);

      // Update task to completed with duration from audio
      // Video duration = audio duration (InfiniteTalk syncs to audio)
      await updateVideoTaskCompleted(taskId, videoUrl, audioDuration);

      console.log(`✅ [${modelName}] Video generated and cached for segment ${segmentIndex} (duration: ${audioDuration}s)`);
      return { url: videoUrl, fromCache: false, durationSeconds: audioDuration };
    } else {
      // Polling completed but no URL - mark as failed
      await updateVideoTaskFailed(taskId, 'Polling completed but no video URL returned');
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error(`❌ [${modelName}] Failed for segment ${segmentIndex}:`, errorMsg);
    
    // Update task to failed if we saved a pending task
    // Note: taskId is the WaveSpeed task ID, savedTaskId is the DB record ID
    // updateVideoTaskFailed uses task_id (WaveSpeed ID) to find the record
    if (taskId) {
      await updateVideoTaskFailed(taskId, errorMsg);
    }
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
  viralHook?: string,
  improvements?: { implement: string[]; maintain: string[] }
): Promise<ScriptWithScenes> => {
  console.log(`📝 [Script v2.0] Generating script with Narrative Engine...`);
  if (improvements) {
    console.log(`📝 [Script v2.0] Regenerating with ${improvements.implement.length} improvements and ${improvements.maintain.length} strengths to maintain`);
  }
  
  try {
    const scriptWithScenes = await generateScriptWithGPT(news, config, viralHook, improvements);
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
// Now returns { audioBase64, durationSeconds } for accurate video timing
interface CachedAudioResult {
  audioBase64: string;
  durationSeconds: number | null;
}

let findCachedAudioFn: ((text: string, voiceName: string, channelId: string) => Promise<CachedAudioResult | null>) | null = null;

export const setFindCachedAudioFunction = (fn: (text: string, voiceName: string, channelId: string) => Promise<CachedAudioResult | null>) => {
  findCachedAudioFn = fn;
};

/**
 * Extended BroadcastSegment with additional fields for "both" scenes
 * This contains audio URLs for both hosts when video_mode is "both"
 */
export interface ExtendedBroadcastSegment extends BroadcastSegment {
  // For "both" scenes - separate audio for each host
  hostA_audioBase64?: string;
  hostB_audioBase64?: string;
  hostA_audioUrl?: string;
  hostB_audioUrl?: string;
  hostA_text?: string;
  hostB_text?: string;
  // Audio order
  order?: 'left_first' | 'right_first' | 'meanwhile';
  // Scene metadata
  video_mode?: VideoMode;
  model?: 'infinite_talk' | 'infinite_talk_multi';
  shot?: ShotType;
  sceneIndex?: number;
  // Cache flags
  fromCache?: boolean;
  audioUrl?: string;
}

/**
 * Generate a single audio file for a text using TTS (OpenAI or ElevenLabs)
 * Returns audio data AND duration for accurate video timing
 * @param text - The text to convert to speech
 * @param voiceName - The OpenAI voice to use (fallback)
 * @param channelId - Channel ID for caching
 * @param label - Label for logging
 * @param language - Optional language hint (e.g., "Spanish") for better pronunciation
 * @param ttsProvider - 'openai' or 'elevenlabs'
 * @param elevenLabsVoiceId - ElevenLabs voice ID (required if ttsProvider is 'elevenlabs')
 */
const generateSingleAudio = async (
  text: string,
  voiceName: string,
  channelId: string,
  label: string,
  language?: string,
  ttsProvider: 'openai' | 'elevenlabs' = 'openai',
  elevenLabsVoiceId?: string
): Promise<{ audioBase64: string; fromCache: boolean; audioUrl?: string; durationSeconds?: number }> => {
  // Validate input text before processing
  const trimmedText = text?.trim() || '';
  if (!trimmedText) {
    console.error(`❌ [Audio] Empty text for ${label}, skipping TTS generation`);
    throw new Error(`Empty text provided for audio generation (${label})`);
  }
  
  // Determine cache key voice (use elevenLabsVoiceId if available, else voiceName)
  const cacheVoiceKey = ttsProvider === 'elevenlabs' && elevenLabsVoiceId ? elevenLabsVoiceId : voiceName;
  
  // Check cache first
  if (findCachedAudioFn && channelId) {
    const cachedResult = await findCachedAudioFn(trimmedText, cacheVoiceKey, channelId);
    if (cachedResult) {
      console.log(`✅ Cache hit for audio (${label}): "${trimmedText.substring(0, 30)}..." (duration: ${cachedResult.durationSeconds}s)`);
      return { 
        audioBase64: cachedResult.audioBase64, 
        fromCache: true, 
        audioUrl: cachedResult.audioBase64,
        durationSeconds: cachedResult.durationSeconds || undefined
      };
    }
  }

  let audioBase64: string;
  let audioDuration: number;
  
  // Generate audio based on TTS provider
  if (ttsProvider === 'elevenlabs' && elevenLabsVoiceId) {
    // Use ElevenLabs TTS
    console.log(`🎙️ [ElevenLabs] Generating audio for ${label} with voice: ${elevenLabsVoiceId}`);
    try {
      const result = await generateElevenLabsTTS(trimmedText, elevenLabsVoiceId);
      audioBase64 = result.audioBase64;
      audioDuration = result.audioDuration;
      console.log(`✅ [ElevenLabs] Generated (${label}): "${trimmedText.substring(0, 30)}..." (${audioDuration.toFixed(1)}s)`);
    } catch (error) {
      console.warn(`⚠️ [ElevenLabs] Failed for ${label}, falling back to OpenAI:`, (error as Error).message);
      // Fallback to OpenAI
      audioBase64 = await generateTTSAudio(trimmedText, voiceName, language);
      const wordCount = trimmedText.split(/\s+/).length;
      audioDuration = Math.max(1, wordCount / 2.5);
    }
  } else {
    // Use OpenAI TTS
    audioBase64 = await generateTTSAudio(trimmedText, voiceName, language);
    // Estimate duration from text (150 words/min = 2.5 words/sec)
    const wordCount = trimmedText.split(/\s+/).length;
    audioDuration = Math.max(1, wordCount / 2.5);
    console.log(`✅ [OpenAI TTS] Generated (${label}): "${trimmedText.substring(0, 30)}..." (estimated: ${audioDuration.toFixed(1)}s)`);
  }
  
  return { audioBase64, fromCache: false, durationSeconds: audioDuration };
};

export const generateSegmentedAudio = async (script: ScriptLine[], config: ChannelConfig): Promise<BroadcastSegment[]> => {
  return generateSegmentedAudioWithCache(script, config, '');
};

/**
 * Generate audio segments from script lines (legacy format)
 * For new v2.0 format with scenes, use generateAudioFromScenes instead
 * Supports both OpenAI TTS and ElevenLabs based on config.ttsProvider
 */
export const generateSegmentedAudioWithCache = async (
  script: ScriptLine[], 
  config: ChannelConfig,
  channelId: string = ''
): Promise<BroadcastSegment[]> => {
  const ttsProvider = config.ttsProvider || 'openai';
  const providerLabel = ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI TTS';
  
  // Log config details
  console.log(`🎙️ [Audio] Generating ${script.length} audio segments using ${providerLabel}...`);
  if (ttsProvider === 'elevenlabs') {
    console.log(`🎙️ [Audio] ElevenLabs voices: hostA=${config.characters.hostA.elevenLabsVoiceId || 'not set'}, hostB=${config.characters.hostB.elevenLabsVoiceId || 'not set'}`);
  } else {
    console.log(`🎙️ [Audio] OpenAI voices: hostA=${config.characters.hostA.voiceName}, hostB=${config.characters.hostB.voiceName}`);
  }

  const audioPromises = script.map(async (line) => {
    let character = config.characters.hostA;
    if (line.speaker === config.characters.hostA.name) {
      character = config.characters.hostA;
    } else if (line.speaker === config.characters.hostB.name) {
      character = config.characters.hostB;
    }

    try {
      const result = await generateSingleAudio(
        line.text, 
        character.voiceName, 
        channelId, 
        line.speaker, 
        config.language,
        ttsProvider,
        character.elevenLabsVoiceId
      );
      return {
        speaker: line.speaker,
        text: line.text,
        audioBase64: result.audioBase64,
        fromCache: result.fromCache,
        audioUrl: result.audioUrl,
        audioDuration: result.durationSeconds // Include duration for video timing
      } as any;
    } catch (error) {
      console.error(`❌ [Audio] Failed for "${line.text.substring(0, 30)}...":`, (error as Error).message);
      throw error;
    }
  });

  const results = await Promise.all(audioPromises);
  console.log(`✅ [Audio] Successfully generated ${results.length} audio segments via ${providerLabel}`);
  return results;
};

/**
 * Generate audio from v2.0 ScriptWithScenes format
 * For "both" scenes, generates SEPARATE audio for each host
 * Returns ExtendedBroadcastSegment[] with all audio data
 */
export const generateAudioFromScenes = async (
  scriptWithScenes: ScriptWithScenes,
  config: ChannelConfig,
  channelId: string = ''
): Promise<ExtendedBroadcastSegment[]> => {
  const ttsProvider = config.ttsProvider || 'openai';
  const providerLabel = ttsProvider === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI TTS';
  
  console.log(`🎙️ [Audio v2.0] Generating audio from ${Object.keys(scriptWithScenes.scenes).length} scenes using ${providerLabel}...`);
  console.log(`🎙️ [Audio v2.0] Narrative: ${scriptWithScenes.narrative_used}`);
  
  if (ttsProvider === 'elevenlabs') {
    console.log(`🎙️ [Audio v2.0] ElevenLabs voices: hostA=${config.characters.hostA.elevenLabsVoiceId || 'not set'}, hostB=${config.characters.hostB.elevenLabsVoiceId || 'not set'}`);
  }
  
  const hostA = config.characters.hostA;
  const hostB = config.characters.hostB;
  
  const segments: ExtendedBroadcastSegment[] = [];
  const sceneEntries = Object.entries(scriptWithScenes.scenes).sort(([a], [b]) => parseInt(a) - parseInt(b));
  
  for (const [sceneNum, scene] of sceneEntries) {
    const sceneIndex = parseInt(sceneNum) - 1;
    
    // Legacy "both" scenes are converted to hostA (backwards compatibility)
    let effectiveVideoMode: 'hostA' | 'hostB' = scene.video_mode as 'hostA' | 'hostB';
    if ((scene.video_mode as string) === 'both') {
      console.warn(`⚠️ [Audio v2.0] Scene ${sceneNum}: Converting legacy "both" mode to hostA`);
      effectiveVideoMode = 'hostA';
    }
    
    {
      // SINGLE HOST SCENE: Generate 1 audio
      // Use effectiveVideoMode for proper host selection (handles legacy "both" conversion)
      const speaker = effectiveVideoMode === 'hostA' ? hostA.name : hostB.name;
      const character = effectiveVideoMode === 'hostA' ? hostA : hostB;
      // For legacy "both" scenes, try hostA_text first, then fallback to text
      const sceneText = ((scene.video_mode as string) === 'both' && scene.hostA_text) 
        ? scene.hostA_text.trim() 
        : (scene.text || '').trim();
      
      // Validate text exists
      if (!sceneText) {
        console.error(`❌ [Audio v2.0] Scene ${sceneNum}: No text for ${speaker}`);
        throw new Error(`Scene ${sceneNum}: Text is empty for ${speaker}`);
      }
      
      console.log(`🎬 [Audio v2.0] Scene ${sceneNum}: ${speaker} solo - "${sceneText.substring(0, 40)}..."`);
      
      const audio = await generateSingleAudio(
        sceneText, 
        character.voiceName, 
        channelId, 
        `Scene ${sceneNum} - ${speaker}`, 
        config.language,
        ttsProvider,
        character.elevenLabsVoiceId
      );
      
      segments.push({
        speaker,
        text: sceneText,
        audioBase64: audio.audioBase64,
        video_mode: effectiveVideoMode, // Use effective mode (never "both")
        model: 'infinite_talk', // Always single model
        shot: scene.shot,
        sceneIndex,
        sceneTitle: scene.title,
        fromCache: audio.fromCache,
        audioDuration: audio.durationSeconds
      });
      
      console.log(`✅ [Audio v2.0] Scene ${sceneNum}: "${scene.title || 'No title'}" - ${speaker} (${audio.durationSeconds?.toFixed(1) || '?'}s)`);
    }
  }
  
  console.log(`✅ [Audio v2.0] Generated ${segments.length} segments with audio via ${providerLabel}`);
  return segments;
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
  // For intro, prefer two-shot image (using format-aware helper), then fallback
  const twoShotUrl = getSeedImageUrl(config, 'twoShot');
  const hostAUrl = getSeedImageUrl(config, 'hostA');
  const hostBUrl = getSeedImageUrl(config, 'hostB');
  const introImage = twoShotUrl || config.referenceImageUrl || hostAUrl || hostBUrl;
  
  if (introImage) {
    console.log(`✅ [Intro] Using ${twoShotUrl ? 'two-shot' : 'fallback'} image as intro frame (format: ${config.format})`);
    return introImage;
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
  // For outro, prefer two-shot image (using format-aware helper), then fallback
  const twoShotUrl = getSeedImageUrl(config, 'twoShot');
  const hostAUrl = getSeedImageUrl(config, 'hostA');
  const hostBUrl = getSeedImageUrl(config, 'hostB');
  const outroImage = twoShotUrl || config.referenceImageUrl || hostAUrl || hostBUrl;
  
  if (outroImage) {
    console.log(`✅ [Outro] Using ${twoShotUrl ? 'two-shot' : 'fallback'} image as outro frame (format: ${config.format})`);
    return outroImage;
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
  // Get seed images for each host using format-aware helper
  const hostASoloUrl = getSeedImageUrl(config, 'hostA');
  const hostBSoloUrl = getSeedImageUrl(config, 'hostB');
  const twoShotUrl = getSeedImageUrl(config, 'twoShot') || config.referenceImageUrl;
  
  // Check if we have at least one image to work with
  const hasAnyImage = hostASoloUrl || hostBSoloUrl || twoShotUrl || config.referenceImageUrl;
  if (!hasAnyImage) {
    console.error(`❌ [InfiniteTalk] No reference images found. Please set seed images in channel settings.`);
    console.error(`❌ [InfiniteTalk] Need at least one of: hostASoloUrl, hostBSoloUrl, twoShotUrl, or referenceImageUrl`);
    return new Array(segments.length).fill(null);
  }

  if (!isWavespeedConfigured()) {
    const configStatus = checkWavespeedConfig();
    console.error(`❌ [InfiniteTalk] WaveSpeed not configured: ${configStatus.message}`);
    return new Array(segments.length).fill(null);
  }

  const channelFormat = config.format || '16:9';
  console.log(`🎬 [InfiniteTalk Multi] Generating ${segments.length} lip-sync videos (format: ${channelFormat})`);
  console.log(`🖼️ [InfiniteTalk Multi] Host A image: ${hostASoloUrl ? hostASoloUrl.substring(0, 60) + '...' : 'Not set (using fallback)'}`);
  console.log(`🖼️ [InfiniteTalk Multi] Host B image: ${hostBSoloUrl ? hostBSoloUrl.substring(0, 60) + '...' : 'Not set (using fallback)'}`);
  console.log(`🖼️ [InfiniteTalk Multi] Two-shot image: ${twoShotUrl ? twoShotUrl.substring(0, 60) + '...' : 'Not set'}`);
  
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

  // =============================================================================================
  // PARALLEL VIDEO GENERATION - Send all requests at once with staggered delays
  // =============================================================================================
  // Instead of processing in sequential batches (slow), we send ALL video requests
  // in parallel with small staggered delays to avoid rate limits. This dramatically
  // reduces total generation time from O(n * batch_time) to O(max_video_time + small_delays)
  //
  // TIMING INFO (WaveSpeed InfiniteTalk):
  // - Average generation time: ~400 seconds (~6.7 minutes)
  // - Slow cases: up to 700+ seconds (~12 minutes)
  // - By sending in parallel, total time ≈ slowest video + stagger delays
  // - Example: 8 videos × 400s avg = would be 53+ min sequential, but ~7 min parallel!
  
  const STAGGER_DELAY_MS = 500; // Delay between starting each video (500ms)
  const AVG_VIDEO_TIME_MS = 400000; // ~6.7 minutes average
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

  // =============================================================================================
  // PARALLEL PROCESSING: Launch all video generation tasks with staggered starts
  // =============================================================================================
  const totalStaggerTime = (segments.length - 1) * STAGGER_DELAY_MS;
  const estimatedTotalTime = Math.round((AVG_VIDEO_TIME_MS + totalStaggerTime) / 60000);
  
  console.log(`🚀 [InfiniteTalk] Launching ${segments.length} video tasks in parallel`);
  console.log(`⏱️ [InfiniteTalk] Estimated time: ~${estimatedTotalTime} minutes (avg ${Math.round(AVG_VIDEO_TIME_MS / 60000)} min/video + stagger)`);
  
  const startTime = Date.now();
  
  // Create all video generation promises with staggered delays
  const videoPromises = segments.map(async (segment, globalIndex) => {
    // Stagger the start of each request to avoid overwhelming the API
    await new Promise(resolve => setTimeout(resolve, globalIndex * STAGGER_DELAY_MS));
    
    const audioUrl = (segment as any).audioUrl;
    
    if (!audioUrl) {
      // Already warned above, just skip
      return { index: globalIndex, url: null, reason: 'missing_audio' };
    }
    
    // Use originalIndex if provided (for single segment regeneration), otherwise use globalIndex
    const sceneIndex = (segment as any).originalIndex ?? globalIndex;
    
    // Get scene metadata if available (now includes Scene Builder visual prompts)
    const sceneMetadata = sceneMetadataMap.get(sceneIndex);

    // Always use single model (multi model disabled for dynamic single-character scenes)
    // Legacy "both" and "infinite_talk_multi" are converted to single host
    const useMultiModel = false;

    // Determine which image to use based on video_mode
    // Always use solo image of the speaking host for dynamic single-character scenes
    let imageUrlForSegment: string;
    
    {
      // Single model: Use solo image of the speaking host
      // IMPORTANT: Use sceneMetadata.video_mode first, then fall back to speaker name matching
      const videoMode = sceneMetadata?.video_mode || (segment.speaker === hostAName ? 'hostA' : 'hostB');
      
      console.log(`🎭 [InfiniteTalk] Segment ${sceneIndex}: video_mode=${videoMode}, speaker=${segment.speaker}, hostA=${hostAName}, hostB=${hostBName}`);
      
      if (videoMode === 'hostA' && hostASoloUrl) {
        imageUrlForSegment = hostASoloUrl;
        console.log(`🖼️ [InfiniteTalk Single] Segment ${sceneIndex}: Using Host A solo image (video_mode: hostA)`);
      } else if (videoMode === 'hostB' && hostBSoloUrl) {
        imageUrlForSegment = hostBSoloUrl;
        console.log(`🖼️ [InfiniteTalk Single] Segment ${sceneIndex}: Using Host B solo image (video_mode: hostB)`);
      } else if (segment.speaker === hostAName && hostASoloUrl) {
        imageUrlForSegment = hostASoloUrl;
        console.log(`🖼️ [InfiniteTalk Single] Segment ${sceneIndex}: Using Host A solo image (by speaker name: ${segment.speaker})`);
      } else if (segment.speaker === hostBName && hostBSoloUrl) {
        imageUrlForSegment = hostBSoloUrl;
        console.log(`🖼️ [InfiniteTalk Single] Segment ${sceneIndex}: Using Host B solo image (by speaker name: ${segment.speaker})`);
      } else {
        // Fallback: use any available solo image or two-shot
        imageUrlForSegment = hostASoloUrl || hostBSoloUrl || twoShotUrl || config.referenceImageUrl || '';
        console.warn(`⚠️ [InfiniteTalk Single] Segment ${sceneIndex}: Using fallback image (no match for video_mode=${videoMode}, speaker=${segment.speaker})`);
      }
    }

    if (!imageUrlForSegment) {
      console.error(`❌ [InfiniteTalk] Segment ${sceneIndex}: No image available`);
      return { index: globalIndex, url: null, reason: 'no_image' };
    }

    // Get extended segment data (for "both" scenes with separate audios)
    const extSegment = segment as ExtendedBroadcastSegment;
    const hostA_audioUrl = extSegment.hostA_audioUrl;
    const hostB_audioUrl = extSegment.hostB_audioUrl;
    const order = extSegment.order;
    // Get audio duration for accurate video timing
    const segmentDuration = segment.audioDuration;

    console.log(`🎬 [InfiniteTalk] Starting segment ${sceneIndex + 1}/${segments.length} (scene index: ${sceneIndex})...`);

    // Use retry logic for video generation
    const { retryVideoGeneration } = await import('./retryUtils');
    const result = await retryVideoGeneration(
      async () => {
        const videoResult = await generateInfiniteTalkVideo({
          channelId,
          productionId,
          segmentIndex: sceneIndex,  // Use the correct scene index
          audioUrl,
          referenceImageUrl: imageUrlForSegment,
          speaker: segment.speaker,
          dialogueText: segment.text,
          hostAName,
          hostBName,
          hostAVisualPrompt,
          hostBVisualPrompt,
          resolution: '720p',
          aspectRatio: channelFormat, // Use channel format (16:9 or 9:16)
          // Pass separate audios for "both" scenes
          hostA_audioUrl,
          hostB_audioUrl,
          order,
          sceneMetadata,
          // Pass audio duration for accurate video timing
          audioDuration: segmentDuration
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
      console.log(`✅ [InfiniteTalk] Segment ${sceneIndex + 1} complete`);
    } else {
      failedIndices.push(sceneIndex);
    }

    // Return globalIndex for array placement, but use sceneIndex for scene metadata
    return { index: globalIndex, url: result, sceneIndex };
  });

  // Wait for ALL videos to complete in parallel
  console.log(`⏳ [InfiniteTalk] Waiting for all ${segments.length} videos to complete...`);
  const allResults = await Promise.allSettled(videoPromises);
  
  const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`⏱️ [InfiniteTalk] All video tasks completed in ${elapsedTime}s`);

  // Process all results
  allResults.forEach((result, idx) => {
    if (result.status === 'fulfilled') {
      videoUrls[result.value.index] = result.value.url;
    } else {
      failedIndices.push(idx);
      console.error(`❌ [InfiniteTalk] Segment ${idx} failed:`, result.reason);
    }
  });
  
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
 * 
 * CURRENT STATUS: Intro/outro are disabled (always null)
 * The composition will start directly with the first video segment
 * 
 * To enable intro/outro in the future:
 * 1. Generate intro/outro videos separately using InfiniteTalk or another tool
 * 2. Upload them to Supabase Storage
 * 3. Update this function to load and return the video URLs
 */
export const generateBroadcastVisuals = async (
  newsContext: string,
  config: ChannelConfig,
  script: ScriptLine[],
  channelId: string,
  productionId?: string
): Promise<VideoAssets> => {
  console.log(`[Broadcast Visuals] Skipping intro/outro - videos will start directly with scenes`);
  
  // Reference image for other purposes (thumbnail generation, etc.) - using format-aware helper
  const referenceImage = config.referenceImageUrl || getSeedImageUrl(config, 'twoShot') || null;

  return {
    intro: null,
    outro: null,
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

// Generate seed image for Narrative Engine hosts
export const generateSeedImage = async (prompt: string, aspectRatio: '1:1' | '16:9' | '9:16' = '1:1'): Promise<string | null> => {
  // Try WaveSpeed first
  if (isWavespeedConfigured()) {
    try {
      console.log(`🎨 [SeedImage] Generating seed image using WaveSpeed (${aspectRatio})...`);
      const taskId = await createWavespeedImageTask(prompt, aspectRatio);
      const imageUrl = await pollWavespeedImageTask(taskId);
      const dataUri = await imageUrlToDataUri(imageUrl);
      CostTracker.track('seed_image', 'wavespeed/nano-banana-pro', 0.14);
      console.log(`✅ [SeedImage] Generated via WaveSpeed`);
      return dataUri;
    } catch (wavespeedError) {
      console.error(`⚠️ [SeedImage] WaveSpeed failed:`, (wavespeedError as Error).message);
    }
  }

  // Fallback to DALL-E
  try {
    console.log(`🎨 [SeedImage] Generating seed image using DALL-E 3 (${aspectRatio})...`);
    // DALL-E 3 sizes: 1024x1024 (1:1), 1792x1024 (16:9), 1024x1792 (9:16)
    const size = aspectRatio === '16:9' ? '1792x1024' : aspectRatio === '9:16' ? '1024x1792' : '1024x1024';
    const dalleImage = await generateImageWithDALLE(prompt, size as '1024x1024' | '1792x1024' | '1024x1792');
    if (dalleImage) {
      console.log(`✅ [SeedImage] Generated via DALL-E 3`);
      return dalleImage;
    }
  } catch (dalleError) {
    console.error(`❌ [SeedImage] DALL-E 3 failed:`, (dalleError as Error).message);
  }

  return null;
};

export const generateThumbnailVariants = async (
  newsContext: string,
  config: ChannelConfig,
  viralMeta: ViralMetadata,
  channelId?: string,
  productionId?: string
): Promise<{ primary: string | null; variant: string | null }> => {
  // ⭐ Check cache first - avoid regenerating for same context
  if (channelId) {
    const cached = await findCachedThumbnail(channelId, newsContext, viralMeta.title);
    if (cached) {
      console.log(`✅ [Thumbnails] Using cached thumbnails (used ${cached.useCount} times before)`);
      return { 
        primary: cached.thumbnailUrl, 
        variant: cached.variantUrl 
      };
    }
  }

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

  // Track which provider we used for caching
  let usedProvider = 'unknown';

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
        usedProvider = 'wavespeed';
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
          usedProvider = 'wavespeed';
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
        usedProvider = 'dalle';
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
    
    // ⭐ Save to cache for future reuse
    if (channelId && primary) {
      await saveThumbnailToCache(
        channelId,
        productionId || null,
        newsContext,
        viralMeta.title,
        primary,
        variant || undefined,
        primaryStyle.name,
        usedProvider
      );
    }

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
 * 
 * Uses PODCAST-STYLE composition (following shockstack.md guide):
 * - Videos play sequentially (NO overlaps)
 * - Minimalist lower thirds with titles
 * - Subtle frame/border
 * - Soft vignette overlay
 * - Fade transitions only
 * - NO separate audio track (videos have embedded audio from InfiniteTalk)
 * 
 * @param segments - Broadcast segments with video URLs
 * @param videoUrls - Array of video URLs (from InfiniteTalk)
 * @param videos - Video assets (intro/outro) - currently not used in podcast style
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
    transition?: 'fade' | 'wipeLeft' | 'slideLeft' | 'slideRight' | 'zoom';
    transitionDuration?: number;
    watermarkUrl?: string;
    callbackUrl?: string;
    enableOverlays?: boolean;
    breakingNewsTitle?: string;
    headlines?: string[];
    // Scene titles for lower thirds (optional, will use headlines if not provided)
    sceneTitles?: string[];
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

  // Filter out null video URLs and build scenes
  const validSegments: { segment: BroadcastSegment; videoUrl: string; index: number }[] = [];
  segments.forEach((segment, index) => {
    const videoUrl = videoUrls[index] || segment.videoUrl;
    if (videoUrl) {
      validSegments.push({ segment, videoUrl, index });
    }
  });

  if (validSegments.length === 0) {
    console.error('❌ [Composition] No valid video URLs to compose');
    return {
      success: false,
      error: 'No valid video URLs to compose'
    };
  }

  console.log(`🎙️ [Podcast Composition] Starting podcast-style video composition...`);
  console.log(`🎙️ [Podcast Composition] ${validSegments.length}/${segments.length} valid video segments`);
  console.log(`🎙️ [Podcast Composition] Style: Clean podcast aesthetic (no TV news overlays)`);
  console.log(`🎙️ [Podcast Composition] NOTE: Videos play SEQUENTIALLY (no overlaps)`);

  try {
    // Convert segments to PodcastScene format
    // CRITICAL: Each scene needs a duration so we can calculate start times
    const podcastScenes: PodcastScene[] = validSegments.map(({ segment, videoUrl, index }) => {
      // Use actual audio duration from segment (set during audio generation)
      // This is the REAL duration, not an estimate
      const audioDuration = segment.audioDuration;
      
      // Fallback: Estimate duration from text length (only if audioDuration not available)
      let duration: number;
      if (audioDuration && audioDuration > 0) {
        duration = audioDuration;
        console.log(`🎙️ [Podcast Scene ${index}] Using REAL duration: ${duration.toFixed(1)}s`);
      } else {
        // Estimate: ~150 words/minute = 2.5 words/sec
        const wordCount = segment.text.split(/\s+/).length;
        duration = Math.max(3, Math.ceil(wordCount / 2.5));
        console.log(`🎙️ [Podcast Scene ${index}] Using ESTIMATED duration: ${duration.toFixed(1)}s (no audioDuration available)`);
      }

      // Get title for lower third
      // Priority: segment.sceneTitle (from Supabase/Narrative Engine) > sceneTitles > headlines > text
      let title = '';
      if (segment.sceneTitle) {
        // Best: Use title generated by Narrative Engine and stored in Supabase
        title = segment.sceneTitle;
        console.log(`🎙️ [Podcast Scene ${index}] Using scene title from Supabase: "${title}"`);
      } else if (options.sceneTitles && options.sceneTitles[index]) {
        title = options.sceneTitles[index];
      } else if (options.headlines && options.headlines[index]) {
        title = options.headlines[index];
      } else {
        // Fallback: Use first 50 chars of segment text as title
        title = segment.text.length > 50 
          ? segment.text.substring(0, 47) + '...'
          : segment.text;
        console.log(`🎙️ [Podcast Scene ${index}] No sceneTitle found, using text fallback`);
      }

      // Get speaker name
      const speakerName = segment.speaker === 'host_a' 
        ? (config.characters?.hostA?.name || 'Host A')
        : segment.speaker === 'host_b'
        ? (config.characters?.hostB?.name || 'Host B')
        : segment.speaker;

      return {
        video_url: videoUrl,
        title,
        duration,
        speaker: speakerName
      };
    });

    console.log(`🎙️ [Podcast Composition] Built ${podcastScenes.length} scenes:`);
    let totalDuration = 0;
    podcastScenes.forEach((scene, i) => {
      console.log(`  Scene ${i + 1}: ${scene.duration}s - "${scene.title.substring(0, 30)}..." (${scene.speaker})`);
      totalDuration += scene.duration;
    });
    console.log(`🎙️ [Podcast Composition] Estimated total duration: ${totalDuration}s`);

    // Render using podcast-style composition
    const result = await renderPodcastVideo(podcastScenes, {
      channelName: config.channelName,
      episodeTitle: options.breakingNewsTitle,
      showBorder: true,
      showVignette: true,
      resolution: options.resolution || '1080'
    });

    if (result.success) {
      console.log(`✅ [Podcast Composition] Video composed successfully!`);
      console.log(`🎥 [Podcast Composition] URL: ${result.videoUrl}`);
      console.log(`🖼️ [Podcast Composition] Poster: ${result.posterUrl}`);
      console.log(`⏱️ [Podcast Composition] Duration: ${result.duration}s`);
      console.log(`💰 [Podcast Composition] Cost: $${result.cost?.toFixed(4) || '?'}`);
    } else {
      console.error(`❌ [Podcast Composition] Failed: ${result.error}`);
    }

    return result;
  } catch (error) {
    console.error('❌ [Podcast Composition] Error:', (error as Error).message);
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

// Re-export script analysis for YouTube Shorts
export { analyzeScriptForShorts };
export type { ScriptAnalysis };
