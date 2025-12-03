import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { AppState, ChannelConfig, NewsItem, BroadcastSegment, VideoAssets, ViralMetadata, UserProfile, Channel, ScriptLine, StoredVideo } from './types';
import { signInWithGoogle, getSession, signOut, getAllChannels, saveChannel, saveVideoToDB, getNewsByDate, saveNewsToDB, markNewsAsSelected, deleteVideoFromDB, loadConfigFromDB, supabase, fetchVideosFromDB, saveProduction, getIncompleteProductions, getProductionById, updateProductionStatus, uploadAudioToStorage, getAudioFromStorage, findCachedScript, findCachedAudio, getAllProductions, createProductionVersion, getProductionVersions, exportProduction, importProduction, deleteProduction, verifyStorageBucket, getCompletedProductionsWithVideoInfo, ProductionWithVideoInfo } from './services/supabaseService';
import { fetchEconomicNews, generateScript, generateSegmentedAudio, generateSegmentedAudioWithCache, setFindCachedAudioFunction, generateBroadcastVisuals, generateViralMetadata, generateThumbnail, generateThumbnailVariants, generateViralHook, generateVideoSegments } from './services/geminiService';
import { uploadVideoToYouTube, deleteVideoFromYouTube } from './services/youtubeService';
import { ContentCache } from './services/ContentCache';
import { NewsSelector } from './components/NewsSelector';
import { BroadcastPlayer } from './components/BroadcastPlayer';
import { AdminDashboard } from './components/AdminDashboard';

// Runtime configuration access
const getAdminEmail = () => import.meta.env.VITE_ADMIN_EMAIL || window.env?.ADMIN_EMAIL || process.env.ADMIN_EMAIL || "";

// Default Configuration (ChimpNews)
const DEFAULT_CONFIG: ChannelConfig = {
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
      bio: "Male, Republican-leaning, loves free markets, sarcastic, grumpy, wears a red tie",
      visualPrompt: "Male chimpanzee news anchor wearing a suit and red tie",
      voiceName: "Kore"
    },
    hostB: {
      id: 'hostB',
      name: "Dani",
      bio: "Female, Democrat-leaning, loves social safety nets, witty, optimistic, wears a blue suit",
      visualPrompt: "Female chimpanzee news anchor wearing a blue suit and glasses",
      voiceName: "Fenrir"
    }
  }
};

