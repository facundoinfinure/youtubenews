
import { createClient } from '@supabase/supabase-js';
import { ChannelConfig, StoredVideo, ViralMetadata, NewsItem, Channel, Production, ProductionStatus, ScriptLine, BroadcastSegment, VideoAssets, ScriptWithScenes, NarrativeType } from '../types';
import { checkFileExists } from './storageManager';

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

// Connect YouTube - Re-authenticate to get YouTube permissions
export const connectYouTube = async () => {
  if (!supabase) throw new Error("Supabase not initialized");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: import.meta.env.VITE_AUTH_REDIRECT_URL || window.location.origin,
      scopes: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
      queryParams: {
        access_type: 'offline',
        prompt: 'consent' // Force consent screen to ensure YouTube permissions are granted
      }
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

  const fetchDateStr = newsDate.toISOString().split('T')[0]; // YYYY-MM-DD (when we fetched)

  console.log(`💾 Saving ${news.length} news items to database for channel ${channelId}`);

  // Prepare news records with REAL publication dates from iso_date
  const newsRecords = news.map(item => {
    // Use the REAL publication date from the news item (parsed from iso_date)
    // Store FULL ISO timestamp to preserve timezone information
    let publicationDateISO: string | null = null;
    if (item.publicationDate) {
      try {
        const pubDate = typeof item.publicationDate === 'string' 
          ? new Date(item.publicationDate) 
          : item.publicationDate;
        if (!isNaN(pubDate.getTime())) {
          publicationDateISO = pubDate.toISOString(); // Keep FULL ISO timestamp with time
        }
      } catch (e) {
        console.warn(`⚠️ Could not parse publication date for "${item.headline}", using fetch date`);
      }
    }
    
    return {
      news_date: fetchDateStr, // When we fetched the news (date only for filtering)
      publication_date: publicationDateISO || fetchDateStr, // FULL timestamp or fallback to date
      channel_id: channelId,
      headline: item.headline,
      source: item.source,
      url: item.url,
      summary: item.summary,
      viral_score: item.viralScore,
      viral_score_reasoning: item.viralScoreReasoning || null,
      image_keyword: item.imageKeyword,
      image_url: item.imageUrl || null,
      selected: false
    };
  });

  // Log date distribution
  const dateCounts: Record<string, number> = {};
  newsRecords.forEach(record => {
    dateCounts[record.publication_date] = (dateCounts[record.publication_date] || 0) + 1;
  });
  console.log(`📅 News by publication_date:`, dateCounts);

  // Use upsert to avoid duplicates (by URL)
  // This allows accumulating news over time without duplicating
  let insertedCount = 0;
  let skippedCount = 0;

  for (const record of newsRecords) {
    // Check if this URL already exists for this channel
    const { data: existing } = await supabase
      .from('news_items')
      .select('id')
      .eq('channel_id', channelId)
      .eq('url', record.url)
      .limit(1);

    if (existing && existing.length > 0) {
      skippedCount++;
      continue; // Skip duplicate
    }

    // Insert new record
    const { error } = await supabase
      .from('news_items')
      .insert(record);

    if (error) {
      console.error(`❌ Error inserting news: ${record.headline.substring(0, 50)}...`, error.message);
    } else {
      insertedCount++;
    }
  }

  console.log(`✅ Saved ${insertedCount} new items, skipped ${skippedCount} duplicates`);
};

/**
 * Delete all news items for a specific channel
 * Call this when topicToken changes to force fresh news fetch
 */
export const deleteNewsForChannel = async (channelId: string): Promise<number> => {
  if (!supabase) return 0;

  console.log(`🗑️ [News] Deleting all news for channel ${channelId}...`);
  
  const { data, error } = await supabase
    .from('news_items')
    .delete()
    .eq('channel_id', channelId)
    .select('id');

  if (error) {
    console.error("Error deleting news:", error);
    return 0;
  }

  const count = data?.length || 0;
  console.log(`🗑️ [News] Deleted ${count} news items for channel`);
  return count;
};

