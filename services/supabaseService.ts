
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

/**
 * Get news IDs that have already been used in other productions for the same date
 * This allows creating multiple productions per day while preventing duplicate news selection
 */
export const getUsedNewsIdsForDate = async (
  newsDate: Date,
  channelId: string,
  excludeProductionId?: string
): Promise<string[]> => {
  if (!supabase) return [];

  const dateStr = newsDate.toISOString().split('T')[0];

  // Get all productions for this date and channel
  let query = supabase
    .from('productions')
    .select('selected_news_ids')
    .eq('news_date', dateStr)
    .eq('channel_id', channelId)
    .not('selected_news_ids', 'is', null);

  // Exclude current production if provided (for editing existing production)
  if (excludeProductionId) {
    query = query.neq('id', excludeProductionId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching used news IDs:", error);
    return [];
  }

  // Collect all used news IDs from all productions
  const usedIds = new Set<string>();
  if (data) {
    data.forEach((production: any) => {
      if (production.selected_news_ids && Array.isArray(production.selected_news_ids)) {
        production.selected_news_ids.forEach((id: string) => {
          if (id) usedIds.add(id);
        });
      }
    });
  }

  console.log(`📋 Found ${usedIds.size} news items already used in other productions for ${dateStr}`);
  return Array.from(usedIds);
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
    // Check if file already exists (deduplication)
    const filePath = `channel-images/${fileName}`;
    const { checkFileExists } = await import('./storageManager');
    const exists = await checkFileExists('channel-assets', filePath);
    
    if (exists) {
      // File exists, return public URL
      const { data: urlData } = supabase.storage
        .from('channel-assets')
        .getPublicUrl(filePath);
      console.log(`✅ Image already exists, reusing: ${fileName}`);
      return urlData.publicUrl;
    }

    // Convert data URL to blob
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    
    // Upload to Supabase Storage
    const fileExt = fileName.split('.').pop() || 'png';

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
  segmentIndex: number,
  options?: {
    text?: string;
    voiceName?: string;
    channelId?: string;
    durationSeconds?: number;
  }
): Promise<string | null> => {
  if (!supabase) return null;

  try {
    // Check if file already exists (deduplication)
    const fileName = `productions/${productionId}/audio/segment-${segmentIndex}.mp3`;
    const { checkFileExists } = await import('./storageManager');
    const exists = await checkFileExists('channel-assets', fileName);
    
    if (exists) {
      // File exists, return public URL
      const { data: urlData } = supabase.storage
        .from('channel-assets')
        .getPublicUrl(fileName);
      console.log(`✅ Audio already exists, reusing: segment-${segmentIndex}`);
      
      // Update audio cache if text/voice provided
      if (options?.text && options?.voiceName && options?.channelId) {
        await saveCachedAudio(
          options.channelId,
          options.text,
          options.voiceName,
          urlData.publicUrl,
          options.durationSeconds,
          productionId
        );
      }
      
      return urlData.publicUrl;
    }

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

    // Save to audio cache if text/voice provided
    if (options?.text && options?.voiceName && options?.channelId) {
      await saveCachedAudio(
        options.channelId,
        options.text,
        options.voiceName,
        urlData.publicUrl,
        options.durationSeconds,
        productionId
      );
    }

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
    is_posted: row.is_posted ?? (row.youtube_id !== null && row.youtube_id !== undefined), // Use is_posted if exists, otherwise calculate from youtube_id
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
  completed_at: data.completed_at ?? undefined,
  checkpoint_data: data.checkpoint_data ?? undefined,
  last_checkpoint_at: data.last_checkpoint_at ?? undefined,
  failed_steps: data.failed_steps ?? undefined,
  estimated_cost: data.estimated_cost ?? undefined,
  actual_cost: data.actual_cost ?? undefined,
  cost_breakdown: data.cost_breakdown ?? undefined
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
    parent_production_id: production.parent_production_id || null,
    // New fields for checkpoint and cost tracking
    checkpoint_data: production.checkpoint_data || null,
    last_checkpoint_at: production.last_checkpoint_at || null,
    failed_steps: production.failed_steps || null,
    estimated_cost: production.estimated_cost ?? null,
    actual_cost: production.actual_cost ?? null,
    cost_breakdown: production.cost_breakdown || null
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

  // Get all published videos for this channel (videos with youtube_id are considered posted)
  const { data: videos, error: videosError } = await supabase
    .from('videos')
    .select('*')
    .eq('channel_id', channelId)
    .not('youtube_id', 'is', null)
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

/**
 * Get completed and published productions with video information
 * Returns productions with metadata about whether they're published and their analytics
 */
export interface ProductionWithVideoInfo extends Production {
  isPublished: boolean;
  videoId?: string;
  videoAnalytics?: {
    views: number;
    ctr: number;
    avgViewDuration: string;
    retentionData: number[];
  };
  publishedAt?: string;
  thumbnailUrl?: string;
}

export const getCompletedProductionsWithVideoInfo = async (
  channelId: string,
  userId?: string,
  limit: number = 10
): Promise<ProductionWithVideoInfo[]> => {
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
    console.error("Error fetching completed productions:", error);
    return [];
  }

  // Get all published videos for this channel
  const { data: videos, error: videosError } = await supabase
    .from('videos')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false });

  if (videosError) {
    console.error("Error fetching videos:", videosError);
    // Continue without video info
  }

  // Match productions with videos by title
  return (productions || []).map(prod => {
    const prodData = normalizeProduction(prod);
    const prodTitle = prodData.viral_metadata?.title || '';
    
    // Find matching video
    const matchingVideo = (videos || []).find((video: any) => {
      const videoTitle = video.title || '';
      return videoTitle === prodTitle || 
             videoTitle.includes(prodTitle) ||
             prodTitle.includes(videoTitle) ||
             videoTitle.includes(prodTitle.substring(0, 30));
    });

    const isPublished = matchingVideo && matchingVideo.youtube_id !== null && matchingVideo.youtube_id !== undefined;

    return {
      ...prodData,
      isPublished,
      videoId: matchingVideo?.id,
      videoAnalytics: matchingVideo ? {
        views: matchingVideo.views || 0,
        ctr: matchingVideo.ctr || 0,
        avgViewDuration: matchingVideo.avg_view_duration || "0:00",
        retentionData: matchingVideo.retention_data || []
      } : undefined,
      publishedAt: matchingVideo?.created_at,
      thumbnailUrl: matchingVideo?.thumbnail_url || prodData.thumbnail_urls?.[0]
    } as ProductionWithVideoInfo;
  });
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

// =============================================================================================
// CHECKPOINT SYSTEM
// =============================================================================================

/**
 * Save a checkpoint with intermediate state for granular recovery
 */
export const saveCheckpoint = async (
  productionId: string,
  checkpointData: {
    step: string;
    completed: string[]; // Array of completed item IDs/indices
    in_progress?: string[]; // Items currently being processed
    data?: any; // Additional state data
  }
): Promise<boolean> => {
  if (!supabase) return false;

  try {
    // Get current checkpoint data
    const { data: current } = await supabase
      .from('productions')
      .select('checkpoint_data')
      .eq('id', productionId)
      .single();

    const existingCheckpoints = current?.checkpoint_data || {};
    const updatedCheckpoints = {
      ...existingCheckpoints,
      [checkpointData.step]: {
        completed: checkpointData.completed,
        in_progress: checkpointData.in_progress || [],
        data: checkpointData.data,
        timestamp: new Date().toISOString()
      }
    };

    const { error } = await supabase
      .from('productions')
      .update({
        checkpoint_data: updatedCheckpoints,
        last_checkpoint_at: new Date().toISOString()
      })
      .eq('id', productionId);

    if (error) {
      console.error("Error saving checkpoint:", error);
      return false;
    }

    console.log(`✅ Checkpoint saved: ${checkpointData.step} (${checkpointData.completed.length} completed)`);
    return true;
  } catch (e) {
    console.error("Error in saveCheckpoint:", e);
    return false;
  }
};

/**
 * Get the last checkpoint data for a production
 */
export const getLastCheckpoint = async (productionId: string): Promise<any | null> => {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('productions')
      .select('checkpoint_data, last_checkpoint_at')
      .eq('id', productionId)
      .single();

    if (error) {
      console.error("Error fetching checkpoint:", error);
      return null;
    }

    return data?.checkpoint_data || null;
  } catch (e) {
    console.error("Error in getLastCheckpoint:", e);
    return null;
  }
};

