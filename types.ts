
export interface NewsItem {
  id?: string; // UUID from database
  headline: string;
  source: string;
  url: string;
  summary: string;
  viralScore: number;
  viralScoreReasoning?: string; // Explanation of why this score was assigned
  imageKeyword: string;
  imageUrl?: string; // Real image URL from Google News
  publicationDate?: Date | string; // Actual publication date of the news article
}

export interface ScriptLine {
  speaker: string; // Changed from literal to string to support dynamic names
  text: string;
}

// Narrative Engine Types (v2.0)
export type NarrativeType = "classic" | "double_conflict" | "hot_take" | "perspective_clash";
export type VideoMode = "hostA" | "hostB"; // Removed "both" - each scene focuses on one character for dynamic pacing
export type ShotType = "medium" | "closeup" | "wide";

export interface Scene {
  // Scene title for lower-third overlay (e.g., "Market Outlook Explained")
  title?: string;
  
  // Dialogue for this scene (single host only)
  text: string;
  
  // Legacy fields for backwards compatibility (deprecated)
  hostA_text?: string;
  hostB_text?: string;
  order?: 'left_first' | 'right_first' | 'meanwhile';
  
  video_mode: VideoMode;
  model: "infinite_talk" | "infinite_talk_multi"; // infinite_talk_multi kept for backwards compat
  shot: ShotType;
}

export interface ScriptWithScenes {
  title: string;
  narrative_used: NarrativeType;
  scenes: Record<string, Scene>; // Key is scene number as string: "1", "2", etc.
}

export interface BroadcastSegment {
  speaker: string;
  text: string;
  audioBase64: string;
  videoUrl?: string; // Specific video for this segment
  audioUrl?: string; // URL to stored audio in Supabase storage
  audioDuration?: number; // Duration in seconds (from TTS or cache)
  sceneTitle?: string; // Title for lower-third overlay (from Narrative Engine)
  sceneIndex?: number; // Index of the scene (for ordering)
}

export interface VideoAssets {
  intro: string | null;
  outro: string | null;
  wide: string | null;
  hostA: string[]; // Renamed from rusty
  hostB: string[]; // Renamed from dani
}

export interface ViralMetadata {
  title: string;
  titleVariants?: string[]; // Optional array for A/B testing
  description: string;
  tags: string[];
}

export interface VideoAnalytics {
  views: number;
  ctr: number; // Click Through Rate percentage
  avgViewDuration: string; // "0:45"
  retentionData: number[]; // Array of percentages [100, 98, 90...]
}

export interface StoredVideo {
  id: string;
  created_at: string;
  title: string;
  description: string;
  youtube_id: string | null;
  viral_score: number;
  tags?: string[]; // Added tags
  analytics?: VideoAnalytics;
  thumbnail_url?: string; // NEW: Stored thumbnail
  is_posted: boolean; // NEW: Posted status
}

export enum AppState {
  LOGIN = 'LOGIN',
  ADMIN_DASHBOARD = 'ADMIN_DASHBOARD', // New State
  IDLE = 'IDLE',
  FETCHING_NEWS = 'FETCHING_NEWS',
  SELECTING_NEWS = 'SELECTING_NEWS',
  GENERATING_SCRIPT = 'GENERATING_SCRIPT',
  PREVIEW = 'PREVIEW', // NEW: Show script preview while media generates
  GENERATING_MEDIA = 'GENERATING_MEDIA',
  READY = 'READY',
  ERROR = 'ERROR'
}

export interface GeneratedContent {
  news: NewsItem[];
  script: ScriptLine[];
  segments: BroadcastSegment[];
  videos: VideoAssets;
}

export interface UserProfile {
  email: string;
  name: string;
  picture: string;
  accessToken: string;
}

// Configuration Types
export interface CharacterProfile {
  id: 'hostA' | 'hostB';
  name: string;
  bio: string; // Personality, political stance
  visualPrompt: string; // Description for Veo
  voiceName: string; // TTS Voice ID
  voiceStyle?: 'energetic' | 'calm' | 'dramatic' | 'neutral'; // Voice emotion/style
  speakingRate?: number; // 0.5 - 2.0, default 1.0
  pitch?: number; // -20 to +20, default 0
  // New fields for v2.0 Narrative Engine
  outfit?: string; // e.g., "dark hoodie", "teal blazer and white shirt"
  personality?: string; // Detailed personality description
  gender?: "male" | "female";
}

