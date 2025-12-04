/**
 * Video Compositor Service
 * 
 * Prepares video segments for professional-quality FFmpeg composition.
 * This service handles the client-side preparation and interfaces with
 * a backend service (e.g., AWS Lambda, Google Cloud Run) that runs FFmpeg.
 * 
 * For studio-quality videos, the backend should:
 * 1. Concatenate all video segments
 * 2. Add crossfade transitions
 * 3. Normalize audio levels
 * 4. Add intro/outro with proper transitions
 * 5. Render in high quality (1080p H.264/H.265)
 */

import { BroadcastSegment, VideoAssets, ChannelConfig } from "../types";
import { CostTracker } from "./CostTracker";

// =============================================================================================
// TYPES
// =============================================================================================

export type TransitionType = 'none' | 'crossfade' | 'dip_to_black' | 'wipe_left' | 'zoom';
export type OutputResolution = '720p' | '1080p' | '4k';
export type OutputFormat = 'mp4' | 'webm' | 'mov';
export type AudioCodec = 'aac' | 'opus' | 'mp3';
export type VideoCodec = 'h264' | 'h265' | 'vp9';

export interface VideoSegmentInfo {
  index: number;
  videoUrl: string;
  audioUrl?: string;
  duration?: number; // seconds
  speaker: string;
  text: string;
  sceneType?: string;
  shot?: string;
}

export interface CompositionRequest {
  // Segment data
  segments: VideoSegmentInfo[];
  
  // Intro/Outro
  introUrl?: string;
  outroUrl?: string;
  introDuration?: number; // seconds, default 3
  outroDuration?: number; // seconds, default 3
  
  // Channel branding
  channelId: string;
  channelName: string;
  watermarkUrl?: string;
  watermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  watermarkOpacity?: number; // 0-1
  
  // Output settings
  format: '16:9' | '9:16';
  resolution: OutputResolution;
  outputFormat: OutputFormat;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec;
  videoBitrate?: string; // e.g., "8M" for 8 Mbps
  audioBitrate?: string; // e.g., "192k"
  
  // Transitions
  transitionType: TransitionType;
  transitionDuration?: number; // seconds, default 0.5
  
  // Audio enhancements
  normalizeAudio?: boolean;
  audioCompression?: boolean;
  noiseReduction?: boolean;
  
  // Metadata
  title?: string;
  description?: string;
}

export interface CompositionResult {
  success: boolean;
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  fileSize?: number;
  error?: string;
  processingTime?: number; // milliseconds
}

export interface FFmpegCommand {
  inputs: string[];
  filterComplex: string;
  outputOptions: string[];
  estimatedDuration: number;
}

// =============================================================================================
// CONSTANTS
// =============================================================================================

const RESOLUTION_PRESETS: Record<OutputResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 }
};

const RESOLUTION_PRESETS_VERTICAL: Record<OutputResolution, { width: number; height: number }> = {
  '720p': { width: 720, height: 1280 },
  '1080p': { width: 1080, height: 1920 },
  '4k': { width: 2160, height: 3840 }
};

const CODEC_SETTINGS: Record<VideoCodec, { preset: string; crf: number }> = {
  'h264': { preset: 'slow', crf: 18 }, // High quality H.264
  'h265': { preset: 'medium', crf: 22 }, // Good balance for HEVC
  'vp9': { preset: '', crf: 31 } // VP9 uses different settings
};

const TRANSITION_FILTERS: Record<TransitionType, (duration: number) => string> = {
  'none': () => '',
  'crossfade': (d) => `xfade=transition=fade:duration=${d}`,
  'dip_to_black': (d) => `xfade=transition=fadeblack:duration=${d}`,
  'wipe_left': (d) => `xfade=transition=wipeleft:duration=${d}`,
  'zoom': (d) => `xfade=transition=zoomin:duration=${d}`
};

// =============================================================================================
// COMPOSITION PREPARATION
// =============================================================================================

