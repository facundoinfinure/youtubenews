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
  const transitionDuration = config.transition?.duration || 0;
  
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
      // Professional intro with zoom in and fade transition
      effect: config.intro.effect || 'zoomIn',
      transition: {
        in: 'fade',
        out: config.transition?.type || 'fade'
      }
    });
    currentTime += (config.intro.length || 3) - transitionDuration;
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
    const isLast = index === validClips.length - 1 && (!config.outro || !isValidPublicUrl(config.outro.url));
    const isFirst = index === 0 && (!config.intro || !isValidPublicUrl(config.intro.url));
    
    // Auto-assign effects for professional look (Ken Burns style)
    const autoEffect = clip.effect || effectRotation[index % effectRotation.length];
    
    // Use configured transition or rotate through options
    const transitionType = config.transition?.type || transitionRotation[index % transitionRotation.length];
    
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
      filter: clip.filter || (config.effects?.filter),
      // Transition to next clip (not on last clip)
      transition: !isLast ? {
        out: transitionType
      } : undefined,
      // Smooth fade in on first clip
      ...(isFirst && { 
        transition: { 
          in: 'fade',
          out: !isLast ? transitionType : undefined 
        }
      })
    });
    
    // Estimate clip duration if not provided (assume 5 seconds for auto)
    const clipDuration = clip.length || 5;
    currentTime += clipDuration - (isLast ? 0 : transitionDuration);
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
      // Professional outro with zoom out and fade out
      effect: config.outro.effect || 'zoomOutSlow',
      transition: {
        in: config.transition?.type || 'fade',
        out: 'fade'
      }
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

import { BroadcastSegment, VideoAssets, ChannelConfig } from "../types";

/**
 * Scene input for podcast-style composition
 */
export interface PodcastScene {
  video_url: string;
  title: string;
  duration: number; // Duration in seconds (from video metadata or estimate)
  speaker?: string; // Optional speaker name
}

/**
 * Build podcast-style Shotstack edit following the guide
 * 
 * This creates a clean, modern podcast aesthetic with:
 * - Videos playing sequentially (NO overlaps)
 * - Minimalist lower thirds with titles
 * - Subtle frame/border
 * - Soft vignette overlay
 * - Fade transitions only
 */