// Shotstack Render Configuration Types
export type ShotstackTransitionType = 
  | 'none' | 'fade' | 'fadeSlow' | 'fadeFast'
  | 'reveal' | 'revealSlow' | 'revealFast'
  | 'wipeLeft' | 'wipeRight' | 'slideLeft' | 'slideRight'
  | 'slideUp' | 'slideDown' | 'zoom';

export type ShotstackEffectType = 
  | 'none' | 'zoomIn' | 'zoomInSlow' | 'zoomInFast'
  | 'zoomOut' | 'zoomOutSlow' | 'zoomOutFast'
  | 'slideLeft' | 'slideRight' | 'slideUp' | 'slideDown';

export type ShotstackFilterType = 
  | 'none' | 'boost' | 'contrast' | 'darken' 
  | 'greyscale' | 'lighten' | 'muted' | 'blur';

export interface RenderConfig {
  // Transitions
  transition: {
    type: ShotstackTransitionType;
    duration: number; // seconds (0.3 - 2.0)
  };
  
  // Motion Effects
  effects: {
    clipEffect: ShotstackEffectType; // Applied to each clip
    filter: ShotstackFilterType; // Visual filter
    autoEffectRotation: boolean; // Auto-rotate effects for variety
  };
  
  // Watermark/Logo
  watermark?: {
    enabled: boolean;
    url?: string;
    position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
    opacity: number; // 0-1
    scale: number; // 0.1-1
  };
  
  // Output Quality
  output: {
    resolution: 'sd' | 'hd' | '1080' | '4k';
    fps: 24 | 25 | 30 | 60;
    quality: 'low' | 'medium' | 'high' | 'highest';
  };
  
  // Overlays
  overlays: {
    showBreakingNews: boolean;
    breakingNewsText?: string;
    showDate: boolean;
    showHostNames: boolean;
    showLiveIndicator: boolean;
  };
  
  // Background Music
  backgroundMusic?: {
    enabled: boolean;
    url?: string;
    volume: number; // 0-1
  };
  
  // === NEWS-STYLE OVERLAYS (v2.4) - Professional TV Broadcast Look ===
  newsStyle?: {
    enabled: boolean;
    
    // Lower Third Banner (headline bar at bottom)
    lowerThird: {
      enabled: boolean;
      primaryColor: string;    // Banner color (default: #ff0000)
      secondaryColor: string;  // Badge background (default: #000000)
      textColor: string;       // Text color (default: #ffffff)
      category?: string;       // e.g., "BREAKING NEWS", "ECONOMÍA", "TECH"
    };
    
    // Channel branding watermark
    showChannelBranding: boolean;
  };
}

// Default render configuration
export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  transition: {
    type: 'fade',
    duration: 0.5
  },
  effects: {
    clipEffect: 'zoomInSlow',
    filter: 'none',
    autoEffectRotation: true
  },
  watermark: {
    enabled: false,
    position: 'bottomRight',
    opacity: 0.7,
    scale: 0.15
  },
  output: {
    resolution: '1080',
    fps: 30,
    quality: 'high'
  },
  overlays: {
    showBreakingNews: false,
    showDate: true,
    showHostNames: true,
    showLiveIndicator: false
  },
  backgroundMusic: {
    enabled: false,
    volume: 0.1
  },
  // News-style overlays defaults
  newsStyle: {
    enabled: false,
    lowerThird: {
      enabled: false,
      primaryColor: '#ff0000',
      secondaryColor: '#000000',
      textColor: '#ffffff',
      category: 'BREAKING NEWS'
    },
    showChannelBranding: true
  }
};

