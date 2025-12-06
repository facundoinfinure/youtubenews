/**
 * Application Constants
 * 
 * Centralized configuration values to avoid magic numbers
 * and make the codebase more maintainable.
 */

// =============================================================================
// TIMING CONSTANTS (milliseconds)
// =============================================================================

export const TIMING = {
  /** Duration of intro video in player (6 seconds for branding impact) */
  INTRO_DURATION_MS: 6000,
  
  /** Duration of outro video in player */
  OUTRO_DURATION_MS: 6000,
  
  /** Default cache TTL (1 hour) */
  CACHE_TTL_DEFAULT_MS: 3600000,
  
  /** Extended cache TTL (24 hours) */
  CACHE_TTL_EXTENDED_MS: 86400000,
  
  /** Trending cache TTL (2 hours) */
  CACHE_TTL_TRENDING_MS: 7200000,
  
  /** API request timeout */
  API_TIMEOUT_MS: 55000,
  
  /** Polling interval for video generation */
  VIDEO_POLL_INTERVAL_MS: 10000, // 10 seconds (reduced frequency for long-running tasks)
  
  /** Maximum wait time for video generation (15 minutes - WaveSpeed can take 400-700s) */
  VIDEO_MAX_WAIT_MS: 900000, // 15 minutes
  
  /** Stagger delay between parallel video requests */
  VIDEO_STAGGER_DELAY_MS: 500, // 500ms between each video task start
  
  /** Average expected video generation time (for progress estimates) */
  VIDEO_AVG_GENERATION_MS: 400000, // ~6.7 minutes average
} as const;

// =============================================================================
// LIMITS
// =============================================================================

export const LIMITS = {
  /** Maximum news items to display */
  MAX_NEWS_ITEMS: 20,
  
  /** Maximum selected news items */
  MAX_SELECTED_NEWS: 15,
  
  /** Maximum segments to process */
  MAX_SEGMENTS: 20,
  
  /** Maximum log entries to keep */
  MAX_LOG_ENTRIES: 50,
  
  /** Maximum cost entries to store */
  MAX_COST_ENTRIES: 1000,
  
  /** Maximum cache entries to preload */
  MAX_CACHE_PRELOAD: 100,
  
  /** Sidebar items count */
  SIDEBAR_ITEMS_COUNT: 4,
  
  /** Completed productions to show */
  MAX_COMPLETED_PRODUCTIONS: 10,
  
  /** Concurrent batch operations */
  BATCH_CONCURRENCY: 3,
  
  /** API retry attempts */
  MAX_RETRIES: 3,
  
  /** Video generation retries */
  MAX_VIDEO_RETRIES: 3,
} as const;

// =============================================================================
// API COSTS (USD)
// =============================================================================

export const API_COSTS = {
  /** Cost per SerpAPI search */
  SERPAPI_SEARCH: 0.01,
  
  /** Average cost per cached call (for savings calculation) */
  AVERAGE_CACHED_CALL: 0.025,
  
  /** Estimated cost per TTS call */
  TTS_CALL: 0.015,
  
  /** Estimated cost per script generation */
  SCRIPT_GENERATION: 0.05,
} as const;

// =============================================================================
// STORAGE
// =============================================================================

export const STORAGE = {
  /** Main assets bucket name */
  BUCKET_CHANNEL_ASSETS: 'channel-assets',
  
  /** Productions subfolder */
  FOLDER_PRODUCTIONS: 'productions',
  
  /** Audio subfolder */
  FOLDER_AUDIO: 'audio',
  
  /** Images subfolder */
  FOLDER_IMAGES: 'channel-images',
  
  /** Videos subfolder */
  FOLDER_VIDEOS: 'videos',
} as const;

// =============================================================================
// RETRY CONFIGURATION
// =============================================================================

export const RETRY = {
  /** Base delay for exponential backoff */
  BASE_DELAY_MS: 1000,
  
  /** Maximum delay between retries */
  MAX_DELAY_MS: 10000,
  
  /** Video generation specific delays */
  VIDEO_BASE_DELAY_MS: 2000,
  VIDEO_MAX_DELAY_MS: 30000,
} as const;

// =============================================================================
// UI DEFAULTS
// =============================================================================

export const UI = {
  /** Toast notification duration */
  TOAST_DURATION_MS: 5000,
  
  /** Default date format */
  DATE_FORMAT: 'YYYY-MM-DD',
  
  /** Animation duration */
  ANIMATION_DURATION_MS: 300,
} as const;

// =============================================================================
// VIDEO CONFIGURATION
// =============================================================================

export const VIDEO = {
  /** Available aspect ratios */
  ASPECT_RATIOS: ['16:9', '9:16'] as const,
  
  /** Default aspect ratio */
  DEFAULT_ASPECT_RATIO: '16:9' as const,
  
  /** Shot types */
  SHOT_TYPES: ['medium', 'closeup', 'wide'] as const,
  
  /** Video modes */
  VIDEO_MODES: ['hostA', 'hostB', 'both'] as const,
} as const;

// =============================================================================
// NARRATIVE TYPES
// =============================================================================

export const NARRATIVE = {
  /** Available narrative structures */
  TYPES: ['classic', 'double_conflict', 'hot_take', 'perspective_clash'] as const,
  
  /** Scene counts per narrative type */
  SCENE_COUNTS: {
    classic: 6,
    double_conflict: 7,
    hot_take: 4,
    perspective_clash: 6,
  } as const,
} as const;

// =============================================================================
// ERROR MESSAGES
// =============================================================================

export const ERRORS = {
  SUPABASE_NOT_INITIALIZED: 'Supabase not initialized',
  BUCKET_NOT_FOUND: 'Storage bucket not found',
  UNAUTHORIZED: 'unauthorized',
  INVALID_KEY: 'invalid key',
  PERMISSION_DENIED: 'permission denied',
  NOT_FOUND: 'not found',
  RATE_LIMIT: 'rate limit',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
} as const;

// =============================================================================
// VOICE CONFIGURATION
// =============================================================================

export const VOICES = {
  /** Available OpenAI TTS voices */
  OPENAI: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const,
  
  /** Default voice for host A */
  DEFAULT_HOST_A: 'echo',
  
  /** Default voice for host B */
  DEFAULT_HOST_B: 'shimmer',
} as const;
