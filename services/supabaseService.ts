
import { createClient } from '@supabase/supabase-js';
import { ChannelConfig, StoredVideo, ViralMetadata, NewsItem, Channel, Production, ProductionStatus, ScriptLine, BroadcastSegment, VideoAssets } from '../types';

// Initialize Client with Runtime Fallbacks
const getSupabaseUrl = () => import.meta.env.VITE_SUPABASE_URL || window.env?.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const getSupabaseKey = () => import.meta.env.VITE_SUPABASE_ANON_KEY || window.env?.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabaseUrl = getSupabaseUrl();
const supabaseKey = getSupabaseKey();

export const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// =============================================================================================
// STORAGE BUCKET VERIFICATION
// =============================================================================================

/**
 * Verifies that the channel-assets bucket exists, or provides instructions to create it
 */
export const verifyStorageBucket = async (): Promise<boolean> => {
  if (!supabase) {
    console.error("❌ Supabase not initialized - cannot verify storage bucket");
    return false;
  }

  try {
    // First, try a simple operation to see if bucket exists (most reliable)
    // This works even if listBuckets() fails due to permissions
    const { data: testData, error: testError } = await supabase.storage
      .from('channel-assets')
      .list('', { limit: 1 });
    
    // If we can list (even if empty), the bucket exists
    if (!testError) {
      console.log("✅ Storage bucket 'channel-assets' verified");
      return true;
    }

    // If error is specifically "Bucket not found", it doesn't exist
    if (testError.message?.includes('Bucket not found') || 
        testError.message?.includes('not found') ||
        testError.message?.includes('does not exist')) {
      console.error("❌ Storage bucket 'channel-assets' not found!");
      console.error("📋 To create it:");
      console.error("   1. Go to Supabase Dashboard > Storage");
      console.error("   2. Click 'New bucket'");
      console.error("   3. Name: 'channel-assets'");
      console.error("   4. Set as Public: YES");
      console.error("   5. Click 'Create bucket'");
      console.error("   Or see: supabase_storage_setup.sql for detailed instructions");
      return false;
    }

    // If we get here, it might be a permissions issue
    // Try listing buckets as a fallback
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    
    if (!listError && buckets) {
      const bucketExists = buckets.some(bucket => bucket.name === 'channel-assets');
      if (bucketExists) {
        console.log("✅ Storage bucket 'channel-assets' verified (via listBuckets)");
        return true;
      }
    }

    // If we can't verify but error doesn't say "not found", assume it might exist
    // (could be permissions issue) and return true to avoid blocking the app
    console.warn("⚠️ Could not fully verify bucket (may be permissions issue):", testError.message);
    console.warn("⚠️ Assuming bucket exists. If uploads fail, check bucket permissions.");
    return true; // Assume it exists if we can't verify (better UX than blocking)
  } catch (e) {
    console.error("Error verifying storage bucket:", e);
    // On error, assume bucket exists to avoid blocking the app
    console.warn("⚠️ Error during verification, assuming bucket exists");
    return true;
  }
};

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
    console.warn(`[DELETE] No rows were deleted for ID: ${id} (already deleted?)`);
    // Do not throw, just return. This makes the operation idempotent.
    return;
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
// INTRO/OUTRO VIDEO CACHE
// =============================================================================================

export const getChannelIntroOutro = async (channelId: string): Promise<{ introUrl: string | null; outroUrl: string | null }> => {
  if (!supabase) return { introUrl: null, outroUrl: null };

  const { data, error } = await supabase
    .from('channels')
    .select('config')
    .eq('id', channelId)
    .single();

  if (error) {
    console.error("Error fetching channel intro/outro:", error);
    return { introUrl: null, outroUrl: null };
  }

  // Extract intro/outro URLs from config JSONB field
  const config = data?.config as any;
  return {
    introUrl: config?.intro_video_url || null,
    outroUrl: config?.outro_video_url || null
  };
};

