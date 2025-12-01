
export interface NewsItem {
  headline: string;
  source: string;
  url: string;
  summary: string;
  viralScore: number;
  imageKeyword: string;
}

export interface ScriptLine {
  speaker: string; // Changed from literal to string to support dynamic names
  text: string;
}

export interface BroadcastSegment {
  speaker: string;
  text: string;
  audioBase64: string;
}

export interface VideoAssets {
  wide: string | null;
  hostA: string[]; // Renamed from rusty
  hostB: string[]; // Renamed from dani
}

export interface ViralMetadata {
  title: string;
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
  analytics?: VideoAnalytics;
}

export enum AppState {
  LOGIN = 'LOGIN',
  ADMIN_DASHBOARD = 'ADMIN_DASHBOARD', // New State
  IDLE = 'IDLE',
  FETCHING_NEWS = 'FETCHING_NEWS',
  SELECTING_NEWS = 'SELECTING_NEWS',
  GENERATING_SCRIPT = 'GENERATING_SCRIPT',
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
  characters: {
    hostA: CharacterProfile;
    hostB: CharacterProfile;
  };
}

// Window augmentation for AI Studio key selection & Google Identity & Runtime Env
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    webkitAudioContext: typeof AudioContext;
    // Runtime environment variables injected by env.sh
    env?: {
      API_KEY?: string;
      googlecloud_clientid?: string;
      VITE_SUPABASE_URL?: string;
      VITE_SUPABASE_ANON_KEY?: string;
      ADMIN_EMAIL?: string;
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
