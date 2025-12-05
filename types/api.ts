/**
 * API Types
 * 
 * Type definitions for external API requests and responses.
 * Helps reduce the use of `any` in the codebase.
 */

// =============================================================================
// OPENAI TYPES
// =============================================================================

export interface OpenAIRequestOptions {
  retries?: number;
  timeout?: number;
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' | 'text' };
}

export interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAITTSRequest {
  model: string;
  input: string;
  voice: string;
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac';
  speed?: number;
}

export interface OpenAIImageRequest {
  model: string;
  prompt: string;
  n?: number;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  response_format?: 'url' | 'b64_json';
}

export interface OpenAIImageResponse {
  data: Array<{
    url?: string;
    b64_json?: string;
  }>;
}

// =============================================================================
// SERPAPI TYPES
// =============================================================================

export interface SerpAPINewsItem {
  title: string;
  link: string;
  source?: { name: string };
  snippet?: string;
  thumbnail?: string;
  thumbnail_small?: string;
  date?: string;
  iso_date?: string;
}

export interface SerpAPIGroupedStory {
  highlight?: SerpAPINewsItem;
  stories?: SerpAPINewsItem[];
}

export interface SerpAPIResponse {
  news_results?: (SerpAPINewsItem | SerpAPIGroupedStory)[];
  error?: string;
}

// =============================================================================
// WAVESPEED TYPES
// =============================================================================

export interface WavespeedTaskResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  id?: string;
  output?: {
    video_url?: string;
    image_url?: string;
  };
  error?: string;
}

export interface WavespeedCreateTaskRequest {
  prompt?: string;
  audio_url?: string;
  reference_image_url?: string;
  aspect_ratio?: '16:9' | '9:16';
}

// =============================================================================
// SHOTSTACK TYPES
// =============================================================================

export interface ShotstackClip {
  asset: {
    type: string;
    src?: string;
    text?: string;
    html?: string;
    [key: string]: unknown;
  };
  start: number;
  length: number;
  fit?: 'cover' | 'contain' | 'crop' | 'none';
  position?: 'center' | 'top' | 'bottom' | 'left' | 'right';
  offset?: { x: number; y: number };
  transition?: {
    in?: string;
    out?: string;
  };
  effect?: string;
  filter?: string;
  opacity?: number;
  transform?: {
    rotate?: { angle: number };
    skew?: { x: number; y: number };
    flip?: { horizontal: boolean; vertical: boolean };
  };
  [key: string]: unknown;
}

export interface ShotstackTrack {
  clips: ShotstackClip[];
}

export interface ShotstackTimeline {
  soundtrack?: {
    src: string;
    effect?: string;
  };
  background?: string;
  tracks: ShotstackTrack[];
  fonts?: Array<{ src: string }>;
}

export interface ShotstackOutput {
  format: 'mp4' | 'gif' | 'webm';
  resolution: 'hd' | 'sd' | '1080' | '720' | '480';
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5' | '4:3';
  fps?: number;
  quality?: 'low' | 'medium' | 'high';
}

export interface ShotstackRenderRequest {
  timeline: ShotstackTimeline;
  output: ShotstackOutput;
}

export interface ShotstackRenderResponse {
  success: boolean;
  message: string;
  response: {
    id: string;
    message: string;
  };
}

export interface ShotstackStatusResponse {
  success: boolean;
  response: {
    id: string;
    status: 'queued' | 'fetching' | 'rendering' | 'saving' | 'done' | 'failed';
    url?: string;
    error?: string;
    data?: {
      output?: {
        url: string;
      };
    };
  };
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export interface APIError {
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
}

export type APIResult<T> = 
  | { success: true; data: T }
  | { success: false; error: APIError };

// =============================================================================
// RETRY TYPES
// =============================================================================

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, error: Error) => void;
  shouldRetry?: (error: Error) => boolean;
}

export interface BatchResult<T, R> {
  item: T;
  result: R | null;
  error: Error | null;
}
