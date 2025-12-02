
import { createClient } from '@supabase/supabase-js';
import { ChannelConfig, StoredVideo, ViralMetadata, NewsItem, Channel } from '../types';

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
      redirectTo: import.meta.env.VITE_AUTH_REDIRECT_URL || window.location.origin,
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
  channelId: string,
  youtubeId: string | null = null,
  viralScorePrediction: number = 0,
  thumbnailUrl?: string
) => {
  if (!supabase) return;

  const { error } = await supabase
    .from('videos')
    .insert({
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      youtube_id: youtubeId,
      viral_score: viralScorePrediction,
      views: 0,
      ctr: 0,
      avg_view_duration: "0:00",
      retention_data: [],
      channel_id: channelId,
      thumbnail_url: thumbnailUrl,
      is_posted: youtubeId !== null // If has youtube_id, it's posted
    });

  if (error) console.error("Error saving video:", error);
};

export const deleteVideoFromDB = async (id: string) => {
  if (!supabase) {
    console.error("[DELETE] Supabase not initialized");
    throw new Error("Database not available");
  }

  console.log(`[DELETE] Attempting to delete video: ${id}`);

  const { error, data } = await supabase
    .from('videos')
    .delete()
    .eq('id', id)
    .select(); // Add select() to return deleted rows

  if (error) {
    console.error("[DELETE] Supabase error:", error);
    throw error;
  }

  console.log(`[DELETE] Successfully deleted ${data?.length || 0} row(s)`);

  if (!data || data.length === 0) {
    console.warn(`[DELETE] No rows were deleted for ID: ${id}`);
    throw new Error(`Video with ID ${id} not found or could not be deleted`);
  }
};

// =============================================================================================
// CHANNEL MANAGEMENT
// =============================================================================================

export const getAllChannels = async (): Promise<Channel[]> => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: true });

  if (error) {
    console.error("Error fetching channels:", error);
    return [];
  }

  return data || [];
};

export const getChannelById = async (id: string): Promise<Channel | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error("Error fetching channel:", error);
    return null;
  }

  return data;
};

export const saveChannel = async (channel: Partial<Channel>): Promise<Channel | null> => {
  if (!supabase) return null;

  if (channel.id) {
    // Update existing
    const { data, error } = await supabase
      .from('channels')
      .update({ name: channel.name, config: channel.config, active: channel.active })
      .eq('id', channel.id)
      .select()
      .single();

    if (error) console.error("Error updating channel:", error);
    return data;
  } else {
    // Create new
    const { data, error } = await supabase
      .from('channels')
      .insert({ name: channel.name, config: channel.config, active: channel.active })
      .select()
      .single();

    if (error) console.error("Error creating channel:", error);
    return data;
  }
};

// =============================================================================================
// NEWS PERSISTENCE
// =============================================================================================

export const saveNewsToDB = async (newsDate: Date, news: NewsItem[], channelId: string) => {
  if (!supabase) return;

  const dateStr = newsDate.toISOString().split('T')[0]; // YYYY-MM-DD

  // Delete existing news for this date and channel to avoid duplicates
  await supabase.from('news_items').delete().eq('news_date', dateStr).eq('channel_id', channelId);

  // Insert new news items
  const newsRecords = news.map(item => ({
    news_date: dateStr,
    channel_id: channelId,
    headline: item.headline,
    source: item.source,
    url: item.url,
    summary: item.summary,
    viral_score: item.viralScore,
    image_keyword: item.imageKeyword,
    image_url: item.imageUrl || null,
    selected: false
  }));

  const { error } = await supabase.from('news_items').insert(newsRecords);
  if (error) console.error("Error saving news:", error);
};

export const getNewsByDate = async (newsDate: Date, channelId: string): Promise<NewsItem[]> => {
  if (!supabase) return [];

  const dateStr = newsDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('news_items')
    .select('*')
    .eq('news_date', dateStr)
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error("Error fetching news:", error);
    return [];
  }

  if (!data || data.length === 0) return [];

  return data.map((row: any) => ({
    headline: row.headline,
    source: row.source,
    url: row.url,
    summary: row.summary,
    viralScore: row.viral_score,
    imageKeyword: row.image_keyword,
    imageUrl: row.image_url
  }));
};

export const markNewsAsSelected = async (newsDate: Date, selectedNews: NewsItem[], channelId: string) => {
  if (!supabase) return;

  const dateStr = newsDate.toISOString().split('T')[0];

  // First, mark all news for this date and channel as not selected
  await supabase
    .from('news_items')
    .update({ selected: false })
    .eq('news_date', dateStr)
    .eq('channel_id', channelId);

  // Then mark the selected ones
  for (const item of selectedNews) {
    await supabase
      .from('news_items')
      .update({ selected: true })
      .eq('news_date', dateStr)
      .eq('channel_id', channelId)
      .eq('headline', item.headline);
  }
};

export const fetchVideosFromDB = async (channelId: string): Promise<StoredVideo[]> => {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('channel_id', channelId)
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
    thumbnail_url: row.thumbnail_url,
    is_posted: row.is_posted || false, // Default to false if not set
    analytics: {
      views: row.views || 0,
      ctr: row.ctr || 0,
      avgViewDuration: row.avg_view_duration || "0:00",
      retentionData: row.retention_data || []
    }
  }));
};
