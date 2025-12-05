/**
 * Storage Management Service
 * Handles file deduplication, cleanup, and usage tracking
 */

import { supabase } from './supabaseService';

/**
 * Create a hash from file content (simple hash for deduplication)
 */
export const createFileHash = async (content: string | Blob): Promise<string> => {
  if (typeof content === 'string') {
    // For base64 strings, hash the content
    let hash = 0;
    const str = content.substring(0, 1000); // Hash first 1000 chars for performance
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  } else {
    // For Blobs, would need to read and hash (simplified for now)
    return `${content.size}_${content.type}`.replace(/[^a-z0-9]/gi, '');
  }
};

/**
 * Check if a file exists in storage by path
 */
export const checkFileExists = async (bucket: string, filePath: string): Promise<boolean> => {
  if (!supabase) return false;

  try {
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .list(filePath.split('/').slice(0, -1).join('/') || '', {
        limit: 1000,
        search: filePath.split('/').pop()
      });

    if (error) {
      console.error("Error checking file existence:", error);
      return false;
    }

    return data?.some(file => file.name === filePath.split('/').pop()) || false;
  } catch (e) {
    console.error("Error in checkFileExists:", e);
    return false;
  }
};

/**
 * Get storage usage for a bucket (approximate)
 */
export const getStorageUsage = async (bucket: string): Promise<{
  totalFiles: number;
  totalSize: number; // in bytes
  files: Array<{ name: string; size: number }>;
}> => {
  if (!supabase) {
    return { totalFiles: 0, totalSize: 0, files: [] };
  }

  try {
    // List all files in bucket (this might be slow for large buckets)
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .list('', {
        limit: 10000, // Adjust based on needs
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (error) {
      console.error("Error getting storage usage:", error);
      return { totalFiles: 0, totalSize: 0, files: [] };
    }

    const files = data || [];
    const totalSize = files.reduce((sum, file) => sum + (file.metadata?.size || 0), 0);

    return {
      totalFiles: files.length,
      totalSize,
      files: files.map(f => ({
        name: f.name,
        size: f.metadata?.size || 0
      }))
    };
  } catch (e) {
    console.error("Error in getStorageUsage:", e);
    return { totalFiles: 0, totalSize: 0, files: [] };
  }
};

/**
 * Clean up old files from storage (older than specified days)
 */
export const cleanupOldFiles = async (
  bucket: string,
  daysOld: number = 30,
  dryRun: boolean = false
): Promise<{
  deleted: number;
  freedSpace: number; // bytes
  errors: string[];
}> => {
  if (!supabase) {
    return { deleted: 0, freedSpace: 0, errors: [] };
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  const errors: string[] = [];
  let deleted = 0;
  let freedSpace = 0;

  try {
    // List all files
    const { data: files, error: listError } = await supabase
      .storage
      .from(bucket)
      .list('', {
        limit: 10000,
        sortBy: { column: 'created_at', order: 'asc' }
      });

    if (listError) {
      errors.push(`Failed to list files: ${listError.message}`);
      return { deleted: 0, freedSpace: 0, errors };
    }

    if (!files) {
      return { deleted: 0, freedSpace: 0, errors: [] };
    }

    // Filter old files
    const oldFiles = files.filter(file => {
      const createdAt = file.created_at ? new Date(file.created_at) : null;
      return createdAt && createdAt < cutoffDate;
    });

    console.log(`Found ${oldFiles.length} files older than ${daysOld} days`);

    if (dryRun) {
      const totalSize = oldFiles.reduce((sum, f) => sum + (f.metadata?.size || 0), 0);
      return {
        deleted: oldFiles.length,
        freedSpace: totalSize,
        errors: []
      };
    }

    // Delete old files
    for (const file of oldFiles) {
      try {
        const { error: deleteError } = await supabase
          .storage
          .from(bucket)
          .remove([file.name]);

        if (deleteError) {
          errors.push(`Failed to delete ${file.name}: ${deleteError.message}`);
        } else {
          deleted++;
          freedSpace += file.metadata?.size || 0;
        }
      } catch (e: any) {
        errors.push(`Error deleting ${file.name}: ${e.message}`);
      }
    }

    console.log(`✅ Cleaned up ${deleted} files, freed ${(freedSpace / 1024 / 1024).toFixed(2)} MB`);
    return { deleted, freedSpace, errors };
  } catch (e: any) {
    errors.push(`Cleanup error: ${e.message}`);
    return { deleted, freedSpace, errors };
  }
};

/**
 * Find duplicate files by checking if content hash already exists
 * This is a simplified version - in production you might want to store hashes in DB
 */
export const findDuplicateFile = async (
  bucket: string,
  fileHash: string,
  fileName: string
): Promise<string | null> => {
  // For now, we'll check by filename pattern
  // In a full implementation, you'd store file hashes in a DB table
  if (!supabase) return null;

  try {
    // Check if a file with similar name exists (simplified check)
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .list('', {
        limit: 1000,
        search: fileName.split('_')[0] // Search by prefix
      });

    if (error || !data) return null;

    // Return first match (in production, compare hashes)
    const match = data.find(f => f.name.includes(fileHash.substring(0, 8)));
    return match ? match.name : null;
  } catch (e) {
    console.error("Error finding duplicate:", e);
    return null;
  }
};

/**
 * Verify if a Storage URL is valid and accessible
 * Extracts the path from the URL and checks if the file exists in Storage
 */
export const verifyStorageUrl = async (url: string): Promise<boolean> => {
  if (!url || !supabase) return false;

  try {
    // Check if it's a Supabase storage URL
    if (!url.includes('supabase.co/storage/v1/object/public/channel-assets')) {
      // For external URLs, do a HEAD request
      try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
      } catch {
        return false;
      }
    }

    // Extract path from Supabase URL
    const urlParts = url.split('/channel-assets/');
    if (urlParts.length < 2) return false;
    
    const filePath = urlParts[1];
    return await checkFileExists('channel-assets', filePath);
  } catch (e) {
    console.error("Error verifying storage URL:", e);
    return false;
  }
};

/**
 * Verify multiple URLs in parallel with batching for performance
 * Returns a map of URL -> isValid
 */
export const verifyStorageUrls = async (
  urls: (string | null | undefined)[]
): Promise<Map<string, boolean>> => {
  const results = new Map<string, boolean>();
  const validUrls = urls.filter((url): url is string => !!url);
  
  if (validUrls.length === 0) return results;

  // Process in batches of 5 to avoid overwhelming the server
  const batchSize = 5;
  for (let i = 0; i < validUrls.length; i += batchSize) {
    const batch = validUrls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (url) => ({
        url,
        valid: await verifyStorageUrl(url)
      }))
    );
    
    for (const { url, valid } of batchResults) {
      results.set(url, valid);
    }
  }

  return results;
};