export const buildPodcastStyleEdit = (
  scenes: PodcastScene[],
  options: {
    channelName?: string;
    episodeTitle?: string;
    showBorder?: boolean;
    showVignette?: boolean;
    resolution?: '1080' | 'hd' | 'sd';
  } = {}
): any => {
  // Calculate cumulative start times
  // CRITICAL: Each video starts when the previous one ends
  let currentStart = 0;
  const scenesWithTiming = scenes.map(scene => {
    const sceneWithStart = {
      ...scene,
      start: currentStart
    };
    currentStart += scene.duration;
    return sceneWithStart;
  });

  const totalDuration = currentStart;
  console.log(`🎬 [Podcast Composition] Total duration: ${totalDuration}s across ${scenes.length} scenes`);

  // Track 1: Video clips (bottom layer)
  const videoClips = scenesWithTiming.map(scene => ({
    asset: {
      type: 'video',
      src: scene.video_url,
      volume: 1 // Use embedded audio
    },
    start: scene.start,
    length: 'auto', // Let Shotstack detect the duration
    transition: {
      in: 'fade',
      out: 'fade'
    }
  }));

  // Track 2: Lower third title overlays (HTML-based for podcast style)
  const titleClips = scenesWithTiming.map(scene => ({
    asset: {
      type: 'html',
      html: `<div style="width:100%;height:100%;display:flex;align-items:flex-end;">
        <div style="margin:0 auto 40px auto;max-width:70%;padding:14px 24px;background:rgba(0,0,0,0.65);border-radius:12px;font-family:Inter,Arial,sans-serif;">
          <div style="font-size:26px;font-weight:600;color:#ffffff;text-align:center;">${escapeHtml(scene.title)}</div>
          ${scene.speaker ? `<div style="font-size:16px;color:rgba(255,255,255,0.7);text-align:center;margin-top:4px;">🎙️ ${escapeHtml(scene.speaker)}</div>` : ''}
        </div>
      </div>`.replace(/\n\s*/g, '')
    },
    start: scene.start,
    length: Math.min(scene.duration, 5), // Show title for max 5 seconds
    transition: {
      in: 'fade',
      out: 'fade'
    }
  }));

  // Track 3: Decorative border (optional)
  const borderClip = options.showBorder !== false ? [{
    asset: {
      type: 'html',
      html: `<div style="width:100%;height:100%;display:flex;justify-content:center;align-items:center;pointer-events:none;">
        <div style="width:95%;height:95%;border-radius:20px;border:4px solid rgba(255,255,255,0.12);box-shadow:0 0 20px rgba(0,0,0,0.6);"></div>
      </div>`.replace(/\n\s*/g, '')
    },
    start: 0,
    length: totalDuration + 1 // Slightly longer to cover fade out
  }] : [];

  // Track 4: Vignette overlay (optional)
  const vignetteClip = options.showVignette !== false ? [{
    asset: {
      type: 'html',
      html: `<div style="width:100%;height:100%;background:radial-gradient(circle at center, rgba(0,0,0,0) 60%, rgba(0,0,0,0.35) 100%);"></div>`
    },
    start: 0,
    length: totalDuration + 1
  }] : [];

  // Track 5: Channel branding (top corner, optional)
  const brandingClip = options.channelName ? [{
    asset: {
      type: 'html',
      html: `<div style="width:100%;height:100%;display:flex;justify-content:flex-end;align-items:flex-start;padding:20px;">
        <div style="padding:8px 16px;background:rgba(0,0,0,0.5);border-radius:8px;font-family:Inter,Arial,sans-serif;">
          <div style="font-size:14px;font-weight:600;color:#ffffff;">${escapeHtml(options.channelName)}</div>
        </div>
      </div>`.replace(/\n\s*/g, '')
    },
    start: 0,
    length: totalDuration + 1
  }] : [];

  // Build tracks array (order matters: bottom to top)
  const tracks: any[] = [];
  
  // Videos at the bottom
  tracks.push({ clips: videoClips });
  
  // Title overlays
  if (titleClips.length > 0) {
    tracks.push({ clips: titleClips });
  }
  
  // Border
  if (borderClip.length > 0) {
    tracks.push({ clips: borderClip });
  }
  
  // Vignette
  if (vignetteClip.length > 0) {
    tracks.push({ clips: vignetteClip });
  }
  
  // Branding on top
  if (brandingClip.length > 0) {
    tracks.push({ clips: brandingClip });
  }

  // Resolution settings
  const resolutionMap: Record<string, { width: number; height: number }> = {
    '1080': { width: 1920, height: 1080 },
    'hd': { width: 1280, height: 720 },
    'sd': { width: 854, height: 480 }
  };
  const size = resolutionMap[options.resolution || '1080'];

  return {
    timeline: {
      background: '#000000',
      tracks
    },
    output: {
      format: 'mp4',
      fps: 25,
      size
    }
  };
};

/**
 * Helper to escape HTML special characters
 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Render a podcast-style video from scenes
 * This is the main function to use for podcast composition
 */
