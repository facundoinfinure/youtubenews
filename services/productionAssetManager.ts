/**
 * Production Asset Manager
 * 
 * NEW: Sistema completo de gestión de assets para producciones
 * - Limpieza de assets antiguos al regenerar
 * - Actualización de tablas de cache
 * - Gestión de relaciones entre tablas
 * - Limpieza de assets huérfanos
 */

import { supabase } from './supabaseService';
import { Production, BroadcastSegment } from '../types';

/**
 * Clean up old assets when script/scene is regenerated
 */
export const cleanupSegmentAssets = async (
  productionId: string,
  segmentIndex: number,
  cleanupAudio: boolean = true,
  cleanupVideo: boolean = true
): Promise<void> => {
  if (!supabase) return;

  try {
    console.log(`🧹 [Asset Cleanup] Cleaning up assets for segment ${segmentIndex} in production ${productionId}`);

    // 1. Delete audio from storage
    if (cleanupAudio) {
      // Try multiple possible paths (different naming conventions)
      const audioPaths = [
        `productions/${productionId}/audio/segment_${segmentIndex}.mp3`,
        `productions/${productionId}/audio/segment-${segmentIndex}.mp3`,
        `productions/${productionId}/audio/${segmentIndex}.mp3`
      ];
      
      const { error: audioError } = await supabase.storage
        .from('channel-assets')
        .remove(audioPaths);

      if (audioError && audioError.message !== 'Object not found') {
        console.warn(`⚠️ [Asset Cleanup] Error deleting audio: ${audioError.message}`);
      } else {
        console.log(`✅ [Asset Cleanup] Deleted audio for segment ${segmentIndex}`);
      }
    }

    // 2. Mark video as obsolete in generated_videos table (don't delete, mark for cleanup)
    if (cleanupVideo) {
      // CRITICAL: Mark ALL videos for this segment as obsolete (not just completed ones)
      const { error: videoError } = await supabase
        .from('generated_videos')
        .update({ 
          status: 'failed',
          error_message: 'Regenerated - marked for cleanup'
        })
        .eq('production_id', productionId)
        .eq('segment_index', segmentIndex)
        .in('status', ['completed', 'generating', 'pending']); // Mark all non-failed as obsolete

      if (videoError) {
        console.warn(`⚠️ [Asset Cleanup] Error marking video obsolete: ${videoError.message}`);
      } else {
        console.log(`✅ [Asset Cleanup] Marked video as obsolete for segment ${segmentIndex}`);
      }
    }

    // 3. Remove from audio_cache if it was cached (optional - keep cache for reuse)
    // We don't delete from audio_cache because it might be reused by other productions
    // But we could mark it as less relevant if needed

  } catch (e) {
    console.error(`❌ [Asset Cleanup] Error cleaning up segment assets:`, e);
  }
};

/**
 * Clean up all assets when entire script is regenerated
 */
export const cleanupProductionAssetsOnRegenerate = async (
  productionId: string,
  keepSegments: number[] = [] // Segments to keep (e.g., if only regenerating some)
): Promise<void> => {
  if (!supabase) return;

  try {
    console.log(`🧹 [Asset Cleanup] Cleaning up production assets (keeping segments: ${keepSegments.join(', ')})`);

    // Get production to find all segments
    const { data: production, error: fetchError } = await supabase
      .from('productions')
      .select('segments, segment_status')
      .eq('id', productionId)
      .single();

    if (fetchError || !production) {
      console.warn(`⚠️ [Asset Cleanup] Could not fetch production: ${fetchError?.message}`);
      return;
    }

    const segments = (production.segments as BroadcastSegment[]) || [];
    const segmentStatus = (production.segment_status as Record<number, any>) || {};

    // Clean up each segment that's not in keepSegments
    for (let i = 0; i < segments.length; i++) {
      if (keepSegments.includes(i)) {
        console.log(`⏭️ [Asset Cleanup] Skipping segment ${i} (in keep list)`);
        continue;
      }

      await cleanupSegmentAssets(productionId, i, true, true);

      // Also clear segment status
      if (segmentStatus[i]) {
        const updatedStatus = {
          ...segmentStatus,
          [i]: {
            ...segmentStatus[i],
            audio: 'pending',
            video: 'pending',
            audioUrl: undefined,
            videoUrl: undefined
          }
        };

        await supabase
          .from('productions')
          .update({ segment_status: updatedStatus })
          .eq('id', productionId);
      }
    }

    console.log(`✅ [Asset Cleanup] Production assets cleaned up`);
  } catch (e) {
    console.error(`❌ [Asset Cleanup] Error cleaning up production assets:`, e);
  }
};