/**
 * Interface for segment resource status
 */
export interface SegmentResourceStatus {
  index: number;
  audioUrl: string | null;
  audioValid: boolean;
  videoUrl: string | null;
  videoValid: boolean;
  needsAudio: boolean;
  needsVideo: boolean;
}

/**
 * Analyze segments to determine which resources need to be generated
 * Returns detailed status for each segment
 */
export const analyzeSegmentResources = async (
  segments: Array<{ audioUrl?: string | null; videoUrl?: string | null }>
): Promise<SegmentResourceStatus[]> => {
  if (!segments || segments.length === 0) return [];

  // Collect all URLs to verify
  const allUrls = segments.flatMap(seg => [seg.audioUrl, seg.videoUrl]);
  const urlValidityMap = await verifyStorageUrls(allUrls);

  // Build status for each segment
  return segments.map((seg, index) => {
    const audioUrl = seg.audioUrl || null;
    const videoUrl = seg.videoUrl || null;
    const audioValid = audioUrl ? (urlValidityMap.get(audioUrl) ?? false) : false;
    const videoValid = videoUrl ? (urlValidityMap.get(videoUrl) ?? false) : false;

    return {
      index,
      audioUrl,
      audioValid,
      videoUrl,
      videoValid,
      needsAudio: !audioUrl || !audioValid,
      needsVideo: !videoUrl || !videoValid
    };
  });
};