export const renderPodcastVideo = async (
  scenes: PodcastScene[],
  options: {
    channelName?: string;
    episodeTitle?: string;
    showBorder?: boolean;
    showVignette?: boolean;
    resolution?: '1080' | 'hd' | 'sd';
  } = {}
): Promise<RenderResult> => {
  console.log(`🎙️ [Podcast Render] Starting podcast-style composition...`);
  console.log(`🎙️ [Podcast Render] ${scenes.length} scenes to compose`);
  
  // Validate scenes
  const validScenes = scenes.filter(s => s.video_url && s.duration > 0);
  if (validScenes.length === 0) {
    return {
      success: false,
      error: 'No valid scenes to render'
    };
  }

  // Build the edit
  const edit = buildPodcastStyleEdit(validScenes, options);
  
  console.log(`📋 [Podcast Render] Edit config built, submitting to Shotstack...`);

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
 * Professional transition presets
 */
const TRANSITION_PRESETS: Record<string, ShotstackTransition> = {
  'smooth': 'fade',
  'dynamic': 'slideRight',
  'professional': 'wipeLeft',
  'energetic': 'zoom'
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

/**
 * Format date for news overlay
 */
const formatNewsDate = (format: 'full' | 'short' | 'time' = 'full'): string => {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = format === 'full' 
    ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
    : format === 'short'
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { hour: '2-digit', minute: '2-digit' };
  
  return now.toLocaleDateString('en-US', options).toUpperCase();
};

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
    const dateText = formatNewsDate(config.dateFormat);
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
  
  // Build text overlays - NEWS BROADCAST STYLE
  let textOverlays: TextOverlay[] = [];
  
  // Default news overlays configuration
  const defaultNewsConfig: NewsOverlayConfig = {
    showBreakingNews: true,
    breakingNewsText: options.breakingNewsTitle 
      ? `🔴 BREAKING: ${options.breakingNewsTitle.toUpperCase()}`
      : '🔴 BREAKING NEWS',
    breakingNewsDuration: 4,
    showDate: true,
    dateFormat: 'short',
    channelName: config.channelName,
    showHostNames: true,
    hostAName: config.characters?.hostA?.name || 'RUSTY',
    hostBName: config.characters?.hostB?.name || 'DANI',
    headlines: options.headlines
  };
  
  // Use provided news overlays or defaults if overlays enabled
  if (options.enableOverlays !== false) {
    const newsConfig = options.newsOverlays || defaultNewsConfig;
    textOverlays = createNewsOverlays(estimatedTotalDuration, newsConfig, segments);
  }
  
  // NOTE: We do NOT include audioTrack - videos have embedded audio from InfiniteTalk
  return {
    clips,
    intro: videos.intro ? { 
      url: videos.intro, 
      start: 0, 
      length: 3,
      volume: 1, // Intro may have its own audio
      effect: 'zoomIn' // Professional intro zoom
    } : undefined,
    outro: videos.outro ? { 
      url: videos.outro, 
      start: 0, 
      length: 3,
      volume: 1, // Outro may have its own audio
      effect: 'zoomOutSlow' // Smooth outro
    } : undefined,
    // NO audioTrack - videos already have embedded audio from InfiniteTalk lip-sync
    audioTrack: undefined, // EXPLICITLY undefined to avoid any audio duplication
    resolution: options.resolution || '1080',
    aspectRatio: config.format,
    fps: 30,
    transition: options.transition || { 
      type: transitionType, 
      duration: 0.5 
    },
    effects: {
      zoom: 'zoomInSlow' // Default Ken Burns effect
    },
    textOverlays: textOverlays.length > 0 ? textOverlays : undefined,
    watermark: options.watermarkUrl ? {
      url: options.watermarkUrl,
      position: 'bottomRight',
      opacity: 0.7,
      scale: 0.1
    } : undefined,
    callbackUrl: options.callbackUrl
  };
};

/**
 * Create a composition config with all professional features enabled
 */
export const createProfessionalComposition = (
  segments: BroadcastSegment[],
  videoUrls: (string | null)[],
  videos: VideoAssets,
  config: ChannelConfig,
  title?: string
): CompositionConfig => {
  const composition = createCompositionFromSegments(
    segments,
    videoUrls,
    videos,
    config,
    {
      resolution: '1080',
      transitionStyle: 'smooth',
      enableOverlays: true
    }
  );
  
  // Add title card overlay at the beginning
  if (title && composition.textOverlays) {
    composition.textOverlays.unshift({
      text: title,
      start: 0.5,
      length: 3,
      position: 'center',
      style: 'blockbuster',
      size: 'large',
      color: '#ffffff'
    });
  }
  
  return composition;
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
  createTickerOverlay
};