/**
 * Mark a step as failed in the production
 */
export const markStepFailed = async (
  productionId: string,
  step: string,
  error: string
): Promise<boolean> => {
  if (!supabase) return false;

  try {
    // Get current failed steps
    const { data: current } = await supabase
      .from('productions')
      .select('failed_steps')
      .eq('id', productionId)
      .single();

    const existingFailed = current?.failed_steps || [];
    const failedEntry = {
      step,
      error,
      timestamp: new Date().toISOString()
    };

    // Check if step already marked as failed
    const alreadyFailed = existingFailed.some((f: any) => f.step === step);
    const updatedFailed = alreadyFailed
      ? existingFailed.map((f: any) => f.step === step ? failedEntry : f)
      : [...existingFailed, failedEntry];

    const { error: updateError } = await supabase
      .from('productions')
      .update({ failed_steps: updatedFailed })
      .eq('id', productionId);

    if (updateError) {
      console.error("Error marking step as failed:", updateError);
      return false;
    }

    console.log(`⚠️ Step marked as failed: ${step}`);
    return true;
  } catch (e) {
    console.error("Error in markStepFailed:", e);
    return false;
  }
};

// =============================================================================================
// AUDIO CACHE (Improved with dedicated table)
// =============================================================================================

/**
 * Create a hash from text for cache lookup
 */
