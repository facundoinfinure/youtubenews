
import { createClient } from '@supabase/supabase-js';
import { ChannelConfig, StoredVideo, ViralMetadata } from '../types';

// Initialize Client with Runtime Fallbacks
const getSupabaseUrl = () => import.meta.env.VITE_SUPABASE_URL || window.env?.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const getSupabaseKey = () => import.meta.env.VITE_SUPABASE_ANON_KEY || window.env?.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabaseUrl = getSupabaseUrl();
const supabaseKey = getSupabaseKey();

export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export const signInWithGoogle = async () => {
  if (!supabase) throw new Error("Supabase not initialized");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      scopes: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'
    }
  });
  if (error) throw error;
  return data;
};

export const signOut = async () => {
  if (!supabase) return;
  await supabase.auth.signOut();
};

export const getSession = async () => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
};


export const saveConfigToDB = async (config: ChannelConfig) => {
  if (!supabase) return;
  // We assume a single config row with ID 1 for simplicity in this demo
  const { error } = await supabase
    .from('channel_settings')
    .upsert({ id: 1, config });

  if (error) console.error("Error saving config:", error);
};

export const loadConfigFromDB = async (): Promise<ChannelConfig | null> => {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('channel_settings')
    .select('config')
    .eq('id', 1)
    .single();

  if (error || !data) {
    console.log("No remote config found or error:", error);
    return null;
  }
  return data.config as ChannelConfig;
};

export const saveVideoToDB = async (
  metadata: ViralMetadata,
  youtubeId: string | null = null,
  viralScorePrediction: number = 85
) => {
  if (!supabase) return;

  // Mock analytics for the new video
  const mockRetention = Array.from({ length: 20 }, (_, i) => 100 - (i * (Math.random() * 2 + 1)));

  const { error } = await supabase
    .from('videos')
    .insert({
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      youtube_id: youtubeId,
      viral_score: viralScorePrediction,
      views: 0,
      ctr: Math.floor(Math.random() * 5) + 2, // Mock CTR 2-7%
      avg_view_duration: "0:00",
      retention_data: mockRetention
    });

  if (error) console.error("Error saving video:", error);
};

export const fetchVideosFromDB = async (): Promise<StoredVideo[]> => {
  if (!supabase) {
    // Return Mock Data if Supabase not connected
    return [
      {
        id: 'mock-1',
        created_at: new Date(Date.now() - 86400000).toISOString(),
        title: 'MARKET CRASH IMMINENT?! 📉 (ChimpNews Explain)',
        description: 'Mock description...',
        youtube_id: 'mock_vid_1',
        viral_score: 92,
        analytics: {
          views: 12500,
          ctr: 5.4,
          avgViewDuration: "0:48",
          retentionData: [100, 95, 92, 88, 85, 80, 75, 70, 68, 65, 60, 55, 50, 48, 45]
        }
      },
      {
        id: 'mock-2',
        created_at: new Date(Date.now() - 172800000).toISOString(),
        title: 'TECH STOCKS RALLY 🚀',
        description: 'Mock description...',
        youtube_id: 'mock_vid_2',
        viral_score: 78,
        analytics: {
          views: 8200,
          ctr: 4.1,
          avgViewDuration: "0:35",
          retentionData: [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]
        }
      }
    ];
  }

  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching videos:", error);
    return [];
  }

  // Map flat DB structure to typed object
  return data.map((row: any) => ({
    id: row.id,
    created_at: row.created_at,
    title: row.title,
    description: row.description,
    youtube_id: row.youtube_id,
    viral_score: row.viral_score,
    analytics: {
      views: row.views || 0,
      ctr: row.ctr || 0,
      avgViewDuration: row.avg_view_duration || "0:00",
      retentionData: row.retention_data || []
    }
  }));
};
