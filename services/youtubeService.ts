
import { UserProfile, ViralMetadata, BroadcastSegment } from "../types";
import { generateSRTFromSegments } from "./subtitleService";

// =============================================================================================
// CONFIGURATION: GOOGLE CLOUD OAUTH CLIENT ID
// =============================================================================================

// Priority: 
// 1. Runtime Environment (Cloud Run - window.env)
// 2. Build-time Environment (Vite - process.env)
const getClientId = () => {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || window.env?.googlecloud_clientid || process.env.googlecloud_clientid || process.env.GOOGLE_CLIENT_ID;
}

// Login handled via Supabase Auth now

// Map channel language config to YouTube language codes
const LANGUAGE_CODE_MAP: Record<string, string> = {
  'English': 'en',
  'Spanish': 'es',
  'Portuguese': 'pt',
  'French': 'fr',
  'German': 'de',
  'Italian': 'it',
  'Japanese': 'ja',
  'Korean': 'ko',
  'Chinese': 'zh',
  'Russian': 'ru',
  'Arabic': 'ar',
  'Hindi': 'hi',
};

/**
 * Get YouTube language code from channel language setting
 * @param language - Channel language (e.g., "Spanish", "English")
 * @returns YouTube language code (e.g., "es", "en")
 */
const getYouTubeLanguageCode = (language?: string): string => {
  if (!language) return 'en';
  return LANGUAGE_CODE_MAP[language] || 'en';
};

/**
 * Upload captions/subtitles to a YouTube video
 * Uses YouTube Data API v3 captions endpoint
 */
export const uploadCaptionsToYouTube = async (
  videoId: string,
  srtContent: string,
  accessToken: string,
  languageCode: string = 'es',
  captionName: string = 'Subtítulos'
): Promise<boolean> => {
  try {
    console.log(`[YouTube] 📝 Uploading captions for video ${videoId}...`);
    
    // Create caption metadata
    const captionMetadata = {
      snippet: {
        videoId: videoId,
        language: languageCode,
        name: captionName,
        isDraft: false
      }
    };
    
    // Create multipart form data
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;
    
    const metadataPart = 
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(captionMetadata);
    
    const mediaPart = 
      delimiter +
      'Content-Type: text/plain; charset=UTF-8\r\n' +
      'Content-Transfer-Encoding: binary\r\n\r\n' +
      srtContent;
    
    const requestBody = metadataPart + mediaPart + closeDelimiter;
    
    const response = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary="${boundary}"`,
        },
        body: requestBody
      }
    );
    
    if (response.ok) {
      console.log(`[YouTube] ✅ Captions uploaded successfully`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`[YouTube] ⚠️ Caption upload failed: ${response.status} - ${errorText}`);
      // Don't fail the whole process, just log the error
      return false;
    }
  } catch (error) {
    console.error(`[YouTube] ⚠️ Caption upload error:`, (error as Error).message);
    return false;
  }
};

export const uploadVideoToYouTube = async (
  blob: Blob,
  metadata: ViralMetadata,
  accessToken: string,
  thumbnailBlob: Blob | null,
  onProgress: (percent: number) => void,
  channelLanguage?: string, // Optional: channel language setting (e.g., "Spanish")
  segments?: BroadcastSegment[], // Optional: segments for subtitle generation
  introOffset?: number // Optional: offset in seconds for intro video
): Promise<string> => {
  try {
    // Get YouTube language code from channel language
    const languageCode = getYouTubeLanguageCode(channelLanguage);
    console.log(`[YouTube] 🌐 Setting video language to: ${languageCode} (from channel: ${channelLanguage || 'default'})`);

    const metadataObj = {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: "25", // News & Politics
        defaultLanguage: languageCode, // Language of title/description
        defaultAudioLanguage: languageCode, // Language spoken in video
      },
      status: {
        privacyStatus: "private", // Default to private for safety
      },
    };

    const formData = new FormData();
    formData.append(
      "snippet",
      new Blob([JSON.stringify(metadataObj)], { type: "application/json" })
    );
    formData.append("file", blob, "video.mp4");

    const videoId = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response.id);
          } catch (e) {
            reject(new Error("Failed to parse YouTube response"));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}: ${xhr.responseText}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload."));

      xhr.open(
        "POST",
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status"
      );
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.send(formData);
    });

    // Upload Thumbnail if provided
    if (thumbnailBlob && videoId) {
      onProgress(100); // Video done, starting thumbnail
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              console.error("Thumbnail upload failed", xhr.responseText);
              // Don't fail the whole process if thumbnail fails, just log it
              resolve();
            }
          };
          xhr.onerror = () => {
            console.error("Network error during thumbnail upload");
            resolve();
          };

          xhr.open("POST", `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`);
          xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
          // Content-Type is automatically set by browser for Blob/File, but for raw bytes we might need it.
          // However, for 'set' endpoint, we send the binary data directly.
          xhr.setRequestHeader("Content-Type", "image/png");
          xhr.send(thumbnailBlob);
        });
      } catch (e) {
        console.error("Thumbnail upload error", e);
      }
    }
    
    // Upload Subtitles/Captions if segments are provided
    if (segments && segments.length > 0 && videoId) {
      console.log(`[YouTube] 📝 Generating and uploading subtitles...`);
      try {
        const srtContent = generateSRTFromSegments(segments, {
          includeSpeakerNames: false, // Cleaner subtitles without speaker names
          introOffset: introOffset || 0
        });
        
        await uploadCaptionsToYouTube(
          videoId,
          srtContent,
          accessToken,
          languageCode,
          languageCode === 'es' ? 'Subtítulos en español' : 'Subtitles'
        );
      } catch (captionError) {
        console.error("Caption upload error:", captionError);
        // Don't fail the whole process if captions fail
      }
    }

    return `https://youtu.be/${videoId}`;

  } catch (error) {
    throw new Error(`YouTube upload error: ${(error as Error).message}`);
  }
};

