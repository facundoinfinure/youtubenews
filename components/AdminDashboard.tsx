import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { ChannelConfig, CharacterProfile, StoredVideo, Channel, UserProfile, Production } from '../types';
import { fetchVideosFromDB, saveConfigToDB, getAllChannels, saveChannel, getChannelById, uploadImageToStorage, getIncompleteProductions, getAllProductions, getPublishedProductions, createProductionVersion, getProductionVersions, exportProduction, importProduction, deleteProduction } from '../services/supabaseService';
import { generateSeedImage } from '../services/geminiService';
import { CostTracker } from '../services/CostTracker';
import { ContentCache } from '../services/ContentCache';
import { VideoListSkeleton, AnalyticsCardSkeleton, EmptyState } from './LoadingStates';
import { getStorageUsage, cleanupOldFiles } from '../services/storageManager';

interface AdminDashboardProps {
  config: ChannelConfig;
  onUpdateConfig: (newConfig: ChannelConfig) => void;
  onExit: () => void;
  activeChannel: Channel | null;
  channels: Channel[];
  onChannelChange: (channel: Channel) => void;
  onDeleteVideo: (videoId: string, youtubeId: string | null) => Promise<void>;
  onResumeProduction?: (production: Production) => Promise<void>;
  user: UserProfile | null;
}

const CharacterEditor: React.FC<{
  profile: CharacterProfile;
  onChange: (p: CharacterProfile) => void;
  label: string;
}> = ({ profile, onChange, label }) => {
  return (
    <div className="bg-[#1a1a1a] p-4 rounded-lg border border-[#333] space-y-3">
      <h4 className="text-yellow-500 font-bold uppercase text-sm border-b border-[#333] pb-2">{label}</h4>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Name</label>
          <input
            type="text" value={profile.name}
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
            className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white"
          />
        </div>
        
        <div>
          <label className="text-xs text-gray-500 block mb-1">Gender</label>
          <select
            value={profile.gender || 'male'}
            onChange={(e) => onChange({ ...profile, gender: e.target.value as 'male' | 'female' })}
            className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white"
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Outfit</label>
        <input
          type="text" 
          value={profile.outfit || ''}
          placeholder="e.g., dark hoodie, teal blazer and white shirt"
          onChange={(e) => onChange({ ...profile, outfit: e.target.value })}
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white"
        />
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Personality & Behavior</label>
        <textarea
          value={profile.personality || ''}
          placeholder="e.g., sarcastic, dry humor, skeptical, leans conservative, loves free markets"
          onChange={(e) => onChange({ ...profile, personality: e.target.value })}
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white h-20"
        />
        <p className="text-xs text-gray-600 mt-1">Describe how this host acts, speaks, and their political/ideological stance</p>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Visual Appearance</label>
        <textarea
          value={profile.visualPrompt}
          placeholder="e.g., Male chimpanzee news anchor wearing a suit and red tie, confident posture"
          onChange={(e) => onChange({ ...profile, visualPrompt: e.target.value })}
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white h-20"
        />
        <p className="text-xs text-gray-600 mt-1">Physical description used for video generation</p>
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Voice</label>
        <select
          value={profile.voiceName}
          onChange={(e) => onChange({ ...profile, voiceName: e.target.value })}
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white"
        >
          <option value="echo">echo - Male, Warm ⭐</option>
          <option value="onyx">onyx - Male, Deep</option>
          <option value="fable">fable - Male, British</option>
          <option value="alloy">alloy - Neutral</option>
          <option value="shimmer">shimmer - Female, Expressive ⭐</option>
          <option value="nova">nova - Female, Warm</option>
        </select>
        <p className="text-xs text-gray-600 mt-1">OpenAI TTS voice for this host</p>
      </div>
    </div>
  );
};

