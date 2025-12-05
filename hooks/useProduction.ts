/**
 * Production Hook
 * 
 * Manages production state, progress tracking, and persistence.
 */

import { useState, useCallback, useRef } from 'react';
import { 
  NewsItem, 
  BroadcastSegment, 
  VideoAssets, 
  ViralMetadata, 
  ScriptLine,
  ScriptWithScenes,
  Channel,
  UserProfile,
  Production
} from '../types';
import { 
  saveProduction, 
  getProductionById,
  updateProductionStatus,
  getIncompleteProductions
} from '../services/supabaseService';
import { logger } from '../services/logger';
// Shared utilities
import { EMPTY_VIDEO_ASSETS, normalizeVideoAssets, hasVideoAssets } from '../utils/videoAssets';

export interface ProductionProgress {
  current: number;
  total: number;
  step: string;
}

interface UseProductionReturn {
  // State
  currentProductionId: string | null;
  allNews: NewsItem[];
  selectedNews: NewsItem[];
  usedNewsIds: Set<string>;
  segments: BroadcastSegment[];
  videos: VideoAssets;
  viralMeta: ViralMetadata | null;
  previewScript: ScriptLine[];
  currentScriptWithScenes: ScriptWithScenes | null;
  thumbnailDataUrl: string | null;
  thumbnailVariant: string | null;
  progress: ProductionProgress;
  isAborted: boolean;
  
  // Actions
  setAllNews: (news: NewsItem[]) => void;
  setSelectedNews: (news: NewsItem[]) => void;
  setUsedNewsIds: (ids: Set<string>) => void;
  setSegments: (segments: BroadcastSegment[]) => void;
  setVideos: (videos: VideoAssets) => void;
  setViralMeta: (meta: ViralMetadata | null) => void;
  setPreviewScript: (script: ScriptLine[]) => void;
  setCurrentScriptWithScenes: (script: ScriptWithScenes | null) => void;
  setThumbnailDataUrl: (url: string | null) => void;
  setThumbnailVariant: (url: string | null) => void;
  setProgress: (progress: ProductionProgress) => void;
  
  // Production management
  startNewProduction: () => void;
  abortProduction: () => void;
  resetAbort: () => void;
  saveCurrentProduction: (channel: Channel, user: UserProfile, selectedDate: string) => Promise<string | null>;
  loadProduction: (productionId: string) => Promise<Production | null>;
  resetProduction: () => void;
  checkIncompleteProductions: (channelId: string, userEmail: string) => Promise<Production[]>;
}