export const saveChannelIntroOutro = async (
  channelId: string,
  introUrl: string | null,
  outroUrl: string | null
): Promise<boolean> => {
  if (!supabase) return false;

  // First, get the current channel config
  const { data: channelData, error: fetchError } = await supabase
    .from('channels')
    .select('config')
    .eq('id', channelId)
    .single();

  if (fetchError) {
    console.error("Error fetching channel for intro/outro save:", fetchError);
    return false;
  }

  // Update config with intro/outro URLs
  const currentConfig = (channelData?.config || {}) as any;
  const updatedConfig = {
    ...currentConfig,
    intro_video_url: introUrl,
    outro_video_url: outroUrl
  };

  const { error } = await supabase
    .from('channels')
    .update({ config: updatedConfig })
    .eq('id', channelId);

  if (error) {
    console.error("Error saving channel intro/outro:", error);
    return false;
  }

  console.log(`✅ Saved intro/outro videos for channel ${channelId}`);
  return true;
};

// =============================================================================================
// NEWS PERSISTENCE
// =============================================================================================

export const saveNewsToDB = async (newsDate: Date, news: NewsItem[], channelId: string) => {
  if (!supabase) return;

  const dateStr = newsDate.toISOString().split('T')[0]; // YYYY-MM-DD

  console.log(`💾 Saving ${news.length} news items to database for date ${dateStr}, channel ${channelId}`);

  // Delete existing news for this date and channel to avoid duplicates
  const { error: deleteError } = await supabase
    .from('news_items')
    .delete()
    .eq('news_date', dateStr)
    .eq('channel_id', channelId);
  
  if (deleteError) {
    console.error("Error deleting existing news:", deleteError);
  }

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

  // Insert in batches if needed (Supabase has a limit, but 15 items should be fine)
  const { data, error } = await supabase
    .from('news_items')
    .insert(newsRecords)
    .select(); // Return inserted data to verify

  if (error) {
    console.error("❌ Error saving news to database:", error);
    console.error("Error details:", JSON.stringify(error, null, 2));
  } else {
    console.log(`✅ Successfully saved ${data?.length || news.length} news items to database`);
    if (data && data.length !== news.length) {
      console.warn(`⚠️ Warning: Tried to save ${news.length} items but only ${data.length} were saved`);
    }
  }
};