/**
 * Update audio_cache when audio is regenerated
 */
export const updateAudioCacheOnRegenerate = async (
  channelId: string,
  oldText: string,
  newText: string,
  voiceName: string,
  newAudioUrl: string,
  durationSeconds?: number,
  productionId?: string
): Promise<void> => {
  if (!supabase) return;

  try {
    // If text changed, we should create new cache entry
    // Old entry can stay (might be reused by other productions)
    // But we update the new one
    // Import createTextHash function
    const createTextHash = (text: string): string => {
      // Simple hash function (same as in supabaseService)
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return Math.abs(hash).toString();
    };
    const textHash = createTextHash(newText);

    // Check if new text already has cache entry
    const { data: existing } = await supabase
      .from('audio_cache')
      .select('id')
      .eq('channel_id', channelId)
      .eq('text_hash', textHash)
      .eq('voice_name', voiceName)
      .maybeSingle();

    if (!existing) {
      // Create new cache entry for new text
      await supabase
        .from('audio_cache')
        .insert({
          channel_id: channelId,
          text_hash: textHash,
          voice_name: voiceName,
          audio_url: newAudioUrl,
          duration_seconds: durationSeconds,
          text_preview: newText.substring(0, 100),
          production_id: productionId || null,
          use_count: 1,
          last_used_at: new Date().toISOString()
        });

      console.log(`✅ [Audio Cache] Created new cache entry for regenerated audio`);
    } else {
      // Update existing entry
      await supabase
        .from('audio_cache')
        .update({
          audio_url: newAudioUrl,
          duration_seconds: durationSeconds,
          last_used_at: new Date().toISOString(),
          use_count: (existing as any).use_count + 1
        })
        .eq('id', existing.id);

      console.log(`✅ [Audio Cache] Updated cache entry for regenerated audio`);
    }
  } catch (e) {
    console.error(`❌ [Audio Cache] Error updating cache on regenerate:`, e);
  }
};

/**
 * Update generated_videos when video is regenerated
 */
export const updateVideoCacheOnRegenerate = async (
  channelId: string,
  productionId: string,
  segmentIndex: number,
  oldVideoUrl: string,
  newVideoUrl: string,
  dialogueText: string,
  videoType: string = 'segment'
): Promise<void> => {
  if (!supabase) return;

  try {
    // Mark old video as obsolete
    await supabase
      .from('generated_videos')
      .update({
        status: 'failed',
        error_message: 'Regenerated - replaced by new video'
      })
      .eq('production_id', productionId)
      .eq('segment_index', segmentIndex)
      .eq('video_url', oldVideoUrl)
      .eq('status', 'completed');

    // Create new video entry
    const createTextHash = (text: string): string => {
      // Simple hash function (same as in supabaseService)
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return Math.abs(hash).toString();
    };
    const promptHash = createTextHash(dialogueText);

    await supabase
      .from('generated_videos')
      .insert({
        channel_id: channelId,
        production_id: productionId,
        video_type: videoType,
        segment_index: segmentIndex,
        prompt_hash: promptHash,
        dialogue_text: dialogueText,
        video_url: newVideoUrl,
        provider: 'wavespeed',
        status: 'completed',
        aspect_ratio: '16:9'
      });

    console.log(`✅ [Video Cache] Updated video cache for regenerated video`);
  } catch (e) {
    console.error(`❌ [Video Cache] Error updating video cache on regenerate:`, e);
  }
};

/**
 * Clean up orphaned assets (assets not referenced by any production)
 */