/**
 * Prepare segments from BroadcastSegment array
 */
export const prepareSegmentsFromBroadcast = (
  segments: BroadcastSegment[],
  videos: VideoAssets
): VideoSegmentInfo[] => {
  return segments.map((seg, idx) => {
    // Get video URL from segment or fallback to host videos
    let videoUrl = seg.videoUrl;
    
    if (!videoUrl) {
      // Fallback to host-specific videos from VideoAssets
      if (seg.speaker === 'Rusty' || seg.speaker.toLowerCase().includes('hosta')) {
        videoUrl = videos.hostA?.[idx % (videos.hostA?.length || 1)] || '';
      } else if (seg.speaker === 'Dani' || seg.speaker.toLowerCase().includes('hostb')) {
        videoUrl = videos.hostB?.[idx % (videos.hostB?.length || 1)] || '';
      }
    }
    
    return {
      index: idx,
      videoUrl: videoUrl || '',
      speaker: seg.speaker,
      text: seg.text
    };
  });
};

/**
 * Build a composition request from production data
 */
export const buildCompositionRequest = (
  segments: BroadcastSegment[],
  videos: VideoAssets,
  config: ChannelConfig,
  channelId: string,
  options: Partial<CompositionRequest> = {}
): CompositionRequest => {
  const segmentInfos = prepareSegmentsFromBroadcast(segments, videos);
  
  return {
    // Segments
    segments: segmentInfos,
    
    // Intro/Outro
    introUrl: videos.intro || undefined,
    outroUrl: videos.outro || undefined,
    introDuration: 3,
    outroDuration: 3,
    
    // Channel branding
    channelId,
    channelName: config.channelName,
    
    // Output settings (high quality defaults)
    format: config.format,
    resolution: '1080p',
    outputFormat: 'mp4',
    videoCodec: 'h264',
    audioCodec: 'aac',
    videoBitrate: '8M',
    audioBitrate: '192k',
    
    // Transitions
    transitionType: 'crossfade',
    transitionDuration: 0.3,
    
    // Audio enhancements
    normalizeAudio: true,
    audioCompression: true,
    noiseReduction: false,
    
    // Override with custom options
    ...options
  };
};

/**
 * Estimate total video duration
 */
export const estimateTotalDuration = (request: CompositionRequest): number => {
  const segmentDurations = request.segments.reduce((sum, seg) => {
    return sum + (seg.duration || 5); // Default 5 seconds per segment if unknown
  }, 0);
  
  const introDuration = request.introUrl ? (request.introDuration || 3) : 0;
  const outroDuration = request.outroUrl ? (request.outroDuration || 3) : 0;
  
  // Subtract transition overlaps
  const transitionCount = request.segments.length - 1 + (request.introUrl ? 1 : 0) + (request.outroUrl ? 1 : 0);
  const transitionDuration = request.transitionType !== 'none' ? (request.transitionDuration || 0.5) : 0;
  const totalTransitionTime = transitionCount * transitionDuration;
  
  return segmentDurations + introDuration + outroDuration - totalTransitionTime;
};

/**
 * Estimate processing cost based on duration and quality
 */
export const estimateProcessingCost = (request: CompositionRequest): number => {
  const duration = estimateTotalDuration(request);
  
  // Base cost per minute of video
  const baseCostPerMinute = {
    '720p': 0.02,
    '1080p': 0.05,
    '4k': 0.15
  };
  
  const minutes = duration / 60;
  const baseCost = minutes * baseCostPerMinute[request.resolution];
  
  // Additional costs for enhancements
  let multiplier = 1;
  if (request.normalizeAudio) multiplier += 0.1;
  if (request.noiseReduction) multiplier += 0.2;
  if (request.transitionType !== 'none') multiplier += 0.1;
  
  return baseCost * multiplier;
};

// =============================================================================================
// FFMPEG COMMAND GENERATION (for backend use)
// =============================================================================================