export interface ChannelConfig {
  channelName: string;
  tagline: string;
  country: string; // "USA", "Argentina"
  language: string; // "English", "Spanish"
  format: '16:9' | '9:16'; // Landscape or Shorts
  tone: string; // "Sarcastic", "Serious", "Chaotic"
  logoColor1: string; // Hex
  logoColor2: string; // Hex
  captionsEnabled: boolean;
  defaultTags?: string[]; // Added for default tags
  referenceImageUrl?: string; // NEW: Reference image for visual consistency
  topicToken?: string; // Google News topic token for news fetching (e.g., Business, Argentina, etc.)
  characters: {
    hostA: CharacterProfile;
    hostB: CharacterProfile;
  };
  // New fields for v2.0 Narrative Engine
  seedImages?: {
    hostASolo?: string; // Seed image prompt for hostA solo
    hostBSolo?: string; // Seed image prompt for hostB solo
    twoShot?: string; // Seed image prompt for both hosts
    // Image URLs for 16:9 format (landscape)
    hostASoloUrl?: string;
    hostBSoloUrl?: string;
    twoShotUrl?: string;
    // Image URLs for 9:16 format (vertical/shorts)
    hostASoloUrl_9_16?: string;
    hostBSoloUrl_9_16?: string;
    twoShotUrl_9_16?: string;
  };
  studioSetup?: string; // Description of the podcast studio setup
  preferredNarrative?: NarrativeType; // Optional preferred narrative (auto-selection if not set)
  // Render settings (v2.3)
  renderConfig?: RenderConfig; // Shotstack render configuration
}

export interface Channel {
  id: string;
  created_at: string;
  name: string;
  config: ChannelConfig;
  active: boolean;
}

// Production Types
export type ProductionStatus = 'draft' | 'in_progress' | 'completed' | 'failed';

// =============================================================================================
// PRODUCTION WIZARD - Step-by-step flow (v2.4)
// =============================================================================================

/**
 * Main production steps - the wizard progresses through these in order
 */
export type ProductionStep = 
  | 'news_fetch'      // Step 1: Fetch news from sources
  | 'news_select'     // Step 2: User selects which news to use
  | 'script_generate' // Step 3: Generate scripts/scenes
  | 'script_review'   // Step 4: User reviews/edits scripts
  | 'audio_generate'  // Step 5: Generate audio for each segment
  | 'video_generate'  // Step 6: Generate video for each segment
  | 'render_final'    // Step 7: Render final composition
  | 'publish'         // Step 8: Publish to YouTube
  | 'done';           // Complete

/**
 * Sub-step status within a main step
 */
export type SubStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

/**
 * Detailed progress tracking for each sub-step
 */
export interface SubStepProgress {
  status: SubStepStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  retryCount?: number;
  data?: any; // Step-specific data
}

/**
 * Progress tracking for the entire production wizard
 */
export interface ProductionWizardState {
  currentStep: ProductionStep;
  
  // Step 1: News fetching
  newsFetch: SubStepProgress & {
    data?: {
      fetchedNews?: NewsItem[];
      fetchedAt?: string;
      source?: string;
    };
  };
  
  // Step 2: News selection
  newsSelect: SubStepProgress & {
    data?: {
      selectedIds?: string[];
      confirmedAt?: string;
    };
  };
  
  // Step 3: Script generation
  scriptGenerate: SubStepProgress & {
    data?: {
      narrativeType?: NarrativeType;
      generatedAt?: string;
    };
  };
  
  // Step 4: Script review (user can edit)
  scriptReview: SubStepProgress & {
    data?: {
      editedByUser?: boolean;
      approvedAt?: string;
    };
  };
  
  // Step 5: Audio generation - tracks each segment
  audioGenerate: SubStepProgress & {
    data?: {
      totalSegments?: number;
      completedSegments?: number;
      segmentProgress?: Record<number, SubStepProgress>;
    };
  };
  
  // Step 6: Video generation - tracks each segment
  videoGenerate: SubStepProgress & {
    data?: {
      totalSegments?: number;
      completedSegments?: number;
      segmentProgress?: Record<number, SubStepProgress>;
    };
  };
  
  // Step 7: Final render
  renderFinal: SubStepProgress & {
    data?: {
      renderId?: string;
      renderStartedAt?: string;
      videoUrl?: string;
      posterUrl?: string;
    };
  };
  
  // Step 8: YouTube publish
  publish: SubStepProgress & {
    data?: {
      youtubeId?: string;
      publishedAt?: string;
      isShort?: boolean;
    };
  };
}

/**
 * Default empty wizard state
 */
export const createEmptyWizardState = (): ProductionWizardState => ({
  currentStep: 'news_fetch',
  newsFetch: { status: 'pending' },
  newsSelect: { status: 'pending' },
  scriptGenerate: { status: 'pending' },
  scriptReview: { status: 'pending' },
  audioGenerate: { status: 'pending' },
  videoGenerate: { status: 'pending' },
  renderFinal: { status: 'pending' },
  publish: { status: 'pending' }
});