export function useProduction(): UseProductionReturn {
  // Production ID
  const [currentProductionId, setCurrentProductionId] = useState<string | null>(null);
  
  // News state
  const [allNews, setAllNews] = useState<NewsItem[]>([]);
  const [selectedNews, setSelectedNews] = useState<NewsItem[]>([]);
  const [usedNewsIds, setUsedNewsIds] = useState<Set<string>>(new Set());
  
  // Media state
  const [segments, setSegments] = useState<BroadcastSegment[]>([]);
  const [videos, setVideos] = useState<VideoAssets>(EMPTY_VIDEO_ASSETS);
  const [viralMeta, setViralMeta] = useState<ViralMetadata | null>(null);
  
  // Script state
  const [previewScript, setPreviewScript] = useState<ScriptLine[]>([]);
  const [currentScriptWithScenes, setCurrentScriptWithScenes] = useState<ScriptWithScenes | null>(null);
  
  // Thumbnail state
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);
  const [thumbnailVariant, setThumbnailVariant] = useState<string | null>(null);
  
  // Progress state
  const [progress, setProgress] = useState<ProductionProgress>({ current: 0, total: 0, step: '' });
  
  // Abort flag
  const abortRef = useRef<boolean>(false);

  // Start a new production
  const startNewProduction = useCallback(() => {
    setCurrentProductionId(null);
    setSelectedNews([]);
    setSegments([]);
    setVideos(EMPTY_VIDEO_ASSETS);
    setViralMeta(null);
    setPreviewScript([]);
    setCurrentScriptWithScenes(null);
    setThumbnailDataUrl(null);
    setThumbnailVariant(null);
    setProgress({ current: 0, total: 0, step: '' });
    abortRef.current = false;
    
    logger.info('production', 'New production started');
  }, []);

  // Abort current production
  const abortProduction = useCallback(() => {
    abortRef.current = true;
    logger.warn('production', 'Production aborted');
  }, []);

  // Reset abort flag
  const resetAbort = useCallback(() => {
    abortRef.current = false;
  }, []);

  // Save current production to database
  const saveCurrentProduction = useCallback(async (
    channel: Channel,
    user: UserProfile,
    selectedDate: string
  ): Promise<string | null> => {
    try {
      const newsIds = selectedNews
        .map(n => n.id)
        .filter((id): id is string => Boolean(id));

      const productionData = {
        id: currentProductionId || undefined,
        channel_id: channel.id,
        news_date: selectedDate,
        status: 'in_progress' as const,
        selected_news_ids: newsIds,
        progress_step: progress.current,
        user_id: user.email,
        script: previewScript.length > 0 ? previewScript : undefined,
        viral_metadata: viralMeta || undefined,
        video_assets: hasVideoAssets(videos) ? videos : undefined,
        thumbnail_urls: thumbnailDataUrl 
          ? [thumbnailDataUrl, thumbnailVariant].filter((url): url is string => Boolean(url)) 
          : undefined,
        scenes: currentScriptWithScenes || undefined
      };

      const saved = await saveProduction(productionData, user.email);
      
      if (saved) {
        setCurrentProductionId(saved.id);
        logger.info('production', 'Production saved', { id: saved.id });
        return saved.id;
      }
      
      return null;
    } catch (error) {
      logger.error('production', 'Failed to save production', { error });
      return null;
    }
  }, [
    currentProductionId, 
    selectedNews, 
    progress, 
    previewScript, 
    viralMeta, 
    videos, 
    thumbnailDataUrl, 
    thumbnailVariant,
    currentScriptWithScenes
  ]);

  // Load a production from database
  const loadProduction = useCallback(async (productionId: string): Promise<Production | null> => {
    try {
      const production = await getProductionById(productionId);
      
      if (production) {
        setCurrentProductionId(production.id);
        
        if (production.script) {
          setPreviewScript(production.script);
        }
        if (production.viral_metadata) {
          setViralMeta(production.viral_metadata);
        }
        if (production.video_assets) {
          setVideos(normalizeVideoAssets(production.video_assets));
        }
        if (production.thumbnail_urls?.length) {
          setThumbnailDataUrl(production.thumbnail_urls[0] || null);
          setThumbnailVariant(production.thumbnail_urls[1] || null);
        }
        if (production.scenes) {
          setCurrentScriptWithScenes(production.scenes);
        }
        
        logger.info('production', 'Production loaded', { id: productionId });
      }
      
      return production;
    } catch (error) {
      logger.error('production', 'Failed to load production', { error });
      return null;
    }
  }, []);

  // Reset all production state
  const resetProduction = useCallback(() => {
    setCurrentProductionId(null);
    setAllNews([]);
    setSelectedNews([]);
    setUsedNewsIds(new Set());
    setSegments([]);
    setVideos(EMPTY_VIDEO_ASSETS);
    setViralMeta(null);
    setPreviewScript([]);
    setCurrentScriptWithScenes(null);
    setThumbnailDataUrl(null);
    setThumbnailVariant(null);
    setProgress({ current: 0, total: 0, step: '' });
    abortRef.current = false;
    
    logger.info('production', 'Production reset');
  }, []);

  // Check for incomplete productions
  const checkIncompleteProductions = useCallback(async (
    channelId: string, 
    userEmail: string
  ): Promise<Production[]> => {
    try {
      const incomplete = await getIncompleteProductions(channelId, userEmail);
      logger.debug('production', 'Checked incomplete productions', { count: incomplete.length });
      return incomplete;
    } catch (error) {
      logger.error('production', 'Failed to check incomplete productions', { error });
      return [];
    }
  }, []);

  return {
    // State
    currentProductionId,
    allNews,
    selectedNews,
    usedNewsIds,
    segments,
    videos,
    viralMeta,
    previewScript,
    currentScriptWithScenes,
    thumbnailDataUrl,
    thumbnailVariant,
    progress,
    isAborted: abortRef.current,
    
    // Setters
    setAllNews,
    setSelectedNews,
    setUsedNewsIds,
    setSegments,
    setVideos,
    setViralMeta,
    setPreviewScript,
    setCurrentScriptWithScenes,
    setThumbnailDataUrl,
    setThumbnailVariant,
    setProgress,
    
    // Actions
    startNewProduction,
    abortProduction,
    resetAbort,
    saveCurrentProduction,
    loadProduction,
    resetProduction,
    checkIncompleteProductions
  };
}