/**
 * Generate FFmpeg filter complex for concatenating videos with transitions
 * This is meant to be executed on a backend server with FFmpeg installed
 */
export const generateFFmpegFilterComplex = (request: CompositionRequest): string => {
  const { segments, transitionType, transitionDuration = 0.5 } = request;
  const resolution = request.format === '9:16' 
    ? RESOLUTION_PRESETS_VERTICAL[request.resolution]
    : RESOLUTION_PRESETS[request.resolution];
  
  const filters: string[] = [];
  
  // Scale all inputs to target resolution
  segments.forEach((_, idx) => {
    filters.push(`[${idx}:v]scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${idx}]`);
  });
  
  // Apply transitions or simple concatenation
  if (transitionType !== 'none' && segments.length > 1) {
    const transitionFilter = TRANSITION_FILTERS[transitionType](transitionDuration);
    
    // Chain transitions
    let prevOutput = 'v0';
    for (let i = 1; i < segments.length; i++) {
      const output = i === segments.length - 1 ? 'vout' : `vt${i}`;
      filters.push(`[${prevOutput}][v${i}]${transitionFilter}[${output}]`);
      prevOutput = output;
    }
  } else {
    // Simple concatenation
    const inputs = segments.map((_, idx) => `[v${idx}]`).join('');
    filters.push(`${inputs}concat=n=${segments.length}:v=1:a=0[vout]`);
  }
  
  // Audio concatenation with normalization
  const audioInputs = segments.map((_, idx) => `[${idx}:a]`).join('');
  if (request.normalizeAudio) {
    filters.push(`${audioInputs}concat=n=${segments.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
  } else {
    filters.push(`${audioInputs}concat=n=${segments.length}:v=0:a=1[aout]`);
  }
  
  return filters.join(';');
};

/**
 * Generate complete FFmpeg command for composition
 */
export const generateFFmpegCommand = (request: CompositionRequest): FFmpegCommand => {
  const inputs = request.segments.map(s => s.videoUrl);
  const filterComplex = generateFFmpegFilterComplex(request);
  
  const codecSettings = CODEC_SETTINGS[request.videoCodec];
  const resolution = request.format === '9:16' 
    ? RESOLUTION_PRESETS_VERTICAL[request.resolution]
    : RESOLUTION_PRESETS[request.resolution];
  
  const outputOptions: string[] = [
    `-map "[vout]"`,
    `-map "[aout]"`,
    `-c:v ${request.videoCodec === 'h265' ? 'libx265' : request.videoCodec === 'vp9' ? 'libvpx-vp9' : 'libx264'}`,
    `-preset ${codecSettings.preset || 'medium'}`,
    `-crf ${codecSettings.crf}`,
    `-c:a ${request.audioCodec === 'aac' ? 'aac' : request.audioCodec === 'opus' ? 'libopus' : 'libmp3lame'}`,
    `-b:a ${request.audioBitrate || '192k'}`,
    `-movflags +faststart` // Enable progressive download
  ];
  
  if (request.videoBitrate) {
    outputOptions.push(`-b:v ${request.videoBitrate}`);
  }
  
  return {
    inputs,
    filterComplex,
    outputOptions,
    estimatedDuration: estimateTotalDuration(request)
  };
};

// =============================================================================================
// BACKEND API INTERFACE
// =============================================================================================

/**
 * Get the composition backend URL
 */
const getCompositionBackendUrl = (): string => {
  return import.meta.env.VITE_COMPOSITION_BACKEND_URL || 
         import.meta.env.VITE_BACKEND_URL || 
         '';
};

/**
 * Submit a composition job to the backend
 * The backend should have an endpoint like POST /api/compose
 */
export const submitCompositionJob = async (
  request: CompositionRequest
): Promise<{ jobId: string; estimatedTime: number } | null> => {
  const backendUrl = getCompositionBackendUrl();
  
  if (!backendUrl) {
    console.warn('⚠️ [VideoCompositor] No composition backend URL configured');
    console.warn('⚠️ [VideoCompositor] Set VITE_COMPOSITION_BACKEND_URL to enable server-side rendering');
    return null;
  }
  
  try {
    console.log(`🎬 [VideoCompositor] Submitting composition job to ${backendUrl}/api/compose`);
    
    const response = await fetch(`${backendUrl}/api/compose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    
    const result = await response.json();
    
    // Track estimated cost
    const estimatedCost = estimateProcessingCost(request);
    CostTracker.track('composition', 'ffmpeg-backend', estimatedCost);
    
    console.log(`✅ [VideoCompositor] Job submitted: ${result.jobId}`);
    return result;
  } catch (error) {
    console.error('❌ [VideoCompositor] Failed to submit job:', (error as Error).message);
    return null;
  }
};

/**
 * Poll for composition job status
 */
export const pollCompositionJob = async (
  jobId: string,
  maxWaitMs: number = 600000 // 10 minutes
): Promise<CompositionResult> => {
  const backendUrl = getCompositionBackendUrl();
  
  if (!backendUrl) {
    return { success: false, error: 'No backend configured' };
  }
  
  const startTime = Date.now();
  const pollInterval = 5000; // 5 seconds
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`${backendUrl}/api/compose/${jobId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.status === 'completed') {
        console.log(`✅ [VideoCompositor] Job ${jobId} completed`);
        return {
          success: true,
          videoUrl: result.videoUrl,
          thumbnailUrl: result.thumbnailUrl,
          duration: result.duration,
          fileSize: result.fileSize,
          processingTime: Date.now() - startTime
        };
      }
      
      if (result.status === 'failed') {
        console.error(`❌ [VideoCompositor] Job ${jobId} failed:`, result.error);
        return {
          success: false,
          error: result.error,
          processingTime: Date.now() - startTime
        };
      }
      
      // Still processing
      console.log(`⏳ [VideoCompositor] Job ${jobId} progress: ${result.progress || 0}%`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
    } catch (error) {
      console.warn(`⚠️ [VideoCompositor] Poll error:`, (error as Error).message);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
  
  return {
    success: false,
    error: 'Timeout waiting for composition',
    processingTime: maxWaitMs
  };
};

/**
 * Full composition workflow: submit job and wait for result
 */
export const composeVideo = async (
  request: CompositionRequest
): Promise<CompositionResult> => {
  // Submit job
  const job = await submitCompositionJob(request);
  
  if (!job) {
    // Fallback: return instructions for manual processing
    const ffmpegCommand = generateFFmpegCommand(request);
    console.log('📝 [VideoCompositor] FFmpeg command for manual processing:');
    console.log(JSON.stringify(ffmpegCommand, null, 2));
    
    return {
      success: false,
      error: 'No backend available. See console for FFmpeg command.'
    };
  }
  
  // Poll for result
  return pollCompositionJob(job.jobId);
};

// =============================================================================================
// BROWSER-BASED FALLBACK (using MediaRecorder)
// =============================================================================================

/**
 * Check if browser-based composition is available
 */
export const isBrowserCompositionAvailable = (): boolean => {
  return typeof MediaRecorder !== 'undefined' && 
         typeof MediaSource !== 'undefined' &&
         MediaRecorder.isTypeSupported('video/webm;codecs=vp9');
};

/**
 * Get supported MIME types for browser recording
 */
export const getSupportedMimeTypes = (): string[] => {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4'
  ];
  
  return types.filter(type => MediaRecorder.isTypeSupported(type));
};

/**
 * Export composition utilities for use in backend
 */
export const COMPOSITOR_UTILS = {
  RESOLUTION_PRESETS,
  RESOLUTION_PRESETS_VERTICAL,
  CODEC_SETTINGS,
  TRANSITION_FILTERS,
  generateFFmpegFilterComplex,
  generateFFmpegCommand
};
