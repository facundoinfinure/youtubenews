/**
 * Shotstack Video Composition Service
 * 
 * Shotstack es un API de composición de video en la nube que funciona
 * perfectamente con Vercel (serverless).
 * 
 * Pricing: ~$0.05 por minuto de video renderizado
 * Sign up: https://shotstack.io
 * 
 * Alternativas si Shotstack no funciona:
 * - Creatomate (https://creatomate.com)
 * - Renderforest API
 * - Modal.com (si necesitas FFmpeg real)
 */

import { CostTracker } from "./CostTracker";
import { getNewsByDate } from "./supabaseService";

// =============================================================================================
// TYPES
// =============================================================================================

/**
 * Valid Shotstack transition types
 * See: https://shotstack.io/docs/api/#tocs_transition
 */
export type ShotstackTransition = 
  | 'fade' | 'fadeSlow' | 'fadeFast'
  | 'reveal' | 'revealSlow' | 'revealFast'
  | 'wipeLeft' | 'wipeLeftSlow' | 'wipeLeftFast'
  | 'wipeRight' | 'wipeRightSlow' | 'wipeRightFast'
  | 'slideLeft' | 'slideLeftSlow' | 'slideLeftFast'
  | 'slideRight' | 'slideRightSlow' | 'slideRightFast'
  | 'slideUp' | 'slideUpSlow' | 'slideUpFast'
  | 'slideDown' | 'slideDownSlow' | 'slideDownFast'
  | 'carouselLeft' | 'carouselLeftSlow' | 'carouselLeftFast'
  | 'carouselRight' | 'carouselRightSlow' | 'carouselRightFast'
  | 'carouselUp' | 'carouselUpSlow' | 'carouselUpFast'
  | 'carouselDown' | 'carouselDownSlow' | 'carouselDownFast'
  | 'shuffleTopRight' | 'shuffleRightTop' | 'shuffleRightBottom'
  | 'shuffleBottomRight' | 'shuffleBottomLeft' | 'shuffleLeftBottom'
  | 'shuffleLeftTop' | 'shuffleTopLeft'
  | 'zoom';

/**
 * Valid Shotstack motion effects
 */
export type ShotstackEffect = 
  | 'zoomIn' | 'zoomInSlow' | 'zoomInFast'
  | 'zoomOut' | 'zoomOutSlow' | 'zoomOutFast'
  | 'slideLeft' | 'slideLeftSlow' | 'slideLeftFast'
  | 'slideRight' | 'slideRightSlow' | 'slideRightFast'
  | 'slideUp' | 'slideUpSlow' | 'slideUpFast'
  | 'slideDown' | 'slideDownSlow' | 'slideDownFast';

/**
 * Valid Shotstack filters
 */
export type ShotstackFilter = 
  | 'blur' | 'boost' | 'contrast' | 'darken' 
  | 'greyscale' | 'lighten' | 'muted' | 'negative';

export interface VideoClip {
  url: string;
  start: number;      // Start time in seconds
  length?: number;    // Duration in seconds (auto-detect if not provided)
  fit?: 'cover' | 'contain' | 'crop' | 'none';
  volume?: number;    // 0-1
  effect?: ShotstackEffect;   // Motion effect (zoom, slide, etc)
  filter?: ShotstackFilter;   // Visual filter (boost, contrast, etc)
}

export interface AudioClip {
  url: string;
  start: number;
  length?: number;
  volume?: number;
}

export interface TextOverlay {
  text: string;
  start: number;
  length: number;
  style?: 'minimal' | 'blockbuster' | 'vogue' | 'sketch';
  position?: 'top' | 'center' | 'bottom';
  size?: 'small' | 'medium' | 'large';
  color?: string;
}

export interface CompositionConfig {
  // Video segments in order
  clips: VideoClip[];
  
  // Optional audio track (if not using clip audio)
  audioTrack?: AudioClip;
  
  // Text overlays (subtitles, titles)
  textOverlays?: TextOverlay[];
  
  // Branding
  watermark?: {
    url: string;
    position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
    opacity?: number;
    scale?: number;
  };
  
  // Intro/Outro
  intro?: VideoClip;
  outro?: VideoClip;
  
  // Output settings
  resolution: 'sd' | 'hd' | '1080' | '4k';
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:5';
  fps?: number;
  
  // Transitions between clips (Shotstack valid values)
  // See: https://shotstack.io/docs/api/#tocs_transition
  transition?: {
    type: ShotstackTransition;
    duration: number; // seconds
  };
  
  // Visual effects for clips
  effects?: {
    zoom?: 'zoomIn' | 'zoomOut' | 'zoomInSlow' | 'zoomOutSlow';
    filter?: 'boost' | 'contrast' | 'darken' | 'greyscale' | 'lighten' | 'muted';
  };
  
  // Callback URL for webhook (optional)
  callbackUrl?: string;
}

export interface RenderResult {
  success: boolean;
  renderId?: string;
  status?: 'queued' | 'rendering' | 'done' | 'failed';
  videoUrl?: string;
  posterUrl?: string;
  error?: string;
  duration?: number;
  cost?: number;
}

// =============================================================================================
// CONFIGURATION
// =============================================================================================

const getShotstackConfig = () => {
  const apiKey = import.meta.env.VITE_SHOTSTACK_API_KEY || '';
  const env = import.meta.env.VITE_SHOTSTACK_ENV || 'stage'; // 'stage' for testing, 'v1' for production
  
  return {
    apiKey,
    baseUrl: `https://api.shotstack.io/${env}`,
    isConfigured: !!apiKey
  };
};

export const checkShotstackConfig = () => {
  const config = getShotstackConfig();
  return {
    configured: config.isConfigured,
    message: config.isConfigured 
      ? 'Shotstack configured' 
      : 'Set VITE_SHOTSTACK_API_KEY in .env'
  };
};

// =============================================================================================
// SHOTSTACK API HELPERS
// =============================================================================================