export const getNewsByDate = async (newsDate: Date, channelId: string): Promise<NewsItem[]> => {
  if (!supabase) return [];

  const dateStr = newsDate.toISOString().split('T')[0];

  // Get all news items for this channel where the REAL publication date matches
  // publication_date comes from iso_date field in Google News API response
  const { data, error } = await supabase
    .from('news_items')
    .select('*')
    .eq('channel_id', channelId)
    .eq('publication_date', dateStr)
    .order('viral_score', { ascending: false });

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
    viralScoreReasoning: row.viral_score_reasoning || undefined,
    imageKeyword: row.image_keyword,
    imageUrl: row.image_url,
    publicationDate: row.publication_date || row.news_date // Include publication date
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

/**
 * Upload channel logo to Supabase Storage
 * Used for watermarks and channel branding
 */
export const uploadChannelLogo = async (
  file: File,
  channelId: string
): Promise<string | null> => {
  if (!supabase) return null;

  try {
    // Generate a unique filename based on channel ID
    const fileExt = file.name.split('.').pop() || 'png';
    const fileName = `channel-logos/${channelId}/logo.${fileExt}`;
    
    // Upload to Supabase Storage (upsert to replace if exists)
    const { data, error } = await supabase.storage
      .from('channel-assets')
      .upload(fileName, file, {
        contentType: file.type,
        upsert: true
      });

    if (error) {
      console.error("❌ Error uploading channel logo:", error);
      if (error.message?.includes('Bucket not found')) {
        console.error("   Storage bucket 'channel-assets' not found. Please create it in Supabase Dashboard.");
      }
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('channel-assets')
      .getPublicUrl(fileName);

    console.log(`✅ Channel logo uploaded: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (e) {
    console.error("Error uploading channel logo:", e);
    return null;
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

/**
 * Upload background music to Supabase Storage
 * @param audioFile - File, Blob, or base64 string
 * @param fileName - Name for the file (e.g., "podcast-bg-music.mp3")
 * @param channelId - Optional channel ID for organization
 */
export const uploadBackgroundMusic = async (
  audioFile: File | Blob | string,
  fileName: string,
  channelId?: string
): Promise<string | null> => {
  if (!supabase) return null;

  try {
    const folder = channelId ? `channels/${channelId}/music` : 'music';
    const filePath = `${folder}/${fileName}`;
    
    // Check if file already exists
    const exists = await checkFileExists('channel-assets', filePath);
    if (exists) {
      const { data: urlData } = supabase.storage
        .from('channel-assets')
        .getPublicUrl(filePath);
      console.log(`✅ Background music already exists, reusing: ${fileName}`);
      return urlData.publicUrl;
    }

    // Convert to blob if needed
    let blob: Blob;
    if (typeof audioFile === 'string') {
      // Base64 string
      const base64Data = audioFile.split(',')[1] || audioFile;
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      blob = new Blob([byteArray], { type: 'audio/mpeg' });
    } else {
      blob = audioFile;
    }

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('channel-assets')
      .upload(filePath, blob, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (error) {
      console.error("Error uploading background music:", error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('channel-assets')
      .getPublicUrl(data.path);

    console.log(`✅ Background music uploaded: ${fileName}`);
    return urlData.publicUrl;
  } catch (e) {
    console.error("Error processing background music upload:", e);
    return null;
  }
};

/**
 * Upload sound effect to Supabase Storage
 * @param audioFile - File, Blob, or base64 string
 * @param effectType - Type of effect (e.g., "transition", "emphasis")
 * @param description - Description of the effect (e.g., "whoosh", "ding")
 * @param channelId - Optional channel ID for organization
 */
export const uploadSoundEffect = async (
  audioFile: File | Blob | string,
  effectType: string,
  description: string,
  channelId?: string
): Promise<string | null> => {
  if (!supabase) return null;

  try {
    // Create safe filename from type and description
    const safeDescription = description.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const fileName = `${effectType}-${safeDescription}.mp3`;
    const folder = channelId ? `channels/${channelId}/sound-effects` : 'sound-effects';
    const filePath = `${folder}/${fileName}`;
    
    // Check if file already exists
    const exists = await checkFileExists('channel-assets', filePath);
    if (exists) {
      const { data: urlData } = supabase.storage
        .from('channel-assets')
        .getPublicUrl(filePath);
      console.log(`✅ Sound effect already exists, reusing: ${fileName}`);
      return urlData.publicUrl;
    }

    // Convert to blob if needed
    let blob: Blob;
    if (typeof audioFile === 'string') {
      // Base64 string
      const base64Data = audioFile.split(',')[1] || audioFile;
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      blob = new Blob([byteArray], { type: 'audio/mpeg' });
    } else {
      blob = audioFile;
    }

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('channel-assets')
      .upload(filePath, blob, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (error) {
      console.error("Error uploading sound effect:", error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('channel-assets')
      .getPublicUrl(data.path);

    console.log(`✅ Sound effect uploaded: ${fileName}`);
    return urlData.publicUrl;
  } catch (e) {
    console.error("Error processing sound effect upload:", e);
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
  cost_breakdown: data.cost_breakdown ?? undefined,
  // v2.0 Narrative Engine fields
  narrative_used: data.narrative_used ?? undefined,
  scenes: data.scenes ?? undefined,
  // v2.1 Granular segment tracking
  segment_status: data.segment_status ?? undefined,
  // v2.2 Final video and publishing fields
  final_video_url: data.final_video_url ?? undefined,
  final_video_poster: data.final_video_poster ?? undefined,
  youtube_id: data.youtube_id ?? undefined,
  published_at: data.published_at ?? undefined,
  // v2.4 Wizard state for step-by-step flow
  wizard_state: data.wizard_state ?? undefined,
  fetched_news: data.fetched_news ?? undefined,
  // v2.5 Script history for comparison and rollback
  script_history: data.script_history ?? undefined,
});

export const saveProduction = async (
  production: Partial<Production>,
  userId?: string
): Promise<Production | null> => {
  if (!supabase) return null;

  // Prepare segments without audioBase64 for storage (only if segments were passed)
  const segmentsForStorage = production.segments?.map(seg => ({
    speaker: seg.speaker,
    text: seg.text,
    videoUrl: seg.videoUrl
    // audioBase64 is NOT stored in DB, only in Storage
  }));

  if (production.id) {
    // === UPDATE EXISTING ===
    // IMPORTANT: Only include fields that were explicitly passed in the update
    // This prevents overwriting existing data with null/undefined
    const updateData: any = {};
    
    // Always update these tracking fields
    if (production.status !== undefined) updateData.status = production.status;
    if (production.progress_step !== undefined) updateData.progress_step = production.progress_step;
    updateData.updated_at = new Date().toISOString();
    
    // Only update optional fields if they were explicitly passed
    if (production.channel_id !== undefined) updateData.channel_id = production.channel_id;
    if (production.news_date !== undefined) updateData.news_date = production.news_date;
    if (production.selected_news_ids !== undefined) updateData.selected_news_ids = production.selected_news_ids;
    if (production.script !== undefined) updateData.script = production.script;
    if (production.viral_hook !== undefined) updateData.viral_hook = production.viral_hook;
    if (production.viral_metadata !== undefined) updateData.viral_metadata = production.viral_metadata;
    if (production.segments !== undefined) updateData.segments = segmentsForStorage;
    if (production.video_assets !== undefined) updateData.video_assets = production.video_assets;
    if (production.thumbnail_urls !== undefined) updateData.thumbnail_urls = production.thumbnail_urls;
    if (userId !== undefined) updateData.user_id = userId;
    if (production.version !== undefined) updateData.version = production.version;
    if (production.parent_production_id !== undefined) updateData.parent_production_id = production.parent_production_id;
    if (production.checkpoint_data !== undefined) updateData.checkpoint_data = production.checkpoint_data;
    if (production.last_checkpoint_at !== undefined) updateData.last_checkpoint_at = production.last_checkpoint_at;
    if (production.failed_steps !== undefined) updateData.failed_steps = production.failed_steps;
    if (production.estimated_cost !== undefined) updateData.estimated_cost = production.estimated_cost;
    if (production.actual_cost !== undefined) updateData.actual_cost = production.actual_cost;
    if (production.cost_breakdown !== undefined) updateData.cost_breakdown = production.cost_breakdown;
    if (production.narrative_used !== undefined) updateData.narrative_used = production.narrative_used;
    if (production.scenes !== undefined) updateData.scenes = production.scenes;
    if (production.segment_status !== undefined) updateData.segment_status = production.segment_status;
    if (production.completed_at !== undefined) updateData.completed_at = production.completed_at;
    // v2.2 Final video and publishing fields
    if (production.final_video_url !== undefined) updateData.final_video_url = production.final_video_url;
    if (production.final_video_poster !== undefined) updateData.final_video_poster = production.final_video_poster;
    if (production.youtube_id !== undefined) updateData.youtube_id = production.youtube_id;
    if (production.published_at !== undefined) updateData.published_at = production.published_at;
    // v2.4 Wizard state for step-by-step flow
    if (production.wizard_state !== undefined) updateData.wizard_state = production.wizard_state;
    if (production.fetched_news !== undefined) updateData.fetched_news = production.fetched_news;
    // v2.5 Script history for comparison and rollback
    if (production.script_history !== undefined) updateData.script_history = production.script_history;

    console.log(`💾 [Production] Updating ${production.id} with fields:`, Object.keys(updateData).join(', '));

    let { data, error } = await supabase
      .from('productions')
      .update(updateData)
      .eq('id', production.id)
      .select()
      .single();

    // If segment_status column doesn't exist, retry without it
    if (error && (error.code === 'PGRST204' || error.message?.includes('segment_status'))) {
      console.warn("⚠️ segment_status column not found, retrying without it. Run migration: supabase_segment_status_migration.sql");
      const { segment_status, ...dataWithoutSegmentStatus } = updateData;
      const retryResult = await supabase
        .from('productions')
        .update(dataWithoutSegmentStatus)
        .eq('id', production.id)
        .select()
        .single();
      data = retryResult.data;
      error = retryResult.error;
    }

    if (error) {
      console.error("Error updating production:", error);
      return null;
    }
    console.log(`✅ [Production] Updated successfully`);
    return normalizeProduction(data);
  } else {
    // === CREATE NEW ===
    // For new productions, include all fields with defaults
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
      checkpoint_data: production.checkpoint_data || null,
      last_checkpoint_at: production.last_checkpoint_at || null,
      failed_steps: production.failed_steps || null,
      estimated_cost: production.estimated_cost ?? null,
      actual_cost: production.actual_cost ?? null,
      cost_breakdown: production.cost_breakdown || null,
      narrative_used: production.narrative_used || null,
      scenes: production.scenes || null,
      segment_status: production.segment_status || null,
      // v2.2 Final video and publishing fields
      final_video_url: production.final_video_url || null,
      final_video_poster: production.final_video_poster || null,
      youtube_id: production.youtube_id || null,
      published_at: production.published_at || null,
      // v2.4 Wizard state for step-by-step flow
      wizard_state: production.wizard_state || null,
      fetched_news: production.fetched_news || null,
      // v2.5 Script history for comparison and rollback
      script_history: production.script_history || null
    };

    console.log(`💾 [Production] Creating new production for channel ${production.channel_id}`);

    let { data, error } = await supabase
      .from('productions')
      .insert(productionData)
      .select()
      .single();

    // If segment_status column doesn't exist, retry without it
    if (error && (error.code === 'PGRST204' || error.message?.includes('segment_status'))) {
      console.warn("⚠️ segment_status column not found, retrying without it. Run migration: supabase_segment_status_migration.sql");
      const { segment_status, ...dataWithoutSegmentStatus } = productionData;
      const retryResult = await supabase
        .from('productions')
        .insert(dataWithoutSegmentStatus)
        .select()
        .single();
      data = retryResult.data;
      error = retryResult.error;
    }

    if (error) {
      console.error("Error creating production:", error);
      return null;
    }
    console.log(`✅ [Production] Created with ID: ${data.id}`);
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

  // Show productions that match user_id OR have null user_id (legacy/orphaned productions)
  if (userId) {
    query = query.or(`user_id.eq.${userId},user_id.is.null`);
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

  // Show productions that match user_id OR have null user_id (legacy/orphaned productions)
  if (userId) {
    query = query.or(`user_id.eq.${userId},user_id.is.null`);
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
 * Uses youtube_id directly from production instead of matching by title
 */
export const getPublishedProductions = async (
  channelId: string,
  userId?: string,
  limit: number = 50
): Promise<Production[]> => {
  if (!supabase) return [];

  // Get productions that have youtube_id (directly published from dashboard)
  let query = supabase
    .from('productions')
    .select('*')
    .eq('channel_id', channelId)
    .eq('status', 'completed')
    .not('youtube_id', 'is', null) // Only get productions with youtube_id
    .order('published_at', { ascending: false })
    .limit(limit);

  // Show productions that match user_id OR have null user_id (legacy/orphaned productions)
  if (userId) {
    query = query.or(`user_id.eq.${userId},user_id.is.null`);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Error fetching published productions:", error);
    return [];
  }

  return (data || []).map(normalizeProduction);
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

  // Show productions that match user_id OR have null user_id (legacy/orphaned productions)
  if (userId) {
    query = query.or(`user_id.eq.${userId},user_id.is.null`);
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

/**
 * Update segment status for granular resource tracking
 * Allows tracking audio/video generation progress per segment
 */
export const updateSegmentStatus = async (
  productionId: string,
  segmentIndex: number,
  updates: {
    audio?: 'pending' | 'generating' | 'done' | 'failed' | 'stale'; // 'stale' = text changed, needs regeneration
    video?: 'pending' | 'generating' | 'done' | 'failed' | 'stale';
    audioUrl?: string;
    videoUrl?: string;
    // For "both" scenes - separate audio URLs for each host
    hostA_audioUrl?: string;
    hostB_audioUrl?: string;
    error?: string;
  }
): Promise<boolean> => {
  if (!supabase) return false;

  try {
    // Get current segment_status
    const { data: production, error: fetchError } = await supabase
      .from('productions')
      .select('segment_status')
      .eq('id', productionId)
      .single();

    if (fetchError) {
      // If column doesn't exist (PGRST204), log warning but don't fail
      if (fetchError.code === 'PGRST204') {
        console.warn("⚠️ segment_status column not found - run migration: supabase_segment_status_migration.sql");
        return false;
      }
      console.error("Error fetching production:", fetchError);
      return false;
    }

    // Merge updates with existing status
    const currentStatus = production?.segment_status || {};
    const segmentStatus = currentStatus[segmentIndex] || { audio: 'pending', video: 'pending' };
    
    const updatedSegmentStatus = {
      ...segmentStatus,
      ...updates,
      lastUpdated: new Date().toISOString()
    };

    const newSegmentStatus = {
      ...currentStatus,
      [segmentIndex]: updatedSegmentStatus
    };

    // Save updated status
    const { error: updateError } = await supabase
      .from('productions')
      .update({ segment_status: newSegmentStatus })
      .eq('id', productionId);

    if (updateError) {
      // If column doesn't exist, log warning but don't fail the production
      if (updateError.code === 'PGRST204') {
        console.warn("⚠️ segment_status column not found - run migration: supabase_segment_status_migration.sql");
        return false;
      }
      console.error("Error updating segment status:", updateError);
      return false;
    }

    return true;
  } catch (e) {
    console.error("Error in updateSegmentStatus:", e);
    return false;
  }
};

/**
 * Get segments that need regeneration based on their status
 */
export const getSegmentsNeedingRegeneration = async (
  productionId: string
): Promise<{ audioNeeded: number[]; videoNeeded: number[] }> => {
  if (!supabase) return { audioNeeded: [], videoNeeded: [] };

  try {
    const { data: production, error } = await supabase
      .from('productions')
      .select('segment_status, segments')
      .eq('id', productionId)
      .single();

    if (error) {
      // If column doesn't exist, log warning and return empty (will regenerate all)
      if (error.code === 'PGRST204') {
        console.warn("⚠️ segment_status column not found - run migration: supabase_segment_status_migration.sql");
      }
      return { audioNeeded: [], videoNeeded: [] };
    }
    
    if (!production) {
      return { audioNeeded: [], videoNeeded: [] };
    }

    const segmentStatus = production.segment_status || {};
    const segmentCount = production.segments?.length || 0;
    
    const audioNeeded: number[] = [];
    const videoNeeded: number[] = [];

    for (let i = 0; i < segmentCount; i++) {
      const status = segmentStatus[i];
      if (!status || status.audio !== 'done') {
        audioNeeded.push(i);
      }
      if (!status || status.video !== 'done') {
        videoNeeded.push(i);
      }
    }

    return { audioNeeded, videoNeeded };
  } catch (e) {
    console.error("Error in getSegmentsNeedingRegeneration:", e);
    return { audioNeeded: [], videoNeeded: [] };
  }
};

/**
 * Delete a single audio file from Storage
 * Useful when regenerating audio (deletes old before generating new)
 */
export const deleteAudioFromStorage = async (
  productionId: string,
  segmentIndex: number
): Promise<boolean> => {
  if (!supabase) return false;

  try {
    const fileName = `productions/${productionId}/audio/segment-${segmentIndex}.mp3`;
    const { error } = await supabase.storage
      .from('channel-assets')
      .remove([fileName]);
    
    if (error) {
      console.warn(`⚠️ Could not delete old audio: ${error.message}`);
      return false;
    }
    
    console.log(`🗑️ Deleted old audio: segment-${segmentIndex}`);
    return true;
  } catch (e) {
    console.warn("Error deleting audio from storage:", e);
    return false;
  }
};

/**
 * Delete all assets for a production from Storage
 * Called before deleting the production from DB
 */
export const deleteProductionAssets = async (productionId: string): Promise<boolean> => {
  if (!supabase) return false;

  try {
    // List and delete all audio files
    const { data: audioFiles, error: listError } = await supabase.storage
      .from('channel-assets')
      .list(`productions/${productionId}/audio`);
    
    if (audioFiles && audioFiles.length > 0) {
      const audioFilePaths = audioFiles.map(f => `productions/${productionId}/audio/${f.name}`);
      const { error: deleteError } = await supabase.storage
        .from('channel-assets')
        .remove(audioFilePaths);
      
      if (deleteError) {
        console.warn(`⚠️ Error deleting audio files: ${deleteError.message}`);
      } else {
        console.log(`🗑️ Deleted ${audioFilePaths.length} audio files for production ${productionId}`);
      }
    }

    // Try to delete the production folder (might fail if other files exist, that's OK)
    try {
      await supabase.storage
        .from('channel-assets')
        .remove([`productions/${productionId}`]);
    } catch {
      // Folder deletion is optional
    }

    return true;
  } catch (e) {
    console.error("Error deleting production assets:", e);
    return false;
  }
};

/**
 * Delete a production and all its associated assets
 * Cleans up Storage files before deleting DB record
 */
export const deleteProduction = async (id: string): Promise<boolean> => {
  if (!supabase) return false;

  try {
    // 1. Delete all assets from Storage first
    await deleteProductionAssets(id);

    // 2. Delete the production record from DB
    const { error } = await supabase
      .from('productions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error("Error deleting production from DB:", error);
      return false;
    }

    console.log(`✅ Production ${id} and all assets deleted successfully`);
    return true;
  } catch (e) {
    console.error("Error in deleteProduction:", e);
    return false;
  }
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
 * Cached audio result with duration
 */
export interface CachedAudioResult {
  audioBase64: string;
  durationSeconds: number | null;
}

/**
 * Find cached audio using dedicated audio_cache table (fast lookup)
 * Returns both the audio data and duration for accurate video timing
 */
export const findCachedAudio = async (
  text: string,
  voiceName: string,
  channelId: string
): Promise<CachedAudioResult | null> => {
  if (!supabase) return null;

  try {
    const textHash = createTextHash(text);

    // First try dedicated audio_cache table (fast)
    // Include duration_seconds for accurate video timing!
    const { data: cached, error: cacheError } = await supabase
      .from('audio_cache')
      .select('audio_url, use_count, duration_seconds')
      .eq('channel_id', channelId)
      .eq('text_hash', textHash)
      .eq('voice_name', voiceName)
      .order('last_used_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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
        console.log(`✅ Found cached audio in audio_cache table (used ${cached.use_count + 1} times, duration: ${cached.duration_seconds}s)`);
        return {
          audioBase64,
          durationSeconds: cached.duration_seconds || null
        };
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
              // Legacy productions don't have duration, return null for duration
              return {
                audioBase64,
                durationSeconds: (segment as any).audioDuration || null
              };
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
    // Use maybeSingle() to avoid 406 error when no results found
    const { data: existing } = await supabase
      .from('audio_cache')
      .select('id')
      .eq('channel_id', channelId)
      .eq('text_hash', textHash)
      .eq('voice_name', voiceName)
      .maybeSingle();

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

/**
 * Find cached script result type
 * Returns both script and scenes for v2.0 Narrative Engine compatibility
 */
export interface CachedScriptResult {
  script: ScriptLine[];
  scenes: ScriptWithScenes | null;
  productionId: string;
  fromStatus: ProductionStatus;
}

/**
 * Find existing script for the same news items
 * Searches in both 'completed' and 'in_progress' productions
 * Returns script, scenes, and metadata for full recovery
 */
export const findCachedScript = async (
  newsItems: NewsItem[],
  channelId: string,
  config: ChannelConfig
): Promise<ScriptLine[] | null> => {
  const result = await findCachedScriptWithScenes(newsItems, channelId, config);
  return result?.script || null;
};

/**
 * Enhanced version that returns script + scenes + metadata
 * Searches in 'completed' AND 'in_progress' productions for better recovery
 */
export const findCachedScriptWithScenes = async (
  newsItems: NewsItem[],
  channelId: string,
  config: ChannelConfig
): Promise<CachedScriptResult | null> => {
  if (!supabase || newsItems.length === 0) return null;

  try {
    // Prepare matching criteria
    // Use news IDs if available (more reliable), otherwise fall back to headlines
    const newsIds = newsItems.map(n => n.id).filter(Boolean).sort();
    const newsHeadlines = newsItems.map(n => n.headline).sort();
    const useIds = newsIds.length === newsItems.length;
    
    console.log(`🔍 [Script Cache] Searching for cached script...`);
    console.log(`🔍 [Script Cache] Matching by ${useIds ? 'news IDs' : 'headlines'} (${newsItems.length} items)`);
    
    // Search in BOTH completed and in_progress productions
    // Prioritize completed, then in_progress
    const { data, error } = await supabase
      .from('productions')
      .select('*')
      .eq('channel_id', channelId)
      .in('status', ['completed', 'in_progress'])
      .not('script', 'is', null)
      .order('status', { ascending: true }) // 'completed' comes before 'in_progress'
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error("Error searching for cached script:", error);
      return null;
    }

    if (!data || data.length === 0) {
      console.log(`🔍 [Script Cache] No productions with scripts found`);
      return null;
    }

    console.log(`🔍 [Script Cache] Found ${data.length} productions to check`);

    // Find a production with matching news
    for (const prod of data) {
      if (!prod.selected_news_ids || !Array.isArray(prod.selected_news_ids)) continue;
      
      let isMatch = false;
      
      if (useIds) {
        // Match by news IDs (preferred - more reliable)
        const prodIds = [...prod.selected_news_ids].sort();
        isMatch = prodIds.length === newsIds.length &&
                  prodIds.every((id, i) => id === newsIds[i]);
      } else {
        // Fall back to matching by headlines
        const prodHeadlines = [...prod.selected_news_ids].sort();
        isMatch = prodHeadlines.length === newsHeadlines.length &&
                  prodHeadlines.every((h, i) => h === newsHeadlines[i]);
      }
      
      if (isMatch && prod.script && Array.isArray(prod.script) && prod.script.length > 0) {
        console.log(`✅ [Script Cache] Found cached script in production ${prod.id} (status: ${prod.status})`);
        console.log(`✅ [Script Cache] Script has ${prod.script.length} lines, scenes: ${prod.scenes ? 'yes' : 'no'}`);
        
        return {
          script: prod.script as ScriptLine[],
          scenes: prod.scenes as ScriptWithScenes | null,
          productionId: prod.id,
          fromStatus: prod.status as ProductionStatus
        };
      }
    }

    console.log(`🔍 [Script Cache] No matching script found`);
    return null;
  } catch (error) {
    console.error("Error in findCachedScriptWithScenes:", error);
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

// =============================================================================================
// PENDING VIDEO TASK MANAGEMENT
// =============================================================================================

/**
 * Result of finding a pending video task
 */
export interface PendingVideoTask {
  id: string;
  taskId: string;
  provider: VideoProvider;
  createdAt: string;
  dialogueText: string | null;
  segmentIndex: number | null;
}

/**
 * Find a pending video task that was started but not completed
 * This allows resuming polling instead of creating duplicate requests
 */
export const findPendingVideoTask = async (
  channelId: string,
  dialogueText: string,
  segmentIndex?: number
): Promise<PendingVideoTask | null> => {
  if (!supabase) return null;

  try {
    let query = supabase
      .from('generated_videos')
      .select('*')
      .eq('channel_id', channelId)
      .eq('dialogue_text', dialogueText)
      .in('status', ['pending', 'generating'])
      .not('task_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data, error } = await query;

    if (error) {
      // If task_id column doesn't exist, log warning but don't fail
      if (error.message?.includes('task_id')) {
        console.warn("⚠️ task_id column not found - run migration: supabase_video_taskid_thumbnail_cache_migration.sql");
        return null;
      }
      console.error("Error finding pending video task:", error);
      return null;
    }

    if (data && data.length > 0 && data[0].task_id) {
      const task = data[0];
      console.log(`🔄 [Video Cache] Found pending task: ${task.task_id} (status: ${task.status})`);
      return {
        id: task.id,
        taskId: task.task_id,
        provider: task.provider as VideoProvider,
        createdAt: task.created_at || task.task_created_at,
        dialogueText: task.dialogue_text,
        segmentIndex: task.segment_index
      };
    }

    return null;
  } catch (e) {
    console.error("Error in findPendingVideoTask:", e);
    return null;
  }
};

/**
 * Save a video task as pending/generating before starting polling
 * This allows resuming if the app is interrupted
 */
export const saveVideoTaskPending = async (
  video: Omit<GeneratedVideo, 'id' | 'created_at' | 'video_url'> & { task_id: string }
): Promise<string | null> => {
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
        video_url: '', // Will be updated when completed
        provider: video.provider,
        aspect_ratio: video.aspect_ratio || '16:9',
        duration_seconds: null,
        status: 'generating',
        error_message: null,
        reference_image_hash: video.reference_image_hash,
        expires_at: null,
        task_id: video.task_id,
        task_created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (error) {
      // If task_id column doesn't exist, fall back to old behavior (no pending tracking)
      if (error.message?.includes('task_id') || error.message?.includes('task_created_at')) {
        console.warn("⚠️ task_id/task_created_at columns not found - run migration");
        // Fall back to saving without task_id
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('generated_videos')
          .insert({
            channel_id: video.channel_id,
            production_id: video.production_id,
            video_type: video.video_type,
            segment_index: video.segment_index,
            prompt_hash: video.prompt_hash,
            dialogue_text: video.dialogue_text,
            video_url: '',
            provider: video.provider,
            aspect_ratio: video.aspect_ratio || '16:9',
            status: 'generating'
          })
          .select('id')
          .single();
        
        if (fallbackError) {
          console.error("Error saving video task (fallback):", fallbackError);
          return null;
        }
        return fallbackData?.id || null;
      }
      console.error("Error saving video task pending:", error);
      return null;
    }

    console.log(`✅ [Video Task] Saved pending task: ${video.task_id}`);
    return data?.id || null;
  } catch (e) {
    console.error("Error in saveVideoTaskPending:", e);
    return null;
  }
};

/**
 * Update a video task to completed status with the final URL
 */
export const updateVideoTaskCompleted = async (
  taskId: string,
  videoUrl: string,
  durationSeconds?: number
): Promise<boolean> => {
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('generated_videos')
      .update({
        status: 'completed',
        video_url: videoUrl,
        duration_seconds: durationSeconds || null,
        error_message: null
      })
      .eq('task_id', taskId);

    if (error) {
      console.error("Error updating video task to completed:", error);
      return false;
    }

    console.log(`✅ [Video Task] Updated task ${taskId} to completed`);
    return true;
  } catch (e) {
    console.error("Error in updateVideoTaskCompleted:", e);
    return false;
  }
};

/**
 * Update a video task to failed status
 */
export const updateVideoTaskFailed = async (
  taskId: string,
  errorMessage: string
): Promise<boolean> => {
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('generated_videos')
      .update({
        status: 'failed',
        error_message: errorMessage
      })
      .eq('task_id', taskId);

    if (error) {
      console.error("Error updating video task to failed:", error);
      return false;
    }

    console.log(`❌ [Video Task] Updated task ${taskId} to failed: ${errorMessage}`);
    return true;
  } catch (e) {
    console.error("Error in updateVideoTaskFailed:", e);
    return false;
  }
};

// =============================================================================================
// THUMBNAIL CACHE
// =============================================================================================

/**
 * Cached thumbnail result
 */
export interface CachedThumbnail {
  id: string;
  thumbnailUrl: string;
  variantUrl: string | null;
  style: string | null;
  provider: string;
  useCount: number;
}

/**
 * Find a cached thumbnail by context hash
 */
export const findCachedThumbnail = async (
  channelId: string,
  newsContext: string,
  viralTitle: string
): Promise<CachedThumbnail | null> => {
  if (!supabase) return null;

  try {
    const contextHash = createPromptHash(`${newsContext}_${viralTitle}`);

    const { data, error } = await supabase
      .from('thumbnail_cache')
      .select('*')
      .eq('channel_id', channelId)
      .eq('context_hash', contextHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      // If table doesn't exist, log warning but don't fail
      if (error.message?.includes('thumbnail_cache') || error.code === '42P01') {
        console.warn("⚠️ thumbnail_cache table not found - run migration: supabase_video_taskid_thumbnail_cache_migration.sql");
        return null;
      }
      console.error("Error finding cached thumbnail:", error);
      return null;
    }

    if (data?.thumbnail_url) {
      console.log(`✅ [Thumbnail Cache] Found cached thumbnail (used ${data.use_count} times)`);
      
      // Update use count
      await supabase
        .from('thumbnail_cache')
        .update({
          use_count: (data.use_count || 1) + 1,
          last_used_at: new Date().toISOString()
        })
        .eq('id', data.id);

      return {
        id: data.id,
        thumbnailUrl: data.thumbnail_url,
        variantUrl: data.variant_url,
        style: data.style,
        provider: data.provider || 'unknown',
        useCount: data.use_count || 1
      };
    }

    return null;
  } catch (e) {
    console.error("Error in findCachedThumbnail:", e);
    return null;
  }
};

/**
 * Save a thumbnail to cache
 */
export const saveThumbnailToCache = async (
  channelId: string,
  productionId: string | null,
  newsContext: string,
  viralTitle: string,
  thumbnailUrl: string,
  variantUrl?: string,
  style?: string,
  provider: string = 'wavespeed'
): Promise<boolean> => {
  if (!supabase) return false;

  try {
    const contextHash = createPromptHash(`${newsContext}_${viralTitle}`);

    // Check if already exists
    const { data: existing } = await supabase
      .from('thumbnail_cache')
      .select('id')
      .eq('channel_id', channelId)
      .eq('context_hash', contextHash)
      .maybeSingle();

    if (existing) {
      // Update existing entry
      const { error } = await supabase
        .from('thumbnail_cache')
        .update({
          thumbnail_url: thumbnailUrl,
          variant_url: variantUrl || null,
          style: style || null,
          provider,
          last_used_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) {
        console.error("Error updating cached thumbnail:", error);
        return false;
      }

      console.log("✅ [Thumbnail Cache] Updated existing cache entry");
      return true;
    }

    // Insert new entry
    const { error } = await supabase
      .from('thumbnail_cache')
      .insert({
        channel_id: channelId,
        production_id: productionId,
        context_hash: contextHash,
        thumbnail_url: thumbnailUrl,
        variant_url: variantUrl || null,
        style: style || null,
        provider,
        use_count: 1,
        last_used_at: new Date().toISOString()
      });

    if (error) {
      // If table doesn't exist, log warning but don't fail the production
      if (error.message?.includes('thumbnail_cache') || error.code === '42P01') {
        console.warn("⚠️ thumbnail_cache table not found - thumbnails won't be cached");
        return false;
      }
      console.error("Error saving thumbnail to cache:", error);
      return false;
    }

    console.log("✅ [Thumbnail Cache] Saved new thumbnail to cache");
    return true;
  } catch (e) {
    console.error("Error in saveThumbnailToCache:", e);
    return false;
  }
};

// =============================================================================================
// SYSTEM DEFAULTS
// =============================================================================================

/**
 * Get a system default value from the system_defaults table
 */
export const getSystemDefault = async <T>(key: string): Promise<T | null> => {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('system_defaults')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error) {
      // Table might not exist
      if (error.code === '42P01' || error.message?.includes('system_defaults')) {
        console.warn('⚠️ system_defaults table not found');
        return null;
      }
      console.error('Error fetching system default:', error);
      return null;
    }

    return data?.value as T || null;
  } catch (e) {
    console.error('Error in getSystemDefault:', e);
    return null;
  }
};

/**
 * Get the default channel configuration from system_defaults
 */
export const getDefaultChannelConfig = async (): Promise<ChannelConfig | null> => {
  return getSystemDefault<ChannelConfig>('default_channel_config');
};

/**
 * Set a system default value
 */
export const setSystemDefault = async <T>(key: string, value: T, description?: string): Promise<boolean> => {
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('system_defaults')
      .upsert({
        key,
        value,
        description: description || null,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'key'
      });

    if (error) {
      console.error('Error setting system default:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Error in setSystemDefault:', e);
    return false;
  }
};

// =============================================================================================
// VIDEO ANALYTICS - YouTube Performance Tracking
// =============================================================================================

export interface VideoAnalyticsRecord {
  id?: string;
  production_id: string;
  channel_id: string;
  youtube_video_id: string;
  view_count: number;
  like_count: number;
  comment_count: number;
  estimated_minutes_watched?: number;
  average_view_duration?: number;
  average_view_percentage?: number;
  click_through_rate?: number;
  shares?: number;
  subscribers_gained?: number;
  engagement_rate?: number;
  video_published_at: string;
  fetched_at: string;
}

/**
 * Save or update video analytics data
 * Uses upsert based on production_id + youtube_video_id
 */
export const saveVideoAnalytics = async (analytics: VideoAnalyticsRecord): Promise<boolean> => {
  if (!supabase) return false;

  try {
    // Calculate engagement rate if not provided
    const engagementRate = analytics.engagement_rate ?? 
      (analytics.view_count > 0 
        ? ((analytics.like_count + analytics.comment_count) / analytics.view_count) * 100 
        : 0);

    const { error } = await supabase
      .from('video_analytics')
      .upsert({
        ...analytics,
        engagement_rate: engagementRate,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'production_id,youtube_video_id'
      });

    if (error) {
      // Table might not exist yet
      if (error.code === '42P01') {
        console.warn('⚠️ video_analytics table not found. Please run the migration.');
        return false;
      }
      console.error('Error saving video analytics:', error);
      return false;
    }

    return true;
  } catch (e) {
    console.error('Error in saveVideoAnalytics:', e);
    return false;
  }
};

/**
 * Save analytics for multiple videos at once
 */
export const saveMultipleVideoAnalytics = async (analyticsArray: VideoAnalyticsRecord[]): Promise<number> => {
  if (!supabase || !analyticsArray.length) return 0;

  let savedCount = 0;
  for (const analytics of analyticsArray) {
    const success = await saveVideoAnalytics(analytics);
    if (success) savedCount++;
  }
  
  console.log(`📊 Saved analytics for ${savedCount}/${analyticsArray.length} videos`);
  return savedCount;
};

/**
 * Get video analytics for a channel within a date range
 */
export const getVideoAnalytics = async (
  channelId: string,
  startDate?: string,
  endDate?: string
): Promise<VideoAnalyticsRecord[]> => {
  if (!supabase) return [];

  try {
    let query = supabase
      .from('video_analytics')
      .select('*')
      .eq('channel_id', channelId)
      .order('video_published_at', { ascending: false });

    // Filter by date range if provided
    if (startDate) {
      query = query.gte('video_published_at', startDate);
    }
    if (endDate) {
      query = query.lte('video_published_at', endDate + 'T23:59:59.999Z');
    }

    const { data, error } = await query;

    if (error) {
      if (error.code === '42P01') {
        console.warn('⚠️ video_analytics table not found');
        return [];
      }
      console.error('Error fetching video analytics:', error);
      return [];
    }

    return data || [];
  } catch (e) {
    console.error('Error in getVideoAnalytics:', e);
    return [];
  }
};

/**
 * Get the latest analytics fetch timestamp for a channel
 */
export const getLastAnalyticsFetch = async (channelId: string): Promise<string | null> => {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('video_analytics')
      .select('fetched_at')
      .eq('channel_id', channelId)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === '42P01') return null;
      return null;
    }

    return data?.fetched_at || null;
  } catch (e) {
    return null;
  }
};

/**
 * Get analytics summary for a channel
 */
export const getChannelAnalyticsSummary = async (
  channelId: string,
  startDate: string,
  endDate: string
): Promise<{
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalVideos: number;
  avgViewsPerVideo: number;
  avgEngagementRate: number;
  topVideo: VideoAnalyticsRecord | null;
}> => {
  const analytics = await getVideoAnalytics(channelId, startDate, endDate);
  
  if (!analytics.length) {
    return {
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalVideos: 0,
      avgViewsPerVideo: 0,
      avgEngagementRate: 0,
      topVideo: null
    };
  }

  const totalViews = analytics.reduce((sum, a) => sum + a.view_count, 0);
  const totalLikes = analytics.reduce((sum, a) => sum + a.like_count, 0);
  const totalComments = analytics.reduce((sum, a) => sum + a.comment_count, 0);
  const totalVideos = analytics.length;
  const avgViewsPerVideo = totalVideos > 0 ? totalViews / totalVideos : 0;
  const avgEngagementRate = analytics.reduce((sum, a) => sum + (a.engagement_rate || 0), 0) / totalVideos;
  
  // Find top video by views
  const topVideo = analytics.reduce((top, current) => 
    current.view_count > (top?.view_count || 0) ? current : top
  , analytics[0]);

  return {
    totalViews,
    totalLikes,
    totalComments,
    totalVideos,
    avgViewsPerVideo,
    avgEngagementRate,
    topVideo
  };
};

/**
 * Get published productions with their analytics
 */
export const getProductionsWithAnalytics = async (
  channelId: string
): Promise<Array<Production & { analytics?: VideoAnalyticsRecord }>> => {
  if (!supabase) return [];

  try {
    // Get published productions
    const { data: productions, error: prodError } = await supabase
      .from('productions')
      .select('*')
      .eq('channel_id', channelId)
      .eq('status', 'published')
      .not('youtube_id', 'is', null)
      .order('published_at', { ascending: false });

    if (prodError) {
      console.error('Error fetching productions:', prodError);
      return [];
    }

    if (!productions?.length) return [];

    // Get analytics for these productions
    const productionIds = productions.map(p => p.id);
    const { data: analytics, error: analyticsError } = await supabase
      .from('video_analytics')
      .select('*')
      .in('production_id', productionIds);

    // Merge analytics with productions
    const analyticsMap = new Map((analytics || []).map(a => [a.production_id, a]));
    
    return productions.map(prod => ({
      ...prod,
      analytics: analyticsMap.get(prod.id)
    }));
  } catch (e) {
    console.error('Error in getProductionsWithAnalytics:', e);
    return [];
  }
};
