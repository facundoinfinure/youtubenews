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
  audioUrl: string;           // URL to the audio file (primary, or hostA for "both" scenes)
  referenceImageUrl: string;  // URL to the reference image
  speaker: string;            // Who is speaking: hostA name, hostB name, or "Both"
  dialogueText: string;       // The dialogue text for caching
  hostAName: string;          // Name of host A (left in image)
  hostBName: string;          // Name of host B (right in image)
  hostAVisualPrompt: string;  // Visual description of host A
  hostBVisualPrompt: string;  // Visual description of host B
  resolution?: '480p' | '720p';
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
    hostA_audioUrl,  // Separate audio for Host A (for "both" scenes)
    hostB_audioUrl,  // Separate audio for Host B (for "both" scenes)
    order: providedOrder,  // Who speaks first
    sceneMetadata
  } = options;

  // Determine video type and model based on scene metadata or speaker
  let videoType: VideoType = 'segment';
  let effectiveVideoMode: VideoMode | null = null;
  let useMultiModel: boolean = false;
  
  if (sceneMetadata?.video_mode) {
    effectiveVideoMode = sceneMetadata.video_mode;
    videoType = effectiveVideoMode === 'hostA' ? 'host_a' 
      : effectiveVideoMode === 'hostB' ? 'host_b' 
      : 'both_hosts';
    // Use Multi model only for 'both' mode (two characters in frame)
    useMultiModel = effectiveVideoMode === 'both';
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
      videoType = 'both_hosts';
      effectiveVideoMode = 'both';
      useMultiModel = true;
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
        // Update task to completed
        await updateVideoTaskCompleted(pendingTask.taskId, videoUrl);
        
        // Track cost (estimate based on typical segment)
        const baseCost = resolution === '720p' ? INFINITETALK_COST_720P : INFINITETALK_COST_480P;
        CostTracker.track('video', 'infinitetalk-resumed', baseCost);
        
        console.log(`✅ [InfiniteTalk] Resumed task completed for segment ${segmentIndex}`);
        return { url: videoUrl, fromCache: false };
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
      aspect_ratio: '16:9',
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

      // Update task to completed (instead of inserting new record)
      await updateVideoTaskCompleted(taskId, videoUrl);

      console.log(`✅ [${modelName}] Video generated and cached for segment ${segmentIndex}`);
      return { url: videoUrl, fromCache: false };
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
 * Generate a single audio file for a text using TTS
 */
const generateSingleAudio = async (
  text: string,
  voiceName: string,
  channelId: string,
  label: string
): Promise<{ audioBase64: string; fromCache: boolean; audioUrl?: string }> => {
  // Validate input text before processing
  const trimmedText = text?.trim() || '';
  if (!trimmedText) {
    console.error(`❌ [Audio] Empty text for ${label}, skipping TTS generation`);
    throw new Error(`Empty text provided for audio generation (${label})`);
  }
  
  // Check cache first
  if (findCachedAudioFn && channelId) {
    const cachedAudio = await findCachedAudioFn(trimmedText, voiceName, channelId);
    if (cachedAudio) {
      console.log(`✅ Cache hit for audio (${label}): "${trimmedText.substring(0, 30)}..."`);
      return { audioBase64: cachedAudio, fromCache: true, audioUrl: cachedAudio };
    }
  }

  // Generate new audio
  const audioBase64 = await generateTTSAudio(trimmedText, voiceName);
  console.log(`✅ [Audio] Generated (${label}): "${trimmedText.substring(0, 30)}..."`);
  return { audioBase64, fromCache: false };
};

export const generateSegmentedAudio = async (script: ScriptLine[], config: ChannelConfig): Promise<BroadcastSegment[]> => {
  return generateSegmentedAudioWithCache(script, config, '');
};

/**
 * Generate audio segments from script lines (legacy format)
 * For new v2.0 format with scenes, use generateAudioFromScenes instead
 */
export const generateSegmentedAudioWithCache = async (
  script: ScriptLine[], 
  config: ChannelConfig,
  channelId: string = ''
): Promise<BroadcastSegment[]> => {
  console.log(`🔍 [Audio DEBUG] Config received for audio generation:`);
  console.log(`🔍 [Audio DEBUG] Host A (${config.characters.hostA.name}): voiceName = "${config.characters.hostA.voiceName}"`);
  console.log(`🔍 [Audio DEBUG] Host B (${config.characters.hostB.name}): voiceName = "${config.characters.hostB.voiceName}"`);
  
  console.log(`🎙️ [Audio] Generating ${script.length} audio segments using OpenAI TTS...`);

  const audioPromises = script.map(async (line) => {
    let character = config.characters.hostA;
    if (line.speaker === config.characters.hostA.name) {
      character = config.characters.hostA;
    } else if (line.speaker === config.characters.hostB.name) {
      character = config.characters.hostB;
    }

    try {
      const result = await generateSingleAudio(line.text, character.voiceName, channelId, line.speaker);
      return {
        speaker: line.speaker,
        text: line.text,
        audioBase64: result.audioBase64,
        fromCache: result.fromCache,
        audioUrl: result.audioUrl
      } as any;
    } catch (error) {
      console.error(`❌ [Audio] Failed for "${line.text.substring(0, 30)}...":`, (error as Error).message);
      throw error;
    }
  });

  const results = await Promise.all(audioPromises);
  console.log(`✅ [Audio] Successfully generated ${results.length} audio segments via OpenAI TTS`);
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
  console.log(`🎙️ [Audio v2.0] Generating audio from ${Object.keys(scriptWithScenes.scenes).length} scenes...`);
  console.log(`🎙️ [Audio v2.0] Narrative: ${scriptWithScenes.narrative_used}`);
  
  const hostA = config.characters.hostA;
  const hostB = config.characters.hostB;
  
  const segments: ExtendedBroadcastSegment[] = [];
  const sceneEntries = Object.entries(scriptWithScenes.scenes).sort(([a], [b]) => parseInt(a) - parseInt(b));
  
  for (const [sceneNum, scene] of sceneEntries) {
    const sceneIndex = parseInt(sceneNum) - 1;
    
    if (scene.video_mode === 'both') {
      // BOTH HOSTS SCENE: Generate 2 separate audios
      console.log(`🎬 [Audio v2.0] Scene ${sceneNum}: BOTH hosts - generating 2 audios`);
      
      // Get separate dialogues (or fallback to splitting text)
      let hostAText = (scene.hostA_text || '').trim();
      let hostBText = (scene.hostB_text || '').trim();
      
      // Fallback: if separate texts not provided, split the main text
      if (!hostAText || !hostBText) {
        console.warn(`⚠️ [Audio v2.0] Scene ${sceneNum}: Missing separate dialogues, splitting text`);
        const text = (scene.text || '').trim();
        if (!text) {
          console.error(`❌ [Audio v2.0] Scene ${sceneNum}: No text available for BOTH mode`);
          throw new Error(`Scene ${sceneNum} has no text content for audio generation`);
        }
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        const midpoint = Math.ceil(sentences.length / 2);
        hostAText = hostAText || sentences.slice(0, midpoint).join(' ').trim();
        hostBText = hostBText || sentences.slice(midpoint).join(' ').trim();
      }
      
      // Final validation - ensure both have content
      if (!hostAText) {
        console.error(`❌ [Audio v2.0] Scene ${sceneNum}: hostA_text is empty`);
        throw new Error(`Scene ${sceneNum}: Host A text is empty after processing`);
      }
      if (!hostBText) {
        console.error(`❌ [Audio v2.0] Scene ${sceneNum}: hostB_text is empty`);
        throw new Error(`Scene ${sceneNum}: Host B text is empty after processing`);
      }
      
      console.log(`📝 [Audio v2.0] Scene ${sceneNum} texts - ${hostA.name}: "${hostAText.substring(0, 40)}..." | ${hostB.name}: "${hostBText.substring(0, 40)}..."`);
      
      // Generate both audios in parallel
      const [hostAAudio, hostBAudio] = await Promise.all([
        generateSingleAudio(hostAText, hostA.voiceName, channelId, `Scene ${sceneNum} - ${hostA.name}`),
        generateSingleAudio(hostBText, hostB.voiceName, channelId, `Scene ${sceneNum} - ${hostB.name}`)
      ]);
      
      // Create segment with BOTH audios
      segments.push({
        speaker: 'Both',
        text: scene.text || `${hostAText} ${hostBText}`,
        audioBase64: hostAAudio.audioBase64, // Primary audio (for backwards compatibility)
        hostA_text: hostAText,
        hostB_text: hostBText,
        hostA_audioBase64: hostAAudio.audioBase64,
        hostB_audioBase64: hostBAudio.audioBase64,
        order: scene.order || 'left_first',
        video_mode: scene.video_mode,
        model: scene.model,
        shot: scene.shot,
        sceneIndex,
        fromCache: hostAAudio.fromCache && hostBAudio.fromCache
      });
      
      console.log(`✅ [Audio v2.0] Scene ${sceneNum}: Generated ${hostA.name} + ${hostB.name} audios`);
      
    } else {
      // SINGLE HOST SCENE: Generate 1 audio
      const speaker = scene.video_mode === 'hostA' ? hostA.name : hostB.name;
      const character = scene.video_mode === 'hostA' ? hostA : hostB;
      const sceneText = (scene.text || '').trim();
      
      // Validate text exists
      if (!sceneText) {
        console.error(`❌ [Audio v2.0] Scene ${sceneNum}: No text for ${speaker}`);
        throw new Error(`Scene ${sceneNum}: Text is empty for ${speaker}`);
      }
      
      console.log(`🎬 [Audio v2.0] Scene ${sceneNum}: ${speaker} solo - "${sceneText.substring(0, 40)}..."`);
      
      const audio = await generateSingleAudio(sceneText, character.voiceName, channelId, `Scene ${sceneNum} - ${speaker}`);
      
      segments.push({
        speaker,
        text: sceneText,
        audioBase64: audio.audioBase64,
        video_mode: scene.video_mode,
        model: scene.model,
        shot: scene.shot,
        sceneIndex,
        fromCache: audio.fromCache
      });
      
      console.log(`✅ [Audio v2.0] Scene ${sceneNum}: Generated ${speaker} audio`);
    }
  }
  
  console.log(`✅ [Audio v2.0] Generated ${segments.length} segments with audio`);
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
  // For intro, prefer two-shot image, then fallback to referenceImageUrl or any available image
  const twoShotUrl = config.seedImages?.twoShotUrl;
  const introImage = twoShotUrl || config.referenceImageUrl || config.seedImages?.hostASoloUrl || config.seedImages?.hostBSoloUrl;
  
  if (introImage) {
    console.log(`✅ [Intro] Using ${twoShotUrl ? 'two-shot' : 'fallback'} image as intro frame`);
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
  // For outro, prefer two-shot image, then fallback
  const twoShotUrl = config.seedImages?.twoShotUrl;
  const outroImage = twoShotUrl || config.referenceImageUrl || config.seedImages?.hostASoloUrl || config.seedImages?.hostBSoloUrl;
  
  if (outroImage) {
    console.log(`✅ [Outro] Using ${twoShotUrl ? 'two-shot' : 'fallback'} image as outro frame`);
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
  // Get seed images for each host (prefer individual images, fallback to referenceImageUrl)
  const hostASoloUrl = config.seedImages?.hostASoloUrl;
  const hostBSoloUrl = config.seedImages?.hostBSoloUrl;
  const twoShotUrl = config.seedImages?.twoShotUrl || config.referenceImageUrl;
  
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

  console.log(`🎬 [InfiniteTalk Multi] Generating ${segments.length} lip-sync videos`);
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

        // Determine which model to use based on scene metadata
        // This affects which image we need (single host vs two-shot)
        const useMultiModel = sceneMetadata?.model === 'infinite_talk_multi' || sceneMetadata?.video_mode === 'both';

        // Determine which image to use based on MODEL and video_mode
        // CRITICAL: Single model needs single-host image, Multi model needs two-shot image
        let imageUrlForSegment: string;
        
        if (useMultiModel) {
          // Multi model: MUST use two-shot image (both hosts in frame)
          if (twoShotUrl) {
            imageUrlForSegment = twoShotUrl;
            console.log(`🖼️ [InfiniteTalk Multi] Segment ${globalIndex}: Using two-shot image (both hosts)`);
          } else {
            // Fallback if no two-shot available
            console.warn(`⚠️ [InfiniteTalk Multi] Segment ${globalIndex}: No two-shot image available, using fallback`);
            imageUrlForSegment = config.referenceImageUrl || hostASoloUrl || hostBSoloUrl || '';
          }
        } else {
          // Single model: Use solo image of the speaking host
          const videoMode = sceneMetadata?.video_mode || (segment.speaker === hostAName ? 'hostA' : 'hostB');
          
          if (videoMode === 'hostA' && hostASoloUrl) {
          imageUrlForSegment = hostASoloUrl;
            console.log(`🖼️ [InfiniteTalk Single] Segment ${globalIndex}: Using Host A solo image`);
          } else if (videoMode === 'hostB' && hostBSoloUrl) {
            imageUrlForSegment = hostBSoloUrl;
            console.log(`🖼️ [InfiniteTalk Single] Segment ${globalIndex}: Using Host B solo image`);
          } else if (segment.speaker === hostAName && hostASoloUrl) {
            imageUrlForSegment = hostASoloUrl;
            console.log(`🖼️ [InfiniteTalk Single] Segment ${globalIndex}: Using Host A solo image (by speaker)`);
        } else if (segment.speaker === hostBName && hostBSoloUrl) {
          imageUrlForSegment = hostBSoloUrl;
            console.log(`🖼️ [InfiniteTalk Single] Segment ${globalIndex}: Using Host B solo image (by speaker)`);
        } else {
            // Fallback: use any available solo image or two-shot
            imageUrlForSegment = hostASoloUrl || hostBSoloUrl || twoShotUrl || config.referenceImageUrl || '';
            console.warn(`⚠️ [InfiniteTalk Single] Segment ${globalIndex}: Using fallback image`);
          }
        }

        if (!imageUrlForSegment) {
          console.error(`❌ [InfiniteTalk] Segment ${globalIndex}: No image available`);
          return { index: globalIndex, url: null, reason: 'no_image' };
        }

        // Get extended segment data (for "both" scenes with separate audios)
        const extSegment = segment as ExtendedBroadcastSegment;
        const hostA_audioUrl = extSegment.hostA_audioUrl;
        const hostB_audioUrl = extSegment.hostB_audioUrl;
        const order = extSegment.order;

        // Use retry logic for video generation
        const { retryVideoGeneration } = await import('./retryUtils');
        const result = await retryVideoGeneration(
          async () => {
            const videoResult = await generateInfiniteTalkVideo({
              channelId,
              productionId,
              segmentIndex: globalIndex,
              audioUrl,
              referenceImageUrl: imageUrlForSegment,
              speaker: segment.speaker,
              dialogueText: segment.text,
              hostAName,
              hostBName,
              hostAVisualPrompt,
              hostBVisualPrompt,
              resolution: '720p',
              // Pass separate audios for "both" scenes
              hostA_audioUrl,
              hostB_audioUrl,
              order,
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
  
  // Reference image for other purposes (thumbnail generation, etc.)
  const referenceImage = config.referenceImageUrl || config.seedImages?.twoShotUrl || null;

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
export const generateSeedImage = async (prompt: string, aspectRatio: '1:1' | '16:9' = '1:1'): Promise<string | null> => {
  // Try WaveSpeed first
  if (isWavespeedConfigured()) {
    try {
      console.log(`🎨 [SeedImage] Generating seed image using WaveSpeed...`);
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
    console.log(`🎨 [SeedImage] Generating seed image using DALL-E 3...`);
    const size = aspectRatio === '16:9' ? '1792x1024' : '1024x1024';
    const dalleImage = await generateImageWithDALLE(prompt, size as '1024x1024' | '1792x1024');
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
    transition?: 'fade' | 'wipeLeft' | 'slideLeft' | 'slideRight' | 'zoom';
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
          duration: options.transitionDuration || 0.5
        } : { type: 'fade', duration: 0.5 },
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
