/**
 * Asset Reuse Service
 * 
 * NEW: Sistema de Reutilización de Assets
 * - Asset library compartida entre producciones
 * - Asset similarity matching
 * - Asset versioning para variaciones
 * - Asset marketplace interno
 */

import { supabase } from './supabaseService';

export interface AssetMetadata {
  id: string;
  type: 'video' | 'audio' | 'image' | 'thumbnail';
  url: string;
  channelId: string;
  productionId?: string;
  dialogueText?: string; // For video/audio assets
  voiceName?: string; // For audio assets
  sceneType?: string; // For video assets
  shotType?: string; // For video assets
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  tags?: string[]; // For searchability
  useCount: number; // How many times this asset has been reused
  createdAt: string;
  lastUsedAt?: string;
}

export interface SimilarAsset {
  asset: AssetMetadata;
  similarity: number; // 0-1
  matchReason: string;
}

/**
 * NEW: Asset Reuse Service
 * Manages asset library and similarity matching
 */
export class AssetReuseService {
  /**
   * Find similar assets that could be reused
   */
  static async findSimilarAssets(
    channelId: string,
    type: 'video' | 'audio' | 'image',
    criteria: {
      dialogueText?: string;
      voiceName?: string;
      sceneType?: string;
      shotType?: string;
      minSimilarity?: number;
    }
  ): Promise<SimilarAsset[]> {
    if (!supabase) return [];

    try {
      const { data, error } = await supabase
        .from('generated_videos') // Use existing table or create asset_library
        .select('*')
        .eq('channel_id', channelId)
        .limit(100);

      if (error || !data) return [];

      const similar: SimilarAsset[] = [];

      for (const asset of data) {
        let similarity = 0;
        const reasons: string[] = [];

        // Match by dialogue text (fuzzy)
        if (criteria.dialogueText && asset.dialogue_text) {
          const textSimilarity = this.calculateTextSimilarity(
            criteria.dialogueText.toLowerCase(),
            asset.dialogue_text.toLowerCase()
          );
          if (textSimilarity > 0.7) {
            similarity += textSimilarity * 0.5;
            reasons.push(`dialogue match (${(textSimilarity * 100).toFixed(0)}%)`);
          }
        }

        // Match by scene type
        if (criteria.sceneType && asset.scene_metadata) {
          const metadata = typeof asset.scene_metadata === 'string' 
            ? JSON.parse(asset.scene_metadata) 
            : asset.scene_metadata;
          if (metadata.sceneType === criteria.sceneType) {
            similarity += 0.3;
            reasons.push('scene type match');
          }
        }

        // Match by shot type
        if (criteria.shotType && asset.shot_type === criteria.shotType) {
          similarity += 0.2;
          reasons.push('shot type match');
        }

        if (similarity >= (criteria.minSimilarity || 0.6)) {
          similar.push({
            asset: {
              id: asset.id,
              type: 'video',
              url: asset.video_url,
              channelId: asset.channel_id,
              productionId: asset.production_id,
              dialogueText: asset.dialogue_text,
              sceneType: asset.scene_metadata?.sceneType,
              shotType: asset.shot_type,
              duration: asset.duration_seconds,
              resolution: asset.resolution,
              aspectRatio: asset.aspect_ratio,
              useCount: asset.use_count || 0,
              createdAt: asset.created_at,
              lastUsedAt: asset.last_used_at
            },
            similarity,
            matchReason: reasons.join(', ')
          });
        }
      }

      // Sort by similarity
      similar.sort((a, b) => b.similarity - a.similarity);

      return similar;
    } catch (e) {
      console.warn('Asset similarity search failed:', e);
      return [];
    }
  }

  /**
   * Calculate text similarity (Levenshtein-based)
   */
  private static calculateTextSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Levenshtein distance
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Record asset reuse
   */
  static async recordReuse(assetId: string, productionId: string) {
    if (!supabase) return;

    try {
      // Update use count and last used date
      // Get current use_count first, then increment
      const { data: current } = await supabase
        .from('generated_videos')
        .select('use_count')
        .eq('id', assetId)
        .single();
      
      if (current) {
        await supabase
          .from('generated_videos')
          .update({
            use_count: (current.use_count || 0) + 1,
            last_used_at: new Date().toISOString()
          })
          .eq('id', assetId);
      }
    } catch (e) {
      console.warn('Failed to record asset reuse:', e);
    }
  }

  /**
   * Get most reused assets (asset marketplace)
   */
  static async getPopularAssets(
    channelId: string,
    type?: 'video' | 'audio' | 'image',
    limit: number = 20
  ): Promise<AssetMetadata[]> {
    if (!supabase) return [];

    try {
      let query = supabase
        .from('generated_videos')
        .select('*')
        .eq('channel_id', channelId)
        .order('use_count', { ascending: false })
        .limit(limit);

      const { data, error } = await query;

      if (error || !data) return [];

      return data.map(asset => ({
        id: asset.id,
        type: 'video' as const,
        url: asset.video_url,
        channelId: asset.channel_id,
        productionId: asset.production_id,
        dialogueText: asset.dialogue_text,
        sceneType: asset.scene_metadata?.sceneType,
        shotType: asset.shot_type,
        duration: asset.duration_seconds,
        resolution: asset.resolution,
        aspectRatio: asset.aspect_ratio,
        useCount: asset.use_count || 0,
        createdAt: asset.created_at,
        lastUsedAt: asset.last_used_at
      }));
    } catch (e) {
      console.warn('Failed to get popular assets:', e);
      return [];
    }
  }

  /**
   * Create asset version (for variations)
   */
  static async createAssetVersion(
    originalAssetId: string,
    newUrl: string,
    variation: string
  ): Promise<string | null> {
    if (!supabase) return null;

    try {
      // Get original asset
      const { data: original, error: fetchError } = await supabase
        .from('generated_videos')
        .select('*')
        .eq('id', originalAssetId)
        .single();

      if (fetchError || !original) return null;

      // Create versioned asset
      const { data, error } = await supabase
        .from('generated_videos')
        .insert({
          channel_id: original.channel_id,
          production_id: original.production_id,
          video_url: newUrl,
          dialogue_text: original.dialogue_text,
          scene_metadata: {
            ...original.scene_metadata,
            variation,
            originalAssetId
          },
          shot_type: original.shot_type,
          resolution: original.resolution,
          aspect_ratio: original.aspect_ratio,
          duration_seconds: original.duration_seconds,
          use_count: 0
        })
        .select('id')
        .single();

      if (error || !data) return null;

      return data.id;
    } catch (e) {
      console.warn('Failed to create asset version:', e);
      return null;
    }
  }
}