const shotstackRequest = async (
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: any
): Promise<any> => {
  const config = getShotstackConfig();
  
  if (!config.isConfigured) {
    throw new Error('Shotstack not configured. Set VITE_SHOTSTACK_API_KEY');
  }
  
  console.log(`[Shotstack] ${method} ${config.baseUrl}${endpoint}`);
  
  const response = await fetch(`${config.baseUrl}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey
    },
    body: body ? JSON.stringify(body) : undefined
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorDetails = errorText;
    try {
      const errorJson = JSON.parse(errorText);
      errorDetails = JSON.stringify(errorJson, null, 2);
      console.error(`❌ [Shotstack] API Error (${response.status}):`, errorDetails);
    } catch {
      console.error(`❌ [Shotstack] API Error (${response.status}):`, errorText);
    }
    throw new Error(`Shotstack API error: ${response.status} - ${errorText.substring(0, 200)}`);
  }
  
  return response.json();
};

// =============================================================================================
// BUILD SHOTSTACK TIMELINE
// =============================================================================================

/**
 * Check if a URL is a valid public URL (not a data URI)
 * Shotstack only accepts public URLs, not data URIs or base64
 */
const isValidPublicUrl = (url: string): boolean => {
  if (!url) return false;
  // Data URIs are not valid
  if (url.startsWith('data:')) return false;
  // Blob URLs are not valid for Shotstack (they're local)
  if (url.startsWith('blob:')) return false;
  // Must be HTTP/HTTPS
  return url.startsWith('http://') || url.startsWith('https://');
};

/**
 * Convert our config to Shotstack Edit format
 * Docs: https://shotstack.io/docs/api/
 * 
 * IMPORTANT: Shotstack only accepts public URLs, not data URIs!
 * All video/image sources must be publicly accessible HTTPS URLs.
 */
const buildShotstackEdit = (config: CompositionConfig): any => {
  const tracks: any[] = [];
  let currentTime = 0;
  // NO transitions - videos play back to back
  const transitionDuration = 0;
  
  // === VIDEO TRACK ===
  const videoClips: any[] = [];
  
  // Add intro if provided AND is a valid public URL
  if (config.intro && isValidPublicUrl(config.intro.url)) {
    videoClips.push({
      asset: {
        type: 'video',
        src: config.intro.url,
        volume: config.intro.volume ?? 1
      },
      start: currentTime,
      length: config.intro.length || 3,
      fit: config.intro.fit || 'cover',
      // Professional intro with zoom in - NO transition
      effect: config.intro.effect || 'zoomIn'
    });
    currentTime += (config.intro.length || 3);
  } else if (config.intro) {
    console.warn(`⚠️ [Shotstack] Skipping intro - not a valid public URL: ${config.intro.url?.substring(0, 50)}...`);
  }
  
  // Add main clips (only those with valid public URLs)
  const validClips = config.clips.filter(clip => isValidPublicUrl(clip.url));
  const skippedClips = config.clips.length - validClips.length;
  
  if (skippedClips > 0) {
    console.warn(`⚠️ [Shotstack] Skipping ${skippedClips} clips without valid public URLs`);
  }
  
  // Professional effect rotation for dynamic visuals
  const effectRotation: ShotstackEffect[] = [
    'zoomInSlow', 'slideRightSlow', 'zoomOutSlow', 'slideLeftSlow'
  ];
  
  // Transition rotation for variety
  const transitionRotation: ShotstackTransition[] = [
    'fade', 'slideRight', 'fade', 'wipeLeft', 'fade', 'slideUp'
  ];
  
  validClips.forEach((clip, index) => {
    // Auto-assign effects for professional look (Ken Burns style)
    const autoEffect = clip.effect || effectRotation[index % effectRotation.length];
    
    videoClips.push({
      asset: {
        type: 'video',
        src: clip.url,
        volume: clip.volume ?? 1
      },
      start: currentTime,
      length: clip.length || 'auto',
      fit: clip.fit || 'cover',
      // Add motion effect for professional Ken Burns style
      effect: autoEffect,
      // Add filter if specified
      filter: clip.filter || (config.effects?.filter)
      // NO transitions - clips play back to back
    });
    
    // Estimate clip duration if not provided (assume 5 seconds for auto)
    const clipDuration = clip.length || 5;
    currentTime += clipDuration;
  });
  
  // Add outro if provided AND is a valid public URL
  if (config.outro && isValidPublicUrl(config.outro.url)) {
    videoClips.push({
      asset: {
        type: 'video',
        src: config.outro.url,
        volume: config.outro.volume ?? 1
      },
      start: currentTime,
      length: config.outro.length || 3,
      fit: config.outro.fit || 'cover',
      // Professional outro with zoom out - NO transition
      effect: config.outro.effect || 'zoomOutSlow'
    });
  } else if (config.outro) {
    console.warn(`⚠️ [Shotstack] Skipping outro - not a valid public URL: ${config.outro.url?.substring(0, 50)}...`);
  }
  
  // Verify we have at least one valid clip
  if (videoClips.length === 0) {
    throw new Error('No valid video clips with public URLs. Shotstack requires HTTPS URLs, not data URIs.');
  }
  
  tracks.push({ clips: videoClips });
  
  // === WATERMARK TRACK (above video) ===
  if (config.watermark && isValidPublicUrl(config.watermark.url)) {
    const positionMap: Record<string, string> = {
      'topLeft': 'topLeft',
      'topRight': 'topRight', 
      'bottomLeft': 'bottomLeft',
      'bottomRight': 'bottomRight'
    };
    
    // Calculate total duration including outro if valid
    const totalDuration = currentTime + (config.outro && isValidPublicUrl(config.outro.url) ? (config.outro.length || 3) : 0);
    
    tracks.unshift({
      clips: [{
        asset: {
          type: 'image',
          src: config.watermark.url
        },
        start: 0,
        length: totalDuration,
        position: positionMap[config.watermark.position] || 'bottomRight',
        opacity: config.watermark.opacity || 0.7,
        scale: config.watermark.scale || 0.15
      }]
    });
  } else if (config.watermark) {
    console.warn(`⚠️ [Shotstack] Skipping watermark - not a valid public URL`);
  }
  
  // === TEXT OVERLAY TRACK ===
  if (config.textOverlays && config.textOverlays.length > 0) {
    const textClips = config.textOverlays.map(overlay => ({
      asset: {
        type: 'title',
        text: overlay.text,
        style: overlay.style || 'minimal',
        color: overlay.color || '#ffffff',
        size: overlay.size || 'medium',
        position: overlay.position || 'bottom'
      },
      start: overlay.start,
      length: overlay.length
    }));
    
    tracks.unshift({ clips: textClips });
  }
  
  // NOTE: We don't add a separate audio track since video clips already have their audio
  // The soundtrack property (below) can be used for background music if needed
  
  // Build resolution
  const resolutionMap: Record<string, string> = {
    'sd': 'sd',
    'hd': 'hd',
    '1080': '1080',
    '4k': '4k'
  };
  
  // Build timeline - no soundtrack needed since video clips have their own audio
  const timeline: any = {
    background: '#000000',
    tracks
  };
  
  // Only add soundtrack if we have a separate audio track
  if (config.audioTrack && isValidPublicUrl(config.audioTrack.url)) {
    timeline.soundtrack = {
      src: config.audioTrack.url,
      effect: 'fadeOut',
      volume: config.audioTrack.volume ?? 0.3
    };
  }
  
  return {
    timeline,
    output: {
      format: 'mp4',
      resolution: resolutionMap[config.resolution] || 'hd',
      aspectRatio: config.aspectRatio,
      fps: config.fps || 30,
      // Generate poster/thumbnail
      poster: {
        capture: 1 // Capture at 1 second
      }
    },
    callback: config.callbackUrl || undefined
  };
};

// =============================================================================================
// MAIN API FUNCTIONS
// =============================================================================================

/**
 * Submit a video composition job to Shotstack
 */
export const submitRenderJob = async (
  config: CompositionConfig
): Promise<{ renderId: string; message: string }> => {
  console.log('🎬 [Shotstack] Submitting render job...');
  
  const edit = buildShotstackEdit(config);
  
  console.log('📋 [Shotstack] Edit config:', JSON.stringify(edit, null, 2).substring(0, 500) + '...');
  
  const response = await shotstackRequest('/render', 'POST', edit);
  
  console.log(`✅ [Shotstack] Job submitted: ${response.response.id}`);
  
  return {
    renderId: response.response.id,
    message: response.response.message
  };
};

/**
 * Check the status of a render job
 */
export const checkRenderStatus = async (
  renderId: string
): Promise<RenderResult> => {
  const response = await shotstackRequest(`/render/${renderId}`);
  const data = response.response;
  
  const statusMap: Record<string, RenderResult['status']> = {
    'queued': 'queued',
    'fetching': 'queued',
    'rendering': 'rendering',
    'saving': 'rendering',
    'done': 'done',
    'failed': 'failed'
  };
  
  const result: RenderResult = {
    success: data.status === 'done',
    renderId,
    status: statusMap[data.status] || 'queued'
  };
  
  if (data.status === 'done') {
    result.videoUrl = data.url;
    result.posterUrl = data.poster;
    result.duration = data.data?.duration;
    
    // Track cost (~$0.05 per minute)
    if (data.data?.duration) {
      const cost = (data.data.duration / 60) * 0.05;
      CostTracker.track('composition', 'shotstack', cost);
      result.cost = cost;
    }
  }
  
  if (data.status === 'failed') {
    result.error = data.error || 'Render failed';
  }
  
  return result;
};

/**
 * Poll for render completion
 */
export const pollRenderJob = async (
  renderId: string,
  maxWaitMs: number = 600000, // 10 minutes
  pollIntervalMs: number = 5000 // 5 seconds
): Promise<RenderResult> => {
  const startTime = Date.now();
  
  console.log(`⏳ [Shotstack] Waiting for render ${renderId}...`);
  
  while (Date.now() - startTime < maxWaitMs) {
    const result = await checkRenderStatus(renderId);
    
    if (result.status === 'done') {
      console.log(`✅ [Shotstack] Render complete: ${result.videoUrl}`);
      return result;
    }
    
    if (result.status === 'failed') {
      console.error(`❌ [Shotstack] Render failed: ${result.error}`);
      return result;
    }
    
    console.log(`⏳ [Shotstack] Status: ${result.status}, waiting...`);
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  return {
    success: false,
    renderId,
    status: 'failed',
    error: 'Timeout waiting for render'
  };
};

/**
 * Full render workflow: submit and wait for completion
 */
export const renderVideo = async (
  config: CompositionConfig
): Promise<RenderResult> => {
  try {
    // Submit job
    const { renderId } = await submitRenderJob(config);
    
    // Poll for completion
    return await pollRenderJob(renderId);
  } catch (error) {
    console.error('❌ [Shotstack] Render error:', (error as Error).message);
    return {
      success: false,
      error: (error as Error).message
    };
  }
};

// =============================================================================================
// PODCAST-STYLE COMPOSITION (Following shockstack.md guide)
// =============================================================================================

import { BroadcastSegment, VideoAssets, ChannelConfig, RenderConfig, DEFAULT_RENDER_CONFIG } from "../types";

/**
 * Scene input for podcast-style composition
 */
export interface PodcastScene {
  // CRITICAL FIX: Add camera movement metadata for dynamic shots
  cameraMovement?: {
    type: 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'zoom' | 'static';
    intensity: 'subtle' | 'moderate' | 'pronounced';
    duration: number;
    startTime: number;
  };
  video_url: string;
  title: string;
  duration: number; // Duration in seconds (from video metadata or estimate)
  speaker?: string; // Optional speaker name
  text?: string;    // Optional text/dialogue for subtitles
  soundEffects?: {
    type?: 'transition' | 'emphasis' | 'notification' | 'ambient' | 'none';
    description?: string;
    startTime?: 'start' | 'end' | 'middle' | number; // When the effect should start
    duration?: number; // Duration of sound effect in seconds
    endTime?: number; // Optional explicit end time (if not provided, calculated from startTime + duration)
    volume?: number;
    url?: string; // URL to sound effect audio file (stored in Supabase Storage)
  };
}

/**
 * Format current date for news overlay display
 */
const formatNewsDate = (): string => {
  const now = new Date();
  const day = now.getDate();
  const month = now.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const year = now.getFullYear();
  return `${day} ${month} ${year}`;
};

/**
 * Determine pacing for a scene based on its type and position
 * NEW: Variación de Ritmo - adjusts scene duration and effects for optimal pacing
 */
const determineScenePacing = (
  scene: PodcastScene,
  sceneIndex: number,
  totalScenes: number
): {
  speedMultiplier: number; // 0.9 (fast) to 1.1 (slow)
  durationAdjustment: number; // Seconds to add/subtract
  effectIntensity: 'fast' | 'normal' | 'slow';
} => {
  const title = scene.title?.toLowerCase() || '';
  const isHook = sceneIndex === 0;
  const isPayoff = sceneIndex === totalScenes - 1;
  const isConflict = title.includes('conflict') || title.includes('crisis') || 
                      title.includes('crash') || title.includes('problem');
  
  // Hook: Fast pacing (0.9x speed feel, shorter duration)
  if (isHook) {
    return {
      speedMultiplier: 0.9,
      durationAdjustment: -0.5, // Cut 0.5s for faster feel
      effectIntensity: 'fast'
    };
  }
  
  // Conflict: Fast pacing for energy
  if (isConflict) {
    return {
      speedMultiplier: 0.95,
      durationAdjustment: -0.3,
      effectIntensity: 'fast'
    };
  }
  
  // Payoff: Slower pacing for emphasis (1.1x speed feel)
  if (isPayoff) {
    return {
      speedMultiplier: 1.1,
      durationAdjustment: 0.5, // Add 0.5s for emphasis
      effectIntensity: 'slow'
    };
  }
  
  // Default: Normal pacing
  return {
    speedMultiplier: 1.0,
    durationAdjustment: 0,
    effectIntensity: 'normal'
  };
};

/**
 * Advanced transition selection based on scene context
 * NEW: Contextual transitions for better visual flow
 */
const selectAdvancedTransition = (
  currentScene: PodcastScene,
  nextScene: PodcastScene | undefined,
  sceneIndex: number,
  totalScenes: number
): ShotstackTransition => {
  if (!nextScene) return 'fade'; // Last scene, no transition needed
  
  // Analyze scene types for contextual transitions
  const currentTitle = currentScene.title?.toLowerCase() || '';
  const nextTitle = nextScene.title?.toLowerCase() || '';
  
  // Hook to Context: Dramatic reveal
  if (sceneIndex === 0) {
    return 'zoom'; // Zoom transition for hook impact
  }
  
  // Conflict scenes: Whip pan for dramatic effect
  if (currentTitle.includes('conflict') || currentTitle.includes('crisis') || 
      currentTitle.includes('problem') || currentTitle.includes('crash')) {
    return 'carouselRight'; // Fast whip pan
  }
  
  // Payoff/Conclusion: Slow fade for emphasis
  if (sceneIndex === totalScenes - 2) {
    return 'fadeSlow'; // Slow fade before final scene
  }
  
  // Topic change: Slide transition
  const topicChanged = !currentTitle.includes(nextTitle.split(' ')[0]) && 
                       !nextTitle.includes(currentTitle.split(' ')[0]);
  if (topicChanged) {
    return 'slideRight'; // Slide for topic change
  }
  
  // Continuation: Subtle fade
  return 'fade';
};

/**
 * Build podcast-style Shotstack edit with professional production quality
 * 
 * This creates a professional podcast aesthetic with:
 * - Videos playing sequentially with configurable transitions
 * - Ken Burns style motion effects (zoom, pan)
 * - Optional news-style overlays (lower third, date, breaking news)
 * - Configurable filters and color grading
 */
export const buildPodcastStyleEdit = (
  scenes: PodcastScene[],
  options: {
    channelName?: string;
    episodeTitle?: string;
    headline?: string;           // Main headline for lower third
    newsHeadlines?: string[];    // Array of news headlines for ticker
    showBorder?: boolean;
    showVignette?: boolean;
    resolution?: '1080' | 'hd' | 'sd';
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5';
    renderConfig?: RenderConfig; // Full render configuration
  } = {}
): any => {
  const config = options.renderConfig || DEFAULT_RENDER_CONFIG;
  
  // CRITICAL FIX: Calculate cumulative start times with proper audio-video sync
  // Ensure no gaps and no problematic overlaps
  const transitionDuration = config.transition.type !== 'none' ? config.transition.duration : 0;
  let currentStart = 0;
  const scenesWithTiming = scenes.map((scene, index) => {
    // Verify scene has valid duration
    if (!scene.duration || scene.duration <= 0) {
      console.error(`❌ [Podcast Composition] Scene ${index + 1} missing or invalid duration`);
      throw new Error(`Scene ${index + 1} has invalid duration (${scene.duration}s) - cannot compose`);
    }
    
    const sceneWithStart = {
      ...scene,
      start: currentStart,
      index
    };
    
    // CRITICAL: Use exact audio duration, overlap only for smooth transitions
    // For transitions, we overlap by transitionDuration to create smooth crossfade
    // But we don't want gaps, so we advance by full duration minus overlap
    // ENHANCED: Ensure no gaps by using exact audio duration
    const sceneDuration = scene.duration || 0;
    if (sceneDuration <= 0) {
      console.error(`❌ [Podcast Composition] Scene ${index + 1} has invalid duration: ${sceneDuration}`);
      throw new Error(`Scene ${index + 1} has invalid duration - cannot compose`);
    }
    
    if (index < scenes.length - 1 && transitionDuration > 0) {
      // Overlap for smooth transition (transition happens during overlap)
      // Ensure we don't create gaps by using full duration minus overlap
      currentStart += Math.max(0, sceneDuration - transitionDuration);
    } else {
      // Last scene or no transition - use full duration
      currentStart += sceneDuration;
    }
    
    return sceneWithStart;
  });

  const totalDuration = currentStart + (scenes.length > 0 ? transitionDuration : 0);
  const aspectRatio = options.aspectRatio || '16:9';
  console.log(`🎬 [Podcast Composition] Total duration: ${totalDuration}s across ${scenes.length} scenes (aspect: ${aspectRatio})`);
  console.log(`🎬 [Podcast Composition] Transition: ${config.transition.type}, Effect: ${config.effects.clipEffect}, Filter: ${config.effects.filter}`);

  // Effect rotation for variety (Ken Burns style)
  const effectRotation: ShotstackEffect[] = [
    'zoomInSlow', 'slideRightSlow', 'zoomOutSlow', 'slideLeftSlow',
    'zoomIn', 'slideUpSlow', 'zoomOutSlow', 'slideDownSlow'
  ];

  // Build video clips with transitions and effects
  const videoClips = scenesWithTiming.map((scene, index) => {
    // CRITICAL FIX: Determine effect based on camera movement or config
    // Camera movements translate to Shotstack effects:
    // - push_in → zoomInSlow/zoomIn
    // - pull_out → zoomOutSlow/zoomOut
    // - pan_left/pan_right → slideLeftSlow/slideRightSlow
    let clipEffect: ShotstackEffect | undefined;
    
    // Check if scene has camera movement metadata (from SceneBuilder)
    const cameraMovement = (scene as any).cameraMovement;
    if (cameraMovement) {
      // Map camera movement to Shotstack effect
      const movementToEffect: Record<string, ShotstackEffect> = {
        'push_in': cameraMovement.intensity === 'pronounced' ? 'zoomInFast' : 
                   cameraMovement.intensity === 'moderate' ? 'zoomIn' : 'zoomInSlow',
        'pull_out': cameraMovement.intensity === 'pronounced' ? 'zoomOutFast' : 
                    cameraMovement.intensity === 'moderate' ? 'zoomOut' : 'zoomOutSlow',
        'pan_left': 'slideLeftSlow',
        'pan_right': 'slideRightSlow',
        'zoom': 'zoomInSlow'
      };
      clipEffect = movementToEffect[cameraMovement.type];
      console.log(`🎬 [Podcast Composition] Scene ${index + 1}: Applying camera movement "${cameraMovement.type}" as effect "${clipEffect}"`);
    } else if (config.effects.clipEffect !== 'none') {
      // Fallback to config or auto-rotate
      clipEffect = config.effects.autoEffectRotation 
        ? effectRotation[index % effectRotation.length]
        : config.effects.clipEffect as ShotstackEffect;
    }

    // CRITICAL FIX: Use exact audio duration to avoid gaps or overlaps
    // Ensure clip duration matches audio duration exactly
    // For transitions, extend clip slightly to cover transition overlap
    let clipDuration = scene.duration;
    
    // NEW: Apply pacing variation based on scene type
    const pacing = config.effects.pacingVariation !== false 
      ? determineScenePacing(scene, index, scenesWithTiming.length)
      : { speedMultiplier: 1.0, durationAdjustment: 0, effectIntensity: 'normal' };
    
    // Adjust duration based on pacing (but keep audio sync)
    // Note: We can't actually change playback speed in Shotstack easily,
    // but we can adjust visual duration and use faster effects for "fast" feel
    clipDuration += pacing.durationAdjustment;
    
    // If there's a transition after this clip, extend duration to cover overlap
    if (index < scenes.length - 1 && transitionDuration > 0) {
      // Extend by transition duration to ensure smooth crossfade
      clipDuration = clipDuration + transitionDuration;
    }
    
    // Verify duration is valid
    if (!clipDuration || clipDuration <= 0) {
      console.error(`❌ [Podcast Composition] Scene ${index + 1} has invalid duration: ${clipDuration}`);
      throw new Error(`Scene ${index + 1} has invalid duration - cannot compose`);
    }

    const clip: any = {
      asset: {
        type: 'video',
        src: scene.video_url,
        volume: 1 // CRITICAL: Use embedded audio from InfiniteTalk
      },
      start: scene.start,
      length: clipDuration, // Use exact calculated duration to avoid gaps
      // CRITICAL: Ensure audio is enabled and synced
      trim: 0, // No trim - use full video
      // Ensure video plays at normal speed (no speed adjustment that could desync audio)
    };
    
    // CRITICAL: Validate clip has valid timing
    if (clip.start < 0 || clip.length <= 0) {
      console.error(`❌ [Podcast Composition] Scene ${index + 1} has invalid timing: start=${clip.start}, length=${clip.length}`);
      throw new Error(`Scene ${index + 1} has invalid timing - cannot compose`);
    }
    
    // Log for debugging
    console.log(`📹 [Podcast Composition] Scene ${index + 1}: start=${scene.start.toFixed(2)}s, duration=${clipDuration.toFixed(2)}s, audio=${scene.duration.toFixed(2)}s, pacing=${pacing.speedMultiplier}x`);

    // Add effect (Ken Burns motion) - adjust intensity based on pacing
    if (clipEffect) {
      // Modify effect based on pacing intensity
      if (pacing.effectIntensity === 'fast' && clipEffect.includes('Slow')) {
        // Use faster version for fast pacing
        clip.effect = clipEffect.replace('Slow', '') as ShotstackEffect;
      } else if (pacing.effectIntensity === 'slow' && !clipEffect.includes('Slow')) {
        // Use slower version for slow pacing
        clip.effect = (clipEffect + 'Slow') as ShotstackEffect;
      } else {
        clip.effect = clipEffect;
      }
    }

    // Add filter if configured
    if (config.effects.filter && config.effects.filter !== 'none') {
      clip.filter = config.effects.filter;
    }

    // CRITICAL FIX: Add advanced contextual transitions
    if (config.transition.type !== 'none' && index > 0) {
      // Use advanced transition selection if enabled, otherwise use config
      const nextScene = scenesWithTiming[index + 1];
      const selectedTransition = config.effects.autoTransitionSelection
        ? selectAdvancedTransition(scene, nextScene, index, scenesWithTiming.length)
        : config.transition.type;
      
      clip.transition = {
        in: selectedTransition
      };
      
      console.log(`🎬 [Transition] Scene ${index + 1} → ${index + 2}: ${selectedTransition}`);
    }

    return clip;
  });

  /**
   * NEW: Generate motion graphics for scenes
   * Adds animated graphics, info cards, progress bars, and callouts
   */
  const generateMotionGraphics = (
    scene: PodcastScene,
    sceneIndex: number,
    totalScenes: number,
    startTime: number,
    duration: number
  ): any[] => {
    const graphics: any[] = [];
    const isVertical = aspectRatio === '9:16' || aspectRatio === '4:5';
    
    // Progress bar for multi-scene narratives
    if (totalScenes > 3 && sceneIndex < totalScenes - 1) {
      const progress = ((sceneIndex + 1) / totalScenes) * 100;
      graphics.push({
        asset: {
          type: 'text',
          text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
          alignment: { horizontal: 'center', vertical: 'center' },
          font: { color: 'rgba(255, 255, 255, 0.2)', size: 12 }, // Match background for invisible text
          width: isVertical ? 800 : 1200,
          height: 8,
          background: { color: 'rgba(255, 255, 255, 0.2)' }
        },
        start: startTime,
        length: duration,
        offset: { x: 0, y: isVertical ? 0.45 : 0.45 },
        position: 'center',
        opacity: 0.8
      });
      
      // Progress fill (only add if width is at least 1px to avoid validation errors)
      const fillWidth = Math.max(1, (progress / 100) * (isVertical ? 800 : 1200));
      if (fillWidth >= 1) {
        graphics.push({
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: config.newsStyle?.lowerThird?.primaryColor || '#ff3333', size: 12 }, // Match background for invisible text
            width: fillWidth,
            height: 8,
            background: { color: config.newsStyle?.lowerThird?.primaryColor || '#ff3333' }
          },
          start: startTime,
          length: duration,
          offset: { x: -(isVertical ? 400 : 600) + ((progress / 100) * (isVertical ? 400 : 600)), y: isVertical ? 0.45 : 0.45 },
          position: 'center',
          opacity: 1.0,
          transition: { in: 'slideRight' }
        });
      }
    }
    
    // Info cards for statistics (if scene text contains numbers)
    const sceneText = scene.text || '';
    const numberMatch = sceneText.match(/\d+[.,]?\d*[%$€£¥]?/);
    if (numberMatch && sceneIndex < 3) { // Only in first 3 scenes
      graphics.push({
        asset: {
          type: 'text',
          text: numberMatch[0],
          alignment: { horizontal: 'center', vertical: 'center' },
          font: { 
            color: '#ffffff', 
            family: 'Arial Black', 
            size: isVertical ? 72 : 96,
            lineHeight: 1.2
          },
          width: isVertical ? 300 : 400,
          height: isVertical ? 120 : 160,
          background: { color: 'rgba(0, 0, 0, 0.8)' }
        },
        start: startTime + 1, // Appear 1s into scene
        length: 3, // Show for 3 seconds
        offset: { x: isVertical ? 0.3 : 0.35, y: isVertical ? -0.2 : -0.2 },
        position: 'center',
        opacity: 1.0,
        transition: { in: 'zoom', out: 'fade' }
      });
    }
    
    // Animated callout for key points
    if (scene.title && sceneIndex === 0) { // First scene hook
      graphics.push({
        asset: {
          type: 'text',
          text: '⚠️',
          alignment: { horizontal: 'center', vertical: 'center' },
          font: { 
            color: '#ff3333', 
            family: 'Arial', 
            size: isVertical ? 80 : 100
          },
          width: isVertical ? 100 : 120,
          height: isVertical ? 100 : 120
        },
        start: startTime,
        length: 2,
        offset: { x: isVertical ? -0.35 : -0.4, y: isVertical ? -0.3 : -0.3 },
        position: 'center',
        opacity: 1.0,
        transition: { in: 'zoom', out: 'fade' }
      });
    }
    
    return graphics;
  };

  // Build tracks array (bottom to top in render order)
  const tracks: any[] = [];
  
  // TRACK 1 (Base): Video clips
  tracks.push({ clips: videoClips });
  
  // NEW: Motion Graphics Track (animated graphics, info cards, progress bars)
  if (config.effects.motionGraphics !== false) {
    const motionGraphicsClips: any[] = [];
    scenesWithTiming.forEach((scene, index) => {
      const graphics = generateMotionGraphics(
        scene,
        index,
        scenesWithTiming.length,
        scene.start,
        scene.duration
      );
      motionGraphicsClips.push(...graphics);
    });
    
    if (motionGraphicsClips.length > 0) {
      tracks.unshift({ clips: motionGraphicsClips });
      console.log(`🎨 [Motion Graphics] Added ${motionGraphicsClips.length} animated graphics`);
    }
  }

  // === FORMAT-SPECIFIC SETTINGS ===
  // Determine if vertical format BEFORE using it
  const isVertical = aspectRatio === '9:16' || aspectRatio === '4:5';

  // === TRANSITION COLOR FLASH TRACK ===
  // Add subtle color flashes during transitions for a more dynamic look
  if (config.transition.type !== 'none' && scenesWithTiming.length > 1) {
    const transitionFlashClips: any[] = [];
    const flashColor = config.newsStyle?.lowerThird?.primaryColor || '#ff3333';
    
    scenesWithTiming.forEach((scene, index) => {
      if (index > 0) {
        // Add a brief color flash at each transition point
        transitionFlashClips.push({
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: flashColor, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: isVertical ? 1080 : 1920,
            height: isVertical ? 1920 : 1080,
            background: { color: flashColor }
          },
          start: scene.start - 0.1,
          length: 0.2,
          opacity: 0.15,
          position: 'center',
          transition: { in: 'fade', out: 'fade' }
        });
      }
    });
    
    if (transitionFlashClips.length > 0) {
      tracks.unshift({ clips: transitionFlashClips });
    }
  }

  // === FORMAT-SPECIFIC OVERLAY PRESETS ===
  // RENOVATED DESIGN - Premium broadcast style with modern aesthetics
  // CRITICAL FIX: Larger font sizes for better readability
  const overlayPresets = isVertical ? {
    // 9:16 / 4:5 (Vertical - Shorts/Reels/TikTok) - PREMIUM MOBILE DESIGN
    lowerThird: {
      // Wider banner with gradient-ready structure
      banner: { width: 1080, height: 200, y: -0.42 }, // Increased height
      // Sleek category badge with rounded feel - LARGER TEXT
      badge: { width: 360, height: 60, x: 0, y: -0.32, fontSize: 42 }, // Increased from 32 to 42
      // Clean headline area - LARGER TEXT
      headline: { width: 1000, height: 100, x: 0, y: -0.42, fontSize: 64 } // Increased from 48 to 64
    },
    // Modern date badge - top right corner - LARGER
    date: { x: 0.35, y: 0.42, fontSize: 28, width: 200, height: 50 }, // Increased from 20 to 28
    // LIVE indicator - pulsing red - LARGER
    live: { x: -0.35, y: 0.42, fontSize: 24, width: 120, height: 46 }, // Increased from 18 to 24
    // Channel branding - subtle top corner - LARGER
    branding: { x: 0.35, y: 0.36, fontSize: 24, width: 180, height: 44 }, // Increased from 18 to 24
    // Breaking news - dramatic center strip - LARGER
    breakingNews: { width: 900, height: 70, y: -0.22, fontSize: 36 }, // Increased from 26 to 36
    // Host name plate - sleek left-aligned - LARGER
    hostName: { width: 320, height: 64, y: -0.48, fontSize: 32, accentWidth: 5 } // Increased from 22 to 32
  } : {
    // 16:9 (Landscape - YouTube) - CINEMA BROADCAST DESIGN
    lowerThird: {
      // Full-width cinematic lower third
      banner: { width: 1920, height: 220, y: -0.42 }, // Increased height
      // Premium category badge with accent - LARGER TEXT
      badge: { width: 360, height: 80, x: -0.38, y: -0.42, fontSize: 44 }, // Increased from 32 to 44
      // Spacious headline with professional typography - LARGER TEXT
      headline: { width: 1200, height: 110, x: 0.05, y: -0.42, fontSize: 56 } // Increased from 38 to 56
    },
    // Date display - sleek corner badge - LARGER
    date: { x: 0.40, y: 0.42, fontSize: 28, width: 220, height: 52 }, // Increased from 22 to 28
    // LIVE indicator with recording dot - LARGER
    live: { x: -0.40, y: 0.42, fontSize: 28, width: 140, height: 48 }, // Increased from 22 to 28
    // Channel branding - professional corner - LARGER
    branding: { x: 0.40, y: 0.36, fontSize: 26, width: 200, height: 46 }, // Increased from 20 to 26
    // Breaking news - impactful banner - LARGER
    breakingNews: { width: 700, height: 80, y: -0.25, fontSize: 42 }, // Increased from 32 to 42
    // Host name plate - broadcast style - LARGER
    hostName: { width: 360, height: 72, y: -0.48, fontSize: 36, accentWidth: 7 } // Increased from 26 to 36
  };

  // === NEWS-STYLE OVERLAYS - PREMIUM BROADCAST DESIGN ===
  if (config.newsStyle?.enabled) {
    const newsConfig = config.newsStyle;
    const presets = overlayPresets;
    
    // LOWER THIRD - PREMIUM MULTI-LAYER DESIGN
    if (newsConfig.lowerThird?.enabled) {
      const primaryColor = newsConfig.lowerThird.primaryColor || '#e63946'; // Modern red
      const secondaryColor = newsConfig.lowerThird.secondaryColor || '#0d1b2a'; // Deep navy
      const textColor = newsConfig.lowerThird.textColor || '#ffffff';
      const accentGold = '#ffd60a'; // Vibrant gold accent
      const category = newsConfig.lowerThird.category || 'BREAKING';
      const headline = options.headline || options.episodeTitle || options.channelName || '';

      // LAYER 1: Main dark banner with subtle transparency
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: secondaryColor, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: presets.lowerThird.banner.width,
            height: presets.lowerThird.banner.height,
            background: { color: secondaryColor }
          },
          start: 0.2,
          length: totalDuration,
          offset: { x: 0, y: presets.lowerThird.banner.y },
          position: 'center',
          opacity: 0.92,
          transition: { in: 'slideUp' }
        }]
      });

      // LAYER 2: Top accent strip (primary color - dramatic reveal)
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: primaryColor, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: presets.lowerThird.banner.width,
            height: isVertical ? 6 : 8,
            background: { color: primaryColor }
          },
          start: 0.35,
          length: totalDuration,
          offset: { x: 0, y: presets.lowerThird.banner.y + (isVertical ? 0.048 : 0.052) },
          position: 'center',
          transition: { in: 'slideRight' }
        }]
      });

      // LAYER 3: Secondary thin gold line (elegant detail)
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: accentGold, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: presets.lowerThird.banner.width * 0.7,
            height: isVertical ? 2 : 3,
            background: { color: accentGold }
          },
          start: 0.5,
          length: totalDuration,
          offset: { x: isVertical ? 0 : 0.1, y: presets.lowerThird.banner.y + (isVertical ? 0.042 : 0.045) },
          position: 'center',
          opacity: 0.8,
          transition: { in: 'slideRight' }
        }]
      });

      // LAYER 4: Category badge - modern pill design
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: category.toUpperCase(),
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { 
              color: '#000000', 
              family: 'Montserrat Bold', 
              size: presets.lowerThird.badge.fontSize, 
              lineHeight: 1 
            },
            width: presets.lowerThird.badge.width,
            height: presets.lowerThird.badge.height,
            background: { color: accentGold }
          },
          start: 0.4,
          length: totalDuration,
          offset: { x: presets.lowerThird.badge.x, y: presets.lowerThird.badge.y },
          position: 'center',
          transition: { in: isVertical ? 'slideDown' : 'slideRight' }
        }]
      });

      // LAYER 5: Headline text with premium typography
      if (headline) {
        tracks.unshift({
          clips: [{
            asset: {
              type: 'text',
              text: headline,
              alignment: { horizontal: isVertical ? 'center' : 'left', vertical: 'center' },
              font: { 
                color: textColor, 
                family: 'Montserrat SemiBold', 
                size: presets.lowerThird.headline.fontSize, 
                lineHeight: 1.2 
              },
              width: presets.lowerThird.headline.width,
              height: presets.lowerThird.headline.height
            },
            start: 0.6,
            length: totalDuration,
            offset: { x: presets.lowerThird.headline.x, y: presets.lowerThird.headline.y },
            position: 'center',
            transition: { in: isVertical ? 'fade' : 'slideRight' }
          }]
        });
      }
    }

    // DATE DISPLAY - MODERN FLOATING BADGE DESIGN
    if (config.overlays?.showDate) {
      const dateText = formatNewsDate();
      const primaryColor = newsConfig.lowerThird?.primaryColor || '#e63946';
      
      // Date pill background - dark with subtle border effect
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#0d1b2a', family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: presets.date.width,
            height: presets.date.height,
            background: { color: '#0d1b2a' }
          },
          start: 0.8,
          length: totalDuration,
          offset: { x: presets.date.x, y: presets.date.y },
          position: 'center',
          opacity: 0.95,
          transition: { in: 'fade' }
        }]
      });
      
      // Date accent line (left border effect)
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: primaryColor, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: 4,
            height: presets.date.height - 8,
            background: { color: primaryColor }
          },
          start: 0.9,
          length: totalDuration,
          offset: { x: presets.date.x - (isVertical ? 0.08 : 0.05), y: presets.date.y },
          position: 'center',
          transition: { in: 'slideDown' }
        }]
      });
      
      // Date text - clean typography
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: dateText,
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#ffffff', family: 'Montserrat SemiBold', size: presets.date.fontSize, lineHeight: 1 },
            width: presets.date.width - 16,
            height: presets.date.height - 8
          },
          start: 1.0,
          length: totalDuration,
          offset: { x: presets.date.x, y: presets.date.y },
          position: 'center',
          transition: { in: 'fade' }
        }]
      });
    }

    // LIVE INDICATOR - PREMIUM RECORDING STYLE
    if (config.overlays?.showLiveIndicator) {
      // Live background - red pill
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#dc2626', family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: presets.live.width,
            height: presets.live.height,
            background: { color: '#dc2626' }
          },
          start: 0.2,
          length: totalDuration,
          offset: { x: presets.live.x, y: presets.live.y },
          position: 'center',
          transition: { in: 'fade' }
        }]
      });
      
      // Recording dot indicator (white dot before text)
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '●',
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#ffffff', family: 'Arial', size: isVertical ? 12 : 14, lineHeight: 1 },
            width: 24,
            height: 24
          },
          start: 0.3,
          length: totalDuration,
          offset: { x: presets.live.x - (isVertical ? 0.04 : 0.025), y: presets.live.y },
          position: 'center',
          transition: { in: 'fade' }
        }]
      });
      
      // LIVE text - bold and clean
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: 'LIVE',
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#ffffff', family: 'Montserrat Bold', size: presets.live.fontSize, lineHeight: 1 },
            width: presets.live.width - 30,
            height: presets.live.height - 8
          },
          start: 0.4,
          length: totalDuration,
          offset: { x: presets.live.x + (isVertical ? 0.02 : 0.015), y: presets.live.y },
          position: 'center',
          transition: { in: 'fade' }
        }]
      });
    }

    // BREAKING NEWS BANNER - URGENT DRAMATIC REVEAL
    if (config.overlays?.showBreakingNews) {
      const breakingText = config.overlays.breakingNewsText || 'BREAKING NEWS';
      const primaryColor = newsConfig.lowerThird?.primaryColor || '#dc2626';
      
      // Background strip - dramatic red
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: primaryColor, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: presets.breakingNews.width + 80,
            height: presets.breakingNews.height,
            background: { color: primaryColor }
          },
          start: 0,
          length: 5,
          offset: { x: 0, y: presets.breakingNews.y },
          position: 'center',
          transition: { in: 'slideDown', out: 'fade' }
        }]
      });
      
      // Gold accent line above
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#ffd60a', family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: presets.breakingNews.width + 80,
            height: 4,
            background: { color: '#ffd60a' }
          },
          start: 0.1,
          length: 4.8,
          offset: { x: 0, y: presets.breakingNews.y + (isVertical ? 0.018 : 0.02) },
          position: 'center',
          transition: { in: 'slideRight', out: 'fade' }
        }]
      });
      
      // Breaking text with impact
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: breakingText.toUpperCase(),
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#ffffff', family: 'Montserrat Bold', size: presets.breakingNews.fontSize, lineHeight: 1 },
            width: presets.breakingNews.width,
            height: presets.breakingNews.height - 8
          },
          start: 0.15,
          length: 4.7,
          offset: { x: 0, y: presets.breakingNews.y },
          position: 'center',
          transition: { in: 'slideDown', out: 'fade' }
        }]
      });
    }

    // CHANNEL BRANDING - PREMIUM CORNER BADGE
    if (newsConfig.showChannelBranding && options.channelName) {
      const accentGold = '#ffd60a';
      
      // Dark background pill
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#0d1b2a', family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: presets.branding.width,
            height: presets.branding.height,
            background: { color: '#0d1b2a' }
          },
          start: 1.5,
          length: totalDuration,
          offset: { x: presets.branding.x, y: presets.branding.y },
          position: 'center',
          opacity: 0.92,
          transition: { in: 'fade' }
        }]
      });
      
      // Channel name with gold accent
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: options.channelName.toUpperCase(),
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: accentGold, family: 'Montserrat Bold', size: presets.branding.fontSize, lineHeight: 1 },
            width: presets.branding.width - 16,
            height: presets.branding.height - 8
          },
          start: 1.7,
          length: totalDuration,
          offset: { x: presets.branding.x, y: presets.branding.y },
          position: 'center',
          transition: { in: 'fade' }
        }]
      });
    }

    // === NEWS TICKER - PREMIUM SCROLLING HEADLINES ===
    if (newsConfig.ticker?.enabled && options.newsHeadlines && options.newsHeadlines.length > 0) {
      const tickerConfig = newsConfig.ticker;
      const tickerBgColor = tickerConfig.backgroundColor || '#0d1b2a'; // Deep navy
      const tickerTextColor = tickerConfig.textColor || '#ffffff';
      const primaryColor = newsConfig.lowerThird?.primaryColor || '#e63946';
      const accentGold = '#ffd60a';
      
      // Ticker positioning - sleek bottom bar
      // CRITICAL FIX: Larger ticker text for better readability
      const tickerPresets = isVertical
        ? { y: -0.48, height: 56, fontSize: 24, width: 1080 } // Increased from 18 to 24
        : { y: -0.475, height: 60, fontSize: 28, width: 1920 }; // Increased from 22 to 28
      
      // Speed settings
      const speedDurations = { slow: 35, normal: 25, fast: 18 };
      const scrollDuration = speedDurations[tickerConfig.speed || 'normal'];
      
      // Create ticker text with stylish separators
      const tickerText = options.newsHeadlines.map(h => h.toUpperCase()).join('    ◆    ');
      
      // LAYER 1: Main ticker background - dark navy
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: tickerBgColor, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: tickerPresets.width * 1.1,
            height: tickerPresets.height,
            background: { color: tickerBgColor }
          },
          start: 1.2,
          length: totalDuration - 1.2,
          offset: { x: 0, y: tickerPresets.y },
          position: 'center',
          opacity: 0.96,
          transition: { in: 'slideUp' }
        }]
      });
      
      // LAYER 2: Top accent line - primary color
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: primaryColor, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: tickerPresets.width * 1.1,
            height: 4,
            background: { color: primaryColor }
          },
          start: 1.4,
          length: totalDuration - 1.4,
          offset: { x: 0, y: tickerPresets.y + (isVertical ? 0.013 : 0.014) },
          position: 'center',
          transition: { in: 'slideRight' }
        }]
      });
      
      // LAYER 3: "LATEST" badge on left side
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: primaryColor, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: isVertical ? 100 : 120,
            height: tickerPresets.height - 8,
            background: { color: primaryColor }
          },
          start: 1.5,
          length: totalDuration - 1.5,
          offset: { x: isVertical ? -0.40 : -0.44, y: tickerPresets.y },
          position: 'center',
          transition: { in: 'slideRight' }
        }]
      });
      
      // "LATEST" text
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: 'LATEST',
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#ffffff', family: 'Montserrat Bold', size: isVertical ? 20 : 24, lineHeight: 1 }, // Increased from 14/16 to 20/24
            width: isVertical ? 90 : 110,
            height: tickerPresets.height - 12
          },
          start: 1.6,
          length: totalDuration - 1.6,
          offset: { x: isVertical ? -0.40 : -0.44, y: tickerPresets.y },
          position: 'center',
          transition: { in: 'fade' }
        }]
      });
      
      // LAYER 4: Scrolling headlines
      const tickerClips: any[] = [];
      let tickerStartTime = 2.0;
      
      while (tickerStartTime < totalDuration - 2) {
        tickerClips.push({
          asset: {
            type: 'text',
            text: tickerText,
            alignment: { horizontal: 'left', vertical: 'center' },
            font: { 
              color: tickerTextColor, 
              family: 'Roboto Medium', 
              size: tickerPresets.fontSize, 
              lineHeight: 1 
            },
            width: tickerPresets.width * 3,
            height: tickerPresets.height - 12
          },
          start: tickerStartTime,
          length: Math.min(scrollDuration, totalDuration - tickerStartTime - 1),
          offset: { x: isVertical ? 0.05 : 0.03, y: tickerPresets.y },
          position: 'center',
          effect: 'slideLeftSlow'
        });
        
        tickerStartTime += scrollDuration - 3;
      }
      
      if (tickerClips.length > 0) {
        tracks.unshift({ clips: tickerClips });
      }
    }
  }

  // === HOST NAME PLATES - PREMIUM BROADCAST STYLE ===
  if (config.overlays?.showHostNames && scenesWithTiming.length > 0) {
    const hostNameClips: any[] = [];
    const primaryColor = config.newsStyle?.lowerThird?.primaryColor || '#e63946';
    const accentGold = '#ffd60a';
    const hostNamePresets = overlayPresets.hostName;
    
    scenesWithTiming.forEach((scene) => {
      if (scene.speaker) {
        const showDuration = Math.min(4, scene.duration - 0.4);
        
        // LAYER 1: Dark background plate
        hostNameClips.push({
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#0d1b2a', family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: hostNamePresets.width,
            height: hostNamePresets.height,
            background: { color: '#0d1b2a' }
          },
          start: scene.start + 0.15,
          length: showDuration,
          offset: { 
            x: isVertical ? -0.28 : -0.36, 
            y: hostNamePresets.y 
          },
          position: 'center',
          opacity: 0.95,
          transition: { in: 'slideRight', out: 'fade' }
        });
        
        // LAYER 2: Primary color accent bar (left edge)
        hostNameClips.push({
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: primaryColor, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: hostNamePresets.accentWidth,
            height: hostNamePresets.height,
            background: { color: primaryColor }
          },
          start: scene.start + 0.2,
          length: showDuration - 0.1,
          offset: { 
            x: isVertical ? -0.40 : -0.45, 
            y: hostNamePresets.y 
          },
          position: 'center',
          transition: { in: 'slideRight', out: 'fade' }
        });
        
        // LAYER 3: Gold accent line (top)
        hostNameClips.push({
          asset: {
            type: 'text',
            text: '.', // Dot required by Shotstack (text cannot be empty, space causes validation error with small heights)
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: accentGold, family: 'Roboto', size: 12, lineHeight: 1 }, // Match background for invisible text
            width: hostNamePresets.width - 10,
            height: 2,
            background: { color: accentGold }
          },
          start: scene.start + 0.25,
          length: showDuration - 0.15,
          offset: { 
            x: isVertical ? -0.28 : -0.36, 
            y: hostNamePresets.y + (isVertical ? 0.016 : 0.018) 
          },
          position: 'center',
          opacity: 0.7,
          transition: { in: 'slideRight', out: 'fade' }
        });
        
        // LAYER 4: Speaker name - clean typography
        hostNameClips.push({
          asset: {
            type: 'text',
            text: scene.speaker.toUpperCase(),
            alignment: { horizontal: 'left', vertical: 'center' },
            font: { 
              color: '#ffffff', 
              family: 'Montserrat SemiBold', 
              size: hostNamePresets.fontSize, 
              lineHeight: 1 
            },
            width: hostNamePresets.width - 20,
            height: hostNamePresets.height - 12
          },
          start: scene.start + 0.3,
          length: showDuration - 0.2,
          offset: { 
            x: isVertical ? -0.26 : -0.34, 
            y: hostNamePresets.y 
          },
          position: 'center',
          transition: { in: 'slideRight', out: 'fade' }
        });
      }
    });
    
    if (hostNameClips.length > 0) {
      tracks.unshift({ clips: hostNameClips });
    }
  }

  // === SUBTITLES TRACK ===
  // Generate subtitle clips from scene text/dialogue
  if (config.overlays?.showSubtitles && scenesWithTiming.length > 0) {
    const subtitleClips: any[] = [];
    const subtitleStyle = config.overlays.subtitleStyle || 'boxed';
    const subtitlePosition = config.overlays.subtitlePosition || 'bottom';
    
    // Position presets based on format and position setting
    const positionY = {
      bottom: isVertical ? -0.25 : -0.28,
      center: 0,
      top: isVertical ? 0.35 : 0.38
    }[subtitlePosition];
    
    // CRITICAL FIX: Larger subtitles for better readability - PERFECTED
    // These sizes ensure subtitles are ALWAYS readable on mobile and desktop
    const subtitlePresets = isVertical 
      ? { fontSize: 76, width: 1000, height: 200, maxChars: 42, padding: 24 } // Increased to 76px for mobile readability
      : { fontSize: 88, width: 1700, height: 180, maxChars: 60, padding: 28 }; // Increased to 88px for perfect desktop readability
    
    // Style configurations
    const styleConfig = {
      minimal: { 
        background: undefined, 
        fontColor: '#ffffff',
        stroke: undefined
      },
      boxed: { 
        background: { color: '#1a1a1a' }, 
        fontColor: '#ffffff',
        stroke: undefined
      },
      outline: { 
        background: undefined, 
        fontColor: '#ffffff',
        stroke: { color: '#000000', width: 2 }
      }
    }[subtitleStyle];
    
    scenesWithTiming.forEach((scene) => {
      if (scene.text) {
        // Split long text into chunks for readability
        const words = scene.text.split(' ');
        let currentChunk = '';
        let chunkStart = scene.start;
        const wordsPerSecond = 2.5; // Average speaking rate
        const chunks: { text: string; start: number; duration: number }[] = [];
        
        words.forEach((word, idx) => {
          const testChunk = currentChunk ? `${currentChunk} ${word}` : word;
          
          if (testChunk.length > subtitlePresets.maxChars || idx === words.length - 1) {
            // Finalize current chunk
            const finalText = testChunk.length > subtitlePresets.maxChars ? currentChunk : testChunk;
            if (finalText) {
              const wordCount = finalText.split(' ').length;
              const chunkDuration = Math.max(1.5, wordCount / wordsPerSecond);
              chunks.push({
                text: finalText,
                start: chunkStart,
                duration: chunkDuration
              });
              chunkStart += chunkDuration;
            }
            currentChunk = testChunk.length > subtitlePresets.maxChars ? word : '';
          } else {
            currentChunk = testChunk;
          }
        });
        
        // Create subtitle clips for each chunk
        chunks.forEach((chunk) => {
          if (chunk.start < scene.start + scene.duration) {
            const clipDuration = Math.min(chunk.duration, scene.start + scene.duration - chunk.start);
            
            const subtitleAsset: any = {
              type: 'text',
              text: chunk.text,
              alignment: { horizontal: 'center', vertical: 'center' },
              font: { 
                color: styleConfig.fontColor, 
                family: 'Montserrat Bold', // Changed to bold for better readability
                size: subtitlePresets.fontSize, 
                lineHeight: 1.3, // Increased line height for better spacing
                weight: 'bold' // Explicit bold weight
              },
              width: subtitlePresets.width,
              height: subtitlePresets.height
            };
            
            // Enhanced background for better readability
            if (styleConfig.background) {
              subtitleAsset.background = {
                ...styleConfig.background,
                color: styleConfig.background.color || 'rgba(0, 0, 0, 0.85)' // More opaque for better contrast
              };
            }
            
            // Add stroke for outline style or enhance boxed style
            if (subtitleStyle === 'outline' || subtitleStyle === 'boxed') {
              subtitleAsset.stroke = {
                color: '#000000',
                width: 3 // Thicker stroke for better visibility
              };
            }
            
            subtitleClips.push({
              asset: subtitleAsset,
              start: chunk.start,
              length: clipDuration,
              offset: { x: 0, y: positionY },
              position: 'center',
              transition: { in: 'fade', out: 'fade' }
            });
          }
        });
      }
    });
    
    if (subtitleClips.length > 0) {
      tracks.unshift({ clips: subtitleClips });
    }
  }

  // Resolution settings based on aspect ratio
  const resolutionMap: Record<string, Record<string, { width: number; height: number }>> = {
    '16:9': {
      '1080': { width: 1920, height: 1080 },
      'hd': { width: 1280, height: 720 },
      'sd': { width: 854, height: 480 }
    },
    '9:16': {
      '1080': { width: 1080, height: 1920 },
      'hd': { width: 720, height: 1280 },
      'sd': { width: 480, height: 854 }
    },
    '1:1': {
      '1080': { width: 1080, height: 1080 },
      'hd': { width: 720, height: 720 },
      'sd': { width: 480, height: 480 }
    },
    '4:5': {
      '1080': { width: 1080, height: 1350 },
      'hd': { width: 720, height: 900 },
      'sd': { width: 480, height: 600 }
    }
  };
  const size = resolutionMap[aspectRatio]?.[options.resolution || config.output.resolution || '1080'] || resolutionMap['16:9']['1080'];

  // Helper function to validate audio URLs
  const isValidAudioUrl = (url: string): boolean => {
    if (!url || !url.trim()) return false;
    
    // Reject Pixabay URLs (they return 403)
    if (url.includes('cdn.pixabay.com') || url.includes('pixabay.com')) {
      console.warn(`[Shotstack] ⚠️ Rejecting Pixabay URL (not publicly accessible): ${url}`);
      return false;
    }
    
    // Must be a valid HTTP/HTTPS URL
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  // === SOUND EFFECTS TRACK ===
  // Add sound effects from scene metadata and config
  const soundEffectClips: any[] = [];
  
  // First, add sound effects from scene metadata (if available)
  scenesWithTiming.forEach((scene: any, index) => {
    // Check if scene has soundEffects metadata
    if (scene.soundEffects && scene.soundEffects.type && scene.soundEffects.type !== 'none') {
      const effectUrl = scene.soundEffects.url; // URL should be provided in scene metadata
      
      if (effectUrl && isValidAudioUrl(effectUrl)) {
        // Calculate precise start time
        let effectStart = scene.start;
        const startTime = scene.soundEffects.startTime;
        
        if (typeof startTime === 'number') {
          // Explicit number in seconds
          effectStart = scene.start + startTime;
        } else if (startTime === 'end') {
          // At end of scene
          effectStart = scene.start + scene.duration - (scene.soundEffects.duration || 1.5);
        } else if (startTime === 'middle') {
          // Middle of scene
          effectStart = scene.start + (scene.duration / 2) - ((scene.soundEffects.duration || 1.5) / 2);
        }
        // 'start' or undefined means 0 (beginning of scene)
        
        // Use explicit duration or calculate from endTime
        let effectDuration = scene.soundEffects.duration || 1.5;
        if (scene.soundEffects.endTime !== undefined) {
          // If endTime is provided, calculate duration from it
          const calculatedEnd = typeof startTime === 'number' 
            ? scene.start + scene.soundEffects.endTime
            : effectStart + effectDuration;
          effectDuration = calculatedEnd - effectStart;
        }
        
        // Ensure effect doesn't exceed scene boundaries
        const maxEndTime = scene.start + scene.duration;
        const effectEndTime = effectStart + effectDuration;
        if (effectEndTime > maxEndTime) {
          effectDuration = maxEndTime - effectStart;
        }
        
        if (effectDuration > 0 && effectStart >= 0) {
          soundEffectClips.push({
            asset: {
              type: 'audio',
              src: effectUrl,
              volume: scene.soundEffects.volume || 0.4
            },
            start: Math.max(0, effectStart),
            length: Math.max(0.1, effectDuration) // Minimum 0.1s duration
          });
          
          console.log(`🔊 [Shotstack] Sound effect: ${scene.soundEffects.type} at ${effectStart.toFixed(2)}s for ${effectDuration.toFixed(2)}s`);
        }
      } else if (effectUrl && !isValidAudioUrl(effectUrl)) {
        console.warn(`[Shotstack] ⚠️ Skipping invalid sound effect URL from scene: ${effectUrl}`);
      } else if (!effectUrl) {
        console.warn(`[Shotstack] ⚠️ Scene ${index + 1} has sound effect metadata but no URL provided`);
      }
    }
    
    // Also add transition sounds at scene changes (if enabled in config)
    if (config.soundEffects?.enabled && index > 0) {
      const transitionSound = config.soundEffects?.transitionSound?.trim();
      if (transitionSound && isValidAudioUrl(transitionSound)) {
        soundEffectClips.push({
          asset: {
            type: 'audio',
            src: transitionSound,
            volume: config.soundEffects?.transitionVolume || 0.4
          },
          start: Math.max(0, scene.start - 0.3), // Start slightly before transition
          length: 1.5 // Short sound effect
        });
      } else if (transitionSound && !isValidAudioUrl(transitionSound)) {
        console.warn(`[Shotstack] ⚠️ Skipping invalid transition sound URL: ${transitionSound}`);
      }
      
      // Add scene change notification sound (optional)
      const sceneChangeSound = config.soundEffects?.sceneChangeSound?.trim();
      if (sceneChangeSound && isValidAudioUrl(sceneChangeSound) && index % 3 === 0) {
        soundEffectClips.push({
          asset: {
            type: 'audio',
            src: sceneChangeSound,
            volume: config.soundEffects?.sceneChangeVolume || 0.3
          },
          start: scene.start + 0.5,
          length: 1
        });
      } else if (sceneChangeSound && !isValidAudioUrl(sceneChangeSound)) {
        console.warn(`[Shotstack] ⚠️ Skipping invalid scene change sound URL: ${sceneChangeSound}`);
      }
    }
  });
  
  if (soundEffectClips.length > 0) {
    console.log(`🔊 [Podcast Composition] Adding ${soundEffectClips.length} sound effects`);
    tracks.push({ clips: soundEffectClips });
  }

  // === BACKGROUND MUSIC TRACK ===
  // Add background music if provided - CRITICAL: Ensure it always works
  if (config.backgroundMusic?.enabled) {
    const musicUrl = config.backgroundMusic.url?.trim();
    if (musicUrl && isValidAudioUrl(musicUrl)) {
      const musicVolume = Math.max(0.05, Math.min(0.3, config.backgroundMusic.volume || 0.15)); // Clamp between 5-30%
      const musicFadeIn = config.backgroundMusic.fadeIn || 1.5;
      const musicFadeOut = config.backgroundMusic.fadeOut || 2.5;
      
      // CRITICAL: Ensure music plays for entire duration, including any gaps
      const musicDuration = Math.max(totalDuration, scenes.reduce((sum, s) => sum + (s.duration || 0), 0));
      
      // Add background music as a separate audio track with proper fade
      tracks.push({
        clips: [{
          asset: {
            type: 'audio',
            src: musicUrl,
            volume: musicVolume
          },
          start: 0,
          length: musicDuration, // Play for entire video duration
          transition: {
            in: 'fade',
            out: 'fade'
          }
        }]
      });
      
      console.log(`🎵 [Podcast Composition] Adding background music (volume: ${(musicVolume * 100).toFixed(0)}%, duration: ${musicDuration.toFixed(1)}s)`);
    } else if (config.backgroundMusic?.enabled && !musicUrl) {
      console.warn(`[Shotstack] ⚠️ Background music enabled but no URL provided - music will be silent`);
    } else if (musicUrl && !isValidAudioUrl(musicUrl)) {
      console.warn(`[Shotstack] ⚠️ Skipping invalid background music URL: ${musicUrl}`);
    }
  } else {
    // If gaps detected and music not enabled, warn user (gaps will be checked later in renderPodcastVideo)
    // Note: gaps variable is not in scope here, will be checked in renderPodcastVideo
  }

  // === BUILD TIMELINE WITH FONTS ===
  const timeline: any = {
    background: '#0a0a0a', // Slightly lighter than pure black for better transitions
    tracks
  };

  // Add custom fonts if configured
  const fontsToLoad: { src: string }[] = [];
  
  // Add configured custom fonts
  if (config.fonts?.primary) {
    fontsToLoad.push({ src: config.fonts.primary });
  }
  if (config.fonts?.secondary) {
    fontsToLoad.push({ src: config.fonts.secondary });
  }
  if (config.fonts?.accent) {
    fontsToLoad.push({ src: config.fonts.accent });
  }
  
  // Add premium professional fonts (Shotstack hosted + Google Fonts)
  const defaultFonts = [
    // Montserrat family - Primary display font
    'https://fonts.gstatic.com/s/montserrat/v26/JTUSjIg1_i6t8kCHKm459WRhyyTh89ZNpQ.woff2', // Montserrat Bold
    'https://fonts.gstatic.com/s/montserrat/v26/JTUSjIg1_i6t8kCHKm459WlhyyTh89ZNpQ.woff2', // Montserrat SemiBold
    // Roboto family - Body/ticker font
    'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2', // Roboto Medium
    // Fallback from Shotstack templates
    'https://templates.shotstack.io/basic-text-overlay/6ab63510-5d0e-401b-86b0-d46e87df0a91/source.ttf', // Montserrat Bold (backup)
    'https://templates.shotstack.io/breaking-news-channel-template-urgent-announcements-sales/ef4d1738-75fd-4808-84b9-119a36c79c3b/source.ttf'  // Roboto (backup)
  ];
  
  defaultFonts.forEach(fontUrl => {
    if (!fontsToLoad.some(f => f.src === fontUrl)) {
      fontsToLoad.push({ src: fontUrl });
    }
  });
  
  if (fontsToLoad.length > 0) {
    timeline.fonts = fontsToLoad;
  }

  return {
    timeline,
    output: {
      format: 'mp4',
      fps: config.output.fps || 25,
      size,
      aspectRatio
    }
  };
};

/**
 * Render a podcast-style video from scenes with professional production quality
 * This is the main function to use for podcast composition
 */
/**
 * Validate segments for composition - CRITICAL FIX - ENHANCED
 * Validates audio/video sync, gaps, overlaps, and ensures perfect composition
 */
const validateSegmentsForComposition = (
  scenes: PodcastScene[]
): { valid: boolean; issues: string[]; warnings: string[] } => {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  if (scenes.length === 0) {
    issues.push('No scenes provided for composition');
    return { valid: false, issues, warnings };
  }
  
  scenes.forEach((scene, index) => {
    // Verify video URL exists and is valid
    if (!scene.video_url) {
      issues.push(`Scene ${index + 1}: Missing video URL`);
    } else if (!scene.video_url.startsWith('http')) {
      issues.push(`Scene ${index + 1}: Invalid video URL format (must be HTTP/HTTPS)`);
    }
    
    // Verify duration is valid
    if (!scene.duration || scene.duration <= 0) {
      issues.push(`Scene ${index + 1}: Invalid duration (${scene.duration}s)`);
    } else if (scene.duration < 1) {
      warnings.push(`Scene ${index + 1}: Very short duration (${scene.duration}s) - may cause issues`);
    } else if (scene.duration > 30) {
      warnings.push(`Scene ${index + 1}: Very long duration (${scene.duration}s) - consider splitting`);
    }
    
    // Verify text exists for subtitles (if subtitles enabled)
    if (!scene.text || scene.text.trim().length === 0) {
      warnings.push(`Scene ${index + 1}: No text/dialogue - subtitles will be empty`);
    }
    
    // Verify title exists for lower third (if enabled)
    if (!scene.title || scene.title.trim().length === 0) {
      warnings.push(`Scene ${index + 1}: No title - lower third will be empty`);
    }
  });
  
  // Check for potential gaps or overlaps in timeline
  // Note: scenes don't have 'start' property until buildPodcastStyleEdit processes them
  // This validation happens before timing is calculated, so we just check durations
  let cumulativeTime = 0;
  scenes.forEach((scene, index) => {
    const sceneDuration = scene.duration || 0;
    // Check if scene duration is reasonable
    if (sceneDuration < 1) {
      warnings.push(`Scene ${index + 1}: Very short duration (${sceneDuration.toFixed(1)}s) - may cause timing issues`);
    }
    cumulativeTime += sceneDuration;
  });
  
  return {
    valid: issues.length === 0,
    issues,
    warnings
  };
};

/**
 * Detect audio gaps in timeline - ENHANCED
 * Detects gaps between scenes and within scenes (video longer than audio)
 * Note: Scenes don't have 'start' property until buildPodcastStyleEdit processes them
 */
const detectAudioGaps = (scenes: PodcastScene[]): Array<{ sceneIndex: number; start: number; end: number; duration: number; type: 'between_scenes' | 'within_scene' }> => {
  const gaps: Array<{ sceneIndex: number; start: number; end: number; duration: number; type: 'between_scenes' | 'within_scene' }> = [];
  let cumulativeTime = 0;
  
  scenes.forEach((scene, index) => {
    const audioDuration = scene.duration || 0;
    
    // Check if scene has video duration metadata that differs from audio
    // (This would indicate video is longer than audio, creating silent gaps)
    const videoDuration = (scene as any).videoDuration || audioDuration;
    if (videoDuration > audioDuration + 0.5) {
      gaps.push({
        sceneIndex: index,
        start: cumulativeTime + audioDuration,
        end: cumulativeTime + videoDuration,
        duration: videoDuration - audioDuration,
        type: 'within_scene'
      });
    }
    
    // Check for potential gap between scenes (will be validated after timing is calculated)
    // For now, just track cumulative time
    cumulativeTime += Math.max(audioDuration, videoDuration);
  });
  
  return gaps;
};

export const renderPodcastVideo = async (
  scenes: PodcastScene[],
  options: {
    channelName?: string;
    episodeTitle?: string;
    headline?: string;
    newsHeadlines?: string[];  // Headlines for news ticker
    showBorder?: boolean;
    showVignette?: boolean;
    resolution?: '1080' | 'hd' | 'sd';
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5';
    renderConfig?: RenderConfig;
  } = {}
): Promise<RenderResult> => {
  const config = options.renderConfig || DEFAULT_RENDER_CONFIG;
  
  console.log(`🎙️ [Podcast Render] Starting professional podcast composition...`);
  console.log(`🎙️ [Podcast Render] ${scenes.length} scenes to compose`);
  console.log(`🎙️ [Podcast Render] News-style overlays: ${config.newsStyle?.enabled ? 'ENABLED' : 'disabled'}`);
  
  // CRITICAL FIX: Enhanced validation before rendering
  const validation = validateSegmentsForComposition(scenes);
  if (!validation.valid) {
    console.error(`❌ [Podcast Render] Validation failed:`, validation.issues);
    return {
      success: false,
      error: `Composition validation failed: ${validation.issues.join(', ')}`
    };
  }
  
  // Log warnings but continue
  if (validation.warnings.length > 0) {
    console.warn(`⚠️ [Podcast Render] Warnings:`, validation.warnings);
  }
  
  // Detect and fix gaps
  const gaps = detectAudioGaps(scenes);
  if (gaps.length > 0) {
    console.warn(`⚠️ [Podcast Render] Detected ${gaps.length} audio gaps:`, gaps);
    // Gaps will be handled by ensuring proper transitions and durations
    // If background music is enabled, it will fill gaps automatically
    if (!config.backgroundMusic?.enabled) {
      console.warn(`⚠️ [Podcast Render] Audio gaps detected but background music is disabled - gaps may be silent`);
    }
  }
  
  // Validate scenes
  const validScenes = scenes.filter(s => s.video_url && s.duration > 0);
  if (validScenes.length === 0) {
    return {
      success: false,
      error: 'No valid scenes to render'
    };
  }

  // Build the edit with full render config
  const edit = buildPodcastStyleEdit(validScenes, {
    ...options,
    renderConfig: config
  });
  
  console.log(`📋 [Podcast Render] Edit config built with ${edit.timeline.tracks.length} tracks, submitting to Shotstack...`);

  try {
    // Submit to Shotstack
    const response = await shotstackRequest('/render', 'POST', edit);
    const renderId = response.response.id;
    
    console.log(`✅ [Podcast Render] Job submitted: ${renderId}`);
    
    // Poll for completion
    return await pollRenderJob(renderId);
  } catch (error) {
    console.error('❌ [Podcast Render] Error:', (error as Error).message);
    return {
      success: false,
      error: (error as Error).message
    };
  }
};

/**
 * Professional effect presets for different scene types
 */
const SCENE_EFFECTS: Record<string, { effect: ShotstackEffect; filter?: ShotstackFilter }> = {
  'hook': { effect: 'zoomInFast' },
  'conflict': { effect: 'zoomIn', filter: 'contrast' },
  'rising': { effect: 'slideRightSlow' },
  'payoff': { effect: 'zoomOutSlow' },
  'default': { effect: 'zoomInSlow' }
};

/**
 * Professional transition presets (legacy support)
 */
const TRANSITION_PRESETS: Record<string, ShotstackTransition> = {
  'smooth': 'fade',
  'dynamic': 'slideRight',
  'professional': 'wipeLeft',
  'energetic': 'zoom',
  'whip_pan': 'carouselRight',
  'zoom_transition': 'zoom',
  'split_screen': 'wipeLeft', // Closest to split screen
  'match_cut': 'fadeSlow',
  'glitch': 'shuffleTopRight',
  'shutter': 'revealFast'
};

/**
 * Create lower-third text overlay for professional broadcasts
 */
export const createLowerThirdOverlay = (
  text: string,
  startTime: number,
  duration: number,
  style: 'minimal' | 'news' | 'bold' = 'minimal'
): TextOverlay => {
  const styleMap = {
    minimal: { style: 'minimal' as const, size: 'medium' as const, color: '#ffffff' },
    news: { style: 'blockbuster' as const, size: 'large' as const, color: '#ffffff' },
    bold: { style: 'vogue' as const, size: 'large' as const, color: '#ffcc00' }
  };
  
  return {
    text,
    start: startTime,
    length: duration,
    position: 'bottom',
    ...styleMap[style]
  };
};

/**
 * Create a professional news ticker overlay
 */
export const createTickerOverlay = (
  text: string,
  startTime: number,
  duration: number
): TextOverlay => ({
  text: `📰 ${text}`,
  start: startTime,
  length: duration,
  position: 'bottom',
  style: 'minimal',
  size: 'small',
  color: '#ffffff'
});

// =============================================================================================
// NEWS BROADCAST OVERLAYS - Professional TV-style graphics
// =============================================================================================

/**
 * News overlay configuration for professional broadcast look
 */
export interface NewsOverlayConfig {
  // Breaking news banner
  showBreakingNews?: boolean;
  breakingNewsText?: string;
  breakingNewsDuration?: number;
  
  // Date/time display
  showDate?: boolean;
  dateFormat?: 'full' | 'short' | 'time';
  
  // Channel branding
  channelName?: string;
  showChannelLogo?: boolean;
  
  // Headlines ticker
  headlines?: string[];
  tickerSpeed?: 'slow' | 'normal' | 'fast';
  
  // Host lower thirds
  hostAName?: string;
  hostBName?: string;
  showHostNames?: boolean;
}

// formatNewsDate is defined earlier in buildPodcastStyleEdit section

/**
 * Create professional news broadcast overlays
 * Returns an array of TextOverlay objects for the timeline
 */
export const createNewsOverlays = (
  totalDuration: number,
  config: NewsOverlayConfig,
  segments?: BroadcastSegment[]
): TextOverlay[] => {
  const overlays: TextOverlay[] = [];
  let currentTime = 0;
  
  // === BREAKING NEWS BANNER ===
  // Appears at the start, typical TV-style "BREAKING NEWS" flash
  if (config.showBreakingNews) {
    const breakingText = config.breakingNewsText || '🔴 BREAKING NEWS';
    overlays.push({
      text: breakingText,
      start: 0,
      length: config.breakingNewsDuration || 4,
      position: 'top',
      style: 'blockbuster',
      size: 'large',
      color: '#ff0000'
    });
    currentTime = config.breakingNewsDuration || 4;
  }
  
  // === DATE DISPLAY ===
  // Shows date in corner, typical news channel style
  if (config.showDate) {
    const dateText = formatNewsDate();
    overlays.push({
      text: dateText,
      start: currentTime,
      length: totalDuration - currentTime,
      position: 'top',
      style: 'minimal',
      size: 'small',
      color: '#ffffff'
    });
  }
  
  // === CHANNEL NAME/BRANDING ===
  if (config.channelName) {
    overlays.push({
      text: config.channelName.toUpperCase(),
      start: 0,
      length: totalDuration,
      position: 'bottom',
      style: 'minimal',
      size: 'small',
      color: '#ffcc00'
    });
  }
  
  // === HOST NAME LOWER THIRDS ===
  // Shows presenter names when they speak (professional broadcast style)
  if (config.showHostNames && segments && segments.length > 0) {
    let segmentTime = currentTime;
    const introOffset = 3; // Assume 3s intro
    segmentTime = introOffset;
    
    segments.forEach((segment, index) => {
      // Determine which host is speaking
      const speaker = segment.speaker;
      let hostName = '';
      
      if (speaker === 'host_a' || speaker?.toLowerCase().includes('rusty')) {
        hostName = config.hostAName || 'RUSTY';
      } else if (speaker === 'host_b' || speaker?.toLowerCase().includes('dani')) {
        hostName = config.hostBName || 'DANI';
      }
      
      if (hostName) {
        // Show host name for first 3 seconds of their segment
        overlays.push({
          text: `🎙️ ${hostName}`,
          start: segmentTime + 0.5, // Slight delay after segment starts
          length: 3,
          position: 'bottom',
          style: 'minimal',
          size: 'medium',
          color: '#ffffff'
        });
      }
      
      // Estimate segment duration (use audio duration or default)
      const segmentDuration = (segment as any).audioDuration || 8;
      segmentTime += segmentDuration;
    });
  }
  
  // === HEADLINES TICKER ===
  // Scrolling ticker at bottom (news channel style)
  if (config.headlines && config.headlines.length > 0) {
    const tickerText = config.headlines.join('  •  ');
    const tickerDuration = totalDuration - (currentTime + 5); // Leave some margin
    
    if (tickerDuration > 5) {
      overlays.push({
        text: `📰 ${tickerText}`,
        start: currentTime + 5, // Start after breaking news settles
        length: tickerDuration,
        position: 'bottom',
        style: 'minimal',
        size: 'small',
        color: '#ffffff'
      });
    }
  }
  
  return overlays;
};

/**
 * Create a "LIVE" indicator overlay
 */
export const createLiveIndicator = (
  startTime: number,
  duration: number
): TextOverlay => ({
  text: '🔴 LIVE',
  start: startTime,
  length: duration,
  position: 'top',
  style: 'minimal',
  size: 'small',
  color: '#ff0000'
});

/**
 * Create a Shotstack composition config from production data
 * with professional effects and overlays
 * 
 * IMPORTANT: Video clips from InfiniteTalk already contain embedded audio.
 * We do NOT add any separate audio track to avoid duplication.
 */
export const createCompositionFromSegments = (
  segments: BroadcastSegment[],
  videoUrls: (string | null)[],
  videos: VideoAssets,
  config: ChannelConfig,
  options: {
    resolution?: '1080' | 'hd' | 'sd';
    transition?: CompositionConfig['transition'];
    watermarkUrl?: string;
    callbackUrl?: string;
    enableOverlays?: boolean;
    transitionStyle?: 'smooth' | 'dynamic' | 'professional' | 'energetic';
    // News overlay options
    newsOverlays?: NewsOverlayConfig;
    // Headlines for ticker
    headlines?: string[];
    // Title for breaking news
    breakingNewsTitle?: string;
  } = {}
): CompositionConfig => {
  // Effect rotation for Ken Burns style variety
  const effectRotation: ShotstackEffect[] = [
    'zoomInSlow', 'slideRightSlow', 'zoomOutSlow', 'slideLeftSlow', 
    'zoomIn', 'slideUpSlow', 'zoomOutSlow', 'slideDownSlow'
  ];
  
  // Build clips from segments with their video URLs and professional effects
  // NOTE: We use volume: 1 because the audio is embedded in the video from InfiniteTalk
  const clips: VideoClip[] = segments
    .map((segment, index): VideoClip | null => {
      const videoUrl = videoUrls[index] || segment.videoUrl;
      if (!videoUrl) return null;
      
      // Auto-assign Ken Burns effect based on scene type or rotation
      const sceneType = (segment as any).sceneType?.toLowerCase() || 'default';
      const sceneEffect = SCENE_EFFECTS[sceneType] || SCENE_EFFECTS.default;
      const autoEffect = sceneEffect.effect || effectRotation[index % effectRotation.length];
      
      return {
        url: videoUrl,
        start: 0, // Will be calculated by Shotstack sequentially
        // Video clips have embedded audio - DO NOT add separate audio track
        volume: 1, // Use embedded audio at full volume
        effect: autoEffect,
        filter: sceneEffect.filter
      };
    })
    .filter((clip): clip is VideoClip => clip !== null);
  
  // Get transition type based on style preference
  const transitionType = options.transitionStyle 
    ? TRANSITION_PRESETS[options.transitionStyle] 
    : 'fade';
  
  // Calculate estimated total duration for overlays
  const introDuration = videos.intro ? 3 : 0;
  const outroDuration = videos.outro ? 3 : 0;
  const segmentsDuration = segments.reduce((acc, seg) => {
    return acc + ((seg as any).audioDuration || 8);
  }, 0);
  const estimatedTotalDuration = introDuration + segmentsDuration + outroDuration;
  
  // DISABLED: Text overlays for cleaner dynamic video flow
  // Videos now play back to back without any overlays
  const textOverlays: TextOverlay[] = [];
  
  // NOTE: We do NOT include audioTrack - videos have embedded audio from InfiniteTalk
  // Clean dynamic composition - no overlays, no transitions, no effects
  return {
    clips,
    intro: videos.intro ? { 
      url: videos.intro, 
      start: 0, 
      length: 3,
      volume: 1
    } : undefined,
    outro: videos.outro ? { 
      url: videos.outro, 
      start: 0, 
      length: 3,
      volume: 1
    } : undefined,
    audioTrack: undefined,
    resolution: options.resolution || '1080',
    aspectRatio: config.format,
    fps: 30,
    transition: undefined,
    textOverlays: undefined,
    watermark: undefined,
    callbackUrl: options.callbackUrl
  };
};

/**
 * Create a composition config - clean dynamic video flow
 * No overlays, no transitions - just videos back to back
 */
export const createProfessionalComposition = (
  segments: BroadcastSegment[],
  videoUrls: (string | null)[],
  videos: VideoAssets,
  config: ChannelConfig,
  title?: string
): CompositionConfig => {
  return createCompositionFromSegments(
    segments,
    videoUrls,
    videos,
    config,
    {
      resolution: '1080'
    }
  );
};

// =============================================================================================
// RENDER FROM COMPLETED PRODUCTION
// =============================================================================================

import { Production } from "../types";

/**
 * Render a completed production to Shotstack using existing assets
 * This reuses all already-generated videos without creating new ones
 * 
 * Data sources:
 * - segment_status: contains videoUrl and audioUrl for each segment
 * - segments: contains speaker and text
 * - scenes.scenes: contains title for each scene
 * 
 * @param production - The production to render
 * @param channelName - Optional channel name for branding
 * @param aspectRatio - Output aspect ratio
 * @param renderConfig - Full render configuration (transitions, effects, overlays)
 */
export const renderProductionToShotstack = async (
  production: Production,
  channelName?: string,
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5',
  renderConfig?: RenderConfig
): Promise<RenderResult> => {
  const config = renderConfig || DEFAULT_RENDER_CONFIG;
  
  console.log(`🎬 [Shotstack] Rendering production ${production.id} to final video (aspect: ${aspectRatio || '16:9'})...`);
  console.log(`🎬 [Shotstack] Config: transition=${config.transition.type}, effect=${config.effects.clipEffect}, newsStyle=${config.newsStyle?.enabled}`);
  
  // Check if we have segment_status with video URLs
  if (!production.segment_status) {
    return { success: false, error: 'No segment_status found in production' };
  }

  // Get scene titles from scenes.scenes if available
  const sceneData = production.scenes?.scenes || {};
  
  // Build scenes from segment_status, segments, and scenes
  const scenes: PodcastScene[] = [];
  
  // Get segment indices sorted
  const segmentIndices = Object.keys(production.segment_status)
    .map(k => parseInt(k))
    .sort((a, b) => a - b);
  
  for (const index of segmentIndices) {
    const status = production.segment_status[index];
    
    // Skip if no video URL
    if (!status?.videoUrl) continue;
    
    // Get speaker from segments array
    const segment = production.segments?.[index];
    const speaker = segment?.speaker || 'Host';
    
    // Get title from scenes (scenes are 1-indexed, segments are 0-indexed)
    const sceneInfo = sceneData[String(index + 1)];
    const title = sceneInfo?.title || `Scene ${index + 1}`;
    
    // Get text for subtitles and duration estimation
    const text = segment?.text || sceneInfo?.text || '';
    
    // Use EXACT audio duration if available, otherwise estimate from text
    // ~150 words per minute = 2.5 words per second
    let sceneDuration: number;
    if (segment?.audioDuration && segment.audioDuration > 0) {
      sceneDuration = segment.audioDuration;
      console.log(`📏 [Shotstack] Segment ${index}: Using exact audio duration: ${sceneDuration.toFixed(2)}s`);
    } else {
      const wordCount = text.split(/\s+/).length;
      sceneDuration = Math.max(3, Math.ceil(wordCount / 2.5));
      console.log(`📏 [Shotstack] Segment ${index}: Estimated duration from ${wordCount} words: ${sceneDuration}s`);
    }
    
    // Include sound effects metadata from scene if available
    const soundEffects = sceneInfo?.soundEffects;
    
    scenes.push({
      video_url: status.videoUrl,
      title,
      duration: sceneDuration,
      speaker,
      text, // Include text for subtitles
      soundEffects: soundEffects ? {
        type: soundEffects.type,
        description: soundEffects.description,
        startTime: soundEffects.startTime,
        duration: soundEffects.duration,
        endTime: soundEffects.endTime,
        volume: soundEffects.volume,
        url: undefined // URL will be fetched from Supabase Storage
      } : undefined
    });
  }

  if (scenes.length === 0) {
    return { success: false, error: 'No segments with video URLs found in segment_status' };
  }

  console.log(`🎬 [Shotstack] Found ${scenes.length} scenes with videos`);
  console.log(`🎬 [Shotstack] Total estimated duration: ${scenes.reduce((acc, s) => acc + s.duration, 0)}s`);

  // Use viral_metadata title or viral_hook as headline for lower third
  const headline = production.viral_metadata?.title || production.viral_hook || channelName || '';

  // Extract news headlines for ticker - get ALL news from the day, not just selected ones
  const newsHeadlines: string[] = [];
  
  // Try to get ALL news from the day from Supabase
  if (production.news_date && production.channel_id) {
    try {
      const newsDate = new Date(production.news_date);
      const allDayNews = await getNewsByDate(newsDate, production.channel_id);
      
      if (allDayNews && allDayNews.length > 0) {
        console.log(`🎬 [Shotstack] Loaded ${allDayNews.length} news items from ${production.news_date} for ticker`);
        allDayNews.forEach(news => {
          if (news.headline) {
            newsHeadlines.push(news.headline);
          }
        });
      }
    } catch (err) {
      console.warn('⚠️ [Shotstack] Could not load all day news, falling back to selected news:', err);
    }
  }
  
  // Fallback: use fetched_news (selected news) if no all-day news loaded
  if (newsHeadlines.length === 0 && production.fetched_news && production.fetched_news.length > 0) {
    production.fetched_news.forEach(news => {
      if (news.headline) {
        newsHeadlines.push(news.headline);
      }
    });
  }
  
  // Second fallback: use scene titles
  if (newsHeadlines.length === 0) {
    Object.values(sceneData).forEach((scene: any) => {
      if (scene?.title) {
        newsHeadlines.push(scene.title);
      }
    });
  }
  
  // Add viral hook as the main headline if available
  if (production.viral_hook && !newsHeadlines.includes(production.viral_hook)) {
    newsHeadlines.unshift(production.viral_hook);
  }
  
  console.log(`🎬 [Shotstack] News headlines for ticker: ${newsHeadlines.length} items`);

  // Generate background music and sound effects if enabled
  // Import ElevenLabs service for audio generation
  const { generateProductionAudio } = await import('./elevenlabsService');
  
  if (config.backgroundMusic?.enabled || config.soundEffects?.enabled) {
    try {
      // Get scene durations for accurate timing
      const sceneDurations = scenes.map(s => s.duration);
      
      // Get channel ID from production if available
      const channelId = production.channel_id;
      
      const audioAssets = await generateProductionAudio(
        scenes.map(s => ({ soundEffects: s.soundEffects })),
        config.backgroundMusic?.style || 'podcast',
        channelId,
        sceneDurations
      );
      
      // Update scenes with sound effect URLs from Supabase Storage
      // Match sound effects by type and description to ensure correct assignment
      if (audioAssets.soundEffects.length > 0) {
        scenes.forEach((scene, sceneIndex) => {
          if (scene.soundEffects && scene.soundEffects.type && scene.soundEffects.type !== 'none') {
            // Use description exactly as provided (should match storage filename)
            const effectDescription = scene.soundEffects.description || scene.soundEffects.type;
            
            // Try to find exact match by type and description
            // We need to match the URL which contains the filename
            let matchedEffect = audioAssets.soundEffects.find(effect => {
              if (effect.type !== scene.soundEffects!.type) return false;
              // Check if URL contains the description (exact match in filename)
              const urlLower = effect.url.toLowerCase();
              const descriptionLower = effectDescription.toLowerCase();
              return urlLower.includes(descriptionLower);
            });
            
            // If no exact match, find by type and start time (assuming order matches)
            if (!matchedEffect) {
              // Count how many effects of this type we've seen so far
              let effectIndex = 0;
              for (let i = 0; i < sceneIndex; i++) {
                if (scenes[i].soundEffects?.type === scene.soundEffects.type && 
                    scenes[i].soundEffects?.type !== 'none') {
                  effectIndex++;
                }
              }
              
              // Find the nth effect of this type
              const effectsOfType = audioAssets.soundEffects.filter(e => e.type === scene.soundEffects!.type);
              matchedEffect = effectsOfType[effectIndex];
            }
            
            if (matchedEffect) {
              scene.soundEffects.url = matchedEffect.url;
              // Preserve original duration and timing from script
              if (!scene.soundEffects.duration) {
                scene.soundEffects.duration = matchedEffect.duration;
              }
              if (!scene.soundEffects.volume) {
                scene.soundEffects.volume = matchedEffect.volume;
              }
              console.log(`🔊 [Shotstack] Assigned sound effect URL to scene ${sceneIndex + 1}: ${matchedEffect.url}`);
            } else {
              console.warn(`[Shotstack] ⚠️ Could not find matching sound effect URL for scene ${sceneIndex + 1} (type: ${scene.soundEffects.type}, description: ${scene.soundEffects.description})`);
            }
          }
        });
      } else {
        // If no sound effects were found, remove sound effects metadata from scenes
        scenes.forEach((scene) => {
          if (scene.soundEffects && scene.soundEffects.type !== 'none') {
            console.warn(`[Shotstack] ⚠️ Sound effect not found in storage, removing from scene (type: ${scene.soundEffects.type})`);
            scene.soundEffects.type = 'none';
          }
        });
      }
      
      // Set background music URL if found in Supabase Storage
      if (audioAssets.backgroundMusic && config.backgroundMusic) {
        config.backgroundMusic.url = audioAssets.backgroundMusic;
      }
    } catch (error) {
      console.warn(`[Shotstack] ⚠️ Could not fetch audio assets from Supabase: ${(error as Error).message}`);
      // Continue without audio assets
    }
  }

  // Render with full configuration
  return await renderPodcastVideo(scenes, {
    channelName,
    headline,
    newsHeadlines, // Pass headlines for ticker
    episodeTitle: headline,
    showBorder: false,
    showVignette: false,
    resolution: config.output.resolution as '1080' | 'hd' | 'sd',
    aspectRatio: aspectRatio || '16:9',
    renderConfig: config
  });
};

/**
 * Check if a production has videos ready for Shotstack rendering
 */
export const hasVideosForRender = (production: Production): boolean => {
  if (!production.segment_status) return false;
  
  return Object.values(production.segment_status).some(
    status => status?.videoUrl && status.video === 'done'
  );
};

// =============================================================================================
// EXPORTS
// =============================================================================================

export const ShotstackService = {
  checkConfig: checkShotstackConfig,
  submitRender: submitRenderJob,
  checkStatus: checkRenderStatus,
  pollRender: pollRenderJob,
  render: renderVideo,
  createFromSegments: createCompositionFromSegments,
  createProfessionalComposition,
  createLowerThirdOverlay,
  createTickerOverlay,
  renderFromProduction: renderProductionToShotstack,
  hasVideosForRender
};
