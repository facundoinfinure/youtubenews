import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { AppState, ChannelConfig, NewsItem, BroadcastSegment, VideoAssets, ViralMetadata, UserProfile, Channel, ScriptLine, StoredVideo, ScriptWithScenes, NarrativeType } from './types';
import { signInWithGoogle, getSession, signOut, getAllChannels, saveChannel, getChannelById, saveVideoToDB, getNewsByDate, saveNewsToDB, markNewsAsSelected, deleteVideoFromDB, supabase, fetchVideosFromDB, saveProduction, getIncompleteProductions, getProductionById, updateProductionStatus, uploadAudioToStorage, uploadImageToStorage, getAudioFromStorage, findCachedScript, findCachedScriptWithScenes, findCachedAudio, getAllProductions, createProductionVersion, getProductionVersions, exportProduction, importProduction, deleteProduction, verifyStorageBucket, getCompletedProductionsWithVideoInfo, ProductionWithVideoInfo, getUsedNewsIdsForDate, saveCheckpoint, getLastCheckpoint, markStepFailed, saveCachedAudio, updateSegmentStatus, getSegmentsNeedingRegeneration, getDefaultChannelConfig } from './services/supabaseService';
import { fetchEconomicNews, generateScript, generateScriptWithScenes, convertScenesToScriptLines, generateSegmentedAudio, generateSegmentedAudioWithCache, generateAudioFromScenes, ExtendedBroadcastSegment, setFindCachedAudioFunction, generateBroadcastVisuals, generateViralMetadata, generateThumbnail, generateThumbnailVariants, generateViralHook, generateVideoSegmentsWithInfiniteTalk, composeVideoWithShotstack, isCompositionAvailable, getCompositionStatus } from './services/geminiService';
import { uploadVideoToYouTube, deleteVideoFromYouTube } from './services/youtubeService';
import { ContentCache } from './services/ContentCache';
import { CostTracker } from './services/CostTracker';
import { retryVideoGeneration, retryBatch } from './services/retryUtils';
import { analyzeSegmentResources, SegmentResourceStatus } from './services/storageManager';
import { logger } from './services/logger';
import { NewsSelector } from './components/NewsSelector';
import { BroadcastPlayer } from './components/BroadcastPlayer';
import { AdminDashboard } from './components/AdminDashboard';
import { LoginScreen } from './components/LoginScreen';
import { Header } from './components/Header';
import { IdleState } from './components/IdleState';
import { ErrorState } from './components/ErrorState';
import { ProductionStatus } from './components/ProductionStatus';
// Shared utilities
import { EMPTY_VIDEO_ASSETS, normalizeVideoAssets, hasVideoAssets } from './utils/videoAssets';
import { parseLocalDate, getYesterdayString } from './utils/dateUtils';

// Runtime configuration access
const getAdminEmail = () => import.meta.env.VITE_ADMIN_EMAIL || window.env?.ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";

// Fallback Default Configuration (used if system_defaults table doesn't exist)
// The actual default is loaded from Supabase system_defaults table
const FALLBACK_DEFAULT_CONFIG: ChannelConfig = {
  channelName: "ChimpNews",
  tagline: "Investing is Bananas",
  country: "USA",
  language: "English",
  format: '16:9',
  tone: "Sarcastic, Witty, Informative",
  logoColor1: "#FACC15", // Yellow
  logoColor2: "#DC2626", // Red
  captionsEnabled: false,
  characters: {
    hostA: {
      id: 'hostA',
      name: "Rusty",
      bio: "Male chimpanzee podcaster, sarcastic, dry humor, tired-finance-bro energy, skeptical",
      visualPrompt: "Male chimpanzee podcaster wearing a dark hoodie, sarcastic expression, relaxed posture",
      voiceName: "echo",
      outfit: "dark hoodie",
      personality: "sarcastic, dry humor, tired-finance-bro energy, skeptical",
      gender: "male"
    },
    hostB: {
      id: 'hostB',
      name: "Dani",
      bio: "Female chimpanzee podcaster, playful, witty, energetic, optimistic but grounded",
      visualPrompt: "Female chimpanzee podcaster wearing a teal blazer and white shirt, playful, expressive look",
      voiceName: "shimmer",
      outfit: "teal blazer and white shirt",
      personality: "playful, witty, energetic, optimistic but grounded",
      gender: "female"
    }
  },
  seedImages: {
    hostASolo: "Ultra-detailed 3D render of a male chimpanzee podcaster wearing a dark hoodie, at a modern podcast desk. Sarcastic expression, relaxed posture. Warm tungsten key light + purple/blue LED accents. Acoustic foam panels, Shure SM7B microphone. Medium shot, eye-level.",
    hostBSolo: "Ultra-detailed 3D render of a female chimpanzee podcaster wearing a teal blazer and white shirt. Playful, expressive look. Warm tungsten lighting + purple/blue LEDs. Acoustic foam panels. Medium shot, eye-level.",
    twoShot: "Ultra-detailed 3D render of hostA and hostB at a sleek podcast desk. hostA in dark hoodie, hostB in teal blazer. Warm tungsten key light, purple/blue LEDs, Shure SM7B mics. Medium two-shot, eye-level."
  },
  studioSetup: "modern podcast room, warm tungsten key light, purple/blue LED accents, acoustic foam panels, Shure SM7B microphones"
};

// Note: EMPTY_VIDEO_ASSETS, normalizeVideoAssets, hasVideoAssets are now imported from utils/videoAssets