export const cleanupOrphanedAssets = async (
  channelId: string,
  daysOld: number = 30
): Promise<{
  deletedAudio: number;
  deletedVideos: number;
  errors: string[];
}> => {
  if (!supabase) {
    return { deletedAudio: 0, deletedVideos: 0, errors: ['Supabase not initialized'] };
  }

  const errors: string[] = [];
  let deletedAudio = 0;
  let deletedVideos = 0;

  try {
    // Find orphaned audio_cache entries (not referenced by active productions)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const { data: orphanedAudio, error: audioError } = await supabase
      .from('audio_cache')
      .select('id, audio_url, production_id, last_used_at')
      .eq('channel_id', channelId)
      .lt('last_used_at', cutoffDate.toISOString())
      .eq('use_count', 1); // Only entries that were never reused

    if (audioError) {
      errors.push(`Error finding orphaned audio: ${audioError.message}`);
    } else if (orphanedAudio && orphanedAudio.length > 0) {
      // Check if production still exists
      const productionIds = orphanedAudio
        .map(a => a.production_id)
        .filter((id): id is string => Boolean(id));

      if (productionIds.length > 0) {
        const { data: existingProductions } = await supabase
          .from('productions')
          .select('id')
          .in('id', productionIds);

        const existingIds = new Set(existingProductions?.map(p => p.id) || []);

        // Delete audio_cache entries where production doesn't exist
        const toDelete = orphanedAudio.filter(a => 
          !a.production_id || !existingIds.has(a.production_id)
        );

        for (const audio of toDelete) {
          // Delete from storage
          if (audio.audio_url) {
            const { error: storageError } = await supabase.storage
              .from('channel-assets')
              .remove([audio.audio_url]);

            if (storageError && storageError.message !== 'Object not found') {
              errors.push(`Error deleting audio from storage: ${storageError.message}`);
            }
          }

          // Delete from cache table
          const { error: deleteError } = await supabase
            .from('audio_cache')
            .delete()
            .eq('id', audio.id);

          if (deleteError) {
            errors.push(`Error deleting audio cache entry: ${deleteError.message}`);
          } else {
            deletedAudio++;
          }
        }
      }
    }

    // Find orphaned generated_videos (failed or obsolete)
    const { data: orphanedVideos, error: videoError } = await supabase
      .from('generated_videos')
      .select('id, video_url, production_id, status, error_message')
      .eq('channel_id', channelId)
      .in('status', ['failed'])
      .like('error_message', '%Regenerated%'); // Only videos marked as regenerated

    if (videoError) {
      errors.push(`Error finding orphaned videos: ${videoError.message}`);
    } else if (orphanedVideos && orphanedVideos.length > 0) {
      // Delete videos marked as regenerated (they've been replaced)
      for (const video of orphanedVideos) {
        const { error: deleteError } = await supabase
          .from('generated_videos')
          .delete()
          .eq('id', video.id);

        if (deleteError) {
          errors.push(`Error deleting video: ${deleteError.message}`);
        } else {
          deletedVideos++;
        }
      }
    }

    console.log(`✅ [Orphan Cleanup] Deleted ${deletedAudio} audio entries and ${deletedVideos} video entries`);
    return { deletedAudio, deletedVideos, errors };
  } catch (e) {
    const errorMsg = (e as Error).message;
    errors.push(`Error in cleanupOrphanedAssets: ${errorMsg}`);
    console.error(`❌ [Orphan Cleanup] Error:`, e);
    return { deletedAudio, deletedVideos, errors };
  }
};

/**
 * Get production asset summary
 */
export const getProductionAssetSummary = async (
  productionId: string
): Promise<{
  audioCount: number;
  videoCount: number;
  totalSize: number;
  cacheHits: number;
}> => {
  if (!supabase) {
    return { audioCount: 0, videoCount: 0, totalSize: 0, cacheHits: 0 };
  }

  try {
    // Count audio files
    const { data: audioFiles } = await supabase.storage
      .from('channel-assets')
      .list(`productions/${productionId}/audio`);

    // Count videos
    const { data: videos } = await supabase
      .from('generated_videos')
      .select('id')
      .eq('production_id', productionId)
      .eq('status', 'completed');

    // Count cache hits
    const { data: cacheEntries } = await supabase
      .from('audio_cache')
      .select('use_count')
      .eq('production_id', productionId);

    const cacheHits = cacheEntries?.reduce((sum, e) => sum + (e.use_count || 1) - 1, 0) || 0;

    return {
      audioCount: audioFiles?.length || 0,
      videoCount: videos?.length || 0,
      totalSize: 0, // Would need to calculate from storage
      cacheHits
    };
  } catch (e) {
    console.error(`❌ [Asset Summary] Error:`, e);
    return { audioCount: 0, videoCount: 0, totalSize: 0, cacheHits: 0 };
  }
};