const App: React.FC = () => {
  // Start at LOGIN state
  const [state, setState] = useState<AppState>(AppState.LOGIN);
  // Track if we're in admin dashboard to restore it when tab becomes visible
  const wasInAdminRef = useRef<boolean>(false);

  // Data State
  const [user, setUser] = useState<UserProfile | null>(null);
  const [config, setConfig] = useState<ChannelConfig>(DEFAULT_CONFIG);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);

  const [allNews, setAllNews] = useState<NewsItem[]>([]);
  const [selectedNews, setSelectedNews] = useState<NewsItem[]>([]);
  const [segments, setSegments] = useState<BroadcastSegment[]>([]);
  const [videos, setVideos] = useState<VideoAssets>({ wide: null, hostA: [], hostB: [] });
  const [viralMeta, setViralMeta] = useState<ViralMetadata | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null);
  const [thumbnailVariant, setThumbnailVariant] = useState<string | null>(null);
  const [previewScript, setPreviewScript] = useState<ScriptLine[]>([]);
  const [storedVideos, setStoredVideos] = useState<StoredVideo[]>([]); // NEW: For home page sidebar
  const [completedProductions, setCompletedProductions] = useState<ProductionWithVideoInfo[]>([]); // For home page sidebar - completed/published productions
  const [productionProgress, setProductionProgress] = useState({ current: 0, total: 0, step: '' });
  const [currentProductionId, setCurrentProductionId] = useState<string | null>(null); // Track current production

  // UI State
  const getYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  };
  const [selectedDate, setSelectedDate] = useState<string>(getYesterday());
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  // Helper function to parse selectedDate consistently (fixes timezone issues)
  const parseSelectedDate = (dateString: string): Date => {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0); // Noon local time to avoid timezone issues
  };

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

  // Load Config from DB on mount & Check Auth
  useEffect(() => {
    const initConfig = async () => {
      const savedConfig = await loadConfigFromDB();
      if (savedConfig) {
        setConfig(savedConfig);
        console.log("Configuration loaded from Supabase");
      }
    };
    initConfig();

    // Load channels
    const loadChannels = async () => {
      const allChannels = await getAllChannels();
      setChannels(allChannels);
      if (allChannels.length > 0) {
        setActiveChannel(allChannels[0]);
        setConfig(allChannels[0].config);
      }
    };
    loadChannels();

    // Verify storage bucket on startup
    const verifyStorage = async () => {
      const bucketExists = await verifyStorageBucket();
      if (!bucketExists) {
        console.warn("⚠️ Storage bucket verification failed. Audio/video uploads may fail.");
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

  // Save Progress to LocalStorage
  useEffect(() => {
    if (state === AppState.READY || state === AppState.SELECTING_NEWS || state === AppState.PREVIEW || state === AppState.GENERATING_MEDIA || state === AppState.ADMIN_DASHBOARD) {
      const progress = {
        state,
        allNews,
        selectedNews,
        segments,
        videos,
        viralMeta,
        selectedDate,
        logs
      };
      localStorage.setItem('chimpNewsProgress', JSON.stringify(progress));
    }
  }, [state, allNews, selectedNews, segments, videos, viralMeta, selectedDate, logs]);

  // Load Progress
  useEffect(() => {
    const saved = localStorage.getItem('chimpNewsProgress');
    // This effect only runs once on mount, so we check state directly
    // We need to wait for user to be logged in before restoring.
  }, []);

  // Restore progress after login and check for abandoned productions
  // Only run once when user first logs in, not on every state change
  useEffect(() => {
    if (user && state === AppState.IDLE && activeChannel) {
      // First check for abandoned productions in DB
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

      // Also restore from localStorage as fallback
      // Only restore if we're truly at IDLE (not in the middle of something)
      const saved = localStorage.getItem('chimpNewsProgress');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Only restore if the saved state indicates work was in progress
          if (parsed.state === AppState.READY || parsed.state === AppState.SELECTING_NEWS || 
              parsed.state === AppState.PREVIEW || parsed.state === AppState.GENERATING_MEDIA) {
            setAllNews(parsed.allNews || []);
            setSelectedNews(parsed.selectedNews || []);
            setSegments(parsed.segments || []);
            setVideos(parsed.videos || { wide: null, hostA: [], hostB: [] });
            setViralMeta(parsed.viralMeta || null);
            setSelectedDate(parsed.selectedDate || getYesterday());
            setLogs(parsed.logs || []);
            setState(parsed.state as AppState);
            addLog("🔄 Restored previous session.");
          }
        } catch (e) {
          console.error("Failed to restore progress", e);
        }
      }
    }
  }, [user, activeChannel]); // Only depend on user and activeChannel, not state

  // Track when we enter/exit admin dashboard
  useEffect(() => {
    if (state === AppState.ADMIN_DASHBOARD) {
      wasInAdminRef.current = true;
    }
    // Note: wasInAdminRef flag is cleared when user explicitly exits admin dashboard
  }, [state]);

  // Persist state when tab becomes hidden (visibility change)
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden && state !== AppState.IDLE && state !== AppState.LOGIN && activeChannel && user) {
        // Save ADMIN_DASHBOARD state to localStorage
        if (state === AppState.ADMIN_DASHBOARD) {
          wasInAdminRef.current = true;
          const progress = {
            state,
            allNews,
            selectedNews,
            segments,
            videos,
            viralMeta,
            selectedDate,
            logs
          };
          localStorage.setItem('chimpNewsProgress', JSON.stringify(progress));
          localStorage.setItem('wasInAdmin', 'true');
          console.log("💾 Saved ADMIN_DASHBOARD state before tab hidden");
          return; // Don't save production state for admin dashboard
        }
        // Save current production state to DB before losing it
        if (currentProductionId || (state !== AppState.SELECTING_NEWS && selectedNews.length > 0)) {
          const dateObj = parseSelectedDate(selectedDate);
          // Use actual news item IDs (UUIDs) if available, otherwise fall back to empty array
          const newsIds = selectedNews
            .map(n => n.id)
            .filter((id): id is string => Boolean(id)) as string[];
          
          const productionData = {
            id: currentProductionId || undefined,
            channel_id: activeChannel.id,
            news_date: dateObj.toISOString().split('T')[0],
            status: 'in_progress' as const,
            selected_news_ids: newsIds.length > 0 ? newsIds : [], // Store UUIDs, empty array if no IDs available
            progress_step: productionProgress.current,
            user_id: user.email,
            script: previewScript.length > 0 ? previewScript : undefined,
            viral_metadata: viralMeta || undefined,
            video_assets: videos.wide ? videos : undefined,
            thumbnail_urls: thumbnailDataUrl ? [thumbnailDataUrl, thumbnailVariant].filter((url): url is string => Boolean(url)) : undefined
          };

          const saved = await saveProduction(productionData, user.email);
          if (saved) {
            setCurrentProductionId(saved.id);
            console.log("💾 Production state saved before tab hidden");
            // Silent save - no toast to avoid interrupting user
          }
        }
      }
      // When tab becomes visible again, restore state from localStorage if needed
      // This prevents the app from switching to home when user returns
      if (!document.hidden && user && activeChannel) {
        const saved = localStorage.getItem('chimpNewsProgress');
        const wasInAdmin = localStorage.getItem('wasInAdmin') === 'true';
        
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            // Always restore ADMIN_DASHBOARD if it was saved, regardless of current state
            if (parsed.state === AppState.ADMIN_DASHBOARD || wasInAdmin) {
              // Force restore ADMIN_DASHBOARD state immediately
              setState(AppState.ADMIN_DASHBOARD);
              wasInAdminRef.current = true;
              console.log("🔄 Restored ADMIN_DASHBOARD state when tab became visible");
              // Don't clear wasInAdmin flag here - only clear when user explicitly exits
            } else if (state === AppState.IDLE && parsed.state && 
                       parsed.state !== AppState.IDLE && 
                       parsed.state !== AppState.LOGIN &&
                       parsed.state !== AppState.ADMIN_DASHBOARD) {
              // Only restore other states if we're currently at IDLE
              setAllNews(parsed.allNews || []);
              setSelectedNews(parsed.selectedNews || []);
              setSegments(parsed.segments || []);
              setVideos(parsed.videos || { wide: null, hostA: [], hostB: [] });
              setViralMeta(parsed.viralMeta || null);
              setSelectedDate(parsed.selectedDate || getYesterday());
              setLogs(parsed.logs || []);
              setState(parsed.state as AppState);
              console.log("🔄 Restored state when tab became visible");
            }
          } catch (e) {
            console.error("Failed to restore state on visibility change", e);
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [state, currentProductionId, activeChannel, user, selectedNews, selectedDate, productionProgress, previewScript, viralMeta, videos, thumbnailDataUrl, thumbnailVariant, allNews, segments, logs]); // Run when user logs in

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
  const initiateNewsSearch = async () => {
    setState(AppState.FETCHING_NEWS);
    setLogs([]);
    setAllNews([]);
    setViralMeta(null);
    setUploadStatus(null);

    try {
      // Fix timezone issue: Parse as local date, not UTC
      const dateObj = parseSelectedDate(selectedDate);
      addLog(`📡 Checking for cached news for ${dateObj.toLocaleDateString()}...`);

      if (!activeChannel) {
        addLog(`❌ No active channel selected. Please select a channel first.`);
        setState(AppState.ERROR);
        toast.error('No active channel selected. Please select a channel first.');
        return;
      }

      // Check if news already exists in database
      let fetchedNews = await getNewsByDate(dateObj, activeChannel.id);
      console.log(`🔍 Database query returned ${fetchedNews.length} news items`);

      if (fetchedNews.length > 0) {
        addLog(`✅ Found ${fetchedNews.length} cached stories.`);
        console.log(`📊 News items from DB:`, fetchedNews.map(n => ({ headline: n.headline, hasImage: !!n.imageUrl })));
      } else {
        addLog(`📡 Scanning financial markets for ${dateObj.toLocaleDateString()} in ${config.country}...`);
        fetchedNews = await fetchEconomicNews(dateObj, config);
        console.log(`🔍 API returned ${fetchedNews.length} news items`);
        addLog(`✅ Found ${fetchedNews.length} potential stories.`);

        // Save news to database
        await saveNewsToDB(dateObj, fetchedNews, activeChannel.id);
        addLog(`💾 News saved to database.`);
        
        // Verify what was saved
        const verifyNews = await getNewsByDate(dateObj, activeChannel.id);
        console.log(`✅ Verification: ${verifyNews.length} news items now in database`);
        if (verifyNews.length !== fetchedNews.length) {
          console.warn(`⚠️ Mismatch: API returned ${fetchedNews.length} but DB has ${verifyNews.length}`);
        }
        fetchedNews = verifyNews; // Use what's actually in DB
      }

      console.log(`📰 Final news count to display: ${fetchedNews.length}`);
      setAllNews(fetchedNews);
      setState(AppState.SELECTING_NEWS);
    } catch (error) {
      console.error(error);
      setState(AppState.ERROR);
      addLog("💥 Scraper failure: " + (error as Error).message);
    }
  };

  // STEP 2: Handle Selection and Start Production
  const handleNewsSelection = async (selection: NewsItem[]) => {
    setSelectedNews(selection);

    if (!activeChannel) return;

    // Mark selected news in database
    const dateObj = parseSelectedDate(selectedDate);
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
    }
  ): Promise<string | null> => {
    if (!activeChannel || !user) return null;

    const dateObj = parseSelectedDate(selectedDate);
    // Use actual news item IDs (UUIDs) if available, otherwise fall back to empty array to avoid UUID type errors
    const newsIds = selectedNews
      .map(n => n.id)
      .filter((id): id is string => Boolean(id)) as string[];

    const productionData = {
      id: productionId || undefined,
      channel_id: activeChannel.id,
      news_date: dateObj.toISOString().split('T')[0],
      status,
      selected_news_ids: newsIds.length > 0 ? newsIds : [], // Store UUIDs, empty array if no IDs available
      progress_step: step,
      user_id: user.email,
      ...updates
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

  const startProduction = async (finalNews: NewsItem[], resumeFromProduction?: any) => {
    if (!activeChannel) {
      setState(AppState.ERROR);
      addLog("❌ No active channel selected. Please select a channel first.");
      toast.error('No active channel selected. Please select a channel first.');
      return;
    }

    // Clear logs when starting a new production
    setLogs([]);
    setVideos({ wide: null, hostA: [], hostB: [] });
    setSegments([]);
    setViralMeta(null);
    setUploadStatus(null);

    // Initialize progress tracking (6 major steps)
    const TOTAL_STEPS = 6;
    setProductionProgress({ current: 0, total: TOTAL_STEPS, step: 'Starting production...' });

    try {
      let productionId: string | null = null;
      let genScript: ScriptLine[] = [];
      let viralHook: string = '';

      // Check if resuming from existing production
      if (resumeFromProduction) {
        productionId = resumeFromProduction.id;
        setCurrentProductionId(productionId);
        
        // Restore state from production
        if (resumeFromProduction.script) {
          genScript = resumeFromProduction.script;
          setPreviewScript(genScript);
        }
        if (resumeFromProduction.viral_hook) {
          viralHook = resumeFromProduction.viral_hook;
        }
        if (resumeFromProduction.viral_metadata) {
          setViralMeta(resumeFromProduction.viral_metadata);
        }
        if (resumeFromProduction.video_assets) {
          setVideos(resumeFromProduction.video_assets);
        }
        if (resumeFromProduction.thumbnail_urls && resumeFromProduction.thumbnail_urls.length > 0) {
          setThumbnailDataUrl(resumeFromProduction.thumbnail_urls[0]);
        }

        addLog("🔄 Resuming production from saved state...");
      }

      // 2. Generate Script (skip if resuming and script exists, or if cached)
      if (!genScript.length) {
        // Check for cached script first
        if (activeChannel) {
          setProductionProgress({ current: 2, total: TOTAL_STEPS, step: 'Checking for cached script...' });
          const cachedScript = await findCachedScript(finalNews, activeChannel.id, config);
          
          if (cachedScript && cachedScript.length > 0) {
            genScript = cachedScript;
            addLog("✅ Using cached script (same news items).");
            setProductionProgress({ current: 2, total: TOTAL_STEPS, step: 'Using cached script...' });
            
            // Still need to generate viral hook for consistency
            setProductionProgress({ current: 1, total: TOTAL_STEPS, step: 'Creating viral hook...' });
            viralHook = await generateViralHook(finalNews, config);
            addLog(`🎣 Viral hook: "${viralHook.substring(0, 40)}..."`);
            
            // Save viral hook and script
            productionId = await saveProductionState(productionId, 1, 'in_progress', { viralHook }) || productionId;
            productionId = await saveProductionState(productionId, 2, 'in_progress', { script: genScript }) || productionId;
          } else {
            // No cached script found, generate new one
            setState(AppState.GENERATING_SCRIPT);
            addLog(`✍️ Editorial approved. Scripting with tone: ${config.tone}...`);

            // Step 1: Generate viral hook first
            setProductionProgress({ current: 1, total: TOTAL_STEPS, step: 'Creating viral hook...' });
            viralHook = await generateViralHook(finalNews, config);
            addLog(`🎣 Viral hook: "${viralHook.substring(0, 40)}..."`);

            // Save viral hook
            productionId = await saveProductionState(productionId, 1, 'in_progress', { viralHook }) || productionId;

            // Step 2: Generate script
            setProductionProgress({ current: 2, total: TOTAL_STEPS, step: 'Writing script...' });
            genScript = await generateScript(finalNews, config, viralHook);
            addLog("✅ Script written.");

            // Save script to DB
            productionId = await saveProductionState(productionId, 2, 'in_progress', { script: genScript }) || productionId;
          }
        }
      } else {
        addLog("✅ Using saved script.");
        setProductionProgress({ current: 2, total: TOTAL_STEPS, step: 'Using saved script...' });
      }

      // PROGRESSIVE ENHANCEMENT: Show preview immediately
      setPreviewScript(genScript);
      setState(AppState.PREVIEW);
      addLog("👀 Script preview ready - review while media generates");

      // Small delay to let user see preview
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 3. Generate Media (Parallel)
      setState(AppState.GENERATING_MEDIA);
      setProductionProgress({ current: 3, total: TOTAL_STEPS, step: 'Generating audio & video...' });
      addLog(`🎬 Rolling cameras (${config.format})...`);
      addLog("🎙️ Sound check...");


      // Check if we need to generate audio (if resuming, check if segments exist)
      let audioSegments: BroadcastSegment[] = [];
      if (resumeFromProduction?.segments && resumeFromProduction.segments.length > 0) {
        // Load audio from Storage
        addLog("🔄 Loading audio from storage...");
        const loadedSegments = await Promise.all(
          resumeFromProduction.segments.map(async (seg: any, idx: number) => {
            if (seg.audioUrl && productionId) {
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
            return null;
          })
        );
        audioSegments = loadedSegments.filter(Boolean) as BroadcastSegment[];
        
        if (audioSegments.length === resumeFromProduction.segments.length) {
          addLog("✅ Audio loaded from storage.");
        } else {
          addLog("⚠️ Some audio missing, regenerating...");
          audioSegments = [];
        }
      }

      if (audioSegments.length === 0) {
        // Generate audio with cache support
        addLog("🎙️ Generating audio segments (checking cache first)...");
        const audioTask = generateSegmentedAudioWithCache(genScript, config, activeChannel?.id || '')
          .then(async (segs: BroadcastSegment[]) => {
            setSegments(segs);
            const cachedCount = segs.filter((s: BroadcastSegment) => (s as any).fromCache).length;
            if (cachedCount > 0) {
              addLog(`✅ Audio produced: ${segs.length} segments (${cachedCount} from cache, ${segs.length - cachedCount} new).`);
            } else {
              addLog(`✅ Audio produced (${segs.length} segments).`);
            }
            
            // Upload audio to Storage and save URLs
            if (productionId && activeChannel) {
              addLog("💾 Uploading audio to storage...");
              const segmentsWithUrls = await Promise.all(
                segs.map(async (seg: BroadcastSegment, idx: number) => {
                  // Only upload if not from cache (already in storage)
                  if ((seg as any).fromCache && (seg as any).audioUrl) {
                    return {
                      speaker: seg.speaker,
                      text: seg.text,
                      audioUrl: (seg as any).audioUrl,
                      videoUrl: seg.videoUrl
                    };
                  }
                  const audioUrl = await uploadAudioToStorage(seg.audioBase64, productionId, idx);
                  return {
                    speaker: seg.speaker,
                    text: seg.text,
                    audioUrl,
                    videoUrl: seg.videoUrl
                  };
                })
              );
              
              // Save segments metadata (without audioBase64) to production
              await saveProductionState(productionId, 3, 'in_progress', {
                segments: segmentsWithUrls as any
              });
            }
            
            return segs;
          });
        
        audioSegments = await audioTask;
      } else {
        setSegments(audioSegments);
      }

      // NEW: Granular Video Generation
      // Check if videos already exist before generating
      let videoSegments: (string | null)[] = [];
      let backgroundVideos: VideoAssets = { wide: null, hostA: [], hostB: [] };
      
      if (resumeFromProduction?.video_assets && resumeFromProduction.video_assets.wide) {
        // Validate existing video assets - check if URLs are still valid
        addLog("🔍 Validating existing video assets...");
        const existingVideos = resumeFromProduction.video_assets as VideoAssets;
        
        // For now, we'll trust the stored assets. In future, could validate URLs
        backgroundVideos = existingVideos;
        setVideos(existingVideos);
        
        // Check if segment videos exist
        if (resumeFromProduction.segments) {
          videoSegments = resumeFromProduction.segments.map((seg: any) => seg.videoUrl || null);
          addLog("✅ Using existing video assets.");
        }
      }
      
      const videoSegmentsTask = videoSegments.length === 0 
        ? generateVideoSegments(genScript, config)
        : Promise.resolve(videoSegments);

      const mainContext = finalNews[0]?.headline || "News";
      const backgroundVideoTask = backgroundVideos.wide
        ? Promise.resolve(backgroundVideos)
        : generateBroadcastVisuals(mainContext, config, genScript, activeChannel.id)
            .then(vids => {
              setVideos(vids);
              addLog("✅ Intro/outro videos ready.");
              return vids;
            });

      const metaTask = generateViralMetadata(finalNews, config, parseSelectedDate(selectedDate))
        .then(async (meta) => {
          setViralMeta(meta);
          addLog("✅ SEO Metadata generated.");
          
          // Save viral metadata
          if (productionId) {
            await saveProductionState(productionId, 3, 'in_progress', { viralMetadata: meta });
          }
          
          return meta;
        });

      const [videoSegmentsResult, backgroundVideosResult, metadata] = await Promise.all([
        videoSegmentsTask,
        backgroundVideoTask,
        metaTask
      ]);
      
      videoSegments = videoSegmentsResult;
      backgroundVideos = backgroundVideosResult;

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
          if (seg.speaker === config.characters.hostA.name) {
            if (!hostAVideos.includes(seg.videoUrl)) {
              hostAVideos.push(seg.videoUrl);
            }
          } else if (seg.speaker === config.characters.hostB.name) {
            if (!hostBVideos.includes(seg.videoUrl)) {
              hostBVideos.push(seg.videoUrl);
            }
          }
        }
      });

      // Update video assets with organized host videos
      const organizedVideos: VideoAssets = {
        wide: backgroundVideos.wide, // Intro/outro video
        hostA: hostAVideos,
        hostB: hostBVideos
      };

      setSegments(finalSegments);
      setVideos(organizedVideos);
      setViralMeta(metadata);
      addLog(`✅ Media ready: ${audioSegments.length} audio clips, ${hostAVideos.length} Host A videos, ${hostBVideos.length} Host B videos.`);

      // Save video assets
      if (productionId) {
        await saveProductionState(productionId, 4, 'in_progress', { videoAssets: backgroundVideos });
      }

      // Step 5: Generate thumbnail variants (after metadata for title context)
      // Check if thumbnails already exist before generating
      let thumbnails = { primary: thumbnailDataUrl, variant: thumbnailVariant };
      
      if (!thumbnails.primary && resumeFromProduction?.thumbnail_urls && resumeFromProduction.thumbnail_urls.length > 0) {
        addLog("✅ Using existing thumbnails.");
        thumbnails.primary = resumeFromProduction.thumbnail_urls[0];
        thumbnails.variant = resumeFromProduction.thumbnail_urls[1] || null;
        setThumbnailDataUrl(thumbnails.primary);
        setThumbnailVariant(thumbnails.variant || null);
      } else if (!thumbnails.primary) {
        setProductionProgress({ current: 5, total: TOTAL_STEPS, step: 'Creating thumbnails...' });
        addLog("🎨 Creating thumbnail variants...");
        thumbnails = await generateThumbnailVariants(mainContext, config, metadata);
        setThumbnailDataUrl(thumbnails.primary);
        setThumbnailVariant(thumbnails.variant || null);
        addLog(`✅ Thumbnails ready (${thumbnails.variant ? '2 variants for A/B testing' : '1 thumbnail'})`);

        // Save thumbnails
        if (productionId) {
          const thumbnailUrls = [thumbnails.primary, thumbnails.variant].filter(Boolean) as string[];
          await saveProductionState(productionId, 5, 'in_progress', { thumbnailUrls });
        }
      } else {
        addLog("✅ Using existing thumbnails from state.");
      }

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
      console.error(error);
      setState(AppState.ERROR);
      addLog("💥 Production failure: " + (error as Error).message);
      
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

      // Restore news selection (we need to fetch news items by IDs)
      const dateObj = parseSelectedDate(fullProduction.news_date);
      setSelectedDate(fullProduction.news_date);
      const allNewsItems = await getNewsByDate(dateObj, activeChannel.id);
      
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
      console.error('Error resuming production:', error);
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
          console.warn('Failed to convert thumbnail to blob:', e);
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
          console.error('Failed to save video to database:', e);
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

    console.log(`[APP] Delete requested for video: ${videoId}, YouTube ID: ${youtubeId}`);
    try {
      // Delete from YouTube if it was uploaded
      if (youtubeId && user?.accessToken) {
        console.log(`[APP] Deleting from YouTube: ${youtubeId}`);
        try {
          await deleteVideoFromYouTube(youtubeId, user.accessToken);
          console.log(`[APP] YouTube deletion successful`);
        } catch (ytError) {
          console.warn(`[APP] YouTube deletion failed:`, ytError);
          // If it's a 404 (Not Found) or 403 (Forbidden - maybe lost access), we should probably still delete from DB
          // For now, we'll assume any error means we can't delete it there, but we SHOULD delete it here to clean up "ghost" records.
          // We'll notify the user but proceed.
          const msg = (ytError as Error).message;
          if (msg.includes('404') || msg.includes('not found')) {
            toast.error('Video not found on YouTube (already deleted?), removing from database...');
          } else {
            toast.error(`YouTube delete error: ${msg}. Proceeding with DB delete.`);
          }
        }
      }

      // Delete from database
      console.log(`[APP] Deleting from database: ${videoId}`);
      await deleteVideoFromDB(videoId);
      console.log(`[APP] Database deletion successful`);

      // Show success message
      toast.success('Video deleted successfully!');

    } catch (e) {
      console.error("[APP] Delete failed:", e);
      const errorMsg = (e as Error).message || "Unknown error";
      toast.error(`Failed to delete video: ${errorMsg}`);
      throw e; // Re-throw to ensure AdminDashboard knows it failed
    }
  };

  const handleChannelSwitch = async (channel: Channel) => {
    if (!channel) return;
    
    // Reset all state when switching channels (including logs to avoid showing logs from deleted productions)
    setActiveChannel(channel);
    setConfig(channel.config);
    setState(AppState.IDLE);
    setAllNews([]);
    setSelectedNews([]);
    setSegments([]);
    setVideos({ wide: null, hostA: [], hostB: [] });
    setViralMeta(null);
    setLogs([]); // Clear logs when switching channels
    setThumbnailDataUrl(null);
    setThumbnailVariant(null);
    setPreviewScript([]);
    setUploadStatus(null);
    setCurrentProductionId(null); // Clear production ID when switching channels
    
    // Clear localStorage to avoid restoring stale state
    localStorage.removeItem('chimpNewsProgress');

    // Fetch videos for new channel
    try {
      const vids = await fetchVideosFromDB(channel.id);
      setStoredVideos(vids.slice(0, 4));
    } catch (error) {
      console.error('Error fetching videos for channel:', error);
      setStoredVideos([]);
    }

    // Fetch completed productions for new channel
    if (user) {
      try {
        const prods = await getCompletedProductionsWithVideoInfo(channel.id, user.email, 10);
        setCompletedProductions(prods.slice(0, 4));
      } catch (error) {
        console.error('Error fetching productions for channel:', error);
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
      setVideos(fullProduction.video_assets);
      setViralMeta(fullProduction.viral_metadata || null);
      setThumbnailDataUrl(fullProduction.thumbnail_urls?.[0] || null);
      setThumbnailVariant(fullProduction.thumbnail_urls?.[1] || null);
      setState(AppState.READY);

      toast.success('Production loaded. Click PUBLISH in the player to upload to YouTube.');
    } catch (error) {
      console.error('Error loading production for publish:', error);
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

  // --------------------------------------------------------------------------------
  // LOGIN SCREEN
  // --------------------------------------------------------------------------------
  if (state === AppState.LOGIN) {
    return (
      <div className="min-h-screen bg-[#0f0f0f] text-white flex flex-col items-center justify-center font-sans relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://image.pollinations.ai/prompt/jungle%20news%20studio%20cyberpunk?nologo=true')] bg-cover opacity-20"></div>
        <div className="z-10 bg-black/80 p-12 rounded-2xl border border-yellow-600/30 backdrop-blur-md shadow-2xl flex flex-col items-center max-w-md w-full text-center">
          <div className="w-24 h-24 bg-gradient-to-br from-yellow-500 to-red-600 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(250,204,21,0.5)] mb-6 animate-pulse">
            <span className="text-5xl">🐵</span>
          </div>
          <h1 className="text-4xl font-headline text-white mb-2">CHIMP<span className="text-yellow-500">NEWS</span></h1>
          <p className="text-gray-400 mb-8 font-mono text-sm tracking-widest uppercase">Restricted Access // Admin Only</p>

          {loginError && (
            <div className="bg-red-900/50 border border-red-500 text-red-200 text-xs p-3 rounded mb-4 w-full">
              {loginError}
            </div>
          )}

          <button
            onClick={handleLogin}
            className="bg-white text-black font-bold py-3 px-8 rounded-full flex items-center gap-3 hover:bg-gray-200 transition-transform hover:scale-105"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.51 19.27 5 15.68 5 11.23S8.51 3.18 12.18 3.18c2.69 0 4.28 1.29 5.3 2.29l2.2-2.2c-1.99-1.89-4.83-2.93-7.5-2.93C4.94.34 0 5.23 0 11.23s4.94 10.89 12.18 10.89c6.05 0 10.18-4.27 10.18-10.18 0-.57-.06-1.13-.13-1.66h-.88z" /></svg>
            Sign in with Google
          </button>
          <p className="mt-4 text-xs text-gray-500">Authorized: {getAdminEmail()}</p>
        </div>
      </div>
    );
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
          localStorage.removeItem('wasInAdmin');
          setState(AppState.IDLE);
        }}
        activeChannel={activeChannel}
        channels={channels}
        onChannelChange={(channel) => {
          setActiveChannel(channel);
          setConfig(channel.config);
        }}
        onDeleteVideo={handleDeleteVideo}
        onResumeProduction={resumeProduction}
        user={user}
      />
    );
  }

  // --------------------------------------------------------------------------------
  // MAIN APP
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
                  date={parseSelectedDate(selectedDate)}
                  onConfirmSelection={handleNewsSelection}
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
                displayDate={parseSelectedDate(selectedDate)}
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
                      <span>{productionProgress.step}</span>
                      <span>{productionProgress.current}/{productionProgress.total}</span>
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

                <div className="text-gray-400 font-mono text-sm max-w-lg mx-auto">
                  {logs[logs.length - 1] || "Initializing..."}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h1 className="text-2xl font-bold line-clamp-2">
              {viralMeta ? viralMeta.title : `${config.channelName} Daily Update`}
            </h1>

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
                {new Number(Math.floor(Math.random() * 50000) + 1000).toLocaleString()} views • {parseSelectedDate(selectedDate).toLocaleDateString()}
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