export const getNewsByDate = async (newsDate: Date, channelId: string): Promise<NewsItem[]> => {
  if (!supabase) return [];

  const dateStr = newsDate.toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('news_items')
    .select('*')
    .eq('news_date', dateStr)
    .eq('channel_id', channelId)
    .order('viral_score', { ascending: false })
    .limit(100); // Explicit limit to ensure we get all news (Supabase default is 1000, but being explicit)

  if (error) {
    console.error("Error fetching news:", error);
    return [];
  }

  if (!data || data.length === 0) {
    console.log(`📭 No news found in database for date ${dateStr} and channel ${channelId}`);
    return [];
  }

  console.log(`📰 Retrieved ${data.length} news items from database for date ${dateStr}`);
  
  return data.map((row: any) => ({
    id: row.id, // Include UUID from database
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

export const uploadImageToStorage = async (imageDataUrl: string, fileName: string): Promise<string | null> => {
  if (!supabase) return null;

  try {
    // Convert data URL to blob
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    
    // Upload to Supabase Storage
    const fileExt = fileName.split('.').pop() || 'png';
    const filePath = `channel-images/${fileName}`;

    const { data, error } = await supabase.storage
      .from('channel-assets')
      .upload(filePath, blob, {
        contentType: blob.type,
        upsert: true
      });

    if (error) {
      // Check if error is due to bucket not existing
      if (error.message?.includes('Bucket not found') || error.message?.includes('not found')) {
        console.error("❌ Storage bucket 'channel-assets' not found. Please create it in Supabase Dashboard:");
        console.error("   1. Go to Storage in Supabase Dashboard");
        console.error("   2. Create a new bucket named 'channel-assets'");
        console.error("   3. Set it to public or configure RLS policies");
        console.error("   4. Error details:", error);
      } else {
        console.error("Error uploading image:", error);
      }
      // Fallback: return data URL if storage upload fails
      return imageDataUrl;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('channel-assets')
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (e) {
    console.error("Error processing image upload:", e);
    // Fallback: return data URL
    return imageDataUrl;
  }
};

export const uploadAudioToStorage = async (
  audioBase64: string,
  productionId: string,
  segmentIndex: number
): Promise<string | null> => {
  if (!supabase) return null;

  try {
    // Convert base64 to blob
    const base64Data = audioBase64.split(',')[1] || audioBase64;
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'audio/mpeg' });

    // Upload to Supabase Storage
    const fileName = `productions/${productionId}/audio/segment-${segmentIndex}.mp3`;
    const { data, error } = await supabase.storage
      .from('channel-assets')
      .upload(fileName, blob, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (error) {
      // Check if error is due to bucket not existing
      if (error.message?.includes('Bucket not found') || error.message?.includes('not found')) {
        console.error("❌ Storage bucket 'channel-assets' not found. Please create it in Supabase Dashboard:");
        console.error("   1. Go to Storage in Supabase Dashboard");
        console.error("   2. Create a new bucket named 'channel-assets'");
        console.error("   3. Set it to public or configure RLS policies");
        console.error("   4. Error details:", error);
      } else {
        console.error("Error uploading audio:", error);
      }
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('channel-assets')
      .getPublicUrl(data.path);

    return urlData.publicUrl;
  } catch (e) {
    console.error("Error processing audio upload:", e);
    return null;
  }
};

export const getAudioFromStorage = async (audioUrl: string): Promise<string | null> => {
  if (!supabase) return null;

  try {
    // Extract path from URL
    const urlParts = audioUrl.split('/');
    const pathIndex = urlParts.findIndex(part => part === 'channel-assets');
    if (pathIndex === -1) return null;

    const path = urlParts.slice(pathIndex + 1).join('/');
    
    // Download from Storage
    const { data, error } = await supabase.storage
      .from('channel-assets')
      .download(path);

    if (error) {
      console.error("Error downloading audio:", error);
      return null;
    }

    // Convert blob to base64
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        resolve(base64);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(data);
    });
  } catch (e) {
    console.error("Error processing audio download:", e);
    return null;
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

// =============================================================================================
// PRODUCTION PERSISTENCE
// =============================================================================================

// Helper to convert null to undefined for optional Production fields
const normalizeProduction = (data: any): Production => ({
  ...data,
  script: data.script ?? undefined,
  viral_hook: data.viral_hook ?? undefined,
  viral_metadata: data.viral_metadata ?? undefined,
  segments: data.segments ?? undefined,
  video_assets: data.video_assets ?? undefined,
  thumbnail_urls: data.thumbnail_urls ?? undefined,
  user_id: data.user_id ?? undefined,
  version: data.version ?? undefined,
  parent_production_id: data.parent_production_id ?? undefined,
  completed_at: data.completed_at ?? undefined
});

export const saveProduction = async (
  production: Partial<Production>,
  userId?: string
): Promise<Production | null> => {
  if (!supabase) return null;

  // Prepare segments without audioBase64 for storage
  const segmentsForStorage = production.segments?.map(seg => ({
    speaker: seg.speaker,
    text: seg.text,
    videoUrl: seg.videoUrl
    // audioBase64 is NOT stored in DB, only in Storage
  }));

  const productionData: any = {
    channel_id: production.channel_id,
    news_date: production.news_date,
    status: production.status || 'draft',
    selected_news_ids: production.selected_news_ids || [],
    script: production.script || null,
    viral_hook: production.viral_hook || null,
    viral_metadata: production.viral_metadata || null,
    segments: segmentsForStorage || null,
    video_assets: production.video_assets || null,
    thumbnail_urls: production.thumbnail_urls || null,
    progress_step: production.progress_step || 0,
    user_id: userId || null,
    version: production.version || 1,
    parent_production_id: production.parent_production_id || null
  };

  if (production.id) {
    // Update existing
    const { data, error } = await supabase
      .from('productions')
      .update(productionData)
      .eq('id', production.id)
      .select()
      .single();

    if (error) {
      console.error("Error updating production:", error);
      return null;
    }
    return normalizeProduction(data);
  } else {
    // Create new
    const { data, error } = await supabase
      .from('productions')
      .insert(productionData)
      .select()
      .single();

    if (error) {
      console.error("Error creating production:", error);
      return null;
    }
    return normalizeProduction(data);
  }
};

export const getProductionById = async (id: string): Promise<Production | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('productions')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error("Error fetching production:", error);
    return null;
  }

  return normalizeProduction(data);
};

export const getIncompleteProductions = async (
  channelId: string,
  userId?: string
): Promise<Production[]> => {
  if (!supabase) return [];

  let query = supabase
    .from('productions')
    .select('*')
    .eq('channel_id', channelId)
    .in('status', ['draft', 'in_progress'])
    .order('updated_at', { ascending: false });

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching incomplete productions:", error);
    return [];
  }

  return (data || []).map(normalizeProduction);
};

export const getAllProductions = async (
  channelId: string,
  userId?: string,
  limit: number = 50
): Promise<Production[]> => {
  if (!supabase) return [];

  let query = supabase
    .from('productions')
    .select('*')
    .eq('channel_id', channelId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching productions:", error);
    return [];
  }

  return (data || []).map(normalizeProduction);
};

/**
 * Get published productions (completed productions that have been published to YouTube)
 */
export const getPublishedProductions = async (
  channelId: string,
  userId?: string,
  limit: number = 50
): Promise<Production[]> => {
  if (!supabase) return [];

  // Get all completed productions
  let query = supabase
    .from('productions')
    .select('*')
    .eq('channel_id', channelId)
    .eq('status', 'completed')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data: productions, error } = await query;

  if (error) {
    console.error("Error fetching published productions:", error);
    return [];
  }

  // Get all published videos for this channel
  const { data: videos, error: videosError } = await supabase
    .from('videos')
    .select('*')
    .eq('channel_id', channelId)
    .eq('is_posted', true)
    .order('created_at', { ascending: false });

  if (videosError) {
    console.error("Error fetching published videos:", videosError);
    return [];
  }

  // Match productions with published videos by title
  const publishedProds = (productions || []).filter(prod => {
    const prodData = normalizeProduction(prod);
    if (!prodData.viral_metadata?.title) return false;
    
    // Check if there's a published video with matching title
    return (videos || []).some((video: any) => {
      const videoTitle = video.title || '';
      const prodTitle = prodData.viral_metadata?.title || '';
      
      // Exact match or partial match (for flexibility)
      return videoTitle === prodTitle || 
             videoTitle.includes(prodTitle) ||
             prodTitle.includes(videoTitle) ||
             videoTitle.includes(prodTitle.substring(0, 30));
    });
  });

  return publishedProds.map(normalizeProduction);
};

export const updateProductionStatus = async (
  id: string,
  status: ProductionStatus,
  completedAt?: Date
): Promise<boolean> => {
  if (!supabase) return false;

  const updateData: any = { status };
  if (completedAt) {
    updateData.completed_at = completedAt.toISOString();
  }

  const { error } = await supabase
    .from('productions')
    .update(updateData)
    .eq('id', id);

  if (error) {
    console.error("Error updating production status:", error);
    return false;
  }

  return true;
};

export const deleteProduction = async (id: string): Promise<boolean> => {
  if (!supabase) return false;

  const { error } = await supabase
    .from('productions')
    .delete()
    .eq('id', id);

  if (error) {
    console.error("Error deleting production:", error);
    return false;
  }

  return true;
};

// Cache functions for scripts and audio
export const findCachedAudio = async (
  text: string,
  voiceName: string,
  channelId: string
): Promise<string | null> => {
  if (!supabase) return null;

  try {
    // Search for segments with matching text and voice
    const { data, error } = await supabase
      .from('productions')
      .select('segments')
      .eq('channel_id', channelId)
      .not('segments', 'is', null)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error("Error searching for cached audio:", error);
      return null;
    }

    if (!data || data.length === 0) return null;

    // Search through segments for matching text
    for (const production of data) {
      if (production.segments && Array.isArray(production.segments)) {
        for (const segment of production.segments) {
          if (segment.text === text && segment.audioUrl) {
            // Found matching audio, try to load it
            const audioBase64 = await getAudioFromStorage(segment.audioUrl);
            if (audioBase64) {
              console.log("✅ Found cached audio for text:", text.substring(0, 30));
              return audioBase64;
            }
          }
        }
      }
    }

    return null;
  } catch (e) {
    console.error("Error in findCachedAudio:", e);
    return null;
  }
};

// Helper function to create a hash from news headlines
const createNewsHash = (newsItems: NewsItem[]): string => {
  const headlines = newsItems.map(n => n.headline).sort().join('|');
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < headlines.length; i++) {
    const char = headlines.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString();
};

// Find existing script for the same news items
export const findCachedScript = async (
  newsItems: NewsItem[],
  channelId: string,
  config: ChannelConfig
): Promise<ScriptLine[] | null> => {
  if (!supabase || newsItems.length === 0) return null;

  try {
    // Create hash from news headlines
    const newsHash = createNewsHash(newsItems);
    
    // Search for completed productions with the same news (by comparing selected_news_ids)
    const newsHeadlines = newsItems.map(n => n.headline).sort();
    
    // Get recent completed productions for this channel
    const { data, error } = await supabase
      .from('productions')
      .select('*')
      .eq('channel_id', channelId)
      .eq('status', 'completed')
      .not('script', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error searching for cached script:", error);
      return null;
    }

    if (!data || data.length === 0) return null;

    // Find a production with matching news
    for (const prod of data) {
      if (prod.selected_news_ids && Array.isArray(prod.selected_news_ids)) {
        const prodHeadlines = [...prod.selected_news_ids].sort();
        // Check if the news items match (same headlines)
        if (prodHeadlines.length === newsHeadlines.length &&
            prodHeadlines.every((h, i) => h === newsHeadlines[i])) {
          // Found a match! Return the script
          if (prod.script && Array.isArray(prod.script) && prod.script.length > 0) {
            console.log("✅ Found cached script for these news items");
            return prod.script as ScriptLine[];
          }
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error in findCachedScript:", error);
    return null;
  }
};

// Versioning functions
export const createProductionVersion = async (
  parentProductionId: string,
  userId?: string
): Promise<Production | null> => {
  if (!supabase) return null;

  try {
    // Get parent production
    const parent = await getProductionById(parentProductionId);
    if (!parent) {
      console.error("Parent production not found");
      return null;
    }

    // Get the next version number
    const { data: versions, error: versionError } = await supabase
      .from('productions')
      .select('version')
      .or(`id.eq.${parentProductionId},parent_production_id.eq.${parentProductionId}`)
      .order('version', { ascending: false })
      .limit(1);

    if (versionError) {
      console.error("Error fetching versions:", versionError);
      return null;
    }

    const nextVersion = versions && versions.length > 0
      ? (Math.max(...versions.map(v => v.version || 1)) + 1)
      : (parent.version || 1) + 1;

    // Create new version based on parent
    const newProduction: Partial<Production> = {
      channel_id: parent.channel_id,
      news_date: parent.news_date,
      status: 'draft',
      selected_news_ids: parent.selected_news_ids || [],
      script: parent.script || undefined,
      viral_hook: parent.viral_hook || undefined,
      viral_metadata: parent.viral_metadata || undefined,
      segments: undefined, // Start fresh for new version
      video_assets: undefined,
      thumbnail_urls: undefined,
      progress_step: 0,
      version: nextVersion,
      parent_production_id: parentProductionId
    };

    return await saveProduction(newProduction, userId);
  } catch (error) {
    console.error("Error creating production version:", error);
    return null;
  }
};

export const getProductionVersions = async (
  parentProductionId: string
): Promise<Production[]> => {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('productions')
      .select('*')
      .or(`id.eq.${parentProductionId},parent_production_id.eq.${parentProductionId}`)
      .order('version', { ascending: true });

    if (error) {
      console.error("Error fetching production versions:", error);
      return [];
    }

    return (data || []).map(normalizeProduction);
  } catch (error) {
    console.error("Error in getProductionVersions:", error);
    return [];
  }
};

// Export/Import functions
export const exportProduction = async (productionId: string): Promise<string | null> => {
  if (!supabase) return null;

  try {
    const production = await getProductionById(productionId);
    if (!production) {
      console.error("Production not found for export");
      return null;
    }

    // Load audio from storage if segments exist
    let segmentsWithAudio: BroadcastSegment[] = [];
    if (production.segments && production.segments.length > 0 && production.id) {
      segmentsWithAudio = await Promise.all(
        production.segments.map(async (seg: any) => {
          if (seg.audioUrl) {
            const audioBase64 = await getAudioFromStorage(seg.audioUrl);
            return {
              speaker: seg.speaker,
              text: seg.text,
              audioBase64: audioBase64 || '',
              videoUrl: seg.videoUrl
            };
          }
          return {
            speaker: seg.speaker,
            text: seg.text,
            audioBase64: '',
            videoUrl: seg.videoUrl
          };
        })
      );
    }

    // Create export object
    const exportData = {
      ...production,
      segments: segmentsWithAudio.length > 0 ? segmentsWithAudio : production.segments,
      exportedAt: new Date().toISOString(),
      version: '1.0' // Export format version
    };

    return JSON.stringify(exportData, null, 2);
  } catch (error) {
    console.error("Error exporting production:", error);
    return null;
  }
};

export const importProduction = async (
  jsonData: string,
  channelId: string,
  userId?: string
): Promise<Production | null> => {
  if (!supabase) return null;

  try {
    const importedData = JSON.parse(jsonData);
    
    // Validate required fields
    if (!importedData.news_date || !importedData.selected_news_ids) {
      console.error("Invalid production data: missing required fields");
      return null;
    }

    // Create new production from imported data
    const newProduction: Partial<Production> = {
      channel_id: channelId,
      news_date: importedData.news_date,
      status: 'draft' as ProductionStatus, // Start as draft for review
      selected_news_ids: importedData.selected_news_ids || [],
      script: importedData.script || undefined,
      viral_hook: importedData.viral_hook || undefined,
      viral_metadata: importedData.viral_metadata || undefined,
      segments: undefined, // We'll need to upload audio separately
      video_assets: importedData.video_assets || undefined,
      thumbnail_urls: importedData.thumbnail_urls || undefined,
      progress_step: importedData.progress_step || 0,
      version: 1, // New production starts at version 1
      parent_production_id: undefined // Import creates a new production, not a version
    };

    const savedProduction = await saveProduction(newProduction, userId);

    // If audio segments exist, upload them to storage
    if (savedProduction && importedData.segments && Array.isArray(importedData.segments)) {
      const segmentsWithUrls = await Promise.all(
        importedData.segments.map(async (seg: BroadcastSegment, idx: number) => {
          if (seg.audioBase64) {
            const audioUrl = await uploadAudioToStorage(seg.audioBase64, savedProduction.id, idx);
            return {
              speaker: seg.speaker,
              text: seg.text,
              audioUrl,
              videoUrl: seg.videoUrl
            };
          }
          return {
            speaker: seg.speaker,
            text: seg.text,
            videoUrl: seg.videoUrl
          };
        })
      );

      // Update production with audio URLs
      await saveProduction({
        ...savedProduction,
        segments: segmentsWithUrls as any
      }, userId);
    }

    return savedProduction;
  } catch (error) {
    console.error("Error importing production:", error);
    return null;
  }
};