export const deleteVideoFromYouTube = async (videoId: string, accessToken: string): Promise<void> => {
  try {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        if (xhr.status === 204) {
          resolve();
        } else {
          reject(new Error(`Delete failed with status ${xhr.status}: ${xhr.responseText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during delete."));

      xhr.open("DELETE", `https://www.googleapis.com/youtube/v3/videos?id=${videoId}`);
      xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      xhr.send();
    });
  } catch (error) {
    throw new Error(`YouTube delete error: ${(error as Error).message}`);
  }
};

// =============================================================================================
// YOUTUBE ANALYTICS - Video Statistics
// =============================================================================================

export interface YouTubeVideoStats {
  videoId: string;
  title: string;
  publishedAt: string;
  thumbnailUrl: string;
  statistics: {
    viewCount: number;
    likeCount: number;
    commentCount: number;
    favoriteCount: number;
  };
  // Calculated/estimated metrics
  estimatedMinutesWatched?: number;
  averageViewDuration?: number; // in seconds
  clickThroughRate?: number; // percentage
  // Metadata
  fetchedAt: string;
}

/**
 * Extract YouTube video ID from various URL formats
 */
export const extractYouTubeVideoId = (url: string): string | null => {
  if (!url) return null;
  
  // Handle youtu.be format
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  
  // Handle youtube.com/watch?v= format
  const watchMatch = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  
  // Handle youtube.com/embed/ format
  const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  
  // If it's already just the ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  
  return null;
};

/**
 * Fetch video statistics from YouTube Data API v3
 * Requires youtube.readonly or youtube scope
 */
export const fetchYouTubeVideoStats = async (
  videoIds: string[],
  accessToken: string
): Promise<YouTubeVideoStats[]> => {
  if (!videoIds.length) return [];
  
  try {
    // YouTube API allows up to 50 video IDs per request
    const batchSize = 50;
    const allStats: YouTubeVideoStats[] = [];
    
    for (let i = 0; i < videoIds.length; i += batchSize) {
      const batch = videoIds.slice(i, i + batchSize);
      const idsParam = batch.join(',');
      
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${idsParam}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[YouTube Analytics] Failed to fetch stats: ${response.status} - ${errorText}`);
        continue;
      }
      
      const data = await response.json();
      
      for (const item of data.items || []) {
        const stats: YouTubeVideoStats = {
          videoId: item.id,
          title: item.snippet?.title || '',
          publishedAt: item.snippet?.publishedAt || '',
          thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
          statistics: {
            viewCount: parseInt(item.statistics?.viewCount || '0', 10),
            likeCount: parseInt(item.statistics?.likeCount || '0', 10),
            commentCount: parseInt(item.statistics?.commentCount || '0', 10),
            favoriteCount: parseInt(item.statistics?.favoriteCount || '0', 10),
          },
          fetchedAt: new Date().toISOString(),
        };
        
        allStats.push(stats);
      }
    }
    
    console.log(`[YouTube Analytics] ✅ Fetched stats for ${allStats.length} videos`);
    return allStats;
    
  } catch (error) {
    console.error('[YouTube Analytics] Error fetching video stats:', error);
    throw error;
  }
};

/**
 * Fetch YouTube Analytics data for a channel's videos
 * Note: This requires YouTube Analytics API scope (yt-analytics.readonly)
 * For basic stats, use fetchYouTubeVideoStats instead
 */
export const fetchYouTubeAnalytics = async (
  accessToken: string,
  startDate: string, // YYYY-MM-DD format
  endDate: string,   // YYYY-MM-DD format
  videoIds?: string[] // Optional: specific video IDs to filter
): Promise<{
  rows: Array<{
    videoId: string;
    views: number;
    estimatedMinutesWatched: number;
    averageViewDuration: number;
    likes: number;
    comments: number;
    shares: number;
    subscribersGained: number;
  }>;
}> => {
  try {
    // Build the request URL for YouTube Analytics API
    let url = `https://youtubeanalytics.googleapis.com/v2/reports?` +
      `ids=channel==MINE&` +
      `startDate=${startDate}&` +
      `endDate=${endDate}&` +
      `metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained&` +
      `dimensions=video&` +
      `sort=-views&` +
      `maxResults=200`;
    
    // Add video filter if specific videos are requested
    if (videoIds && videoIds.length > 0) {
      url += `&filters=video==${videoIds.join(',')}`;
    }
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[YouTube Analytics API] Failed: ${response.status} - ${errorText}`);
      // Fallback to basic stats if Analytics API fails
      throw new Error(`YouTube Analytics API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Parse the response into a more usable format
    const rows = (data.rows || []).map((row: any[]) => ({
      videoId: row[0],
      views: row[1] || 0,
      estimatedMinutesWatched: row[2] || 0,
      averageViewDuration: row[3] || 0,
      likes: row[4] || 0,
      comments: row[5] || 0,
      shares: row[6] || 0,
      subscribersGained: row[7] || 0,
    }));
    
    console.log(`[YouTube Analytics] ✅ Fetched analytics for ${rows.length} videos`);
    return { rows };
    
  } catch (error) {
    console.error('[YouTube Analytics] Error:', error);
    throw error;
  }
};

/**
 * Get date range strings for common periods
 */
export const getAnalyticsDateRange = (period: 'today' | 'yesterday' | '7days' | '14days' | '28days' | '90days'): { startDate: string; endDate: string } => {
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];
  
  let startDate: string;
  
  switch (period) {
    case 'today':
      startDate = endDate;
      break;
    case 'yesterday':
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = yesterday.toISOString().split('T')[0];
      break;
    case '7days':
      const week = new Date(today);
      week.setDate(week.getDate() - 7);
      startDate = week.toISOString().split('T')[0];
      break;
    case '14days':
      const twoWeeks = new Date(today);
      twoWeeks.setDate(twoWeeks.getDate() - 14);
      startDate = twoWeeks.toISOString().split('T')[0];
      break;
    case '28days':
      const month = new Date(today);
      month.setDate(month.getDate() - 28);
      startDate = month.toISOString().split('T')[0];
      break;
    case '90days':
      const quarter = new Date(today);
      quarter.setDate(quarter.getDate() - 90);
      startDate = quarter.toISOString().split('T')[0];
      break;
    default:
      const defaultMonth = new Date(today);
      defaultMonth.setDate(defaultMonth.getDate() - 28);
      startDate = defaultMonth.toISOString().split('T')[0];
  }
  
  return { startDate, endDate };
};