// Simple Line Chart Component using SVG
const RetentionChart: React.FC<{ data: number[], color: string }> = ({ data, color }) => {
  if (!data || data.length === 0) return <div className="h-32 flex items-center justify-center text-gray-500">No Data</div>;

  const height = 120;
  const width = 300;
  const max = 100;

  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - (val / max) * height;
    return `${x},${y} `;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height} `} className="w-full h-full overflow-visible">
      {/* Grid lines */}
      <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} stroke="#333" strokeDasharray="4" />
      <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="#333" strokeDasharray="4" />
      <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75} stroke="#333" strokeDasharray="4" />

      {/* The Line */}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        points={points}
        vectorEffect="non-scaling-stroke"
      />
      {/* Area under curve */}
      <polygon
        fill={color}
        fillOpacity="0.1"
        points={`0, ${height} ${points} ${width},${height} `}
      />
    </svg>
  );
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ config, onUpdateConfig, onExit, activeChannel, channels, onChannelChange, onDeleteVideo, onResumeProduction, user }) => {
  const [tempConfig, setTempConfig] = useState<ChannelConfig>(config);
  const [activeTab, setActiveTab] = useState<'insights' | 'settings' | 'costs' | 'cache' | 'productions'>('insights');
  const [videos, setVideos] = useState<StoredVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<StoredVideo | null>(null);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [productions, setProductions] = useState<Production[]>([]);
  const [isLoadingProductions, setIsLoadingProductions] = useState(false);
  const [expandedProductions, setExpandedProductions] = useState<Set<string>>(new Set());
  const [selectedProductionForVersions, setSelectedProductionForVersions] = useState<string | null>(null);
  const [productionVersions, setProductionVersions] = useState<Production[]>([]);
  const [productionFilter, setProductionFilter] = useState<'all' | 'incomplete' | 'completed' | 'failed' | 'published'>('incomplete');
  const [showNewChannelModal, setShowNewChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  // Seed image generation states
  const [generatingSeedImage, setGeneratingSeedImage] = useState<'hostASolo' | 'hostBSolo' | 'twoShot' | null>(null);
  const [uploadingSeedImage, setUploadingSeedImage] = useState<'hostASolo' | 'hostBSolo' | 'twoShot' | null>(null);
  const seedImageInputRef = useRef<HTMLInputElement>(null);
  const [storageUsage, setStorageUsage] = useState<{
    totalFiles: number;
    totalSize: number;
    files: Array<{ name: string; size: number }>;
  } | null>(null);
  const [isLoadingStorage, setIsLoadingStorage] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    deleted: number;
    freedSpace: number;
    errors: string[];
  } | null>(null);
  const [prodCosts, setProdCosts] = useState<{
    total: number;
    avg: number;
    count: number;
  } | null>(null);

  // Sync tempConfig when config changes (e.g., when switching channels)
  useEffect(() => {
    setTempConfig(config);
  }, [config]);

  useEffect(() => {
    if (activeTab === 'insights' && activeChannel) {
      setIsLoadingVideos(true);
      // Only show published videos (is_posted = true) in insights
      fetchVideosFromDB(activeChannel.id)
        .then(videos => {
          // Filter to only show published videos
          const publishedVideos = videos.filter(v => v.is_posted);
          setVideos(publishedVideos);
        })
        .finally(() => setIsLoadingVideos(false));
    }
    if (activeTab === 'productions' && activeChannel && user) {
      setIsLoadingProductions(true);
      if (productionFilter === 'incomplete') {
        getIncompleteProductions(activeChannel.id, user.email)
          .then(setProductions)
          .finally(() => setIsLoadingProductions(false));
      } else if (productionFilter === 'published') {
        // Get published productions (completed + has published video)
        getPublishedProductions(activeChannel.id, user.email, 100)
          .then(setProductions)
          .finally(() => setIsLoadingProductions(false));
      } else {
        getAllProductions(activeChannel.id, user.email, 100)
          .then(allProds => {
            // Filter by status
            if (productionFilter === 'all') {
              setProductions(allProds);
            } else {
              setProductions(allProds.filter(p => p.status === productionFilter));
            }
          })
          .finally(() => setIsLoadingProductions(false));
      }
    }
  }, [activeTab, activeChannel, user, productionFilter]);

  // Load storage usage when cache tab is active
  useEffect(() => {
    if (activeTab === 'cache') {
      const loadStorageUsage = async () => {
        setIsLoadingStorage(true);
        try {
          const usage = await getStorageUsage('channel-assets');
          setStorageUsage(usage);
        } catch (e) {
          console.error('Error loading storage usage:', e);
          setStorageUsage(null);
        } finally {
          setIsLoadingStorage(false);
        }
      };
      loadStorageUsage();
    }
  }, [activeTab]);

  // Load production costs when costs tab is active
  useEffect(() => {
    if (activeTab === 'costs' && activeChannel && user) {
      getAllProductions(activeChannel.id, user.email, 100).then(allProds => {
        const completedProds = allProds.filter(p => p.status === 'completed' && p.actual_cost);
        const total = completedProds.reduce((sum, p) => sum + (p.actual_cost || 0), 0);
        const avg = completedProds.length > 0 ? total / completedProds.length : 0;
        setProdCosts({ total, avg, count: completedProds.length });
      });
    }
  }, [activeTab, activeChannel, user]);

  const handleSave = async () => {
    if (!activeChannel) return;

    // Log what we're saving
    console.log(`💾 [Save] Saving config to Supabase...`);
    console.log(`💾 [Save] Host A voice: "${tempConfig.characters.hostA.voiceName}"`);
    console.log(`💾 [Save] Host B voice: "${tempConfig.characters.hostB.voiceName}"`);

    // Save to Supabase
    const updatedChannel = { ...activeChannel, config: tempConfig };
    const savedResult = await saveChannel(updatedChannel);
    
    if (!savedResult) {
      toast.error('Failed to save configuration to database!');
      return;
    }

    // VERIFICATION: Reload from Supabase to confirm what was actually saved
    // This is the SOURCE OF TRUTH - we use what's in the database, not local state
    const verifiedChannel = await getChannelById(activeChannel.id);
    
    if (!verifiedChannel) {
      toast.error('Failed to verify save - could not reload from database');
      return;
    }

    const confirmedConfig = verifiedChannel.config;
    
    console.log(`✅ [Save] VERIFIED from Supabase (reloaded):`);
    console.log(`✅ [Save] Host A voice: "${confirmedConfig?.characters?.hostA?.voiceName}"`);
    console.log(`✅ [Save] Host B voice: "${confirmedConfig?.characters?.hostB?.voiceName}"`);
    console.log(`✅ [Save] Host A image: "${confirmedConfig?.seedImages?.hostASoloUrl || 'not set'}"`);
    console.log(`✅ [Save] Host B image: "${confirmedConfig?.seedImages?.hostBSoloUrl || 'not set'}"`);

    // Update the app state with the config FROM SUPABASE (source of truth)
    onUpdateConfig(confirmedConfig);
    setTempConfig(confirmedConfig);
    
    // Also update the channel in parent state
    onChannelChange(verifiedChannel);
    
    toast.success('Configuration saved & verified from database!');
  };


  const handleNewChannel = async () => {
    if (!newChannelName.trim()) {
      toast.error('Please enter a channel name');
      return;
    }

    const newChannel: Partial<Channel> = {
      name: newChannelName.trim(),
      config: tempConfig,
      active: true
    };

    try {
      const created = await saveChannel(newChannel);
      if (created) {
        toast.success(`Channel "${newChannelName}" created!`);
        setShowNewChannelModal(false);
        setNewChannelName('');
        // Reload to fetch new channels
        window.location.reload();
      } else {
        toast.error('Failed to create channel');
      }
    } catch (error) {
      toast.error(`Error creating channel: ${(error as Error).message}`);
    }
  };

  return (
    <div className="w-full min-h-screen bg-[#0f0f0f] text-white p-6 md:p-12 font-sans">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-8 border-b border-[#333] pb-4">
          <div>
            <h1 className="text-4xl font-bold leading-tight">Admin Dashboard</h1>
            <p className="text-gray-400 text-sm mt-2 leading-relaxed">Manage production settings and analyze performance</p>
          </div>
          <div className="flex gap-4 items-center">
            {/* Channel Selector */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400 font-medium">Channel:</label>
              <select
                value={activeChannel?.id || ''}
                onChange={(e) => {
                  const selected = channels.find(c => c.id === e.target.value);
                  if (selected) {
                    onChannelChange(selected);
                  }
                }}
                className="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors duration-200 cursor-pointer hover:border-[#555]"
                disabled={channels.length === 0}
              >
                {channels.length === 0 ? (
                  <option value="">No channels available</option>
                ) : (
                  channels.map(ch => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))
                )}
              </select>
              <button
                onClick={() => setShowNewChannelModal(true)}
                className="bg-green-600 hover:bg-green-500 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-200 hover:scale-105 active:scale-95"
              >
                + New Channel
              </button>
            </div>
            <button
              onClick={onExit}
              className="text-gray-400 hover:text-white transition-colors duration-200 font-medium"
            >
              Exit to App
            </button>
            <button
              onClick={handleSave}
              className="btn-primary"
            >
              Save Changes
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 mb-8 border-b border-[#272727]">
          <button
            onClick={() => setActiveTab('insights')}
            className={`pb-3 px-2 border-b-2 font-semibold text-sm transition-all duration-200 ${activeTab === 'insights'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
          >
            Performance Insights
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`pb-3 px-2 border-b-2 font-semibold text-sm transition-all duration-200 ${activeTab === 'settings'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
          >
            Production Settings
          </button>
          <button
            onClick={() => setActiveTab('productions')}
            className={`pb-3 px-2 border-b-2 font-semibold text-sm transition-all duration-200 ${activeTab === 'productions'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
          >
            Productions {productions.length > 0 && `(${productions.length})`}
          </button>
          <button
            onClick={() => setActiveTab('costs')}
            className={`pb-3 px-2 border-b-2 font-semibold text-sm transition-all duration-200 ${activeTab === 'costs'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
          >
            Costs & Analytics
          </button>
          <button
            onClick={() => setActiveTab('cache')}
            className={`pb-3 px-2 border-b-2 font-semibold text-sm transition-all duration-200 ${activeTab === 'cache'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
          >
            Cache & Storage
          </button>
        </div>

        {/* INSIGHTS TAB */}
        {activeTab === 'insights' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Sidebar: Video List */}
            <div className="lg:col-span-1 bg-[#1a1a1a] rounded-xl border border-[#333] overflow-hidden flex flex-col h-[600px]">
              <div className="p-4 border-b border-[#333] bg-[#222]">
                <h3 className="font-bold text-gray-200">Recent Productions</h3>
              </div>
              <div className="overflow-y-auto flex-1">
                {isLoadingVideos ? (
                  <VideoListSkeleton />
                ) : videos.length === 0 ? (
                  <EmptyState
                    icon="🎬"
                    title="No Published Videos"
                    description="Only videos that have been published to YouTube are shown here. Complete a production and publish it to see analytics."
                  />
                ) : (
                  videos.map(vid => (
                    <div
                      key={vid.id}
                      onClick={() => setSelectedVideo(vid)}
                      className={`p-4 border-b border-[#333] cursor-pointer transition-all duration-200 ${selectedVideo?.id === vid.id
                        ? 'bg-[#2a2a2a] border-l-4 border-l-blue-500'
                        : 'hover:bg-[#222]'
                        }`}
                    >
                      <h4 className="font-bold text-sm line-clamp-2 mb-1">{vid.title}</h4>
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{new Date(vid.created_at).toLocaleDateString()}</span>
                        <span>{vid.analytics?.views.toLocaleString()} views</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Main: Detailed Analytics */}
            <div className="lg:col-span-2 space-y-6">
              {selectedVideo ? (
                <>
                  {/* Summary Card */}
                  <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
                    <h2 className="text-xl font-bold mb-4 line-clamp-1" title={selectedVideo.title}>{selectedVideo.title}</h2>
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-black/30 p-4 rounded-lg">
                        <div className="text-xs text-gray-400 uppercase">Views</div>
                        <div className="text-2xl font-bold text-white">{selectedVideo.analytics?.views.toLocaleString()}</div>
                      </div>
                      <div className="bg-black/30 p-4 rounded-lg">
                        <div className="text-xs text-gray-400 uppercase">Click-Through Rate</div>
                        <div className="text-2xl font-bold text-green-400">{selectedVideo.analytics?.ctr}%</div>
                      </div>
                      <div className="bg-black/30 p-4 rounded-lg">
                        <div className="text-xs text-gray-400 uppercase">Avg View Duration</div>
                        <div className="text-2xl font-bold text-white">{selectedVideo.analytics?.avgViewDuration}</div>
                      </div>
                      <div className="bg-black/30 p-4 rounded-lg">
                        <div className="text-xs text-gray-400 uppercase">Predicted Viral Score</div>
                        <div className="text-2xl font-bold text-yellow-500">{selectedVideo.viral_score}</div>
                      </div>
                    </div>
                  </div>

                  {/* Retention Graph */}
                  <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333] h-80 flex flex-col">
                    <h3 className="font-bold text-gray-200 mb-4 flex justify-between">
                      <span>Audience Retention</span>
                      <span className="text-xs text-gray-400 font-normal">Typical performance range: 40-60%</span>
                    </h3>
                    <div className="flex-1 w-full relative">
                      <div className="absolute left-0 top-0 bottom-0 w-8 flex flex-col justify-between text-xs text-gray-600">
                        <span>100%</span>
                        <span>50%</span>
                        <span>0%</span>
                      </div>
                      <div className="absolute left-10 right-0 top-0 bottom-0">
                        <RetentionChart
                          data={selectedVideo.analytics?.retentionData || []}
                          color={config.logoColor1 || "#FACC15"}
                        />
                      </div>
                    </div>
                    <div className="mt-2 text-center text-xs text-gray-500">Video Duration (Normalized)</div>
                  </div>

                  {/* Metadata Preview */}
                  <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
                    <h3 className="font-bold text-gray-200 mb-4">Metadata Analysis</h3>
                    <div className="space-y-4">
                      <div>
                        <div className="text-xs text-gray-500 uppercase mb-1">Description</div>
                        <p className="text-sm text-gray-300 font-mono bg-black/30 p-3 rounded">{selectedVideo.description}</p>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 uppercase mb-1">Tags</div>
                        <div className="flex flex-wrap gap-2">
                          {selectedVideo.tags?.map((tag, i) => (
                            <span key={i} className="text-xs bg-blue-900/40 text-blue-300 px-2 py-1 rounded">#{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Delete Button */}
                  <div className="bg-red-900/20 p-6 rounded-xl border-2 border-red-900/60 flex justify-between items-center hover:bg-red-900/30 transition-colors duration-300 shadow-[0_0_15px_rgba(220,38,38,0.1)]">
                    <div>
                      <h3 className="text-sm font-bold text-red-400 mb-1 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        Danger Zone
                      </h3>
                      <p className="text-xs text-red-200/70">Permanently delete this video from database and YouTube. This action cannot be undone.</p>
                    </div>
                    <button
                      onClick={async () => {
                        if (confirm('Are you sure you want to delete this video? This will also delete it from YouTube if uploaded.')) {
                          try {
                            console.log(`[ADMIN] Deleting video: ${selectedVideo.id}`);
                            await onDeleteVideo(selectedVideo.id, selectedVideo.youtube_id);
                            console.log(`[ADMIN] Delete successful`);

                            // RE-FETCH videos after deletion
                            if (activeChannel) {
                              // Optimistic update: Remove from UI immediately
                              setVideos(prev => prev.filter(v => v.id !== selectedVideo.id));
                              setSelectedVideo(null); // Clear selection after deletion

                              console.log(`[ADMIN] Re-fetching videos for channel: ${activeChannel.id}`);
                              try {
                                const refreshedVideos = await fetchVideosFromDB(activeChannel.id);
                                console.log(`[ADMIN] Fetched ${refreshedVideos.length} videos`);
                                setVideos(refreshedVideos);
                              } catch (error) {
                                console.error('[ADMIN] Error refreshing videos:', error);
                                // Keep the optimistic update even if refresh fails
                              }
                            }
                          } catch (error) {
                            console.error(`[ADMIN] Delete failed:`, error);
                            // Error already shown by handleDeleteVideo
                          }
                        }
                      }}
                      className="bg-red-600 text-white border border-red-500 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg shadow-red-900/20"
                    >
                      🗑️ Delete Video
                    </button>
                  </div>
                </>
              ) : (
                <div className="bg-[#1a1a1a] rounded-xl border border-[#333] h-full flex items-center justify-center">
                  <EmptyState
                    icon="📊"
                    title="Select a Video"
                    description="Choose a video from the list to view detailed performance insights, analytics, and metadata."
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-8">

            {/* General Settings */}
            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <span className="text-yellow-500">📺</span> Channel Branding
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Channel Name</label>
                  <input type="text" value={tempConfig.channelName} onChange={e => setTempConfig({ ...tempConfig, channelName: e.target.value })} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white" />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Tagline</label>
                  <input type="text" value={tempConfig.tagline} onChange={e => setTempConfig({ ...tempConfig, tagline: e.target.value })} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white" />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Primary Color (Hex)</label>
                  <div className="flex gap-2">
                    <input type="color" value={tempConfig.logoColor1} onChange={e => setTempConfig({ ...tempConfig, logoColor1: e.target.value })} className="h-10 w-10 bg-transparent border-none" />
                    <input type="text" value={tempConfig.logoColor1} onChange={e => setTempConfig({ ...tempConfig, logoColor1: e.target.value })} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white" />
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Secondary Color (Hex)</label>
                  <div className="flex gap-2">
                    <input type="color" value={tempConfig.logoColor2} onChange={e => setTempConfig({ ...tempConfig, logoColor2: e.target.value })} className="h-10 w-10 bg-transparent border-none" />
                    <input type="text" value={tempConfig.logoColor2} onChange={e => setTempConfig({ ...tempConfig, logoColor2: e.target.value })} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white" />
                  </div>
                </div>
              </div>
            </div>

            {/* Content Strategy */}
            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <span className="text-blue-500">🌍</span> Content Strategy
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Target Country</label>
                  <input type="text" value={tempConfig.country} onChange={e => setTempConfig({ ...tempConfig, country: e.target.value })} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white" />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Language</label>
                  <select value={tempConfig.language} onChange={e => setTempConfig({ ...tempConfig, language: e.target.value })} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white">
                    <option value="English">English</option>
                    <option value="Spanish">Spanish</option>
                    <option value="Portuguese">Portuguese</option>
                    <option value="French">French</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Overall Tone</label>
                  <input type="text" value={tempConfig.tone} onChange={e => setTempConfig({ ...tempConfig, tone: e.target.value })} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white" />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Video Format</label>
                  <div className="flex gap-4 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="format" checked={tempConfig.format === '16:9'} onChange={() => setTempConfig({ ...tempConfig, format: '16:9' })} />
                      Landscape (16:9)
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="format" checked={tempConfig.format === '9:16'} onChange={() => setTempConfig({ ...tempConfig, format: '9:16' })} />
                      Shorts (9:16)
                    </label>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-sm text-gray-400 block mb-1">Default Tags (comma separated)</label>
                  <input
                    type="text"
                    value={tempConfig.defaultTags?.join(', ') || ''}
                    onChange={e => setTempConfig({ ...tempConfig, defaultTags: e.target.value.split(',').map(t => t.trim()).filter(t => t) })}
                    className="w-full bg-[#111] border border-[#333] p-2 rounded text-white"
                    placeholder="news, finance, market"
                  />
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <input type="checkbox" checked={tempConfig.captionsEnabled} onChange={e => setTempConfig({ ...tempConfig, captionsEnabled: e.target.checked })} className="w-5 h-5" />
                  <label className="text-sm text-white">Enable Auto-Captions</label>
                </div>
              </div>
            </div>

            {/* Characters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <CharacterEditor
                label="Host A (Left)"
                profile={tempConfig.characters.hostA}
                onChange={(p) => setTempConfig({ ...tempConfig, characters: { ...tempConfig.characters, hostA: p } })}
              />
              <CharacterEditor
                label="Host B (Right)"
                profile={tempConfig.characters.hostB}
                onChange={(p) => setTempConfig({ ...tempConfig, characters: { ...tempConfig.characters, hostB: p } })}
              />
            </div>

            {/* Narrative Engine Settings (v2.0) */}
            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <span className="text-green-500">🎬</span> Narrative Engine Settings (v2.0)
              </h3>
              <p className="text-sm text-gray-400 mb-4">
                Configure the visual prompts and studio setup used by the v2.0 Narrative Engine for InfiniteTalk video generation.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Studio Setup Description</label>
                  <textarea
                    value={tempConfig.studioSetup || 'modern podcast room, warm tungsten key light, purple/blue LED accents, acoustic foam panels, Shure SM7B microphones'}
                    onChange={(e) => setTempConfig({ ...tempConfig, studioSetup: e.target.value })}
                    className="w-full bg-[#111] border border-[#333] p-2 rounded text-white h-20"
                    placeholder="Describe the studio environment..."
                  />
                </div>

                <div className="grid grid-cols-1 gap-6">
                  {/* Host A Solo */}
                  <div className="border border-[#333] rounded-lg p-4">
                    <label className="text-sm text-gray-400 block mb-1">Seed Image: Host A Solo</label>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <textarea
                          value={tempConfig.seedImages?.hostASolo || ''}
                          onChange={(e) => setTempConfig({ 
                            ...tempConfig, 
                            seedImages: { 
                              ...tempConfig.seedImages, 
                              hostASolo: e.target.value 
                            } 
                          })}
                          className="w-full bg-[#111] border border-[#333] p-2 rounded text-white h-20"
                          placeholder="Ultra-detailed 3D render of a male chimpanzee podcaster wearing a dark hoodie..."
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={async () => {
                              const prompt = tempConfig.seedImages?.hostASolo;
                              if (!prompt) {
                                toast.error('Please enter a prompt first');
                                return;
                              }
                              setGeneratingSeedImage('hostASolo');
                              try {
                                const imageDataUrl = await generateSeedImage(prompt);
                                if (imageDataUrl) {
                                  // Upload to storage
                                  const fileName = `seed-hostA-${activeChannel?.id || 'default'}-${Date.now()}.png`;
                                  const uploadedUrl = await uploadImageToStorage(imageDataUrl, fileName);
                                  if (uploadedUrl) {
                                    setTempConfig(prev => ({
                                      ...prev,
                                      seedImages: {
                                        ...prev.seedImages,
                                        hostASoloUrl: uploadedUrl
                                      }
                                    }));
                                    toast.success('Host A image generated & saved!');
                                  }
                                } else {
                                  toast.error('Failed to generate image');
                                }
                              } catch (error) {
                                toast.error('Error generating image');
                              } finally {
                                setGeneratingSeedImage(null);
                              }
                            }}
                            disabled={generatingSeedImage !== null}
                            className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white text-sm py-2 px-3 rounded flex items-center justify-center gap-2"
                          >
                            {generatingSeedImage === 'hostASolo' ? (
                              <>
                                <span className="animate-spin">⏳</span> Generating...
                              </>
                            ) : (
                              <>
                                🎨 Generate
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setUploadingSeedImage('hostASolo');
                              seedImageInputRef.current?.click();
                            }}
                            disabled={uploadingSeedImage !== null}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-sm py-2 px-3 rounded flex items-center justify-center gap-2"
                          >
                            📤 Upload
                          </button>
                        </div>
                      </div>
                      {tempConfig.seedImages?.hostASoloUrl && (
                        <div className="w-32 h-32 rounded-lg overflow-hidden border border-[#333] flex-shrink-0 relative group">
                          <img src={tempConfig.seedImages.hostASoloUrl} alt="Host A" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setTempConfig(prev => ({
                              ...prev,
                              seedImages: { ...prev.seedImages, hostASoloUrl: undefined }
                            }))}
                            className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Host B Solo */}
                  <div className="border border-[#333] rounded-lg p-4">
                    <label className="text-sm text-gray-400 block mb-1">Seed Image: Host B Solo</label>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <textarea
                          value={tempConfig.seedImages?.hostBSolo || ''}
                          onChange={(e) => setTempConfig({ 
                            ...tempConfig, 
                            seedImages: { 
                              ...tempConfig.seedImages, 
                              hostBSolo: e.target.value 
                            } 
                          })}
                          className="w-full bg-[#111] border border-[#333] p-2 rounded text-white h-20"
                          placeholder="Ultra-detailed 3D render of a female chimpanzee podcaster wearing a teal blazer..."
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={async () => {
                              const prompt = tempConfig.seedImages?.hostBSolo;
                              if (!prompt) {
                                toast.error('Please enter a prompt first');
                                return;
                              }
                              setGeneratingSeedImage('hostBSolo');
                              try {
                                const imageDataUrl = await generateSeedImage(prompt);
                                if (imageDataUrl) {
                                  const fileName = `seed-hostB-${activeChannel?.id || 'default'}-${Date.now()}.png`;
                                  const uploadedUrl = await uploadImageToStorage(imageDataUrl, fileName);
                                  if (uploadedUrl) {
                                    setTempConfig(prev => ({
                                      ...prev,
                                      seedImages: {
                                        ...prev.seedImages,
                                        hostBSoloUrl: uploadedUrl
                                      }
                                    }));
                                    toast.success('Host B image generated & saved!');
                                  }
                                } else {
                                  toast.error('Failed to generate image');
                                }
                              } catch (error) {
                                toast.error('Error generating image');
                              } finally {
                                setGeneratingSeedImage(null);
                              }
                            }}
                            disabled={generatingSeedImage !== null}
                            className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white text-sm py-2 px-3 rounded flex items-center justify-center gap-2"
                          >
                            {generatingSeedImage === 'hostBSolo' ? (
                              <>
                                <span className="animate-spin">⏳</span> Generating...
                              </>
                            ) : (
                              <>
                                🎨 Generate
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setUploadingSeedImage('hostBSolo');
                              seedImageInputRef.current?.click();
                            }}
                            disabled={uploadingSeedImage !== null}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-sm py-2 px-3 rounded flex items-center justify-center gap-2"
                          >
                            📤 Upload
                          </button>
                        </div>
                      </div>
                      {tempConfig.seedImages?.hostBSoloUrl && (
                        <div className="w-32 h-32 rounded-lg overflow-hidden border border-[#333] flex-shrink-0 relative group">
                          <img src={tempConfig.seedImages.hostBSoloUrl} alt="Host B" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setTempConfig(prev => ({
                              ...prev,
                              seedImages: { ...prev.seedImages, hostBSoloUrl: undefined }
                            }))}
                            className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Two-Shot */}
                  <div className="border border-[#333] rounded-lg p-4">
                    <label className="text-sm text-gray-400 block mb-1">Seed Image: Two-Shot (Both Hosts)</label>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <textarea
                          value={tempConfig.seedImages?.twoShot || ''}
                          onChange={(e) => setTempConfig({ 
                            ...tempConfig, 
                            seedImages: { 
                              ...tempConfig.seedImages, 
                              twoShot: e.target.value 
                            } 
                          })}
                          className="w-full bg-[#111] border border-[#333] p-2 rounded text-white h-20"
                          placeholder="Ultra-detailed 3D render of hostA and hostB at a sleek podcast desk..."
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={async () => {
                              const prompt = tempConfig.seedImages?.twoShot;
                              if (!prompt) {
                                toast.error('Please enter a prompt first');
                                return;
                              }
                              setGeneratingSeedImage('twoShot');
                              try {
                                const imageDataUrl = await generateSeedImage(prompt, '16:9');
                                if (imageDataUrl) {
                                  const fileName = `seed-twoshot-${activeChannel?.id || 'default'}-${Date.now()}.png`;
                                  const uploadedUrl = await uploadImageToStorage(imageDataUrl, fileName);
                                  if (uploadedUrl) {
                                    setTempConfig(prev => ({
                                      ...prev,
                                      seedImages: {
                                        ...prev.seedImages,
                                        twoShotUrl: uploadedUrl
                                      }
                                    }));
                                    toast.success('Two-shot image generated & saved!');
                                  }
                                } else {
                                  toast.error('Failed to generate image');
                                }
                              } catch (error) {
                                toast.error('Error generating image');
                              } finally {
                                setGeneratingSeedImage(null);
                              }
                            }}
                            disabled={generatingSeedImage !== null}
                            className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white text-sm py-2 px-3 rounded flex items-center justify-center gap-2"
                          >
                            {generatingSeedImage === 'twoShot' ? (
                              <>
                                <span className="animate-spin">⏳</span> Generating...
                              </>
                            ) : (
                              <>
                                🎨 Generate
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => {
                              setUploadingSeedImage('twoShot');
                              seedImageInputRef.current?.click();
                            }}
                            disabled={uploadingSeedImage !== null}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-sm py-2 px-3 rounded flex items-center justify-center gap-2"
                          >
                            📤 Upload
                          </button>
                        </div>
                      </div>
                      {tempConfig.seedImages?.twoShotUrl && (
                        <div className="w-40 h-24 rounded-lg overflow-hidden border border-[#333] flex-shrink-0 relative group">
                          <img src={tempConfig.seedImages.twoShotUrl} alt="Two-Shot" className="w-full h-full object-cover" />
                          <button
                            onClick={() => setTempConfig(prev => ({
                              ...prev,
                              seedImages: { ...prev.seedImages, twoShotUrl: undefined }
                            }))}
                            className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Hidden file input for uploads */}
                <input
                  ref={seedImageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    const currentUploadType = uploadingSeedImage;
                    if (!file || !currentUploadType) return;
                    
                    try {
                      // Convert file to data URL
                      const reader = new FileReader();
                      reader.onload = async () => {
                        const dataUrl = reader.result as string;
                        const fileName = `seed-${currentUploadType}-${activeChannel?.id || 'default'}-${Date.now()}.png`;
                        const uploadedUrl = await uploadImageToStorage(dataUrl, fileName);
                        
                        if (uploadedUrl) {
                          const urlKey = currentUploadType === 'hostASolo' ? 'hostASoloUrl' 
                            : currentUploadType === 'hostBSolo' ? 'hostBSoloUrl' 
                            : 'twoShotUrl';
                          
                          // Use function form to get latest state
                          setTempConfig(prev => ({
                            ...prev,
                            seedImages: {
                              ...prev.seedImages,
                              [urlKey]: uploadedUrl
                            }
                          }));
                          toast.success('Image uploaded to Supabase Storage!');
                        } else {
                          toast.error('Failed to upload image');
                        }
                        setUploadingSeedImage(null);
                      };
                      reader.readAsDataURL(file);
                    } catch (error) {
                      toast.error('Error uploading image');
                      setUploadingSeedImage(null);
                    }
                    
                    // Reset input
                    e.target.value = '';
                  }}
                />

                <p className="text-xs text-gray-500 mt-2">
                  💡 Generate or upload reference images for each host. These images help maintain visual consistency across all video segments.
                  The prompts are still used for scene-specific variations.
                </p>
              </div>
            </div>

          </div>
        )}

        {/* PRODUCTIONS TAB */}
        {activeTab === 'productions' && (
          <div className="space-y-6">
            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <span>📦</span>
                  <span>Productions History</span>
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.json';
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file || !activeChannel || !user) return;
                        
                        try {
                          const text = await file.text();
                          const imported = await importProduction(text, activeChannel.id, user.email);
                          if (imported) {
                            toast.success('Production imported successfully!');
                            // Refresh productions list
                            if (productionFilter === 'all') {
                              const allProds = await getAllProductions(activeChannel.id, user.email, 100);
                              setProductions(allProds);
                            } else if (productionFilter === 'incomplete') {
                              const incomplete = await getIncompleteProductions(activeChannel.id, user.email);
                              setProductions(incomplete);
                            } else if (productionFilter === 'published') {
                              // Get published productions
                              const publishedProds = await getPublishedProductions(activeChannel.id, user.email, 100);
                              setProductions(publishedProds);
                            } else {
                              const allProds = await getAllProductions(activeChannel.id, user.email, 100);
                              setProductions(allProds.filter(p => p.status === productionFilter));
                            }
                          } else {
                            toast.error('Failed to import production');
                          }
                        } catch (error) {
                          console.error('Import error:', error);
                          toast.error('Failed to import production: Invalid file format');
                        }
                      };
                      input.click();
                    }}
                    className="bg-green-600 text-white border border-green-500 hover:bg-green-700 px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-200 hover:scale-105 active:scale-95"
                  >
                    📤 Import Production
                  </button>
                  <button
                    onClick={() => setProductionFilter('all')}
                    className={`px-3 py-1 rounded text-sm font-semibold transition-all ${
                      productionFilter === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#222] text-gray-400 hover:text-white'
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setProductionFilter('incomplete')}
                    className={`px-3 py-1 rounded text-sm font-semibold transition-all ${
                      productionFilter === 'incomplete'
                        ? 'bg-yellow-600 text-white'
                        : 'bg-[#222] text-gray-400 hover:text-white'
                    }`}
                  >
                    In Progress
                  </button>
                  <button
                    onClick={() => setProductionFilter('completed')}
                    className={`px-3 py-1 rounded text-sm font-semibold transition-all ${
                      productionFilter === 'completed'
                        ? 'bg-green-600 text-white'
                        : 'bg-[#222] text-gray-400 hover:text-white'
                    }`}
                  >
                    Completed
                  </button>
                  <button
                    onClick={() => setProductionFilter('failed')}
                    className={`px-3 py-1 rounded text-sm font-semibold transition-all ${
                      productionFilter === 'failed'
                        ? 'bg-red-600 text-white'
                        : 'bg-[#222] text-gray-400 hover:text-white'
                    }`}
                  >
                    Failed
                  </button>
                  <button
                    onClick={() => setProductionFilter('published')}
                    className={`px-3 py-1 rounded text-sm font-semibold transition-all ${
                      productionFilter === 'published'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#222] text-gray-400 hover:text-white'
                    }`}
                  >
                    📺 Published
                  </button>
                </div>
              </div>
              <p className="text-gray-400 text-sm mb-6">
                {productionFilter === 'incomplete' 
                  ? 'Resume productions that were abandoned or are still in progress.'
                  : productionFilter === 'all'
                  ? 'View all productions across all statuses.'
                  : productionFilter === 'published'
                  ? 'View completed productions that have been published to YouTube.'
                  : `View ${productionFilter} productions.`}
              </p>

              {isLoadingProductions ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-[#111] p-4 rounded-lg border border-[#333] animate-pulse">
                      <div className="h-4 bg-gray-800 rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-gray-800 rounded w-1/2"></div>
                    </div>
                  ))}
                </div>
              ) : productions.length === 0 ? (
                <EmptyState
                  icon="📭"
                  title={`No ${productionFilter === 'all' ? '' : productionFilter === 'incomplete' ? 'Incomplete' : productionFilter === 'published' ? 'Published' : productionFilter} Productions`}
                  description={productionFilter === 'incomplete' 
                    ? "All productions have been completed. Start a new production to create content."
                    : productionFilter === 'published'
                    ? "No published productions found. Complete a production and publish it to YouTube to see it here."
                    : `No ${productionFilter} productions found.`}
                />
              ) : (
                <div className="space-y-3">
                  {productions.map((production) => (
                    <div
                      key={production.id}
                      className="bg-[#111] p-4 rounded-lg border border-[#333] hover:border-blue-500 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                              production.status === 'in_progress' 
                                ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                                : production.status === 'completed'
                                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                                : production.status === 'failed'
                                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                            }`}>
                              {production.status === 'in_progress' ? '🔄 In Progress' 
                                : production.status === 'completed' ? '✅ Completed'
                                : production.status === 'failed' ? '❌ Failed'
                                : '📝 Draft'}
                            </span>
                            {production.version && production.version > 1 && (
                              <span className="px-2 py-1 rounded text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30">
                                v{production.version}
                              </span>
                            )}
                            <span className="text-gray-500 text-xs">
                              {new Date(production.news_date).toLocaleDateString()}
                            </span>
                            {production.completed_at && (
                              <span className="text-gray-500 text-xs">
                                • {new Date(production.completed_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-300 mb-2">
                            Progress: Step {production.progress_step} of 6
                          </div>
                          {production.viral_metadata && (
                            <div className="text-xs text-gray-400 mb-2">
                              Title: {production.viral_metadata.title}
                            </div>
                          )}
                          {production.script && (
                            <div className="text-xs text-gray-500">
                              Script: {production.script.length} lines
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {onResumeProduction && (production.status === 'in_progress' || production.status === 'draft') && (
                            <button
                              onClick={() => {
                                onResumeProduction(production);
                                onExit(); // Exit dashboard to show production
                              }}
                              className="bg-blue-600 text-white border border-blue-500 hover:bg-blue-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 hover:scale-105 active:scale-95"
                            >
                              ▶️ Resume
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              try {
                                const jsonData = await exportProduction(production.id);
                                if (jsonData) {
                                  const blob = new Blob([jsonData], { type: 'application/json' });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `production-${production.id}-${production.news_date}.json`;
                                  document.body.appendChild(a);
                                  a.click();
                                  document.body.removeChild(a);
                                  URL.revokeObjectURL(url);
                                  toast.success('Production exported!');
                                } else {
                                  toast.error('Failed to export production');
                                }
                              } catch (error) {
                                console.error('Export error:', error);
                                toast.error('Failed to export production');
                              }
                            }}
                            className="bg-purple-600 text-white border border-purple-500 hover:bg-purple-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 hover:scale-105 active:scale-95"
                            title="Export production to JSON"
                          >
                            📥 Export
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                const newVersion = await createProductionVersion(production.id, user?.email);
                                if (newVersion) {
                                  toast.success(`New version (v${newVersion.version}) created!`);
                                  // Refresh productions list
                                  if (activeChannel && user) {
                                    if (productionFilter === 'all') {
                                      const allProds = await getAllProductions(activeChannel.id, user.email, 100);
                                      setProductions(allProds);
                                    } else if (productionFilter === 'incomplete') {
                                      const incomplete = await getIncompleteProductions(activeChannel.id, user.email);
                                      setProductions(incomplete);
                                    } else if (productionFilter === 'published') {
                                      // Get published productions
                                      const publishedProds = await getPublishedProductions(activeChannel.id, user.email, 100);
                                      setProductions(publishedProds);
                                    } else {
                                      const allProds = await getAllProductions(activeChannel.id, user.email, 100);
                                      setProductions(allProds.filter(p => p.status === productionFilter));
                                    }
                                  }
                                } else {
                                  toast.error('Failed to create version');
                                }
                              } catch (error) {
                                console.error('Version creation error:', error);
                                toast.error('Failed to create version');
                              }
                            }}
                            className="bg-orange-600 text-white border border-orange-500 hover:bg-orange-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 hover:scale-105 active:scale-95"
                            title="Create a new version of this production"
                          >
                            🔄 New Version
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm('Are you sure you want to delete this production? This action cannot be undone.')) {
                                try {
                                  const success = await deleteProduction(production.id);
                                  if (success) {
                                    toast.success('Production deleted successfully!');
                                    // Refresh productions list
                                    if (activeChannel && user) {
                                      if (productionFilter === 'all') {
                                        const allProds = await getAllProductions(activeChannel.id, user.email, 100);
                                        setProductions(allProds);
                                      } else if (productionFilter === 'incomplete') {
                                        const incomplete = await getIncompleteProductions(activeChannel.id, user.email);
                                        setProductions(incomplete);
                                      } else if (productionFilter === 'published') {
                                        // Get published productions
                                        const allProds = await getAllProductions(activeChannel.id, user.email, 100);
                                        const allVideos = await fetchVideosFromDB(activeChannel.id);
                                        const publishedVideos = allVideos.filter(v => v.is_posted);
                                        const publishedProds = allProds.filter(prod => {
                                          if (prod.status !== 'completed') return false;
                                          if (!prod.viral_metadata?.title) return false;
                                          return publishedVideos.some(video => 
                                            video.title === prod.viral_metadata?.title || 
                                            video.title.includes(prod.viral_metadata?.title || '') ||
                                            (prod.viral_metadata?.title && video.title.includes(prod.viral_metadata.title.substring(0, 30)))
                                          );
                                        });
                                        setProductions(publishedProds);
                                      } else {
                                        const allProds = await getAllProductions(activeChannel.id, user.email, 100);
                                        setProductions(allProds.filter(p => p.status === productionFilter));
                                      }
                                    }
                                  } else {
                                    toast.error('Failed to delete production');
                                  }
                                } catch (error) {
                                  console.error('Delete error:', error);
                                  toast.error('Failed to delete production');
                                }
                              }
                            }}
                            className="bg-red-600 text-white border border-red-500 hover:bg-red-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 hover:scale-105 active:scale-95"
                            title="Delete this production"
                          >
                            🗑️ Delete
                          </button>
                          {production.status === 'failed' && (
                            <span className="text-red-400 text-xs flex items-center gap-1">
                              ✗ Failed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* COSTS & ANALYTICS TAB */}
        {activeTab === 'costs' && (
          <div className="space-y-6">
            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <h2 className="text-xl font-bold mb-4">Cost Analytics</h2>
              {(() => {
                const costStats = CostTracker.getStatsSync(30);
                const cacheStats = ContentCache.getStats();
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-black/30 p-4 rounded-lg">
                      <div className="text-xs text-gray-400 uppercase mb-1">Total Cost (30d)</div>
                      <div className="text-2xl font-bold text-white">${costStats.totalCost.toFixed(3)}</div>
                      <div className="text-xs text-gray-500 mt-1">${(costStats.totalCost / 30).toFixed(3)}/day avg</div>
                    </div>
                    <div className="bg-black/30 p-4 rounded-lg">
                      <div className="text-xs text-gray-400 uppercase mb-1">Cache Savings</div>
                      <div className="text-2xl font-bold text-green-400">${costStats.estimatedSavings.toFixed(2)}</div>
                      <div className="text-xs text-gray-500 mt-1">{costStats.cacheHitRate.toFixed(1)}% hit rate</div>
                    </div>
                    <div className="bg-black/30 p-4 rounded-lg">
                      <div className="text-xs text-gray-400 uppercase mb-1">Cache Entries</div>
                      <div className="text-2xl font-bold text-blue-400">{cacheStats.entries}</div>
                      <div className="text-xs text-gray-500 mt-1">${cacheStats.totalCostSaved.toFixed(2)} saved</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <h3 className="text-lg font-bold mb-4">Cost Breakdown by Task</h3>
              {(() => {
                const costStats = CostTracker.getStatsSync(30);
                return (
                  <div className="space-y-2">
                    {costStats.breakdown.map((item: any) => (
                      <div key={item.task} className="flex justify-between items-center p-3 bg-black/30 rounded">
                        <div>
                          <div className="font-semibold text-white">{item.task}</div>
                          <div className="text-xs text-gray-400">{item.count} calls ({item.cached} cached)</div>
                        </div>
                        <div className="text-lg font-bold text-yellow-400">${item.cost.toFixed(3)}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Production Costs */}
            {prodCosts && (
              <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
                <h3 className="text-lg font-bold mb-4">Production Costs</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-black/30 p-4 rounded-lg">
                    <div className="text-xs text-gray-400 uppercase mb-1">Total Production Cost</div>
                    <div className="text-2xl font-bold text-white">${prodCosts.total.toFixed(3)}</div>
                    <div className="text-xs text-gray-500 mt-1">{prodCosts.count} completed productions</div>
                  </div>
                  <div className="bg-black/30 p-4 rounded-lg">
                    <div className="text-xs text-gray-400 uppercase mb-1">Avg per Production</div>
                    <div className="text-2xl font-bold text-blue-400">${prodCosts.avg.toFixed(3)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CACHE & STORAGE TAB */}
        {activeTab === 'cache' && (
          <div className="space-y-6">
            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <h2 className="text-xl font-bold mb-4">Cache Statistics</h2>
              {(() => {
                const cacheStats = ContentCache.getStats();
                const costStats = CostTracker.getStatsSync(30);
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-black/30 p-4 rounded-lg">
                      <div className="text-xs text-gray-400 uppercase mb-1">Cache Entries</div>
                      <div className="text-2xl font-bold text-white">{cacheStats.entries}</div>
                      <div className="text-xs text-gray-500 mt-1">Active cache items</div>
                    </div>
                    <div className="bg-black/30 p-4 rounded-lg">
                      <div className="text-xs text-gray-400 uppercase mb-1">Total Savings</div>
                      <div className="text-2xl font-bold text-green-400">${cacheStats.totalCostSaved.toFixed(2)}</div>
                      <div className="text-xs text-gray-500 mt-1">From cache hits</div>
                    </div>
                    <div className="bg-black/30 p-4 rounded-lg">
                      <div className="text-xs text-gray-400 uppercase mb-1">Cache Hit Rate</div>
                      <div className="text-2xl font-bold text-blue-400">{costStats.cacheHitRate.toFixed(1)}%</div>
                      <div className="text-xs text-gray-500 mt-1">{costStats.cachedCount} of {costStats.totalCount} calls</div>
                    </div>
                    <div className="bg-black/30 p-4 rounded-lg">
                      <div className="text-xs text-gray-400 uppercase mb-1">Estimated Savings</div>
                      <div className="text-2xl font-bold text-yellow-400">${costStats.estimatedSavings.toFixed(2)}</div>
                      <div className="text-xs text-gray-500 mt-1">Last 30 days</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <h3 className="text-lg font-bold mb-4">Storage Management</h3>
              <div className="space-y-4">
                {isLoadingStorage ? (
                  <div className="text-center py-8 text-gray-400">Loading storage info...</div>
                ) : storageUsage ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-black/30 p-4 rounded-lg">
                        <div className="text-xs text-gray-400 uppercase mb-1">Total Files</div>
                        <div className="text-2xl font-bold text-white">{storageUsage.totalFiles}</div>
                      </div>
                      <div className="bg-black/30 p-4 rounded-lg">
                        <div className="text-xs text-gray-400 uppercase mb-1">Total Size</div>
                        <div className="text-2xl font-bold text-blue-400">
                          {(storageUsage.totalSize / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        if (!confirm('Are you sure you want to clean up files older than 30 days? This cannot be undone.')) {
                          return;
                        }
                        setIsLoadingStorage(true);
                        try {
                          const result = await cleanupOldFiles('channel-assets', 30, false);
                          setCleanupResult(result);
                          toast.success(`Cleaned up ${result.deleted} files, freed ${(result.freedSpace / 1024 / 1024).toFixed(2)} MB`);
                          const usage = await getStorageUsage('channel-assets');
                          setStorageUsage(usage);
                        } catch (e) {
                          toast.error(`Cleanup failed: ${(e as Error).message}`);
                        } finally {
                          setIsLoadingStorage(false);
                        }
                      }}
                      className="w-full bg-red-600 hover:bg-red-500 px-4 py-2 rounded-lg font-bold transition-colors"
                    >
                      🗑️ Cleanup Old Files ({'>'}30 days)
                    </button>
                    {cleanupResult && (
                      <div className="bg-green-900/30 border border-green-500/50 p-3 rounded text-sm">
                        <div className="font-bold text-green-400">Cleanup Complete</div>
                        <div className="text-gray-300">
                          Deleted: {cleanupResult.deleted} files<br />
                          Freed: {(cleanupResult.freedSpace / 1024 / 1024).toFixed(2)} MB
                          {cleanupResult.errors.length > 0 && (
                            <div className="text-red-400 mt-2">
                              Errors: {cleanupResult.errors.length}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-400">Storage info unavailable</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Channel Modal */}
      {showNewChannelModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 max-w-2xl w-full mx-4 my-8">
            <h3 className="text-xl font-bold mb-4">Create New Channel</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Channel Name</label>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  className="w-full bg-[#111] border border-[#333] p-2 rounded text-white focus:outline-none focus:border-blue-500"
                  placeholder="Enter channel name..."
                  autoFocus
                />
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-[#333]">
                <button
                  onClick={() => {
                    setShowNewChannelModal(false);
                    setNewChannelName('');
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNewChannel}
                  disabled={!newChannelName.trim()}
                  className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Channel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};