/**
 * Get the next step in the wizard
 */
export const getNextProductionStep = (current: ProductionStep): ProductionStep | null => {
  const steps: ProductionStep[] = [
    'news_fetch', 'news_select', 'script_generate', 'script_review',
    'audio_generate', 'video_generate', 'render_final', 'publish', 'done'
  ];
  const currentIndex = steps.indexOf(current);
  return currentIndex < steps.length - 1 ? steps[currentIndex + 1] : null;
};

/**
 * Get human-readable step name
 */
export const getStepDisplayName = (step: ProductionStep): string => {
  const names: Record<ProductionStep, string> = {
    'news_fetch': '📰 Buscar Noticias',
    'news_select': '✅ Seleccionar Noticias',
    'script_generate': '📝 Generar Guiones',
    'script_review': '👁️ Revisar Guiones',
    'audio_generate': '🎙️ Generar Audios',
    'video_generate': '🎬 Generar Videos',
    'render_final': '🎞️ Renderizar Final',
    'publish': '📺 Publicar',
    'done': '✅ Completado'
  };
  return names[step];
};

/**
 * Get step number (1-8)
 */
export const getStepNumber = (step: ProductionStep): number => {
  const steps: ProductionStep[] = [
    'news_fetch', 'news_select', 'script_generate', 'script_review',
    'audio_generate', 'video_generate', 'render_final', 'publish', 'done'
  ];
  return steps.indexOf(step) + 1;
};

// Segment resource status for incremental regeneration
export type SegmentResourceState = 'pending' | 'generating' | 'done' | 'failed';

export interface SegmentStatus {
  audio: SegmentResourceState;
  video: SegmentResourceState;
  audioUrl?: string;
  videoUrl?: string;
  lastUpdated?: string;
  error?: string;
}

export interface Production {
  id: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  channel_id: string;
  news_date: string; // ISO date string
  status: ProductionStatus;
  selected_news_ids: string[];
  script?: ScriptLine[]; // Legacy format, kept for compatibility
  viral_hook?: string;
  viral_metadata?: ViralMetadata;
  segments?: BroadcastSegment[]; // Without audioBase64, only metadata
  video_assets?: VideoAssets;
  thumbnail_urls?: string[];
  progress_step: number;
  user_id?: string;
  version?: number; // Version number (1, 2, 3...)
  parent_production_id?: string; // Link to parent production for versioning
  // New fields for checkpoint and cost tracking
  checkpoint_data?: any; // Intermediate state for granular recovery
  last_checkpoint_at?: string; // Timestamp of last checkpoint
  failed_steps?: string[]; // Array of failed step identifiers
  estimated_cost?: number; // Estimated cost before generation
  actual_cost?: number; // Actual cost after completion
  cost_breakdown?: Record<string, number>; // Cost breakdown by task type
  // New fields for v2.0 Narrative Engine
  narrative_used?: NarrativeType; // Which narrative structure was used
  scenes?: ScriptWithScenes; // Complete scene structure with metadata
  // New field for granular segment tracking (v2.1)
  segment_status?: Record<number, SegmentStatus>; // Per-segment resource status
  // Final video and publishing fields (v2.2)
  final_video_url?: string; // URL of rendered final video from Shotstack
  final_video_poster?: string; // Poster/thumbnail from Shotstack
  youtube_id?: string; // YouTube video ID after publishing
  published_at?: string; // When it was published to YouTube
  // Wizard state for step-by-step flow (v2.4)
  wizard_state?: ProductionWizardState; // Detailed step-by-step progress tracking
  fetched_news?: NewsItem[]; // Cached fetched news for this production
}

// Window augmentation for AI Studio key selection & Google Identity & Runtime Env
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
    webkitAudioContext: typeof AudioContext;
    // Runtime environment variables injected by env.sh
    env?: {
      API_KEY?: string;
      googlecloud_clientid?: string;
      VITE_SUPABASE_URL?: string;
      VITE_SUPABASE_ANON_KEY?: string;
      ADMIN_EMAIL?: string;
      WAVESPEED_API_KEY?: string;
      WAVESPEED_MODEL?: string;
    };
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: any) => void;
          }) => { requestAccessToken: () => void };
        }
      }
    }
  }
}
