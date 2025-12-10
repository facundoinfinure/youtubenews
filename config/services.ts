/**
 * Services Configuration
 * 
 * Centralized configuration for all external services.
 * Change settings here instead of in individual service files.
 */

/**
 * OpenAI Service Configuration
 */
export const openaiConfig = {
  /** Primary model for text generation */
  primaryModel: 'gpt-4o',
  /** Fallback model when primary fails */
  fallbackModel: 'gpt-4o-mini',
  /** Request timeout in milliseconds */
  timeout: 55000,
  /** Shorter timeout for first try (allows faster fallback) */
  shortTimeout: 45000,
  /** Number of retry attempts */
  retries: 2,
  /** TTS model for English (faster, cheaper) */
  ttsModel: 'tts-1',
  /** TTS model for non-English languages (better pronunciation) */
  ttsModelHD: 'tts-1-hd',
  /** Default TTS voice */
  defaultVoice: 'alloy',
  /** Image generation model */
  imageModel: 'dall-e-3',
  /** Cost per 1000 characters for tts-1 */
  ttsCostPerThousand: 0.015,
  /** Cost per 1000 characters for tts-1-hd */
  ttsCostPerThousandHD: 0.030,
} as const;

/**
 * WaveSpeed Service Configuration
 */
export const wavespeedConfig = {
  /** Default video resolution */
  resolution: '720p' as const,
  /** Poll interval for task status (ms) */
  pollInterval: 5000,
  /** Maximum wait time for task completion (ms) */
  maxWaitTime: 600000, // 10 minutes
  /** Cost per 5 seconds of 480p video */
  cost480p: 0.15,
  /** Cost per 5 seconds of 720p video */
  cost720p: 0.30,
  /** Multi model cost multiplier */
  multiModelMultiplier: 1.2,
} as const;

/**
 * Shotstack Service Configuration
 */
export const shotstackConfig = {
  /** Default output resolution */
  resolution: '1080' as const,
  /** Default transition type */
  transition: 'fade' as const,
  /** Default transition duration (seconds) */
  transitionDuration: 0.5,
  /** Poll interval for render status (ms) */
  pollInterval: 5000,
  /** Maximum wait time for render (ms) */
  maxWaitTime: 300000, // 5 minutes
  /** Approximate cost per minute of video */
  costPerMinute: 0.05,
} as const;

/**
 * SerpAPI Service Configuration
 */
export const serpApiConfig = {
  /** Cache TTL for news (ms) */
  newsCacheTtl: 3600000, // 1 hour
  /** Cache TTL for trending topics (ms) */
  trendingCacheTtl: 7200000, // 2 hours
  /** Cost per search */
  costPerSearch: 0.01,
} as const;

/**
 * Cache Configuration
 */
export const cacheConfig = {
  /** Default TTL (ms) */
  defaultTtl: 3600000, // 1 hour
  /** Extended TTL for rarely changing data (ms) */
  extendedTtl: 86400000, // 24 hours
  /** Maximum cache entries to preload */
  maxPreloadEntries: 100,
  /** Audio cache TTL (ms) */
  audioCacheTtl: 604800000, // 7 days
} as const;

/**
 * Retry Configuration
 */
export const retryConfig = {
  /** Base delay for exponential backoff (ms) */
  baseDelay: 1000,
  /** Maximum delay between retries (ms) */
  maxDelay: 10000,
  /** Default number of retries */
  maxRetries: 3,
  /** Video-specific base delay (ms) */
  videoBaseDelay: 2000,
  /** Video-specific max delay (ms) */
  videoMaxDelay: 30000,
  /** Video-specific retries */
  videoMaxRetries: 3,
} as const;

/**
 * Production Configuration
 */
export const productionConfig = {
  /** Batch size for parallel operations */
  batchConcurrency: 3,
  /** Maximum segments to process */
  maxSegments: 20,
  /** Maximum news items to fetch */
  maxNewsItems: 20,
  /** Maximum selected news for a production */
  maxSelectedNews: 15,
} as const;

/**
 * Cost Estimation Configuration
 * Used to calculate estimated production cost before starting
 */
export const costEstimation = {
  /** Cost per viral hook generation */
  viralHook: 0.005,
  /** Cost per script generation */
  script: 0.01,
  /** Cost per 1000 characters of TTS audio */
  ttsPerThousandChars: 0.015,
  /** Average characters per segment (estimate) */
  avgCharsPerSegment: 750,
  /** Cost per metadata generation */
  metadata: 0.015,
  /** Cost per thumbnail */
  thumbnail: 0.14,
  /** Cost per 5-second video segment */
  videoPerSegment: 0.30,
} as const;

/**
 * Calculate estimated cost for a production
 */
export const calculateEstimatedCost = (scriptLength: number): number => {
  let cost = 0;
  cost += costEstimation.viralHook;
  cost += costEstimation.script;
  cost += (scriptLength * costEstimation.avgCharsPerSegment / 1000) * costEstimation.ttsPerThousandChars;
  cost += costEstimation.metadata;
  cost += costEstimation.thumbnail * 2; // Two variants
  cost += scriptLength * costEstimation.videoPerSegment;
  return cost;
};