const createTextHash = (text: string): string => {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
};

/**
 * Find cached audio using dedicated audio_cache table (fast lookup)
 */
export const findCachedAudio = async (
  text: string,
  voiceName: string,
  channelId: string
): Promise<string | null> => {
  if (!supabase) return null;

  try {
    const textHash = createTextHash(text);

    // First try dedicated audio_cache table (fast)
    const { data: cached, error: cacheError } = await supabase
      .from('audio_cache')
      .select('audio_url, use_count')
      .eq('channel_id', channelId)
      .eq('text_hash', textHash)
      .eq('voice_name', voiceName)
      .order('last_used_at', { ascending: false })
      .limit(1)
      .single();

    if (!cacheError && cached) {
      // Update use count and last_used_at
      await supabase
        .from('audio_cache')
        .update({
          use_count: (cached.use_count || 1) + 1,
          last_used_at: new Date().toISOString()
        })
        .eq('channel_id', channelId)
        .eq('text_hash', textHash)
        .eq('voice_name', voiceName);

      // Load audio from storage
      const audioBase64 = await getAudioFromStorage(cached.audio_url);
      if (audioBase64) {
        console.log(`✅ Found cached audio in audio_cache table (used ${cached.use_count + 1} times)`);
        return audioBase64;
      }
    }

    // Fallback: Search in productions (for backward compatibility)
    const { data: productions, error } = await supabase
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

    if (!productions || productions.length === 0) return null;

    // Search through segments for matching text
    for (const production of productions) {
      if (production.segments && Array.isArray(production.segments)) {
        for (const segment of production.segments) {
          if (segment.text === text && segment.audioUrl) {
            // Found matching audio, try to load it
            const audioBase64 = await getAudioFromStorage(segment.audioUrl);
            if (audioBase64) {
              console.log("✅ Found cached audio in productions (legacy)");
              // Optionally migrate to audio_cache table
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

/**
 * Save audio to cache table for fast future lookups
 */
export const saveCachedAudio = async (
  channelId: string,
  text: string,
  voiceName: string,
  audioUrl: string,
  durationSeconds?: number,
  productionId?: string
): Promise<boolean> => {
  if (!supabase) return false;

  try {
    const textHash = createTextHash(text);

    // Check if already exists
    const { data: existing } = await supabase
      .from('audio_cache')
      .select('id')
      .eq('channel_id', channelId)
      .eq('text_hash', textHash)
      .eq('voice_name', voiceName)
      .single();

    if (existing) {
      // Already cached, just update last_used_at
      await supabase
        .from('audio_cache')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', existing.id);
      return true;
    }

    // Insert new cache entry
    const { error } = await supabase
      .from('audio_cache')
      .insert({
        channel_id: channelId,
        text_hash: textHash,
        voice_name: voiceName,
        audio_url: audioUrl,
        duration_seconds: durationSeconds,
        text_preview: text.substring(0, 100),
        production_id: productionId || null,
        use_count: 1,
        last_used_at: new Date().toISOString()
      });

    if (error) {
      console.error("Error saving cached audio:", error);
      return false;
    }

    console.log("✅ Audio saved to cache table");
    return true;
  } catch (e) {
    console.error("Error in saveCachedAudio:", e);
    return false;
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

// =============================================================================================
// GENERATED VIDEOS CACHE
// =============================================================================================

export type VideoType = 'intro' | 'outro' | 'host_a' | 'host_b' | 'both_hosts' | 'segment';
export type VideoProvider = 'wavespeed' | 'veo3' | 'other';

export interface GeneratedVideo {
  id: string;
  created_at: string;
  channel_id: string;
  production_id: string | null;
  video_type: VideoType;
  segment_index: number | null;
  prompt_hash: string;
  dialogue_text: string | null;
  video_url: string;
  provider: VideoProvider;
  aspect_ratio: string;
  duration_seconds: number | null;
  status: 'pending' | 'generating' | 'completed' | 'failed';
  error_message: string | null;
  reference_image_hash: string | null;
  expires_at: string | null;
}

/**
 * Create a simple hash from a string (for prompt matching)
 */
export const createPromptHash = (prompt: string): string => {
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    const char = prompt.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
};

/**
 * Save a generated video to the cache
 */
export const saveGeneratedVideo = async (
  video: Omit<GeneratedVideo, 'id' | 'created_at'>
): Promise<GeneratedVideo | null> => {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('generated_videos')
      .insert({
        channel_id: video.channel_id,
        production_id: video.production_id,
        video_type: video.video_type,
        segment_index: video.segment_index,
        prompt_hash: video.prompt_hash,
        dialogue_text: video.dialogue_text,
        video_url: video.video_url,
        provider: video.provider,
        aspect_ratio: video.aspect_ratio || '16:9',
        duration_seconds: video.duration_seconds,
        status: video.status || 'completed',
        error_message: video.error_message,
        reference_image_hash: video.reference_image_hash,
        expires_at: video.expires_at
      })
      .select()
      .single();

    if (error) {
      console.error("Error saving generated video:", error);
      return null;
    }

    console.log(`✅ Saved generated video: ${video.video_type} (${video.provider})`);
    return data as GeneratedVideo;
  } catch (e) {
    console.error("Error in saveGeneratedVideo:", e);
    return null;
  }
};

/**
 * Find a cached video by prompt hash
 */
export const findCachedVideo = async (
  channelId: string,
  videoType: VideoType,
  promptHash: string,
  aspectRatio?: string
): Promise<GeneratedVideo | null> => {
  if (!supabase) return null;

  try {
    let query = supabase
      .from('generated_videos')
      .select('*')
      .eq('channel_id', channelId)
      .eq('video_type', videoType)
      .eq('prompt_hash', promptHash)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1);

    if (aspectRatio) {
      query = query.eq('aspect_ratio', aspectRatio);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error finding cached video:", error);
      return null;
    }

    if (data && data.length > 0) {
      console.log(`✅ Found cached ${videoType} video`);
      return data[0] as GeneratedVideo;
    }

    return null;
  } catch (e) {
    console.error("Error in findCachedVideo:", e);
    return null;
  }
};

/**
 * Find a cached video by dialogue text (for lip-sync videos)
 */
export const findCachedVideoByDialogue = async (
  channelId: string,
  videoType: VideoType,
  dialogueText: string,
  aspectRatio?: string
): Promise<GeneratedVideo | null> => {
  if (!supabase) return null;

  try {
    let query = supabase
      .from('generated_videos')
      .select('*')
      .eq('channel_id', channelId)
      .eq('video_type', videoType)
      .eq('dialogue_text', dialogueText)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1);

    if (aspectRatio) {
      query = query.eq('aspect_ratio', aspectRatio);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error finding cached video by dialogue:", error);
      return null;
    }

    if (data && data.length > 0) {
      console.log(`✅ Found cached ${videoType} video for dialogue: "${dialogueText.substring(0, 30)}..."`);
      return data[0] as GeneratedVideo;
    }

    return null;
  } catch (e) {
    console.error("Error in findCachedVideoByDialogue:", e);
    return null;
  }
};

/**
 * Get all videos for a production
 */
export const getProductionVideos = async (
  productionId: string
): Promise<GeneratedVideo[]> => {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('generated_videos')
      .select('*')
      .eq('production_id', productionId)
      .eq('status', 'completed')
      .order('segment_index', { ascending: true });

    if (error) {
      console.error("Error fetching production videos:", error);
      return [];
    }

    return (data || []) as GeneratedVideo[];
  } catch (e) {
    console.error("Error in getProductionVideos:", e);
    return [];
  }
};

/**
 * Get channel intro/outro videos from cache
 */
export const getCachedChannelVideos = async (
  channelId: string,
  aspectRatio: string = '16:9'
): Promise<{ intro: GeneratedVideo | null; outro: GeneratedVideo | null }> => {
  if (!supabase) return { intro: null, outro: null };

  try {
    const { data, error } = await supabase
      .from('generated_videos')
      .select('*')
      .eq('channel_id', channelId)
      .in('video_type', ['intro', 'outro'])
      .eq('aspect_ratio', aspectRatio)
      .eq('status', 'completed')
      .is('production_id', null) // Channel-level videos don't have production_id
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Error fetching channel videos:", error);
      return { intro: null, outro: null };
    }

    const intro = data?.find(v => v.video_type === 'intro') || null;
    const outro = data?.find(v => v.video_type === 'outro') || null;

    return { intro, outro };
  } catch (e) {
    console.error("Error in getCachedChannelVideos:", e);
    return { intro: null, outro: null };
  }
};

/**
 * Mark a video as failed
 */
export const markVideoFailed = async (
  channelId: string,
  videoType: VideoType,
  promptHash: string,
  errorMessage: string,
  productionId?: string
): Promise<void> => {
  if (!supabase) return;

  try {
    await supabase
      .from('generated_videos')
      .insert({
        channel_id: channelId,
        production_id: productionId || null,
        video_type: videoType,
        prompt_hash: promptHash,
        video_url: '', // No URL for failed videos
        provider: 'other',
        status: 'failed',
        error_message: errorMessage
      });
  } catch (e) {
    console.error("Error marking video as failed:", e);
  }
};

/**
 * Delete old cached videos (cleanup)
 */
export const cleanupOldVideos = async (
  channelId: string,
  keepDays: number = 30
): Promise<number> => {
  if (!supabase) return 0;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - keepDays);

    const { data, error } = await supabase
      .from('generated_videos')
      .delete()
      .eq('channel_id', channelId)
      .lt('created_at', cutoffDate.toISOString())
      .not('video_type', 'in', '("intro","outro")') // Keep intro/outro forever
      .select();

    if (error) {
      console.error("Error cleaning up old videos:", error);
      return 0;
    }

    const count = data?.length || 0;
    if (count > 0) {
      console.log(`🧹 Cleaned up ${count} old cached videos`);
    }
    return count;
  } catch (e) {
    console.error("Error in cleanupOldVideos:", e);
    return 0;
  }
};
