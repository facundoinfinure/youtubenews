import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { AppState, ChannelConfig, NewsItem, BroadcastSegment, VideoAssets, ViralMetadata, UserProfile, Channel, ScriptLine, StoredVideo } from './types';
import { signInWithGoogle, getSession, signOut, getAllChannels, saveChannel, saveVideoToDB, getNewsByDate, saveNewsToDB, markNewsAsSelected, deleteVideoFromDB, loadConfigFromDB, supabase, fetchVideosFromDB } from './services/supabaseService';
import { fetchEconomicNews, generateScript, generateSegmentedAudio, generateBroadcastVisuals, generateViralMetadata, generateThumbnail, generateThumbnailVariants, generateViralHook, generateVideoSegments } from './services/geminiService';
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

  // UI State
  const getYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  };
  const [selectedDate, setSelectedDate] = useState<string>(getYesterday());
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

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
    if (state === AppState.READY || state === AppState.SELECTING_NEWS || state === AppState.PREVIEW || state === AppState.GENERATING_MEDIA) {
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
    if (saved && state === AppState.LOGIN) { // Only load if we are at start (but after login check? No, state is LOGIN initially)
      // We need to wait for user to be logged in.
    }
  }, []);

  // Restore progress after login
  useEffect(() => {
    if (user && state === AppState.IDLE) {
      const saved = localStorage.getItem('chimpNewsProgress');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Only restore if date matches or user wants to? 
          // For now, just restore if it's recent?
          // Let's just restore.
          if (parsed.state === AppState.READY || parsed.state === AppState.SELECTING_NEWS) {
            setAllNews(parsed.allNews || []);
            setSelectedNews(parsed.selectedNews || []);
            setSegments(parsed.segments || []);
            setVideos(parsed.videos || { wide: null, hostA: [], hostB: [] });
            setViralMeta(parsed.viralMeta || null);
            setSelectedDate(parsed.selectedDate || getYesterday());
            setLogs(parsed.logs || []);
            setState(parsed.state);
            addLog("🔄 Restored previous session.");
          }
        } catch (e) {
          console.error("Failed to restore progress", e);
        }
      }
    }
  }, [user]); // Run when user logs in

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
      const dateObj = new Date(selectedDate);
      addLog(`📡 Checking for cached news for ${dateObj.toLocaleDateString()}...`);

      if (!activeChannel) {
        addLog(`❌ No active channel selected.`);
        setState(AppState.ERROR);
        return;
      }

      // Check if news already exists in database
      let fetchedNews = await getNewsByDate(dateObj, activeChannel.id);

      if (fetchedNews.length > 0) {
        addLog(`✅ Found ${fetchedNews.length} cached stories.`);
      } else {
        addLog(`📡 Scanning financial markets for ${dateObj.toLocaleDateString()} in ${config.country}...`);
        fetchedNews = await fetchEconomicNews(dateObj, config);
        addLog(`✅ Found ${fetchedNews.length} potential stories.`);

        // Save news to database
        await saveNewsToDB(dateObj, fetchedNews, activeChannel.id);
        addLog(`💾 News saved to database.`);
      }

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
    const dateObj = new Date(selectedDate);
    await markNewsAsSelected(dateObj, selection, activeChannel.id);
    addLog(`📌 Marked ${selection.length} stories as selected.`);

    startProduction(selection);
  };

  const startProduction = async (finalNews: NewsItem[]) => {
    setVideos({ wide: null, hostA: [], hostB: [] });
    setSegments([]);
    setViralMeta(null);
    setUploadStatus(null);

    try {
      // 2. Generate Script
      setState(AppState.GENERATING_SCRIPT);
      addLog(`✍️ Editorial approved. Scripting with tone: ${config.tone}...`);

      // Generate viral hook first
      const viralHook = await generateViralHook(finalNews, config);
      addLog(`🎣 Viral hook: "${viralHook.substring(0, 40)}..."`);

      const genScript = await generateScript(finalNews, config, viralHook);
      addLog("✅ Script written.");

      // PROGRESSIVE ENHANCEMENT: Show preview immediately
      setPreviewScript(genScript);
      setState(AppState.PREVIEW);
      addLog("👀 Script preview ready - review while media generates");

      // Small delay to let user see preview
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 3. Generate Media (Parallel)
      setState(AppState.GENERATING_MEDIA);
      addLog(`🎬 Rolling cameras (${config.format})...`);
      addLog("🎙️ Sound check...");


      const audioTask = generateSegmentedAudio(genScript, config)
        .then(segs => {
          setSegments(segs);
          addLog(`✅ Audio produced (${segs.length} segments).`);
          return segs;
        });

      // NEW: Granular Video Generation
      const videoSegmentsTask = generateVideoSegments(genScript, config);

      const mainContext = finalNews[0]?.headline || "News";
      const backgroundVideoTask = generateBroadcastVisuals(mainContext, config, genScript)
        .then(vids => {
          setVideos(vids);
          addLog("✅ Video feeds established.");
          return vids;
        });

      const metaTask = generateViralMetadata(finalNews, config, new Date(selectedDate))
        .then(async (meta) => {
          setViralMeta(meta);
          addLog("✅ SEO Metadata generated.");
          return meta;
        });

      const [audioSegments, videoSegments, backgroundVideos, metadata] = await Promise.all([
        audioTask,
        videoSegmentsTask,
        backgroundVideoTask,
        metaTask
      ]);

      // Merge audio and video segments
      const finalSegments = audioSegments.map((seg, i) => ({
        ...seg,
        videoUrl: videoSegments[i] || undefined // Attach specific video if generated
      }));

      setSegments(finalSegments);
      setVideos(backgroundVideos);
      setViralMeta(metadata);
      addLog(`✅ Media ready: ${audioSegments.length} audio clips, ${videoSegments.filter(v => v).length} unique video clips.`);

      // 4. Generate thumbnail variants (after metadata for title context)
      addLog("🎨 Creating thumbnail variants...");
      const thumbnails = await generateThumbnailVariants(mainContext, config, metadata);
      setThumbnailDataUrl(thumbnails.primary);
      setThumbnailVariant(thumbnails.variant);
      addLog(`✅ Thumbnails ready (${thumbnails.variant ? '2 variants for A/B testing' : '1 thumbnail'})`);

      setState(AppState.READY);
      addLog("🚀 Broadcast Ready!");

      // Log cache stats
      const cacheStats = ContentCache.getStats();
      if (cacheStats.entries > 0) {
        addLog(`💰 Cache: ${cacheStats.entries} entries, $${cacheStats.totalCostSaved.toFixed(2)} saved`);
      }

    } catch (error) {
      console.error(error);
      setState(AppState.ERROR);
      addLog("💥 Production failure: " + (error as Error).message);
    }
  };

  const handleYouTubeUpload = async (videoBlob: Blob) => {
    if (!user || !viralMeta) return;
    setUploadStatus("Starting Upload...");

    try {
      // Convert thumbnail data URL to Blob if available
      let thumbnailBlob: Blob | null = null;
      if (thumbnailDataUrl) {
        const response = await fetch(thumbnailDataUrl);
        thumbnailBlob = await response.blob();
      }

      const videoUrl = await uploadVideoToYouTube(
        videoBlob,
        viralMeta,
        user.accessToken,
        thumbnailBlob,
        (percent) => setUploadStatus(`Uploading: ${Math.round(percent)}%`)
      );
      setUploadStatus("✅ Published! " + videoUrl);

      window.open(videoUrl, '_blank');
    } catch (e) {
      setUploadStatus("❌ Upload Failed: " + (e as Error).message);
    }
  };

  const handleDeleteVideo = async (videoId: string, youtubeId: string | null) => {
    console.log(`[APP] Delete requested for video: ${videoId}, YouTube ID: ${youtubeId}`);
    try {
      // Delete from YouTube if it was uploaded
      if (youtubeId && user) {
        console.log(`[APP] Deleting from YouTube: ${youtubeId}`);
        await deleteVideoFromYouTube(youtubeId, user.accessToken);
        console.log(`[APP] YouTube deletion successful`);
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
    // Reset all state when switching channels
    setActiveChannel(channel);
    setConfig(channel.config);
    setState(AppState.IDLE);
    setAllNews([]);
    setSelectedNews([]);
    setSegments([]);
    setVideos({ wide: null, hostA: [], hostB: [] });
    setViralMeta(null);
    setLogs([]);
    setThumbnailDataUrl(null);
    setThumbnailVariant(null);
    setPreviewScript([]);

    // Fetch videos for new channel
    const vids = await fetchVideosFromDB(channel.id);
    setStoredVideos(vids.slice(0, 4));
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
        onExit={() => setState(AppState.IDLE)}
        activeChannel={activeChannel}
        channels={channels}
        onChannelChange={(channel) => {
          setActiveChannel(channel);
          setConfig(channel.config);
        }}
        onDeleteVideo={handleDeleteVideo}
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
              onClick={() => setState(AppState.ADMIN_DASHBOARD)}
              className="bg-[#272727] hover:bg-[#3f3f3f] text-xs font-bold px-3 py-1.5 rounded border border-[#444] text-gray-300"
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
              >
                {channels.map(ch => (
                  <option key={ch.id} value={ch.id}>{ch.name}</option>
                ))}
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
                    <button onClick={verifyKeyAndStart} className="bg-white text-black font-medium text-sm px-6 py-3 rounded-full hover:bg-gray-200 transition-colors mt-4">
                      Start Production
                    </button>
                  </>
                )}
              </div>

            ) : state === AppState.SELECTING_NEWS ? (
              // 2. SELECTION PHASE
              <div className="p-4 bg-[#0a0a0a] h-full overflow-y-auto">
                <NewsSelector
                  news={allNews}
                  date={new Date(selectedDate)}
                  onConfirmSelection={handleNewsSelection}
                />
              </div>

            ) : state === AppState.READY ? (
              // 3. PLAYBACK PHASE
              <BroadcastPlayer
                segments={segments}
                videos={videos}
                news={allNews}
                displayDate={new Date(selectedDate)}
                onUploadToYouTube={handleYouTubeUpload}
                config={config}
              />
            ) : (
              // 4. LOADING/GENERATING PHASE
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] text-center p-8">
                <div className="w-20 h-20 border-4 border-t-transparent rounded-full animate-spin mb-6" style={{ borderColor: config.logoColor1, borderTopColor: 'transparent' }}></div>
                <h3 className="text-xl font-bold mb-2">PRODUCING BROADCAST</h3>
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
                {new Number(Math.floor(Math.random() * 50000) + 1000).toLocaleString()} views • {new Date(selectedDate).toLocaleDateString()}
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
          {storedVideos.length > 0 ? storedVideos.map((video) => (
            <div key={video.id} className="flex gap-2 cursor-pointer group">
              <div className="w-40 h-24 bg-gray-800 rounded-lg overflow-hidden relative flex-shrink-0">
                {video.thumbnail_url ? (
                  <img src={video.thumbnail_url} alt={video.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-gray-700 group-hover:bg-gray-600 transition"></div>
                )}
                <div className="absolute top-1 right-1 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded">
                  {video.is_posted ? '✅ Posted' : '📝 Draft'}
                </div>
                {video.is_posted && video.analytics && (
                  <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                    {video.analytics.views.toLocaleString()} views
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-bold line-clamp-2 leading-tight group-hover:text-blue-400">
                  {video.title}
                </h4>
                <div className="text-xs text-gray-400">{config.channelName}</div>
                <div className="text-xs text-gray-400">
                  {new Date(video.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          )) : (
            // Fallback placeholders if no videos
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
