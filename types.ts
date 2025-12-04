
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
export type VideoMode = "hostA" | "hostB" | "both";
export type ShotType = "medium" | "closeup" | "wide";

export interface Scene {
  text: string;
  video_mode: VideoMode;
  model: "infinite_talk" | "infinite_talk_multi";
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
  videoUrl?: string; // NEW: Specific video for this segment
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
  characters: {
    hostA: CharacterProfile;
    hostB: CharacterProfile;
  };
  // New fields for v2.0 Narrative Engine
  seedImages?: {
    hostASolo?: string; // Seed image prompt for hostA solo
    hostBSolo?: string; // Seed image prompt for hostB solo
    twoShot?: string; // Seed image prompt for both hosts
  };
  studioSetup?: string; // Description of the podcast studio setup
  preferredNarrative?: NarrativeType; // Optional preferred narrative (auto-selection if not set)
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