const App: React.FC = () => {
  // Start at LOGIN state
  const [state, setState] = useState<AppState>(AppState.LOGIN);
  // Track if we're in admin dashboard to restore it when tab becomes visible
  const wasInAdminRef = useRef<boolean>(false);
  // Abort controller for cancelling production
  const abortProductionRef = useRef<boolean>(false);

  // Data State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [config, setConfig] = useState<ChannelConfig>(FALLBACK_DEFAULT_CONFIG);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);

  const [allNews, setAllNews] = useState<NewsItem[]>([]);
  const [selectedNews, setSelectedNews] = useState<NewsItem[]>([]);
  const [usedNewsIds, setUsedNewsIds] = useState<Set<string>>(new Set()); // Track news IDs already used in other productions
  const [isRefreshingNews, setIsRefreshingNews] = useState(false);
  const [segments, setSegments] = useState<BroadcastSegment[]>([]);
  const [videos, setVideos] = useState<VideoAssets>(EMPTY_VIDEO_ASSETS);
  const [viralMeta, setViralMeta] = useState<ViralMetadata | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);
  const [thumbnailVariant, setThumbnailVariant] = useState<string | null>(null);
  const [previewScript, setPreviewScript] = useState<ScriptLine[]>([]);
  const [currentScriptWithScenes, setCurrentScriptWithScenes] = useState<ScriptWithScenes | null>(null); // v2.0 Narrative Engine
  const [storedVideos, setStoredVideos] = useState<StoredVideo[]>([]); // NEW: For home page sidebar
  const [completedProductions, setCompletedProductions] = useState<ProductionWithVideoInfo[]>([]); // For home page sidebar - completed/published productions
  const [productionProgress, setProductionProgress] = useState({ current: 0, total: 0, step: '' });
  const [currentProductionId, setCurrentProductionId] = useState<string | null>(null); // Track current production
  
  // Video Composition State (Shotstack)
  const [composedVideoUrl, setComposedVideoUrl] = useState<string | null>(null);
  const [compositionStatus, setCompositionStatus] = useState<'idle' | 'composing' | 'done' | 'error'>('idle');
  const [compositionError, setCompositionError] = useState<string | null>(null);

  // UI State
  // Note: getYesterdayString and parseLocalDate are imported from utils/dateUtils
  const [selectedDate, setSelectedDate] = useState<string>(getYesterdayString());
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  // Connect audio cache function on mount
  useEffect(() => {
    // This enables audio caching across the app
    setFindCachedAudioFunction(findCachedAudio);
    logger.info('cache', 'Audio cache function connected');
  }, []);

  // Fetch stored videos for home page sidebar
  useEffect(() => {
    const fetchStoredVids = async () => {
      if (activeChannel) {
        const vids = await fetchVideosFromDB(activeChannel.id);
        setStoredVideos(vids.slice(0, 4)); // Top 4 for sidebar
      }
    };
    fetchStoredVids();
  }, [activeChannel]);

  // Fetch completed productions for home page sidebar
  useEffect(() => {
    const fetchCompletedProds = async () => {
      if (activeChannel && user) {
        const prods = await getCompletedProductionsWithVideoInfo(activeChannel.id, user.email, 10);
        setCompletedProductions(prods.slice(0, 4)); // Top 4 for sidebar
      }
    };
    fetchCompletedProds();
  }, [activeChannel, user]);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  // Load default channel config from Supabase system_defaults (for new channels)
  useEffect(() => {
    const loadDefaultConfig = async () => {
      const dbDefault = await getDefaultChannelConfig();
      if (dbDefault) {
        logger.info('config', 'Default channel config loaded from Supabase');
        // Note: This is used when creating new channels, not for overriding active channel config
      }
    };
    loadDefaultConfig();
  }, []);

  // Load Channels from DB on mount (channels table is the single source of truth)
  useEffect(() => {
    const loadChannels = async () => {
      const allChannels = await getAllChannels();
      setChannels(allChannels);
      if (allChannels.length > 0) {
        setActiveChannel(allChannels[0]);
        setConfig(allChannels[0].config);
        logger.info('channel', 'Configuration loaded from channels table', { channel: allChannels[0].name });
      }
    };
    loadChannels();

    // Verify storage bucket on startup
    const verifyStorage = async () => {
      const bucketExists = await verifyStorageBucket();
      if (!bucketExists) {
        logger.warn('storage', 'Storage bucket verification failed - uploads may fail');
        addLog("⚠️ Storage bucket 'channel-assets' not found. Please create it in Supabase Dashboard.");
      }
    };
    verifyStorage();

    // Auth Listener
    const { data: authListener } = supabase?.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const email = session.user.email;
        const requiredEmail = getAdminEmail();

        if (email === requiredEmail) {
          setUser({
            email: email!,
            name: session.user.user_metadata.full_name || "Admin",
            picture: session.user.user_metadata.avatar_url || "",
            accessToken: session.provider_token || "" // Supabase passes the provider token here
          });
          setState(AppState.IDLE);
        } else {
          setLoginError(`Access Denied. User ${email} is not authorized.`);
          supabase?.auth.signOut();
        }
      } else {
        setUser(null);
        setState(AppState.LOGIN);
      }
    }) || { data: { subscription: { unsubscribe: () => { } } } };

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  // Set context for CostTracker and ContentCache when channel changes
  useEffect(() => {
    if (activeChannel && user) {
      CostTracker.setContext(activeChannel.id, user.email);
      ContentCache.setContext(activeChannel.id);
      // Preload cache for faster access
      ContentCache.preload().catch(() => {});
    }
  }, [activeChannel, user]);

  // Restore progress after login - check for abandoned productions in Supabase
  // Only run once when user first logs in, not on every state change
  useEffect(() => {
    if (user && state === AppState.IDLE && activeChannel) {
      // Check for abandoned productions in DB (Supabase is the source of truth)
      const checkAbandonedProductions = async () => {
        const incomplete = await getIncompleteProductions(activeChannel.id, user.email);
        if (incomplete.length > 0) {
          // Show notification about abandoned productions
          toast.success(`Found ${incomplete.length} production(s) in progress. Check the dashboard to resume.`, {
            duration: 5000
          });
        }
      };
      checkAbandonedProductions();
    }
  }, [user, activeChannel]); // Only depend on user and activeChannel, not state

  // Track when we enter/exit admin dashboard
  useEffect(() => {
    if (state === AppState.ADMIN_DASHBOARD) {
      wasInAdminRef.current = true;
    }
    // Note: wasInAdminRef flag is cleared when user explicitly exits admin dashboard via onExit callback
  }, [state]);

  // Persist production state to Supabase when tab becomes hidden
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden && activeChannel && user) {
        // Track admin dashboard state in memory ref (no localStorage needed)
        if (state === AppState.ADMIN_DASHBOARD) {
          wasInAdminRef.current = true;
          logger.debug('ui', 'Admin dashboard state tracked in memory');
          return;
        }
        // Save current production state to Supabase before losing it (only if not IDLE or LOGIN)
        if (state !== AppState.IDLE && state !== AppState.LOGIN && 
            (currentProductionId || (state !== AppState.SELECTING_NEWS && selectedNews.length > 0))) {
          const dateObj = parseLocalDate(selectedDate);
          // Use actual news item IDs (UUIDs) if available, otherwise fall back to empty array
          const newsIds = selectedNews
            .map(n => n.id)
            .filter((id): id is string => Boolean(id)) as string[];
          
          const productionData = {
            id: currentProductionId || undefined,
            channel_id: activeChannel.id,
            news_date: dateObj.toISOString().split('T')[0],
            status: 'in_progress' as const,
            selected_news_ids: newsIds.length > 0 ? newsIds : [],
            progress_step: productionProgress.current,
            user_id: user.email,
            script: previewScript.length > 0 ? previewScript : undefined,
            viral_metadata: viralMeta || undefined,
            video_assets: hasVideoAssets(videos) ? videos : undefined,
            thumbnail_urls: thumbnailDataUrl ? [thumbnailDataUrl, thumbnailVariant].filter((url): url is string => Boolean(url)) : undefined
          };

          const saved = await saveProduction(productionData, user.email);
          if (saved) {
            setCurrentProductionId(saved.id);
            logger.info('production', 'Production state saved before tab hidden', { id: saved.id });
          }
        }
      }
      // When tab becomes visible again, restore admin dashboard state from memory ref
      if (!document.hidden && user && activeChannel) {
        if (wasInAdminRef.current && state !== AppState.ADMIN_DASHBOARD) {
          setState(AppState.ADMIN_DASHBOARD);
          logger.debug('ui', 'Restored admin dashboard state on tab visible');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [state, currentProductionId, activeChannel, user, selectedNews, selectedDate, productionProgress, previewScript, viralMeta, videos, thumbnailDataUrl, thumbnailVariant]);

  // LOGIN LOGIC
  const handleLogin = async () => {
    setLoginError(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      setLoginError((error as Error).message);
    }
  };

  const verifyKeyAndStart = async () => {
    // Reset state for new production
    setCurrentProductionId(null); // Reset production ID for new production
    setSelectedNews([]); // Clear previous selection
    setUsedNewsIds(new Set()); // Clear used news IDs
    
    try {
      // Check if running in AI Studio environment
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          addLog("Requesting API Key selection...");
          await window.aistudio.openSelectKey();
        }
      }
      // Note: If using Cloud Run, the API key should be in window.env.API_KEY or process.env.API_KEY

      initiateNewsSearch();
    } catch (e) {
      addLog("Error verifying API Key: " + (e as Error).message);
      // Proceed anyway
      initiateNewsSearch();
    }
  };

  // STEP 1: Fetch News Only
  const initiateNewsSearch = async (forceRefresh: boolean = false) => {
    setState(AppState.FETCHING_NEWS);
    setLogs([]);
    setAllNews([]);
    setViralMeta(null);
    setUploadStatus(null);

    try {
      // Fix timezone issue: Parse as local date, not UTC
      const dateObj = parseLocalDate(selectedDate);
      addLog(`📡 ${forceRefresh ? 'Refreshing' : 'Checking for cached'} news for ${dateObj.toLocaleDateString()}...`);

      if (!activeChannel) {
        addLog(`❌ No active channel selected. Please select a channel first.`);
        setState(AppState.ERROR);
        toast.error('No active channel selected. Please select a channel first.');
        return;
      }

      let fetchedNews: NewsItem[] = [];

      // If forceRefresh, always fetch new news from API
      if (!forceRefresh) {
        // Check if news already exists in database
        fetchedNews = await getNewsByDate(dateObj, activeChannel.id);
        logger.debug('news', `Database query returned ${fetchedNews.length} news items`);
      }

      if (fetchedNews.length > 0 && !forceRefresh) {
        addLog(`✅ Found ${fetchedNews.length} cached stories.`);
        logger.debug('news', 'News items from DB', { count: fetchedNews.length });
      } else {
        addLog(`📡 Scanning financial markets for ${dateObj.toLocaleDateString()} in ${config.country}...`);
        fetchedNews = await fetchEconomicNews(dateObj, config);
        logger.info('news', `API returned ${fetchedNews.length} news items`);
        addLog(`✅ Found ${fetchedNews.length} potential stories.`);

        // Save news to database
        await saveNewsToDB(dateObj, fetchedNews, activeChannel.id);
        addLog(`💾 News saved to database.`);
        
        // Verify what was saved
        const verifyNews = await getNewsByDate(dateObj, activeChannel.id);
        logger.debug('news', `Verification: ${verifyNews.length} items in database`);
        if (verifyNews.length !== fetchedNews.length) {
          logger.warn('news', `Mismatch: API=${fetchedNews.length}, DB=${verifyNews.length}`);
        }
        fetchedNews = verifyNews; // Use what's actually in DB
      }

      // Get news IDs already used in other productions for this date
      const usedIds = await getUsedNewsIdsForDate(dateObj, activeChannel.id, currentProductionId || undefined);
      setUsedNewsIds(new Set(usedIds));
      
      if (usedIds.length > 0) {
        addLog(`⚠️ ${usedIds.length} stories already used in other productions (will be shown as unavailable).`);
      }

      logger.info('news', `Final news count: ${fetchedNews.length}`);
      setAllNews(fetchedNews);
      setState(AppState.SELECTING_NEWS);
    } catch (error) {
      logger.error('news', 'News fetch failed', { error: (error as Error).message });
      setState(AppState.ERROR);
      addLog("💥 Scraper failure: " + (error as Error).message);
    }
  };

  // STEP 2: Handle Selection and Start Production
  const handleNewsSelection = async (selection: NewsItem[]) => {
    setSelectedNews(selection);

    if (!activeChannel) return;

    // Mark selected news in database
    const dateObj = parseLocalDate(selectedDate);
    await markNewsAsSelected(dateObj, selection, activeChannel.id);
    addLog(`📌 Marked ${selection.length} stories as selected.`);

    startProduction(selection);
  };

  // Helper function to save production state to DB
  const saveProductionState = async (
    productionId: string | null,
    step: number,
    status: 'draft' | 'in_progress' | 'completed' | 'failed',
    updates: {
      script?: ScriptLine[];
      viralHook?: string;
      viralMetadata?: ViralMetadata;
      segments?: BroadcastSegment[];
      videoAssets?: VideoAssets;
      thumbnailUrls?: string[];
      scenes?: ScriptWithScenes;
      narrative_used?: NarrativeType;
    }
  ): Promise<string | null> => {
    if (!activeChannel || !user) return null;

    const dateObj = parseLocalDate(selectedDate);
    // Use actual news item IDs (UUIDs) if available, otherwise fall back to empty array to avoid UUID type errors
    const newsIds = selectedNews
      .map(n => n.id)
      .filter((id): id is string => Boolean(id)) as string[];

    const normalizedUpdates = { ...updates };
    if (updates.videoAssets) {
      const normalizedAssets = normalizeVideoAssets(updates.videoAssets);
      if (hasVideoAssets(normalizedAssets)) {
        normalizedUpdates.videoAssets = normalizedAssets;
      } else {
        delete normalizedUpdates.videoAssets;
      }
    }

    const productionData = {
      id: productionId || undefined,
      channel_id: activeChannel.id,
      news_date: dateObj.toISOString().split('T')[0],
      status,
      selected_news_ids: newsIds.length > 0 ? newsIds : [], // Store UUIDs, empty array if no IDs available
      progress_step: step,
      user_id: user.email,
      ...normalizedUpdates
    };

    const saved = await saveProduction(productionData, user.email);
    if (saved) {
      setCurrentProductionId(saved.id);
      // Show toast notification for auto-save
      toast.success('💾 Progress saved', { 
        duration: 2000,
        icon: '💾',
        position: 'bottom-right'
      });
      return saved.id;
    }
    return productionId;
  };

  const persistThumbnailsToStorage = async (
    thumbnails: { primary: string | null; variant: string | null },
    productionId: string | null
  ): Promise<{ primary: string | null; variant: string | null }> => {
    if (!activeChannel || (!thumbnails.primary && !thumbnails.variant)) {
      return thumbnails;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const basePath = `thumbnails/${activeChannel.id}/${productionId || 'draft'}-${timestamp}`;
    const ensureStored = async (url: string | null, suffix: string) => {
      if (!url) return null;
      const alreadyStored = url.includes('supabase.co/storage/v1/object/public/channel-assets');
      if (alreadyStored) return url;
      const stored = await uploadImageToStorage(url, `${basePath}-${suffix}.png`);
      return stored || url;
    };

    const [primaryUrl, variantUrl] = await Promise.all([
      ensureStored(thumbnails.primary, 'A'),
      ensureStored(thumbnails.variant, 'B')
    ]);

    return {
      primary: primaryUrl,
      variant: variantUrl
    };
  };

  const startProduction = async (finalNews: NewsItem[], resumeFromProduction?: any) => {
    // Reset abort flag at start of production
    abortProductionRef.current = false;
    
    // Helper function to check if production was aborted
    const checkAbort = () => {
      if (abortProductionRef.current) {
        throw new Error('PRODUCTION_ABORTED');
      }
    };
    
    if (!activeChannel) {
      setState(AppState.ERROR);
      addLog("❌ No active channel selected. Please select a channel first.");
      toast.error('No active channel selected. Please select a channel first.');
      return;
    }

    // IMPORTANT: Reload config from Supabase before starting production
    // This ensures we use the SOURCE OF TRUTH, not stale local state
    const freshChannel = await getChannelById(activeChannel.id);
    if (!freshChannel) {
      setState(AppState.ERROR);
      addLog("❌ Failed to load channel configuration from database.");
      toast.error('Failed to load channel configuration. Please try again.');
      return;
    }
    
    // Update local state with fresh data from Supabase
    // IMPORTANT: Use currentConfig throughout this function, NOT the closure's `config`
    // because React state updates are async and `config` still has the old value
    const currentConfig = freshChannel.config;
    setConfig(currentConfig);
    setActiveChannel(freshChannel);
    
    logger.info('production', 'Fresh config loaded from Supabase', {
      hostAVoice: currentConfig?.characters?.hostA?.voiceName,
      hostBVoice: currentConfig?.characters?.hostB?.voiceName
    });

    // Clear logs when starting a new production
    setLogs([]);
    setVideos(EMPTY_VIDEO_ASSETS);
    setSegments([]);
    setViralMeta(null);
    setUploadStatus(null);
    setThumbnailDataUrl(null);
    setThumbnailVariant(null);

    // Initialize progress tracking (6 major steps)
    const TOTAL_STEPS = 6;
    setProductionProgress({ current: 0, total: TOTAL_STEPS, step: 'Starting production...' });

    // Calculate estimated cost before starting
    const calculateEstimatedCost = (scriptLength: number): number => {
      let cost = 0;
      // Viral hook: ~$0.005
      cost += 0.005;
      // Script generation: ~$0.01
      cost += 0.01;
      // Audio generation: ~$0.015 per 1000 chars, estimate 150 words = ~750 chars per segment
      cost += (scriptLength * 0.75 * 0.015);
      // Metadata: ~$0.015
      cost += 0.015;
      // Thumbnails: ~$0.14 each (2 variants)
      cost += 0.28;
      // Videos: ~$0.30 per 5s segment (estimate 5s per segment)
      cost += (scriptLength * 0.30);
      return cost;
    };

    try {
      let productionId: string | null = null;
      let genScript: ScriptLine[] = [];
      let viralHook: string = '';
      let scriptWithScenes: ScriptWithScenes | null = null; // v2.0 Narrative Engine

      // Check if resuming from existing production
      if (resumeFromProduction) {
        productionId = resumeFromProduction.id;
        setCurrentProductionId(productionId);
        
        // Restore state from production
        if (resumeFromProduction.script) {
          genScript = resumeFromProduction.script;
          setPreviewScript(genScript);
        }
        if (resumeFromProduction.scenes) {
          scriptWithScenes = resumeFromProduction.scenes;
          setCurrentScriptWithScenes(scriptWithScenes);
        }
        if (resumeFromProduction.viral_hook) {
          viralHook = resumeFromProduction.viral_hook;
        }
        if (resumeFromProduction.viral_metadata) {
          setViralMeta(resumeFromProduction.viral_metadata);
        }
        if (resumeFromProduction.video_assets) {
          setVideos(normalizeVideoAssets(resumeFromProduction.video_assets));
        }
        if (resumeFromProduction.thumbnail_urls && resumeFromProduction.thumbnail_urls.length > 0) {
          setThumbnailDataUrl(resumeFromProduction.thumbnail_urls[0]);
          setThumbnailVariant(resumeFromProduction.thumbnail_urls[1] || null);
        }

        addLog("🔄 Resuming production from saved state...");
      }

      // 2. Generate Script (skip if resuming and script exists, or if cached)
      if (!genScript.length) {
        // Check for cached script first (searches in completed AND in_progress productions)
        if (activeChannel) {
          setProductionProgress({ current: 2, total: TOTAL_STEPS, step: 'Checking for cached script...' });
          const cachedResult = await findCachedScriptWithScenes(finalNews, activeChannel.id, currentConfig);
          
          if (cachedResult && cachedResult.script.length > 0) {
            genScript = cachedResult.script;
            
            // Also use cached scenes if available (v2.0 Narrative Engine)
            if (cachedResult.scenes) {
              scriptWithScenes = cachedResult.scenes;
              setCurrentScriptWithScenes(scriptWithScenes);
              addLog(`✅ Using cached script + scenes from ${cachedResult.fromStatus} production.`);
              addLog(`📝 Narrative: "${scriptWithScenes.narrative_used}" (${Object.keys(scriptWithScenes.scenes).length} scenes)`);
            } else {
              addLog(`✅ Using cached script (${cachedResult.fromStatus} production).`);
            }
            
            setProductionProgress({ current: 2, total: TOTAL_STEPS, step: 'Using cached script...' });
            
            // Still need to generate viral hook for consistency
            setProductionProgress({ current: 1, total: TOTAL_STEPS, step: 'Creating viral hook...' });
            viralHook = await generateViralHook(finalNews, currentConfig);
            addLog(`🎣 Viral hook: "${viralHook.substring(0, 40)}..."`);
            
            // Save viral hook and script (link to existing data)
            productionId = await saveProductionState(productionId, 1, 'in_progress', { viralHook }) || productionId;
            productionId = await saveProductionState(productionId, 2, 'in_progress', { 
              script: genScript,
              scenes: scriptWithScenes || undefined,
              narrative_used: scriptWithScenes?.narrative_used
            }) || productionId;
          } else {
            // No cached script found, generate new one
            setState(AppState.GENERATING_SCRIPT);
            addLog(`✍️ Editorial approved. Scripting with tone: ${currentConfig.tone}...`);

            // Step 1: Generate viral hook first
            setProductionProgress({ current: 1, total: TOTAL_STEPS, step: 'Creating viral hook...' });
            viralHook = await generateViralHook(finalNews, currentConfig);
            addLog(`🎣 Viral hook: "${viralHook.substring(0, 40)}..."`);

            // Save viral hook
            productionId = await saveProductionState(productionId, 1, 'in_progress', { viralHook }) || productionId;

            // Step 2: Generate script with v2.0 Narrative Engine
            setProductionProgress({ current: 2, total: TOTAL_STEPS, step: 'Writing script with Narrative Engine...' });
            scriptWithScenes = await generateScriptWithScenes(finalNews, currentConfig, viralHook);
            setCurrentScriptWithScenes(scriptWithScenes);
            genScript = convertScenesToScriptLines(scriptWithScenes, currentConfig);
            addLog(`✅ Script written using "${scriptWithScenes.narrative_used}" narrative (${Object.keys(scriptWithScenes.scenes).length} scenes).`);

            // Save script and scenes to DB
            productionId = await saveProductionState(productionId, 2, 'in_progress', { 
              script: genScript,
              scenes: scriptWithScenes,
              narrative_used: scriptWithScenes.narrative_used
            }) || productionId;
          }
        }
      } else {
        addLog("✅ Using saved script.");
        setProductionProgress({ current: 2, total: TOTAL_STEPS, step: 'Using saved script...' });
      }

      // Check if aborted
      checkAbort();

      // Save checkpoint after script generation
      if (productionId) {
        await saveCheckpoint(productionId, {
          step: 'script',
          completed: ['viral_hook', 'script'],
          data: { scriptLength: genScript.length }
        });
      }

      // Calculate and save estimated cost
      const estimatedCost = calculateEstimatedCost(genScript.length);
      if (productionId) {
        await saveProduction({
          id: productionId,
          estimated_cost: estimatedCost
        } as any);
      }
      addLog(`💰 Estimated cost: $${estimatedCost.toFixed(3)}`);
      setProductionProgress({ 
        current: 2, 
        total: TOTAL_STEPS, 
        step: `Script ready (Est. cost: $${estimatedCost.toFixed(3)})` 
      });

      // PROGRESSIVE ENHANCEMENT: Show preview immediately
      setPreviewScript(genScript);
      setState(AppState.PREVIEW);
      addLog("👀 Script preview ready - review while media generates");

      // Small delay to let user see preview
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if aborted before starting media generation
      checkAbort();

      // 3. Generate Media (Parallel)
      setState(AppState.GENERATING_MEDIA);
      setProductionProgress({ current: 3, total: TOTAL_STEPS, step: 'Generating audio & video...' });
      addLog(`🎬 Rolling cameras (${currentConfig.format})...`);
      addLog("🎙️ Sound check...");


      // Check if we need to generate audio (if resuming, check if segments exist)
      let audioSegments: BroadcastSegment[] = [];
      let segmentResourceStatus: SegmentResourceStatus[] = [];
      let missingAudioIndices: number[] = [];
      
      if (resumeFromProduction?.segments && resumeFromProduction.segments.length > 0) {
        // INCREMENTAL REGENERATION: Analyze which segments need audio
        addLog("🔍 Analyzing existing resources...");
        segmentResourceStatus = await analyzeSegmentResources(resumeFromProduction.segments);
        
        // Identify segments that need audio regeneration
        missingAudioIndices = segmentResourceStatus
          .filter(s => s.needsAudio)
          .map(s => s.index);
        
        const validAudioCount = segmentResourceStatus.filter(s => !s.needsAudio).length;
        const totalSegments = resumeFromProduction.segments.length;
        
        if (missingAudioIndices.length === 0) {
          // All audio is valid, load from Storage
          addLog("🔄 Loading all audio from storage...");
          const loadedSegments = await Promise.all(
            resumeFromProduction.segments.map(async (seg: any, idx: number) => {
              if (seg.audioUrl) {
                const audioBase64 = await getAudioFromStorage(seg.audioUrl);
                if (audioBase64) {
                  return {
                    speaker: seg.speaker,
                    text: seg.text,
                    audioBase64,
                    audioUrl: seg.audioUrl,
                    videoUrl: seg.videoUrl,
                    hostA_audioUrl: seg.hostA_audioUrl,
                    hostB_audioUrl: seg.hostB_audioUrl,
                    order: seg.order,
                    video_mode: seg.video_mode
                  };
                }
              }
              return null;
            })
          );
          audioSegments = loadedSegments.filter(Boolean) as BroadcastSegment[];
          addLog(`✅ Audio loaded: ${audioSegments.length}/${totalSegments} segments from storage.`);
        } else if (missingAudioIndices.length < totalSegments) {
          // PARTIAL: Some audio exists, only regenerate missing ones
          addLog(`⚠️ ${missingAudioIndices.length}/${totalSegments} audio segments missing - regenerating only missing ones...`);
          
          // Load valid segments first
          const loadedSegments = await Promise.all(
            resumeFromProduction.segments.map(async (seg: any, idx: number) => {
              if (!missingAudioIndices.includes(idx) && seg.audioUrl) {
                const audioBase64 = await getAudioFromStorage(seg.audioUrl);
                if (audioBase64) {
                  return {
                    speaker: seg.speaker,
                    text: seg.text,
                    audioBase64,
                    audioUrl: seg.audioUrl,
                    videoUrl: seg.videoUrl,
                    hostA_audioUrl: seg.hostA_audioUrl,
                    hostB_audioUrl: seg.hostB_audioUrl,
                    order: seg.order,
                    video_mode: seg.video_mode,
                    fromCache: true // Mark as loaded from storage
                  };
                }
              }
              return null; // Will be regenerated
            })
          );
          
          // Regenerate only missing segments
          const missingScriptLines = genScript.filter((_, idx) => missingAudioIndices.includes(idx));
          addLog(`🎙️ Generating ${missingScriptLines.length} missing audio segments...`);
          
          const newAudioSegments = await generateSegmentedAudioWithCache(
            missingScriptLines,
            currentConfig,
            activeChannel?.id || ''
          );
          
          // Merge loaded and new segments in correct order
          let newSegmentIdx = 0;
          audioSegments = resumeFromProduction.segments.map((seg: any, idx: number) => {
            if (missingAudioIndices.includes(idx)) {
              // Use newly generated segment
              const newSeg = newAudioSegments[newSegmentIdx++];
              return {
                ...newSeg,
                videoUrl: seg.videoUrl // Preserve existing videoUrl if any
              };
            } else {
              // Use loaded segment
              return loadedSegments[idx];
            }
          }).filter(Boolean) as BroadcastSegment[];
          
          addLog(`✅ Audio complete: ${validAudioCount} from storage + ${missingAudioIndices.length} regenerated.`);
        } else {
          // All audio missing, will regenerate everything below
          addLog(`⚠️ All ${totalSegments} audio segments missing - generating from scratch...`);
        }
      }

      if (audioSegments.length === 0) {
        // Generate audio with cache support
        // Use v2.0 generateAudioFromScenes if we have scriptWithScenes (handles "both" scenes with separate audios)
        const useV2Audio = scriptWithScenes && Object.keys(scriptWithScenes.scenes).length > 0;
        
        addLog(useV2Audio 
          ? "🎙️ Generating audio with v2.0 Narrative Engine (separate audios for both-hosts scenes)..." 
          : "🎙️ Generating audio segments (checking cache first)...");
        setProductionProgress({ 
          current: 3, 
          total: TOTAL_STEPS, 
          step: `Generating audio: 0/${genScript.length} segments...` 
        });
        
        let completedAudio = 0;
        
        // Use the appropriate audio generation function
        const audioGenerationPromise = useV2Audio
          ? generateAudioFromScenes(scriptWithScenes!, currentConfig, activeChannel?.id || '')
          : generateSegmentedAudioWithCache(genScript, currentConfig, activeChannel?.id || '');
        
        const audioTask = audioGenerationPromise
          .then(async (segs: ExtendedBroadcastSegment[] | BroadcastSegment[]) => {
            setSegments(segs as BroadcastSegment[]);
            const cachedCount = segs.filter((s: any) => s.fromCache).length;
            completedAudio = segs.length;
            setProductionProgress({ 
              current: 3, 
              total: TOTAL_STEPS, 
              step: `Audio complete: ${segs.length} segments (${cachedCount} cached)` 
            });
            
            // Count "both" scenes that have separate audios
            const bothScenesCount = segs.filter((s: any) => s.video_mode === 'both' && s.hostA_audioBase64 && s.hostB_audioBase64).length;
            
            if (bothScenesCount > 0) {
              addLog(`✅ Audio produced: ${segs.length} segments (${bothScenesCount} with dual-host audio, ${cachedCount} cached).`);
            } else if (cachedCount > 0) {
              addLog(`✅ Audio produced: ${segs.length} segments (${cachedCount} from cache, ${segs.length - cachedCount} new).`);
            } else {
              addLog(`✅ Audio produced (${segs.length} segments).`);
            }
            
            // Upload audio to Storage and save URLs
            if (productionId && activeChannel) {
              addLog("💾 Uploading audio to storage...");
              const segmentsWithUrls = await Promise.all(
                segs.map(async (seg: ExtendedBroadcastSegment | BroadcastSegment, idx: number) => {
                  const extSeg = seg as ExtendedBroadcastSegment;
                  
                  // Check if this is a "both" scene with separate audios
                  const isBothScene = extSeg.video_mode === 'both' && extSeg.hostA_audioBase64 && extSeg.hostB_audioBase64;
                  
                  // Only upload if not from cache (already in storage)
                  if ((seg as any).fromCache && (seg as any).audioUrl) {
                    // Save to audio cache if not already cached
                    if (seg.text && currentConfig.characters.hostA.voiceName && currentConfig.characters.hostB.voiceName) {
                      const voiceName = seg.speaker === currentConfig.characters.hostA.name 
                        ? currentConfig.characters.hostA.voiceName 
                        : currentConfig.characters.hostB.voiceName;
                      await saveCachedAudio(
                        activeChannel.id,
                        seg.text,
                        voiceName,
                        (seg as any).audioUrl,
                        seg.audioDuration, // Include duration for video timing
                        productionId
                      );
                    }
                    return {
                      speaker: seg.speaker,
                      text: seg.text,
                      audioUrl: (seg as any).audioUrl,
                      audioDuration: seg.audioDuration, // Pass duration to segment
                      sceneTitle: seg.sceneTitle, // Title for lower-third overlay
                      sceneIndex: seg.sceneIndex, // Scene index for ordering
                      hostA_audioUrl: extSeg.hostA_audioUrl,
                      hostB_audioUrl: extSeg.hostB_audioUrl,
                      order: extSeg.order,
                      video_mode: extSeg.video_mode,
                      videoUrl: seg.videoUrl
                    };
                  }
                  
                  // Upload main audio (or hostA audio for "both" scenes)
                  const voiceName = seg.speaker === currentConfig.characters.hostA.name 
                    ? currentConfig.characters.hostA.voiceName 
                    : currentConfig.characters.hostB.voiceName;
                  const audioUrl = await uploadAudioToStorage(
                    seg.audioBase64, 
                    productionId, 
                    idx,
                    {
                      text: seg.text,
                      voiceName,
                      channelId: activeChannel.id,
                      durationSeconds: seg.audioDuration // Include duration for video timing
                    }
                  );
                  
                  // For "both" scenes, also upload Host A and Host B audios separately
                  let hostA_audioUrl: string | undefined;
                  let hostB_audioUrl: string | undefined;
                  
                  if (isBothScene) {
                    // Estimate duration for each host based on text length (~2.5 words/sec)
                    const hostAWordCount = (extSeg.hostA_text || '').split(/\s+/).length;
                    const hostBWordCount = (extSeg.hostB_text || '').split(/\s+/).length;
                    const hostADuration = Math.max(1, hostAWordCount / 2.5);
                    const hostBDuration = Math.max(1, hostBWordCount / 2.5);
                    
                    // Upload Host A audio
                    if (extSeg.hostA_audioBase64) {
                      hostA_audioUrl = await uploadAudioToStorage(
                        extSeg.hostA_audioBase64,
                        productionId,
                        idx,
                        {
                          text: extSeg.hostA_text || '',
                          voiceName: currentConfig.characters.hostA.voiceName,
                          channelId: activeChannel.id,
                          durationSeconds: hostADuration // Include duration for video timing
                        }
                      ) || undefined;
                      
                      // Save to cache
                      if (hostA_audioUrl && extSeg.hostA_text) {
                        await saveCachedAudio(
                          activeChannel.id,
                          extSeg.hostA_text,
                          currentConfig.characters.hostA.voiceName,
                          hostA_audioUrl,
                          hostADuration, // Include duration for video timing
                          productionId
                        );
                      }
                    }
                    
                    // Upload Host B audio  
                    if (extSeg.hostB_audioBase64) {
                      hostB_audioUrl = await uploadAudioToStorage(
                        extSeg.hostB_audioBase64,
                        productionId,
                        idx * 1000 + 1, // Different index to avoid collision
                        {
                          text: extSeg.hostB_text || '',
                          voiceName: currentConfig.characters.hostB.voiceName,
                          channelId: activeChannel.id,
                          durationSeconds: hostBDuration // Include duration for video timing
                        }
                      ) || undefined;
                      
                      // Save to cache
                      if (hostB_audioUrl && extSeg.hostB_text) {
                        await saveCachedAudio(
                          activeChannel.id,
                          extSeg.hostB_text,
                          currentConfig.characters.hostB.voiceName,
                          hostB_audioUrl,
                          hostBDuration, // Include duration for video timing
                          productionId
                        );
                      }
                    }
                    
                    logger.debug('audio', `Scene ${idx}: Host audios uploaded`, { hostA: !!hostA_audioUrl, hostB: !!hostB_audioUrl });
                  }
                  
                  return {
                    speaker: seg.speaker,
                    text: seg.text,
                    audioUrl,
                    audioDuration: seg.audioDuration, // Include duration for video timing
                    sceneTitle: seg.sceneTitle, // Title for lower-third overlay (from Narrative Engine)
                    sceneIndex: seg.sceneIndex, // Scene index for ordering
                    hostA_audioUrl,
                    hostB_audioUrl,
                    hostA_text: extSeg.hostA_text,
                    hostB_text: extSeg.hostB_text,
                    order: extSeg.order,
                    video_mode: extSeg.video_mode,
                    videoUrl: seg.videoUrl
                  };
                })
              );
              
              // Save checkpoint after audio generation
              if (productionId) {
                await saveCheckpoint(productionId, {
                  step: 'audio',
                  completed: segmentsWithUrls.map((_, idx) => `segment_${idx}`),
                  data: { segmentCount: segmentsWithUrls.length }
                });
                
                // Update segment status for granular tracking
                // Include hostA/hostB audio URLs for "both" scenes
                for (let idx = 0; idx < segmentsWithUrls.length; idx++) {
                  const seg = segmentsWithUrls[idx];
                  await updateSegmentStatus(productionId, idx, {
                    audio: seg?.audioUrl ? 'done' : 'failed',
                    audioUrl: seg?.audioUrl || undefined,
                    // For "both" scenes - save separate audio URLs
                    hostA_audioUrl: seg?.hostA_audioUrl || undefined,
                    hostB_audioUrl: seg?.hostB_audioUrl || undefined
                  });
                }
              }
              
              // Save segments metadata (without audioBase64) to production
              await saveProductionState(productionId, 3, 'in_progress', {
                segments: segmentsWithUrls as any
              });
              
              // Return segments with audioUrl attached for video generation
              // CRITICAL: Include hostA_audioUrl and hostB_audioUrl for "both" scenes!
              return segs.map((seg, idx) => ({
                ...seg,
                audioUrl: segmentsWithUrls[idx]?.audioUrl,
                // For "both" scenes - pass the separate audio URLs to WaveSpeed Multi
                hostA_audioUrl: segmentsWithUrls[idx]?.hostA_audioUrl,
                hostB_audioUrl: segmentsWithUrls[idx]?.hostB_audioUrl,
                hostA_text: segmentsWithUrls[idx]?.hostA_text,
                hostB_text: segmentsWithUrls[idx]?.hostB_text,
                order: segmentsWithUrls[idx]?.order
              }));
            }
            
            return segs;
          });
        
        audioSegments = await audioTask;
      } else {
        setSegments(audioSegments);
      }

      // Generate SEO metadata in parallel while we prepare for video generation
      const mainContext = finalNews[0]?.headline || "News";
      
      const metaTask = generateViralMetadata(finalNews, currentConfig, parseLocalDate(selectedDate))
        .then(async (meta) => {
          setViralMeta(meta);
          addLog("✅ SEO Metadata generated.");
          
          // Save viral metadata
          if (productionId) {
            await saveProductionState(productionId, 3, 'in_progress', { viralMetadata: meta });
          }
          
          return meta;
        });

      // Get intro/outro (just reference image for InfiniteTalk workflow)
      const backgroundVideos = await generateBroadcastVisuals(mainContext, currentConfig, genScript, activeChannel.id, productionId || undefined);
      setVideos(normalizeVideoAssets(backgroundVideos));
      addLog("✅ Reference image ready for video generation.");

      // Wait for metadata
      const metadata = await metaTask;
      
      // Check if aborted before video generation (most expensive step)
      checkAbort();

      // INFINITETALK VIDEO GENERATION
      // Now that audio is uploaded and has URLs, generate lip-sync videos
      let videoSegments: (string | null)[] = [];
      let missingVideoIndices: number[] = [];
      
      // INCREMENTAL VIDEO REGENERATION: Check which videos exist and are valid
      if (resumeFromProduction?.segments && resumeFromProduction.segments.length > 0) {
        // Use previously calculated status if available, otherwise calculate now
        if (segmentResourceStatus.length === 0) {
          segmentResourceStatus = await analyzeSegmentResources(resumeFromProduction.segments);
        }
        
        // Identify segments that need video regeneration
        missingVideoIndices = segmentResourceStatus
          .filter(s => s.needsVideo)
          .map(s => s.index);
        
        const existingVideoUrls = resumeFromProduction.segments.map((seg: any) => seg.videoUrl || null);
        const validVideoCount = segmentResourceStatus.filter(s => !s.needsVideo).length;
        const totalSegments = resumeFromProduction.segments.length;
        
        if (missingVideoIndices.length === 0) {
          // All videos are valid
          videoSegments = existingVideoUrls;
          addLog(`✅ All ${validVideoCount} video assets verified and loaded from storage.`);
        } else if (missingVideoIndices.length < totalSegments && validVideoCount > 0) {
          // PARTIAL: Some videos exist, only regenerate missing ones
          addLog(`⚠️ ${missingVideoIndices.length}/${totalSegments} videos missing - regenerating only missing ones...`);
          
          // Keep existing valid videos
          videoSegments = existingVideoUrls;
          
          // Prepare only missing segments for video generation
          const segmentsToRegenerate = audioSegments
            .filter((_, idx) => missingVideoIndices.includes(idx))
            .map((seg, originalIdx) => ({
              ...seg,
              audioUrl: (seg as any).audioUrl,
              _originalIndex: missingVideoIndices[originalIdx] // Track original position
            }));
          
          addLog(`🎬 Generating ${segmentsToRegenerate.length} missing lip-sync videos...`);
          
          // Generate only missing videos
          const newVideoSegments = await generateVideoSegmentsWithInfiniteTalk(
            segmentsToRegenerate,
            currentConfig,
            activeChannel.id,
            productionId || undefined,
            scriptWithScenes || undefined
          );
          
          // Merge new videos into the correct positions
          missingVideoIndices.forEach((originalIdx, newIdx) => {
            videoSegments[originalIdx] = newVideoSegments[newIdx];
          });
          
          const newlyGeneratedCount = newVideoSegments.filter(v => v !== null).length;
          addLog(`✅ Videos complete: ${validVideoCount} from storage + ${newlyGeneratedCount} regenerated.`);
        } else {
          // All videos missing, will regenerate everything below
          addLog(`⚠️ All ${totalSegments} videos missing - generating from scratch...`);
        }
      }

      // Generate all videos if none exist
      if (videoSegments.length === 0 || !videoSegments.some(v => v !== null)) {
        addLog("🎬 Generating lip-sync videos with WaveSpeed InfiniteTalk Multi...");
        addLog(`🖼️ Using reference image for two-character lip-sync`);
        
        // Prepare segments with audio URLs for InfiniteTalk
        const segmentsForVideo = audioSegments.map((seg, idx) => ({
          ...seg,
          audioUrl: (seg as any).audioUrl // Get the URL from when we uploaded
        }));
        
        // Generate videos using InfiniteTalk Multi (with batch processing and retry)
        let completedVideos = 0;
        const updateVideoProgress = (index: number, total: number) => {
          completedVideos++;
          setProductionProgress({ 
            current: 3, 
            total: TOTAL_STEPS, 
            step: `Generating videos: ${completedVideos}/${total} complete...` 
          });
        };

        videoSegments = await generateVideoSegmentsWithInfiniteTalk(
          segmentsForVideo,
          currentConfig,
          activeChannel.id,
          productionId || undefined,
          scriptWithScenes || undefined // v2.0 Narrative Engine scene metadata
        );
        
        const generatedCount = videoSegments.filter(v => v !== null).length;
        const failedCount = videoSegments.length - generatedCount;
        addLog(`✅ Generated ${generatedCount}/${audioSegments.length} lip-sync videos${failedCount > 0 ? ` (${failedCount} failed - will continue)` : ''}.`);
      }
      
      // Track failed videos if any
      const generatedCount = videoSegments.filter(v => v !== null).length;
      const failedCount = videoSegments.length - generatedCount;
        
      // Mark failed videos in failed_steps
      if (productionId && failedCount > 0) {
        const failedIndices = videoSegments
          .map((url, idx) => url === null ? idx : -1)
          .filter(idx => idx >= 0);
        
        for (const idx of failedIndices) {
          await markStepFailed(productionId, `video_segment_${idx}`, 'Video generation failed after retries');
        }
      }

      // Save checkpoint after video generation
      if (productionId) {
        await saveCheckpoint(productionId, {
          step: 'videos',
          completed: videoSegments
            .map((url, idx) => url !== null ? `segment_${idx}` : null)
            .filter(Boolean) as string[],
          in_progress: [],
          data: { 
            total: videoSegments.length,
            completed: generatedCount,
            failed: failedCount
          }
        });
        
        // Update segment status for granular tracking
        for (let idx = 0; idx < videoSegments.length; idx++) {
          const videoUrl = videoSegments[idx];
          await updateSegmentStatus(productionId, idx, {
            video: videoUrl ? 'done' : 'failed',
            videoUrl: videoUrl || undefined
          });
        }
      }

      // Step 4: Merge segments
      setProductionProgress({ current: 4, total: TOTAL_STEPS, step: 'Merging media segments...' });

      // Merge audio and video segments
      const finalSegments = audioSegments.map((seg, i) => ({
        ...seg,
        videoUrl: videoSegments[i] || undefined // Attach specific video if generated
      }));

      // Organize videos by host for BroadcastPlayer
      // Extract hostA and hostB videos from segments
      const hostAVideos: string[] = [];
      const hostBVideos: string[] = [];
      
      finalSegments.forEach((seg, i) => {
        if (seg.videoUrl) {
          if (seg.speaker === currentConfig.characters.hostA.name) {
            if (!hostAVideos.includes(seg.videoUrl)) {
              hostAVideos.push(seg.videoUrl);
            }
          } else if (seg.speaker === currentConfig.characters.hostB.name) {
            if (!hostBVideos.includes(seg.videoUrl)) {
              hostBVideos.push(seg.videoUrl);
            }
          }
        }
      });

      // Update video assets with organized host videos
      const organizedVideos: VideoAssets = {
        intro: backgroundVideos.intro ?? null,
        outro: backgroundVideos.outro ?? null,
        wide: backgroundVideos.wide,
        hostA: hostAVideos,
        hostB: hostBVideos
      };

      setSegments(finalSegments);
      setVideos(normalizeVideoAssets(organizedVideos));
      setViralMeta(metadata);
      addLog(`✅ Media ready: ${audioSegments.length} audio clips, ${hostAVideos.length} Host A videos, ${hostBVideos.length} Host B videos.`);

      // Save video assets
      if (productionId) {
        await saveProductionState(productionId, 4, 'in_progress', { videoAssets: backgroundVideos });
      }

      // Step 5: Generate thumbnail variants (in parallel with video generation if possible)
      // Check if thumbnails already exist before generating
      let thumbnails = { primary: thumbnailDataUrl, variant: thumbnailVariant };
      
      if (!thumbnails.primary && resumeFromProduction?.thumbnail_urls && resumeFromProduction.thumbnail_urls.length > 0) {
        addLog("✅ Using existing thumbnails.");
        thumbnails.primary = resumeFromProduction.thumbnail_urls[0];
        thumbnails.variant = resumeFromProduction.thumbnail_urls[1] || null;
      } else if (!thumbnails.primary) {
        setProductionProgress({ current: 5, total: TOTAL_STEPS, step: 'Creating thumbnails...' });
        addLog("🎨 Creating thumbnail variants (checking cache first)...");
        // Generate thumbnails with cache support - pass channelId and productionId
        thumbnails = await generateThumbnailVariants(
          mainContext, 
          currentConfig, 
          metadata,
          activeChannel?.id,  // channelId for cache lookup
          productionId || undefined  // productionId for cache association
        );
        addLog(`✅ Thumbnails ready (${thumbnails.variant ? '2 variants for A/B testing' : '1 thumbnail'})`);
        
        // Save checkpoint after thumbnails
        if (productionId) {
          await saveCheckpoint(productionId, {
            step: 'thumbnails',
            completed: ['primary', thumbnails.variant ? 'variant' : ''].filter(Boolean) as string[]
          });
        }
      } else {
        addLog("✅ Using existing thumbnails from state.");
      }

      if (thumbnails.primary || thumbnails.variant) {
        const storedThumbnails = await persistThumbnailsToStorage(thumbnails, productionId);
        thumbnails = storedThumbnails;
        setThumbnailDataUrl(storedThumbnails.primary);
        setThumbnailVariant(storedThumbnails.variant || null);

        if (productionId) {
          const thumbnailUrls = [storedThumbnails.primary, storedThumbnails.variant].filter(Boolean) as string[];
          if (thumbnailUrls.length > 0) {
            await saveProductionState(productionId, 5, 'in_progress', { thumbnailUrls });
          }
        }
      }

      // Calculate actual cost from CostTracker
      const costStats = CostTracker.getStatsSync(1); // Last 1 day
      const actualCost = costStats.totalCost;
      const costBreakdown = costStats.breakdown.reduce((acc: Record<string, number>, item: any) => {
        acc[item.task] = item.cost;
        return acc;
      }, {});

      // Save actual cost to production
      if (productionId) {
        await saveProduction({
          id: productionId,
          actual_cost: actualCost,
          cost_breakdown: costBreakdown
        } as any);
      }

      addLog(`💰 Actual cost: $${actualCost.toFixed(3)}${estimatedCost ? ` (estimated: $${estimatedCost.toFixed(3)})` : ''}`);

      // Step 6: Complete!
      setProductionProgress({ current: 6, total: TOTAL_STEPS, step: 'Broadcast ready!' });
      setState(AppState.READY);
      addLog("🚀 Broadcast Ready!");

      // Mark production as completed
      if (productionId) {
        await updateProductionStatus(productionId, 'completed', new Date());
        
        // Refresh completed productions list
        if (activeChannel && user) {
          const prods = await getCompletedProductionsWithVideoInfo(activeChannel.id, user.email, 10);
          setCompletedProductions(prods.slice(0, 4));
        }
      }

      // Log cache stats
      const cacheStats = ContentCache.getStats();
      if (cacheStats.entries > 0) {
        addLog(`💰 Cache: ${cacheStats.entries} entries, $${cacheStats.totalCostSaved.toFixed(2)} saved`);
      }

    } catch (error) {
      const errorMessage = (error as Error).message;
      
      // Check if this was an intentional abort
      if (errorMessage === 'PRODUCTION_ABORTED') {
        logger.info('production', 'Production aborted by user');
        setState(AppState.IDLE);
        addLog("🛑 Production aborted successfully.");
        
        // Mark production as draft (resumable, not failed)
        if (currentProductionId) {
          await updateProductionStatus(currentProductionId, 'draft');
        }
        return;
      }
      
      logger.error('production', 'Production failure', { error: errorMessage });
      setState(AppState.ERROR);
      addLog("💥 Production failure: " + errorMessage);
      
      // Mark production as failed
      if (currentProductionId) {
        await updateProductionStatus(currentProductionId, 'failed');
      }
    }
  };

  // Function to resume a production
  const resumeProduction = async (production: any) => {
    if (!activeChannel) {
      toast.error('No active channel selected');
      return;
    }

    try {
      // Load full production data
      const fullProduction = await getProductionById(production.id);
      if (!fullProduction) {
        toast.error('Production not found');
        return;
      }

      // Set current production ID so it's excluded from used news calculation
      setCurrentProductionId(fullProduction.id);

      // Restore news selection (we need to fetch news items by IDs)
      const dateObj = parseLocalDate(fullProduction.news_date);
      setSelectedDate(fullProduction.news_date);
      const allNewsItems = await getNewsByDate(dateObj, activeChannel.id);
      
      // Get used news IDs (excluding current production)
      const usedIds = await getUsedNewsIdsForDate(dateObj, activeChannel.id, fullProduction.id);
      setUsedNewsIds(new Set(usedIds));

      // Restore checkpoint data if available
      const checkpoint = await getLastCheckpoint(fullProduction.id);
      if (checkpoint) {
        logger.debug('production', 'Restored checkpoint data', { keys: Object.keys(checkpoint) });
      }
      
      // Match selected news by IDs (UUIDs) if available, otherwise fall back to headlines for backward compatibility
      const selected = allNewsItems.filter(n => {
        if (n.id && fullProduction.selected_news_ids) {
          return fullProduction.selected_news_ids.includes(n.id);
        }
        // Fallback: match by headline for old productions that stored headlines
        return fullProduction.selected_news_ids?.includes(n.headline);
      });
      
      setSelectedNews(selected);
      setAllNews(allNewsItems);

      // Start production with resume data
      await startProduction(selected, fullProduction);
      
      toast.success('Production resumed!');
    } catch (error) {
      logger.error('production', 'Error resuming production', { error: (error as Error).message });
      toast.error('Failed to resume production');
    }
  };

  const handleYouTubeUpload = async (videoBlob: Blob) => {
    if (!user || !viralMeta) {
      toast.error('Missing user or metadata. Cannot upload.');
      return;
    }

    if (!user.accessToken) {
      toast.error('No access token available. Please sign in again.');
      return;
    }

    setUploadStatus("Starting Upload...");

    try {
      // Convert thumbnail data URL to Blob if available
      let thumbnailBlob: Blob | null = null;
      if (thumbnailDataUrl) {
        try {
          const response = await fetch(thumbnailDataUrl);
          thumbnailBlob = await response.blob();
        } catch (e) {
          logger.warn('upload', 'Failed to convert thumbnail to blob', { error: (e as Error).message });
          // Continue without thumbnail
        }
      }

      const videoUrl = await uploadVideoToYouTube(
        videoBlob,
        viralMeta,
        user.accessToken,
        thumbnailBlob,
        (percent) => setUploadStatus(`Uploading: ${Math.round(percent)}%`)
      );
      setUploadStatus("✅ Published! " + videoUrl);
      toast.success('Video uploaded successfully!');

      // Save to database if we have an active channel
      if (activeChannel && viralMeta) {
        try {
          await saveVideoToDB(
            viralMeta,
            activeChannel.id,
            videoUrl.split('/').pop() || null, // Extract video ID from URL
            0, // viral score prediction
            thumbnailDataUrl || undefined
          );
        } catch (e) {
          logger.error('db', 'Failed to save video to database', { error: (e as Error).message });
          // Don't fail the upload if DB save fails
        }
      }

      window.open(videoUrl, '_blank');

      // Refresh completed productions list after publishing
      if (activeChannel && user) {
        const prods = await getCompletedProductionsWithVideoInfo(activeChannel.id, user.email, 10);
        setCompletedProductions(prods.slice(0, 4));
      }
    } catch (e) {
      const errorMsg = (e as Error).message || "Unknown error";
      setUploadStatus("❌ Upload Failed: " + errorMsg);
      toast.error(`Upload failed: ${errorMsg}`);
    }
  };

  const handleDeleteVideo = async (videoId: string, youtubeId: string | null) => {
    if (!videoId) {
      toast.error('Invalid video ID');
      return;
    }

    logger.info('video', 'Delete requested', { videoId, youtubeId });
    try {
      // Delete from YouTube if it was uploaded
      if (youtubeId && user?.accessToken) {
        logger.debug('youtube', 'Deleting from YouTube', { youtubeId });
        try {
          await deleteVideoFromYouTube(youtubeId, user.accessToken);
          logger.info('youtube', 'YouTube deletion successful');
        } catch (ytError) {
          logger.warn('youtube', 'YouTube deletion failed', { error: (ytError as Error).message });
          // If it's a 404 (Not Found) or 403 (Forbidden - maybe lost access), we should probably still delete from DB
          const msg = (ytError as Error).message;
          if (msg.includes('404') || msg.includes('not found')) {
            toast.error('Video not found on YouTube (already deleted?), removing from database...');
          } else {
            toast.error(`YouTube delete error: ${msg}. Proceeding with DB delete.`);
          }
        }
      }

      // Delete from database
      logger.debug('db', 'Deleting from database', { videoId });
      await deleteVideoFromDB(videoId);
      logger.info('db', 'Database deletion successful');

      // Show success message
      toast.success('Video deleted successfully!');

    } catch (e) {
      logger.error('video', 'Delete failed', { error: (e as Error).message });
      const errorMsg = (e as Error).message || "Unknown error";
      toast.error(`Failed to delete video: ${errorMsg}`);
      throw e; // Re-throw to ensure AdminDashboard knows it failed
    }
  };

  const handleChannelSwitch = async (channel: Channel) => {
    if (!channel) return;
    
    logger.info('channel', `Switching to "${channel.name}"`);
    
    // Reset all state when switching channels (including logs to avoid showing logs from deleted productions)
    setActiveChannel(channel);
    setConfig(channel.config);
    setState(AppState.IDLE);
    setAllNews([]);
    setSelectedNews([]);
    setSegments([]);
    setVideos(EMPTY_VIDEO_ASSETS);
    setViralMeta(null);
    setLogs([]); // Clear logs when switching channels
    setThumbnailDataUrl(null);
    setThumbnailVariant(null);
    setPreviewScript([]);
    setCurrentScriptWithScenes(null); // v2.0 Narrative Engine
    setUploadStatus(null);
    setCurrentProductionId(null); // Clear production ID when switching channels

    // Fetch videos for new channel
    try {
      const vids = await fetchVideosFromDB(channel.id);
      setStoredVideos(vids.slice(0, 4));
    } catch (error) {
      logger.error('channel', 'Error fetching videos', { error: (error as Error).message });
      setStoredVideos([]);
    }

    // Fetch completed productions for new channel
    if (user) {
      try {
        const prods = await getCompletedProductionsWithVideoInfo(channel.id, user.email, 10);
        setCompletedProductions(prods.slice(0, 4));
      } catch (error) {
        logger.error('channel', 'Error fetching productions', { error: (error as Error).message });
        setCompletedProductions([]);
      }
    }
  };

  // Helper function to format relative date (e.g., "2 days ago")
  const formatRelativeDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return '1 day ago';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return months === 1 ? '1 month ago' : `${months} months ago`;
    }
    const years = Math.floor(diffDays / 365);
    return years === 1 ? '1 year ago' : `${years} years ago`;
  };

  // Function to publish a completed production
  const handlePublishProduction = async (production: ProductionWithVideoInfo) => {
    if (!user || !activeChannel) {
      toast.error('Missing user or channel information');
      return;
    }

    if (!user.accessToken) {
      toast.error('No access token available. Please sign in again.');
      return;
    }

    try {
      // Load full production data with segments
      const fullProduction = await getProductionById(production.id);
      if (!fullProduction) {
        toast.error('Production not found');
        return;
      }

      if (!fullProduction.segments || fullProduction.segments.length === 0) {
        toast.error('Production has no segments');
        return;
      }

      if (!fullProduction.video_assets) {
        toast.error('Production has no video assets');
        return;
      }

      // Load audio for segments
      const segmentsWithAudio: BroadcastSegment[] = await Promise.all(
        fullProduction.segments.map(async (seg: any) => {
          if (seg.audioUrl) {
            const audioBase64 = await getAudioFromStorage(seg.audioUrl);
            if (audioBase64) {
              return {
                speaker: seg.speaker,
                text: seg.text,
                audioBase64,
                videoUrl: seg.videoUrl
              };
            }
          }
          throw new Error(`Missing audio for segment: ${seg.text.substring(0, 30)}`);
        })
      );

      // Set state to render video
      setSegments(segmentsWithAudio);
      setVideos(normalizeVideoAssets(fullProduction.video_assets));
      setViralMeta(fullProduction.viral_metadata || null);
      setThumbnailDataUrl(fullProduction.thumbnail_urls?.[0] || null);
      setThumbnailVariant(fullProduction.thumbnail_urls?.[1] || null);
      setState(AppState.READY);

      toast.success('Production loaded. Click PUBLISH in the player to upload to YouTube.');
    } catch (error) {
      logger.error('production', 'Error loading production for publish', { error: (error as Error).message });
      toast.error(`Failed to load production: ${(error as Error).message}`);
    }
  };

  const handleConfigUpdate = (newConfig: ChannelConfig) => {
    setConfig(newConfig);
    if (activeChannel) {
      const updatedChannel = { ...activeChannel, config: newConfig };
      setActiveChannel(updatedChannel);
      setChannels(prev => prev.map(c => c.id === updatedChannel.id ? updatedChannel : c));
    }
  };

  // Handle video composition with Shotstack
  const handleComposeVideo = async () => {
    if (!activeChannel || segments.length === 0) {
      toast.error('No segments available to compose');
      return;
    }

    // Check if Shotstack is configured
    if (!isCompositionAvailable()) {
      const status = getCompositionStatus();
      toast.error(status.recommendation);
      addLog(`❌ ${status.shotstack.message}`);
      return;
    }

    setCompositionStatus('composing');
    setCompositionError(null);
    setComposedVideoUrl(null);
    addLog('🎬 Starting video composition with Shotstack...');
    addLog('📺 Adding news broadcast overlays (Breaking News, date, host names)...');

    try {
      // Extract video URLs from segments
      const videoUrls = segments.map(seg => seg.videoUrl || null);
      
      // Get headlines from selected news for ticker
      const headlines = selectedNews.map(news => news.headline).slice(0, 5);
      
      // Get breaking news title from viral metadata
      const breakingTitle = viralMeta?.title || selectedNews[0]?.headline || 'Latest News Update';

      const result = await composeVideoWithShotstack(
        segments,
        videoUrls,
        videos,
        config,
        {
          resolution: '1080',
          transition: 'fade',  // Professional fade transitions
          transitionDuration: 0.5,
          // News broadcast overlays
          enableOverlays: true,
          breakingNewsTitle: breakingTitle,
          headlines: headlines
        }
      );

      if (result.success && result.videoUrl) {
        setComposedVideoUrl(result.videoUrl);
        setCompositionStatus('done');
        addLog(`✅ Video composed successfully! Duration: ${result.duration}s`);
        addLog(`🎥 Final video URL: ${result.videoUrl}`);
        if (result.cost) {
          addLog(`💰 Composition cost: $${result.cost.toFixed(4)}`);
        }
        toast.success('Video composed! Ready for download.');

        // Save composition URL to production if we have one
        if (currentProductionId) {
          await saveProduction({
            id: currentProductionId,
            video_composition_url: result.videoUrl,
            composition_status: 'completed'
          } as any);
        }
      } else {
        setCompositionStatus('error');
        setCompositionError(result.error || 'Unknown error');
        addLog(`❌ Composition failed: ${result.error}`);
        toast.error(`Composition failed: ${result.error}`);
      }
    } catch (error) {
      setCompositionStatus('error');
      setCompositionError((error as Error).message);
      addLog(`❌ Composition error: ${(error as Error).message}`);
      toast.error(`Composition error: ${(error as Error).message}`);
    }
  };

  // --------------------------------------------------------------------------------
  // LOGIN SCREEN
  // --------------------------------------------------------------------------------
  if (state === AppState.LOGIN) {
    return <LoginScreen onLogin={handleLogin} error={loginError} />;
  }

  // --------------------------------------------------------------------------------
  // ADMIN DASHBOARD
  // --------------------------------------------------------------------------------

  if (state === AppState.ADMIN_DASHBOARD) {
    return (
      <AdminDashboard
        config={config}
        onUpdateConfig={handleConfigUpdate}
        onExit={() => {
          wasInAdminRef.current = false;
          setState(AppState.IDLE);
        }}
        activeChannel={activeChannel}
        channels={channels}
        onChannelChange={(channel) => {
          // Update active channel and config from Supabase data
          setActiveChannel(channel);
          setConfig(channel.config);
          // Also update the channel in the channels array
          setChannels(prev => prev.map(c => c.id === channel.id ? channel : c));
          logger.info('channel', 'Config loaded from Supabase', {
            hostAVoice: channel.config?.characters?.hostA?.voiceName,
            hostBVoice: channel.config?.characters?.hostB?.voiceName
          });
        }}
        onDeleteVideo={handleDeleteVideo}
        onResumeProduction={resumeProduction}
        user={user}
      />
    );
  }

  // --------------------------------------------------------------------------------
  // MAIN APP
  // At this point, state cannot be LOGIN or ADMIN_DASHBOARD (handled by early returns above)
  // --------------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col font-sans">
      <header className="bg-[#0f0f0f] px-6 py-3 flex justify-between items-center sticky top-0 z-50 border-b border-[#272727]">
        <div className="flex items-center gap-4">
          <button className="text-white p-2 hover:bg-[#272727] rounded-full">
            <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current"><path d="M21 6H3V5h18v1zm0 5H3v1h18v-1zm0 6H3v1h18v-1z"></path></svg>
          </button>
          <div className="flex items-center gap-1 cursor-pointer">
            <div className="w-8 h-6 bg-red-600 rounded-lg flex items-center justify-center relative">
              <div className="w-0 h-0 border-t-[3px] border-t-transparent border-l-[6px] border-l-white border-b-[3px] border-b-transparent ml-0.5"></div>
            </div>
            <span className="font-headline text-xl ml-1">{config.channelName}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {uploadStatus && (
            <div className="text-xs font-mono bg-blue-900/50 text-blue-200 px-3 py-1 rounded border border-blue-500/30 animate-pulse">
              {uploadStatus}
            </div>
          )}



          {/* Admin Toggle */}
          {user && (
            <button
              onClick={() => {
                // Clear logs when entering admin dashboard to avoid showing logs from deleted productions
                setLogs([]);
                setState(AppState.ADMIN_DASHBOARD);
              }}
              className="btn-secondary"
            >
              ADMIN
            </button>
          )}

          {/* Channel Selector - Moved to right of Admin */}
          {user && channels.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={activeChannel?.id || ''}
                onChange={(e) => {
                  const selected = channels.find(c => c.id === e.target.value);
                  if (selected) {
                    handleChannelSwitch(selected);
                  }
                }}
                className="bg-[#1a1a1a] border border-[#333] rounded px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500"
                disabled={!activeChannel && channels.length === 0}
              >
                {channels.length === 0 ? (
                  <option value="">No channels available</option>
                ) : (
                  channels.map(ch => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))
                )}
              </select>
            </div>
          )}

          {user && (
            <div className="flex items-center gap-2 bg-[#222] rounded-full pr-4 pl-1 py-1 border border-[#333]">
              <img src={user.picture} alt={user.name} className="w-6 h-6 rounded-full" />
              <span className="text-xs font-bold text-gray-300">{user.name}</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-grow flex flex-col md:flex-row p-6 gap-6 max-w-[1800px] mx-auto w-full">
        <div className="flex-grow w-full md:w-[70%] lg:w-[75%] space-y-4">

          {/* CONTAINER AREA */}
          <div className={`w-full bg-black rounded-xl overflow-hidden shadow-lg relative flex flex-col transition-all duration-500 ${config.format === '9:16' ? 'max-w-[400px] mx-auto aspect-[9/16]' : 'aspect-video'}`}>

            {state === AppState.IDLE || state === AppState.FETCHING_NEWS ? (
              // 1. INPUT PHASE
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] text-center p-8 space-y-6">
                <div
                  className="w-24 h-24 rounded-full flex items-center justify-center shadow-2xl mb-4"
                  style={{ background: `linear-gradient(135deg, ${config.logoColor1}, ${config.logoColor2})` }}
                >
                  {state === AppState.FETCHING_NEWS ? (
                    <span className="text-4xl animate-spin">🌍</span>
                  ) : (
                    <span className="text-4xl">🎥</span>
                  )}
                </div>
                <h2 className="text-2xl font-bold">
                  {state === AppState.FETCHING_NEWS ? "Scanning Markets..." : `${config.channelName} Studio`}
                </h2>
                {state === AppState.IDLE && (
                  <>
                    <p className="text-gray-400 max-w-md">
                      {config.tagline}. Select a date to scrape news for {config.country}.
                    </p>

                    <div className="flex flex-col items-center gap-2 w-full max-w-xs">
                      <label className="text-xs text-gray-500 uppercase tracking-wider font-bold">News Date</label>
                      <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                        className="bg-[#1f1f1f] border border-[#3f3f3f] text-white px-4 py-2 rounded-lg w-full focus:outline-none focus:border-blue-500" />
                    </div>
                    <button onClick={verifyKeyAndStart} className="btn-primary mt-4">
                      ▶ Start Production
                    </button>
                  </>
                )}
              </div>

            ) : state === AppState.SELECTING_NEWS ? (
              // 2. SELECTION PHASE
              <div className="p-4 bg-[#0a0a0a] h-full overflow-y-auto">
                <NewsSelector
                  news={allNews}
                  date={parseLocalDate(selectedDate)}
                  onConfirmSelection={handleNewsSelection}
                  usedNewsIds={usedNewsIds}
                  isRefreshing={isRefreshingNews}
                  onRefresh={async () => {
                    setIsRefreshingNews(true);
                    try {
                      await initiateNewsSearch(true); // Force refresh
                    } finally {
                      setIsRefreshingNews(false);
                    }
                  }}
                />
              </div>

            ) : state === AppState.ERROR ? (
              // ERROR STATE
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] text-center p-8 space-y-6">
                <div className="w-24 h-24 rounded-full flex items-center justify-center bg-red-900/50 mb-4">
                  <span className="text-4xl">⚠️</span>
                </div>
                <h2 className="text-2xl font-bold text-red-400">Production Error</h2>
                <p className="text-gray-400 max-w-md">
                  {logs.length > 0 ? logs[logs.length - 1] : "An error occurred during production."}
                </p>
                <div className="flex gap-4">
                  <button
                    onClick={() => {
                      setState(AppState.IDLE);
                      setLogs([]);
                    }}
                    className="btn-secondary"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={() => {
                      setState(AppState.IDLE);
                      setLogs([]);
                      initiateNewsSearch();
                    }}
                    className="btn-primary"
                  >
                    Retry
                  </button>
                </div>
              </div>

            ) : state === AppState.READY ? (
              // 3. PLAYBACK PHASE
              <BroadcastPlayer
                segments={segments}
                videos={videos}
                news={allNews}
                displayDate={parseLocalDate(selectedDate)}
                onUploadToYouTube={handleYouTubeUpload}
                config={config}
              />
            ) : (
              // 4. LOADING/GENERATING PHASE
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] text-center p-8">
                <div className="w-20 h-20 border-4 border-t-transparent rounded-full animate-spin mb-6" style={{ borderColor: config.logoColor1, borderTopColor: 'transparent' }}></div>
                <h3 className="text-xl font-bold mb-2">PRODUCING BROADCAST</h3>

                {/* Progress Bar */}
                {productionProgress.total > 0 && (
                  <div className="w-full max-w-md mb-4">
                    <div className="flex justify-between text-xs mb-2 text-gray-400">
                      <span className="truncate">{productionProgress.step}</span>
                      <span className="ml-2">{productionProgress.current}/{productionProgress.total}</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r transition-all duration-500"
                        style={{
                          width: `${(productionProgress.current / productionProgress.total) * 100}%`,
                          backgroundImage: `linear-gradient(90deg, ${config.logoColor1}, ${config.logoColor2})`
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="text-gray-400 font-mono text-sm max-w-lg mx-auto mb-4">
                  {logs[logs.length - 1] || "Initializing..."}
                </div>

                {/* Pause/Abort Button */}
                {(state === AppState.GENERATING_MEDIA || state === AppState.GENERATING_SCRIPT) && currentProductionId && (
                  <button
                    onClick={async () => {
                      if (currentProductionId) {
                        // Set abort flag to stop ongoing operations
                        abortProductionRef.current = true;
                        addLog("🛑 Aborting production... (waiting for current operations to complete)");
                        
                        // Save final checkpoint before pausing
                        await saveCheckpoint(currentProductionId, {
                          step: 'paused',
                          completed: [],
                          data: { pausedAt: new Date().toISOString(), aborted: true }
                        });
                        
                        addLog("⏸️ Production aborted. You can resume from the dashboard.");
                        setState(AppState.IDLE);
                        toast.success('Production aborted. Resume from dashboard when ready.');
                      }
                    }}
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-sm transition-colors"
                  >
                    🛑 Abort
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h1 className="text-2xl font-bold line-clamp-2">
              {viralMeta ? viralMeta.title : `${config.channelName} Daily Update`}
            </h1>

            {viralMeta?.titleVariants && viralMeta.titleVariants.length > 1 && (
              <div className="bg-[#191919] border border-[#2f2f2f] rounded-xl p-4 space-y-3">
                <div className="text-xs tracking-[0.3em] uppercase text-gray-400">Title Experiments</div>
                {viralMeta.titleVariants.slice(0, 2).map((titleOption, idx) => (
                  <div key={idx}>
                    <div className="text-sm font-semibold text-yellow-400 mb-1">
                      {`Title ${idx === 0 ? 'A' : 'B'}`}
                    </div>
                    <p className="text-sm text-gray-200">{titleOption}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between flex-wrap gap-4 border-b border-[#272727] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-black border border-white/20" style={{ backgroundColor: config.logoColor1 }}>
                  {config.channelName[0]}
                </div>
                <div>
                  <div className="font-bold text-sm">{config.channelName}</div>
                  <div className="text-xs text-gray-400">1.2M subscribers</div>
                </div>
                <button className="ml-4 bg-white text-black rounded-full px-4 py-1.5 text-sm font-medium hover:bg-gray-200">Subscribe</button>
              </div>
            </div>

            <div className="bg-[#272727] rounded-xl p-4 text-sm hover:bg-[#3f3f3f] transition cursor-pointer">
              <div className="font-bold mb-2">
                {new Number(Math.floor(Math.random() * 50000) + 1000).toLocaleString()} views • {parseLocalDate(selectedDate).toLocaleDateString()}
              </div>
              {viralMeta ? (
                <>
                  <p className="whitespace-pre-wrap font-sans text-gray-300 mb-4">{viralMeta.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {viralMeta.tags.map((tag, i) => (
                      <span key={i} className="text-blue-400 hover:underline">#{tag.replace(/\s+/g, '')}</span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-gray-400 italic">Generating video metadata...</p>
              )}
            </div>

            {(thumbnailDataUrl || thumbnailVariant) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {thumbnailDataUrl && (
                  <div className="bg-[#1b1b1b] border border-[#2a2a2a] rounded-xl p-3 space-y-2">
                    <div className="text-xs uppercase tracking-[0.3em] text-gray-400">Thumbnail A</div>
                    <img src={thumbnailDataUrl} alt="Thumbnail A" className="w-full h-48 object-cover rounded-lg" />
                  </div>
                )}
                {thumbnailVariant && (
                  <div className="bg-[#1b1b1b] border border-[#2a2a2a] rounded-xl p-3 space-y-2">
                    <div className="text-xs uppercase tracking-[0.3em] text-gray-400">Thumbnail B</div>
                    <img src={thumbnailVariant} alt="Thumbnail B" className="w-full h-48 object-cover rounded-lg" />
                  </div>
                )}
              </div>
            )}

            {/* Video Composition Section */}
            {state === AppState.READY && segments.length > 0 && (
              <div className="bg-[#191919] border border-[#2f2f2f] rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold">🎬 Final Video Composition</h3>
                    <p className="text-sm text-gray-400">
                      {isCompositionAvailable() 
                        ? 'Combine all segments into one video with transitions'
                        : 'Configure Shotstack API to enable composition'}
                    </p>
                  </div>
                  {compositionStatus === 'idle' && (
                    <button
                      onClick={handleComposeVideo}
                      disabled={!isCompositionAvailable()}
                      className={`px-4 py-2 rounded-lg font-bold transition ${
                        isCompositionAvailable()
                          ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white'
                          : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      🎥 Compose Video
                    </button>
                  )}
                  {compositionStatus === 'composing' && (
                    <div className="flex items-center gap-2 text-blue-400">
                      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                      <span className="text-sm font-medium">Composing...</span>
                    </div>
                  )}
                </div>

                {compositionStatus === 'done' && composedVideoUrl && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-green-400">
                      <span>✅</span>
                      <span className="font-medium">Video composed successfully!</span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <a
                        href={composedVideoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold transition"
                      >
                        <span>🔗</span> Open Video
                      </a>
                      <a
                        href={composedVideoUrl}
                        download={`${config.channelName}_${selectedDate}.mp4`}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold transition"
                      >
                        <span>⬇️</span> Download
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(composedVideoUrl);
                          toast.success('URL copied to clipboard!');
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-bold transition"
                      >
                        <span>📋</span> Copy URL
                      </button>
                      <button
                        onClick={() => {
                          setCompositionStatus('idle');
                          setComposedVideoUrl(null);
                          toast('Ready to re-compose with updated settings', { icon: '🔄' });
                        }}
                        className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-bold transition"
                      >
                        <span>🔄</span> Re-compose
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">
                      💡 Use "Re-compose" to apply new overlays or settings without regenerating videos
                    </p>
                  </div>
                )}

                {compositionStatus === 'error' && compositionError && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-red-400">
                      <span>❌</span>
                      <span className="font-medium">Composition failed</span>
                    </div>
                    <p className="text-sm text-red-300 bg-red-900/30 rounded p-2">{compositionError}</p>
                    <button
                      onClick={() => {
                        setCompositionStatus('idle');
                        setCompositionError(null);
                      }}
                      className="text-sm text-blue-400 hover:text-blue-300 underline"
                    >
                      Try again
                    </button>
                  </div>
                )}

                {!isCompositionAvailable() && (
                  <div className="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-3 text-sm">
                    <p className="text-yellow-400 font-medium mb-1">⚠️ Shotstack not configured</p>
                    <p className="text-yellow-200/70">
                      Add <code className="bg-black/30 px-1 rounded">VITE_SHOTSTACK_API_KEY</code> to your environment variables.
                      <a href="https://shotstack.io" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline ml-1">
                        Get API key →
                      </a>
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* LOGS DISPLAY */}
          {logs.length > 0 && state !== AppState.SELECTING_NEWS && state !== AppState.READY && (
            <div className="mt-6">
              <h3 className="text-lg font-bold mb-4">Production Logs <span className="text-gray-400 text-sm font-normal">({logs.length})</span></h3>
              <div className="space-y-4">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-10 h-10 rounded-full bg-gray-700 flex-shrink-0 flex items-center justify-center text-xs">SYS</div>
                    <div className="text-sm">
                      <div className="font-bold text-xs text-gray-400 mb-0.5">System • {new Date().toLocaleTimeString()}</div>
                      <div className={`${log.includes('❌') ? 'text-red-400' : log.includes('✅') ? 'text-green-400' : 'text-gray-300'}`}>
                        {log}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="hidden md:block w-[30%] lg:w-[25%] space-y-3">
          <h3 className="text-lg font-bold mb-2">Why {config.channelName} is trending</h3>
          {completedProductions.length > 0 ? completedProductions.map((production) => {
            const title = production.viral_metadata?.title || 'Untitled Production';
            const tags = production.viral_metadata?.tags || [];
            const thumbnail = production.thumbnailUrl || production.thumbnail_urls?.[0];
            const isPublished = production.isPublished;
            const views = production.videoAnalytics?.views || 0;
            const publishedDate = production.publishedAt || production.completed_at || production.updated_at;

            return (
              <div key={production.id} className="flex gap-2 group">
                <div className="w-40 h-24 bg-gray-800 rounded-lg overflow-hidden relative flex-shrink-0">
                  {thumbnail ? (
                    <img src={thumbnail} alt={title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-gray-700 group-hover:bg-gray-600 transition"></div>
                  )}
                  {isPublished && production.videoAnalytics && (
                    <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                      {views.toLocaleString()} views
                    </div>
                  )}
                  {!isPublished && (
                    <div className="absolute top-1 right-1 bg-yellow-600/90 text-black text-xs px-1.5 py-0.5 rounded font-bold">
                      Ready
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <h4 className="text-sm font-bold line-clamp-2 leading-tight group-hover:text-blue-400">
                    {title}
                  </h4>
                  <div className="text-xs text-gray-400">{config.channelName}</div>
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {tags.slice(0, 2).map((tag, idx) => (
                        <span key={idx} className="text-xs text-blue-400">#{tag.replace(/\s+/g, '')}</span>
                      ))}
                    </div>
                  )}
                  {isPublished && publishedDate ? (
                    <div className="text-xs text-gray-400">
                      {views > 0 ? `${views.toLocaleString()} views • ` : ''}
                      {formatRelativeDate(publishedDate)}
                    </div>
                  ) : (
                    <button
                      onClick={() => handlePublishProduction(production)}
                      className="text-xs bg-yellow-500 hover:bg-yellow-600 text-black px-2 py-1 rounded font-bold mt-1 transition"
                    >
                      Publish
                    </button>
                  )}
                </div>
              </div>
            );
          }) : (
            // Fallback placeholders if no productions
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-2 cursor-pointer group">
                <div className="w-40 h-24 bg-gray-800 rounded-lg overflow-hidden relative flex-shrink-0">
                  <div className="absolute inset-0 bg-gray-700 group-hover:bg-gray-600 transition"></div>
                  <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">10:0{i}</div>
                </div>
                <div className="flex flex-col gap-1">
                  <h4 className="text-sm font-bold line-clamp-2 leading-tight group-hover:text-blue-400">
                    Why {config.channelName} is trending
                  </h4>
                  <div className="text-xs text-gray-400">{config.channelName}</div>
                  <div className="text-xs text-gray-400">54K views • 2 days ago</div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
