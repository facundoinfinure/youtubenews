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
  video_url: string;
  title: string;
  duration: number; // Duration in seconds (from video metadata or estimate)
  speaker?: string; // Optional speaker name
}

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
    showBorder?: boolean;
    showVignette?: boolean;
    resolution?: '1080' | 'hd' | 'sd';
    aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5';
    renderConfig?: RenderConfig; // Full render configuration
  } = {}
): any => {
  const config = options.renderConfig || DEFAULT_RENDER_CONFIG;
  
  // Calculate cumulative start times accounting for transitions
  const transitionDuration = config.transition.type !== 'none' ? config.transition.duration : 0;
  let currentStart = 0;
  const scenesWithTiming = scenes.map((scene, index) => {
    const sceneWithStart = {
      ...scene,
      start: currentStart,
      index
    };
    // Overlap clips by transition duration (except first clip)
    currentStart += scene.duration - (index < scenes.length - 1 ? transitionDuration : 0);
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
    // Determine effect - use config or auto-rotate for variety
    let clipEffect: ShotstackEffect | undefined;
    if (config.effects.clipEffect !== 'none') {
      clipEffect = config.effects.autoEffectRotation 
        ? effectRotation[index % effectRotation.length]
        : config.effects.clipEffect as ShotstackEffect;
    }

    const clip: any = {
      asset: {
        type: 'video',
        src: scene.video_url,
        volume: 1 // Use embedded audio
      },
      start: scene.start,
      length: 'auto'
    };

    // Add effect (Ken Burns motion)
    if (clipEffect) {
      clip.effect = clipEffect;
    }

    // Add filter if configured
    if (config.effects.filter && config.effects.filter !== 'none') {
      clip.filter = config.effects.filter;
    }

    // Add transition (except for first clip)
    if (config.transition.type !== 'none' && index > 0) {
      clip.transition = {
        in: config.transition.type
      };
    }

    return clip;
  });

  // Build tracks array (bottom to top in render order)
  const tracks: any[] = [];
  
  // TRACK 1 (Base): Video clips
  tracks.push({ clips: videoClips });

  // === NEWS-STYLE OVERLAYS ===
  if (config.newsStyle?.enabled) {
    const newsConfig = config.newsStyle;
    
    // TRACK 2: Lower Third Banner (if enabled)
    if (newsConfig.lowerThird?.enabled) {
      const primaryColor = newsConfig.lowerThird.primaryColor || '#ff0000';
      const secondaryColor = newsConfig.lowerThird.secondaryColor || '#000000';
      const textColor = newsConfig.lowerThird.textColor || '#ffffff';
      const category = newsConfig.lowerThird.category || 'BREAKING NEWS';
      const headline = options.headline || options.episodeTitle || options.channelName || '';

      // Main horizontal banner bar
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '',
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#000000', family: 'Montserrat SemiBold', size: 24, lineHeight: 1 },
            width: 2200,
            height: 162,
            background: { color: primaryColor }
          },
          start: 0.4,
          length: totalDuration,
          offset: { x: 0, y: -0.39 },
          position: 'center',
          transition: { in: 'slideRight' }
        }]
      });

      // Category badge background (black box)
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '',
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#000000', family: 'Montserrat SemiBold', size: 24, lineHeight: 1 },
            width: 430,
            height: 120,
            background: { color: secondaryColor }
          },
          start: 0.8,
          length: totalDuration,
          offset: { x: -0.38, y: -0.39 },
          position: 'center',
          transition: { in: 'slideRight' }
        }]
      });

      // Category text (e.g., "BREAKING NEWS")
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: category,
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: textColor, family: 'Oswald', size: 42, lineHeight: 1 },
            width: 400,
            height: 100
          },
          start: 1,
          length: totalDuration,
          offset: { x: -0.38, y: -0.39 },
          position: 'center',
          transition: { in: 'slideRight' }
        }]
      });

      // Headline text
      if (headline) {
        tracks.unshift({
          clips: [{
            asset: {
              type: 'text',
              text: headline,
              alignment: { horizontal: 'left', vertical: 'center' },
              font: { color: textColor, family: 'Roboto Medium', size: 40, lineHeight: 1 },
              width: 1200,
              height: 120
            },
            start: 1.2,
            length: totalDuration,
            offset: { x: 0.15, y: -0.39 },
            position: 'center',
            transition: { in: 'slideRight' }
          }]
        });
      }
    }

    // TRACK: Date display (if enabled in overlays)
    if (config.overlays?.showDate) {
      const dateText = formatNewsDate();
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: dateText,
            alignment: { horizontal: 'right', vertical: 'center' },
            font: { color: '#ffffff', family: 'Roboto', size: 24, lineHeight: 1 },
            width: 300,
            height: 50
          },
          start: 1.5,
          length: totalDuration,
          offset: { x: 0.42, y: 0.44 },
          position: 'center',
          transition: { in: 'fade' }
        }]
      });
    }

    // TRACK: LIVE indicator (if enabled)
    if (config.overlays?.showLiveIndicator) {
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: '🔴 LIVE',
            alignment: { horizontal: 'left', vertical: 'center' },
            font: { color: '#ff0000', family: 'Roboto Bold', size: 28, lineHeight: 1 },
            width: 150,
            height: 50
          },
          start: 0.5,
          length: totalDuration,
          offset: { x: -0.42, y: 0.44 },
          position: 'center',
          transition: { in: 'fade' }
        }]
      });
    }

    // TRACK: Breaking News banner at top (if enabled)
    if (config.overlays?.showBreakingNews) {
      const breakingText = config.overlays.breakingNewsText || '🔴 BREAKING NEWS';
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: breakingText,
            alignment: { horizontal: 'center', vertical: 'center' },
            font: { color: '#ffffff', family: 'Oswald', size: 36, lineHeight: 1 },
            width: 600,
            height: 60,
            background: { color: '#cc0000' }
          },
          start: 0,
          length: 5, // Show for 5 seconds at start
          offset: { x: 0, y: 0.42 },
          position: 'center',
          transition: { in: 'slideDown', out: 'fade' }
        }]
      });
    }

    // TRACK: Channel branding (if enabled)
    if (newsConfig.showChannelBranding && options.channelName) {
      tracks.unshift({
        clips: [{
          asset: {
            type: 'text',
            text: options.channelName.toUpperCase(),
            alignment: { horizontal: 'right', vertical: 'center' },
            font: { color: '#ffcc00', family: 'Oswald', size: 20, lineHeight: 1 },
            width: 200,
            height: 40
          },
          start: 2,
          length: totalDuration,
          offset: { x: 0.42, y: 0.40 },
          position: 'center',
          transition: { in: 'fade' }
        }]
      });
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

  return {
    timeline: {
      background: '#000000',
      tracks
    },
    output: {
      format: 'mp4',
      fps: config.output.fps || 25,
      size,
      aspectRatio
    }
  };
};

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
 * Render a podcast-style video from scenes with professional production quality
 * This is the main function to use for podcast composition
 */
export const renderPodcastVideo = async (
  scenes: PodcastScene[],
  options: {
    channelName?: string;
    episodeTitle?: string;
    headline?: string;
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
    
    // Estimate duration from text length (~150 words per minute = 2.5 words per second)
    const text = segment?.text || sceneInfo?.text || '';
    const wordCount = text.split(/\s+/).length;
    const estimatedDuration = Math.max(5, Math.ceil(wordCount / 2.5));
    
    scenes.push({
      video_url: status.videoUrl,
      title,
      duration: segment?.audioDuration || estimatedDuration,
      speaker
    });
  }

  if (scenes.length === 0) {
    return { success: false, error: 'No segments with video URLs found in segment_status' };
  }

  console.log(`🎬 [Shotstack] Found ${scenes.length} scenes with videos`);
  console.log(`🎬 [Shotstack] Total estimated duration: ${scenes.reduce((acc, s) => acc + s.duration, 0)}s`);

  // Use viral_metadata title or viral_hook as headline for lower third
  const headline = production.viral_metadata?.title || production.viral_hook || channelName || '';

  // Render with full configuration
  return await renderPodcastVideo(scenes, {
    channelName,
    headline,
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
