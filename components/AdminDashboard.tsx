import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { ChannelConfig, CharacterProfile, StoredVideo, Channel, UserProfile, Production } from '../types';
import { fetchVideosFromDB, saveConfigToDB, getAllChannels, saveChannel, getChannelById, uploadImageToStorage, getIncompleteProductions, getAllProductions, getPublishedProductions, createProductionVersion, getProductionVersions, exportProduction, importProduction, deleteProduction, updateSegmentStatus } from '../services/supabaseService';
import { generateSeedImage } from '../services/geminiService';
import { CostTracker } from '../services/CostTracker';
import { ContentCache } from '../services/ContentCache';
import { VideoListSkeleton, AnalyticsCardSkeleton, EmptyState } from './LoadingStates';
import { getStorageUsage, cleanupOldFiles } from '../services/storageManager';
import { renderProductionToShotstack, hasVideosForRender } from '../services/shotstackService';

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
  const [activeTab, setActiveTab] = useState<'overview' | 'insights' | 'settings' | 'costs' | 'cache' | 'productions'>('overview');
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
  // Seed image format tab (16:9 or 9:16)
  const [seedImageFormat, setSeedImageFormat] = useState<'16:9' | '9:16'>('16:9');
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
  // Asset management state
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});

  // Helper to refresh productions list
  const refreshProductions = async () => {
    if (!activeChannel || !user) return;
    setIsLoadingProductions(true);
    try {
      if (productionFilter === 'incomplete') {
        const prods = await getIncompleteProductions(activeChannel.id, user.email);
        setProductions(prods);
      } else if (productionFilter === 'published') {
        const prods = await getPublishedProductions(activeChannel.id, user.email, 100);
        setProductions(prods);
      } else if (productionFilter === 'all') {
        const prods = await getAllProductions(activeChannel.id, user.email, 100);
        setProductions(prods);
      } else {
        const allProds = await getAllProductions(activeChannel.id, user.email, 100);
        setProductions(allProds.filter(p => p.status === productionFilter));
      }
    } finally {
      setIsLoadingProductions(false);
    }
  };

  // Sync tempConfig when config changes (e.g., when switching channels)
  useEffect(() => {
    setTempConfig(config);
  }, [config]);

  useEffect(() => {
    if ((activeTab === 'insights' || activeTab === 'overview') && activeChannel) {
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
    if ((activeTab === 'productions' || activeTab === 'overview') && activeChannel && user) {
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

  // Load production costs when costs or overview tab is active
  useEffect(() => {
    if ((activeTab === 'costs' || activeTab === 'overview') && activeChannel && user) {
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
            onClick={() => setActiveTab('overview')}
            className={`pb-3 px-2 border-b-2 font-semibold text-sm transition-all duration-200 ${activeTab === 'overview'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
          >
            🏠 Overview
          </button>
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

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Hero Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div 
                onClick={() => { setProductionFilter('incomplete'); setActiveTab('productions'); }} 
                className="bg-gradient-to-br from-yellow-500/20 to-orange-500/10 p-6 rounded-xl border border-yellow-500/30 cursor-pointer hover:scale-105 transition-all"
              >
                <div className="text-3xl mb-2">🔄</div>
                <div className="text-3xl font-bold text-yellow-400">
                  {productions.filter(p => p.status === 'in_progress').length}
                </div>
                <div className="text-sm text-gray-400">In Progress</div>
              </div>
              
              <div 
                onClick={() => { setProductionFilter('completed'); setActiveTab('productions'); }} 
                className="bg-gradient-to-br from-green-500/20 to-emerald-500/10 p-6 rounded-xl border border-green-500/30 cursor-pointer hover:scale-105 transition-all"
              >
                <div className="text-3xl mb-2">✅</div>
                <div className="text-3xl font-bold text-green-400">
                  {productions.filter(p => p.status === 'completed').length}
                </div>
                <div className="text-sm text-gray-400">Completed</div>
              </div>
              
              <div 
                onClick={() => setActiveTab('insights')} 
                className="bg-gradient-to-br from-blue-500/20 to-indigo-500/10 p-6 rounded-xl border border-blue-500/30 cursor-pointer hover:scale-105 transition-all"
              >
                <div className="text-3xl mb-2">📺</div>
                <div className="text-3xl font-bold text-blue-400">{videos.length}</div>
                <div className="text-sm text-gray-400">Published</div>
              </div>
              
              <div 
                onClick={() => setActiveTab('costs')} 
                className="bg-gradient-to-br from-purple-500/20 to-pink-500/10 p-6 rounded-xl border border-purple-500/30 cursor-pointer hover:scale-105 transition-all"
              >
                <div className="text-3xl mb-2">💰</div>
                <div className="text-3xl font-bold text-purple-400">
                  ${(prodCosts?.total || 0).toFixed(2)}
                </div>
                <div className="text-sm text-gray-400">Total Cost</div>
              </div>
            </div>
            
            {/* Active Productions - Quick Access */}
            {productions.filter(p => p.status === 'in_progress').length > 0 && (
              <div className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] p-6 rounded-xl border border-yellow-500/30">
                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <span className="animate-pulse text-red-500">●</span> Producciones Activas
                </h3>
                <div className="space-y-3">
                  {productions.filter(p => p.status === 'in_progress').slice(0, 3).map(prod => {
                    const segmentStatus = prod.segment_status || {};
                    const totalSegments = prod.segments?.length || Object.keys(segmentStatus).length;
                    const audiosDone = Object.values(segmentStatus).filter(s => s?.audio === 'done').length;
                    const videosDone = Object.values(segmentStatus).filter(s => s?.video === 'done').length;
                    
                    return (
                      <div key={prod.id} className="flex items-center justify-between p-4 bg-[#111] rounded-lg border border-[#333]">
                        <div className="flex-1">
                          <div className="font-medium text-white truncate max-w-[400px]">
                            {prod.viral_metadata?.title || `Production ${prod.id.slice(0, 8)}`}
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-gray-500">Step {prod.progress_step}/6</span>
                            {totalSegments > 0 && (
                              <>
                                <span className="text-xs text-cyan-400">🔊 {audiosDone}/{totalSegments}</span>
                                <span className="text-xs text-purple-400">🎥 {videosDone}/{totalSegments}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => { onResumeProduction?.(prod); onExit(); }}
                          className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-blue-500/20"
                        >
                          ▶️ Retomar
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {/* Asset Summary */}
            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <span>📦</span> Resumen de Assets
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#111] p-4 rounded-lg text-center">
                  <div className="text-3xl font-bold text-white">{productions.length}</div>
                  <div className="text-sm text-gray-400">Producciones</div>
                </div>
                <div className="bg-[#111] p-4 rounded-lg text-center">
                  <div className="text-3xl font-bold text-cyan-400">
                    {productions.reduce((acc, p) => acc + Object.values(p.segment_status || {}).filter(s => s?.audio === 'done').length, 0)}
                  </div>
                  <div className="text-sm text-gray-400">Audios</div>
                </div>
                <div className="bg-[#111] p-4 rounded-lg text-center">
                  <div className="text-3xl font-bold text-purple-400">
                    {productions.reduce((acc, p) => acc + Object.values(p.segment_status || {}).filter(s => s?.video === 'done').length, 0)}
                  </div>
                  <div className="text-sm text-gray-400">Videos</div>
                </div>
                <div className="bg-[#111] p-4 rounded-lg text-center">
                  <div className="text-3xl font-bold text-pink-400">
                    {productions.reduce((acc, p) => acc + (p.segments?.length || 0), 0)}
                  </div>
                  <div className="text-sm text-gray-400">Segmentos</div>
                </div>
              </div>
            </div>
            
            {/* Quick Actions */}
            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <h3 className="text-xl font-bold mb-4">⚡ Acciones Rápidas</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button 
                  onClick={() => setActiveTab('productions')}
                  className="p-4 bg-[#111] hover:bg-[#1a1a1a] border border-[#333] hover:border-blue-500 rounded-lg text-left transition-all"
                >
                  <div className="text-2xl mb-2">📦</div>
                  <div className="font-medium text-white">Ver Producciones</div>
                  <div className="text-xs text-gray-500">Gestionar assets</div>
                </button>
                <button 
                  onClick={() => setActiveTab('settings')}
                  className="p-4 bg-[#111] hover:bg-[#1a1a1a] border border-[#333] hover:border-green-500 rounded-lg text-left transition-all"
                >
                  <div className="text-2xl mb-2">⚙️</div>
                  <div className="font-medium text-white">Configuración</div>
                  <div className="text-xs text-gray-500">Hosts y canal</div>
                </button>
                <button 
                  onClick={() => setActiveTab('costs')}
                  className="p-4 bg-[#111] hover:bg-[#1a1a1a] border border-[#333] hover:border-purple-500 rounded-lg text-left transition-all"
                >
                  <div className="text-2xl mb-2">💰</div>
                  <div className="font-medium text-white">Costos</div>
                  <div className="text-xs text-gray-500">Analytics y gastos</div>
                </button>
                <button 
                  onClick={() => setActiveTab('cache')}
                  className="p-4 bg-[#111] hover:bg-[#1a1a1a] border border-[#333] hover:border-yellow-500 rounded-lg text-left transition-all"
                >
                  <div className="text-2xl mb-2">💾</div>
                  <div className="font-medium text-white">Storage</div>
                  <div className="text-xs text-gray-500">Cache y limpieza</div>
                </button>
              </div>
            </div>
          </div>
        )}

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

                {/* Format Tabs */}
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setSeedImageFormat('16:9')}
                    className={`px-4 py-2 rounded font-medium transition-colors ${seedImageFormat === '16:9' ? 'bg-yellow-500 text-black' : 'bg-[#222] text-gray-400 hover:bg-[#333]'}`}
                  >
                    📺 16:9 (Landscape)
                  </button>
                  <button
                    onClick={() => setSeedImageFormat('9:16')}
                    className={`px-4 py-2 rounded font-medium transition-colors ${seedImageFormat === '9:16' ? 'bg-yellow-500 text-black' : 'bg-[#222] text-gray-400 hover:bg-[#333]'}`}
                  >
                    📱 9:16 (Vertical)
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  {/* Host A Solo */}
                  <div className="border border-[#333] rounded-lg p-4">
                    <label className="text-sm text-gray-400 block mb-1">
                      Seed Image: Host A Solo ({seedImageFormat})
                    </label>
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
                                const imageDataUrl = await generateSeedImage(prompt, seedImageFormat);
                                if (imageDataUrl) {
                                  // Upload to storage with format suffix
                                  const formatSuffix = seedImageFormat === '9:16' ? '-9x16' : '';
                                  const fileName = `seed-hostA${formatSuffix}-${activeChannel?.id || 'default'}-${Date.now()}.png`;
                                  const uploadedUrl = await uploadImageToStorage(imageDataUrl, fileName);
                                  if (uploadedUrl) {
                                    const urlKey = seedImageFormat === '9:16' ? 'hostASoloUrl_9_16' : 'hostASoloUrl';
                                    setTempConfig(prev => ({
                                      ...prev,
                                      seedImages: {
                                        ...prev.seedImages,
                                        [urlKey]: uploadedUrl
                                      }
                                    }));
                                    toast.success(`Host A ${seedImageFormat} image generated & saved!`);
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
                      {/* Show image for current format */}
                      {(seedImageFormat === '16:9' ? tempConfig.seedImages?.hostASoloUrl : tempConfig.seedImages?.hostASoloUrl_9_16) && (
                        <div className={`${seedImageFormat === '9:16' ? 'w-20 h-36' : 'w-32 h-20'} rounded-lg overflow-hidden border border-[#333] flex-shrink-0 relative group`}>
                          <img 
                            src={seedImageFormat === '16:9' ? tempConfig.seedImages?.hostASoloUrl : tempConfig.seedImages?.hostASoloUrl_9_16} 
                            alt="Host A" 
                            className="w-full h-full object-cover" 
                          />
                          <button
                            onClick={() => {
                              const urlKey = seedImageFormat === '9:16' ? 'hostASoloUrl_9_16' : 'hostASoloUrl';
                              setTempConfig(prev => ({
                                ...prev,
                                seedImages: { ...prev.seedImages, [urlKey]: undefined }
                              }));
                            }}
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
                    <label className="text-sm text-gray-400 block mb-1">
                      Seed Image: Host B Solo ({seedImageFormat})
                    </label>
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
                                const imageDataUrl = await generateSeedImage(prompt, seedImageFormat);
                                if (imageDataUrl) {
                                  const formatSuffix = seedImageFormat === '9:16' ? '-9x16' : '';
                                  const fileName = `seed-hostB${formatSuffix}-${activeChannel?.id || 'default'}-${Date.now()}.png`;
                                  const uploadedUrl = await uploadImageToStorage(imageDataUrl, fileName);
                                  if (uploadedUrl) {
                                    const urlKey = seedImageFormat === '9:16' ? 'hostBSoloUrl_9_16' : 'hostBSoloUrl';
                                    setTempConfig(prev => ({
                                      ...prev,
                                      seedImages: {
                                        ...prev.seedImages,
                                        [urlKey]: uploadedUrl
                                      }
                                    }));
                                    toast.success(`Host B ${seedImageFormat} image generated & saved!`);
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
                      {/* Show image for current format */}
                      {(seedImageFormat === '16:9' ? tempConfig.seedImages?.hostBSoloUrl : tempConfig.seedImages?.hostBSoloUrl_9_16) && (
                        <div className={`${seedImageFormat === '9:16' ? 'w-20 h-36' : 'w-32 h-20'} rounded-lg overflow-hidden border border-[#333] flex-shrink-0 relative group`}>
                          <img 
                            src={seedImageFormat === '16:9' ? tempConfig.seedImages?.hostBSoloUrl : tempConfig.seedImages?.hostBSoloUrl_9_16} 
                            alt="Host B" 
                            className="w-full h-full object-cover" 
                          />
                          <button
                            onClick={() => {
                              const urlKey = seedImageFormat === '9:16' ? 'hostBSoloUrl_9_16' : 'hostBSoloUrl';
                              setTempConfig(prev => ({
                                ...prev,
                                seedImages: { ...prev.seedImages, [urlKey]: undefined }
                              }));
                            }}
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
                    <label className="text-sm text-gray-400 block mb-1">
                      Seed Image: Two-Shot / Both Hosts ({seedImageFormat})
                    </label>
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
                                const imageDataUrl = await generateSeedImage(prompt, seedImageFormat);
                                if (imageDataUrl) {
                                  const formatSuffix = seedImageFormat === '9:16' ? '-9x16' : '';
                                  const fileName = `seed-twoshot${formatSuffix}-${activeChannel?.id || 'default'}-${Date.now()}.png`;
                                  const uploadedUrl = await uploadImageToStorage(imageDataUrl, fileName);
                                  if (uploadedUrl) {
                                    const urlKey = seedImageFormat === '9:16' ? 'twoShotUrl_9_16' : 'twoShotUrl';
                                    setTempConfig(prev => ({
                                      ...prev,
                                      seedImages: {
                                        ...prev.seedImages,
                                        [urlKey]: uploadedUrl
                                      }
                                    }));
                                    toast.success(`Two-shot ${seedImageFormat} image generated & saved!`);
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
                      {/* Show image for current format */}
                      {(seedImageFormat === '16:9' ? tempConfig.seedImages?.twoShotUrl : tempConfig.seedImages?.twoShotUrl_9_16) && (
                        <div className={`${seedImageFormat === '9:16' ? 'w-20 h-36' : 'w-40 h-24'} rounded-lg overflow-hidden border border-[#333] flex-shrink-0 relative group`}>
                          <img 
                            src={seedImageFormat === '16:9' ? tempConfig.seedImages?.twoShotUrl : tempConfig.seedImages?.twoShotUrl_9_16} 
                            alt="Two-Shot" 
                            className="w-full h-full object-cover" 
                          />
                          <button
                            onClick={() => {
                              const urlKey = seedImageFormat === '9:16' ? 'twoShotUrl_9_16' : 'twoShotUrl';
                              setTempConfig(prev => ({
                                ...prev,
                                seedImages: { ...prev.seedImages, [urlKey]: undefined }
                              }));
                            }}
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
                        const formatSuffix = seedImageFormat === '9:16' ? '-9x16' : '';
                        const fileName = `seed-${currentUploadType}${formatSuffix}-${activeChannel?.id || 'default'}-${Date.now()}.png`;
                        const uploadedUrl = await uploadImageToStorage(dataUrl, fileName);
                        
                        if (uploadedUrl) {
                          // Determine URL key based on upload type AND format
                          let urlKey: string;
                          if (seedImageFormat === '9:16') {
                            urlKey = currentUploadType === 'hostASolo' ? 'hostASoloUrl_9_16' 
                              : currentUploadType === 'hostBSolo' ? 'hostBSoloUrl_9_16' 
                              : 'twoShotUrl_9_16';
                          } else {
                            urlKey = currentUploadType === 'hostASolo' ? 'hostASoloUrl' 
                              : currentUploadType === 'hostBSolo' ? 'hostBSoloUrl' 
                              : 'twoShotUrl';
                          }
                          
                          // Use function form to get latest state
                          setTempConfig(prev => ({
                            ...prev,
                            seedImages: {
                              ...prev.seedImages,
                              [urlKey]: uploadedUrl
                            }
                          }));
                          toast.success(`Image uploaded for ${seedImageFormat} format!`);
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
            {/* Header & Filters */}
            <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <span>📦</span>
                  <span>Production Studio</span>
                </h3>
                <div className="flex gap-2 flex-wrap">
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
                            toast.success('Production imported!');
                            refreshProductions();
                          } else {
                            toast.error('Failed to import');
                          }
                        } catch (error) {
                          toast.error('Invalid file format');
                        }
                      };
                      input.click();
                    }}
                    className="bg-green-600 hover:bg-green-500 px-3 py-1.5 rounded-lg text-sm font-bold"
                  >
                    📤 Import
                  </button>
                  {(['all', 'incomplete', 'completed', 'failed', 'published'] as const).map(filter => (
                    <button
                      key={filter}
                      onClick={() => setProductionFilter(filter)}
                      className={`px-3 py-1 rounded text-sm font-semibold transition-all ${
                        productionFilter === filter
                          ? filter === 'incomplete' ? 'bg-yellow-600 text-white'
                            : filter === 'completed' ? 'bg-green-600 text-white'
                            : filter === 'failed' ? 'bg-red-600 text-white'
                            : filter === 'published' ? 'bg-emerald-600 text-white'
                            : 'bg-blue-600 text-white'
                          : 'bg-[#222] text-gray-400 hover:text-white'
                      }`}
                    >
                      {filter === 'published' ? '📺 ' : ''}{filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

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
                  title={`No ${productionFilter === 'all' ? '' : productionFilter} Productions`}
                  description="No productions found with this filter."
                />
              ) : (
                <div className="space-y-4">
                  {productions.map((production) => {
                    const isExpanded = expandedProductions.has(production.id);
                    const segmentStatus = production.segment_status || {};
                    const segments = production.segments || [];
                    const scenes = production.scenes?.scenes || {};
                    const totalSegments = segments.length || Object.keys(segmentStatus).length;
                    
                    // Calculate stats
                    const audiosDone = Object.values(segmentStatus).filter(s => s?.audio === 'done').length;
                    const videosDone = Object.values(segmentStatus).filter(s => s?.video === 'done').length;
                    const audiosFailed = Object.values(segmentStatus).filter(s => s?.audio === 'failed').length;
                    const videosFailed = Object.values(segmentStatus).filter(s => s?.video === 'failed').length;
                    const progressPercent = totalSegments > 0 
                      ? ((audiosDone + videosDone) / (totalSegments * 2)) * 100 
                      : (production.progress_step / 6) * 100;
                    
                    return (
                      <div
                        key={production.id}
                        className={`rounded-xl border overflow-hidden transition-all duration-300 ${
                          production.status === 'in_progress' 
                            ? 'bg-gradient-to-br from-[#1a1a2e] to-[#16213e] border-yellow-500/40 shadow-lg shadow-yellow-500/5' 
                            : production.status === 'completed'
                            ? 'bg-gradient-to-br from-[#1a2e1a] to-[#162e16] border-green-500/40'
                            : production.status === 'failed'
                            ? 'bg-gradient-to-br from-[#2e1a1a] to-[#2e1616] border-red-500/40'
                            : 'bg-[#111] border-[#333]'
                        }`}
                      >
                        {/* Card Header - Clickable */}
                        <div 
                          className="p-4 cursor-pointer hover:bg-white/5 transition-colors"
                          onClick={() => {
                            setExpandedProductions(prev => {
                              const next = new Set(prev);
                              if (next.has(production.id)) next.delete(production.id);
                              else next.add(production.id);
                              return next;
                            });
                          }}
                        >
                          <div className="flex items-center justify-between">
                            {/* Left: Status & Info */}
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                                production.status === 'in_progress' ? 'bg-yellow-400 animate-pulse' :
                                production.status === 'completed' ? 'bg-green-400' :
                                production.status === 'failed' ? 'bg-red-400' : 'bg-gray-400'
                              }`} />
                              
                              <div className="min-w-0 flex-1">
                                <h4 className="font-bold text-white truncate">
                                  {production.viral_metadata?.title || `Production ${production.id.slice(0, 8)}`}
                                </h4>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="text-xs text-gray-500">
                                    {new Date(production.news_date).toLocaleDateString()}
                                  </span>
                                  {production.version && production.version > 1 && (
                                    <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">v{production.version}</span>
                                  )}
                                  {production.narrative_used && (
                                    <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded">{production.narrative_used}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            {/* Right: Progress indicators */}
                            <div className="flex items-center gap-4 flex-shrink-0">
                              {/* Asset pills */}
                              <div className="hidden md:flex gap-2">
                                <span className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                                  audiosDone === totalSegments && totalSegments > 0 ? 'bg-green-500/20 text-green-400' : 
                                  audiosFailed > 0 ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
                                }`}>
                                  🔊 {audiosDone}/{totalSegments}
                                </span>
                                <span className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                                  videosDone === totalSegments && totalSegments > 0 ? 'bg-green-500/20 text-green-400' : 
                                  videosFailed > 0 ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
                                }`}>
                                  🎥 {videosDone}/{totalSegments}
                                </span>
                              </div>
                              
                              {/* Progress bar */}
                              <div className="w-24 h-2 bg-[#111] rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all ${
                                    production.status === 'completed' ? 'bg-gradient-to-r from-green-500 to-emerald-400' :
                                    production.status === 'failed' ? 'bg-red-500' : 'bg-gradient-to-r from-yellow-500 to-orange-400'
                                  }`}
                                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-mono text-gray-400 w-10">{Math.round(progressPercent)}%</span>
                              
                              {/* Expand arrow */}
                              <span className={`text-gray-400 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Expanded Content - Assets Details */}
                        {isExpanded && (
                          <div className="border-t border-[#333]">
                            {/* Asset Cards Grid */}
                            <div className="p-4">
                              <h5 className="text-sm font-bold text-gray-300 mb-3 flex items-center gap-2">
                                📦 Assets por Segmento
                                <span className="text-xs font-normal text-gray-500">
                                  ({totalSegments} segments • {audiosDone} audios • {videosDone} videos)
                                </span>
                              </h5>
                              
                              {totalSegments === 0 ? (
                                <div className="text-center py-6 text-gray-500">
                                  No segments generated yet. Resume production to create assets.
                                </div>
                              ) : (
                                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                                  {Array.from({ length: totalSegments }, (_, i) => {
                                    const status = segmentStatus[i] || { audio: 'pending', video: 'pending' };
                                    const segment = segments[i];
                                    const scene = scenes[String(i + 1)];
                                    const speaker = segment?.speaker || scene?.video_mode || 'Unknown';
                                    const text = segment?.text || scene?.text || '';
                                    const duration = segment?.audioDuration;
                                    const audioId = `audio-${production.id}-${i}`;
                                    
                                    // Speaker color
                                    const isHostA = speaker.toLowerCase().includes('hosta') || speaker.toLowerCase().includes('rusty') || speaker === 'hostA';
                                    const isHostB = speaker.toLowerCase().includes('hostb') || speaker.toLowerCase().includes('dani') || speaker === 'hostB';
                                    const speakerColor = isHostA 
                                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                                      : isHostB
                                      ? 'bg-pink-500/20 text-pink-400 border-pink-500/30'
                                      : 'bg-gray-500/20 text-gray-400 border-gray-500/30';
                                    
                                    return (
                                      <div 
                                        key={i} 
                                        className={`bg-[#0d0d0d] rounded-lg border transition-all hover:border-[#444] ${
                                          status.audio === 'failed' || status.video === 'failed' 
                                            ? 'border-red-500/40' 
                                            : 'border-[#222]'
                                        }`}
                                      >
                                        {/* Segment Header */}
                                        <div className="p-3 border-b border-[#222]">
                                          <div className="flex items-center justify-between flex-wrap gap-2">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-sm font-bold text-white">#{i + 1}</span>
                                              <span className={`text-xs px-2 py-0.5 rounded border ${speakerColor}`}>
                                                🎙️ {speaker}
                                              </span>
                                              {scene?.shot && (
                                                <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">
                                                  📷 {scene.shot}
                                                </span>
                                              )}
                                              {duration && (
                                                <span className="text-xs text-gray-500">⏱️ {duration.toFixed(1)}s</span>
                                              )}
                                            </div>
                                            {scene?.title && (
                                              <span className="text-xs text-gray-500 truncate max-w-[200px]" title={scene.title}>
                                                "{scene.title}"
                                              </span>
                                            )}
                                          </div>
                                          
                                          {/* Text Preview */}
                                          {text && (
                                            <p className="text-xs text-gray-400 mt-2 line-clamp-2 italic">
                                              "{text.substring(0, 150)}{text.length > 150 ? '...' : ''}"
                                            </p>
                                          )}
                                        </div>
                                        
                                        {/* Assets Row */}
                                        <div className="p-3 grid grid-cols-2 gap-3">
                                          {/* Audio Asset */}
                                          <div className={`p-2 rounded border ${
                                            status.audio === 'done' ? 'bg-green-500/5 border-green-500/30' :
                                            status.audio === 'generating' ? 'bg-yellow-500/5 border-yellow-500/30' :
                                            status.audio === 'failed' ? 'bg-red-500/5 border-red-500/30' :
                                            'bg-[#111] border-[#333]'
                                          }`}>
                                            <div className="flex items-center justify-between mb-2">
                                              <span className="text-xs font-medium text-gray-300">🔊 Audio</span>
                                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                                status.audio === 'done' ? 'bg-green-500/20 text-green-400' :
                                                status.audio === 'generating' ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' :
                                                status.audio === 'failed' ? 'bg-red-500/20 text-red-400' :
                                                'bg-gray-500/20 text-gray-500'
                                              }`}>
                                                {status.audio === 'done' ? '✓' : status.audio === 'generating' ? '⏳' : status.audio === 'failed' ? '✗' : '○'}
                                              </span>
                                            </div>
                                            
                                            {/* Audio Controls */}
                                            <div className="flex gap-1">
                                              {status.audioUrl && (
                                                <>
                                                  <audio 
                                                    id={audioId} 
                                                    src={status.audioUrl} 
                                                    className="hidden"
                                                    onEnded={() => setPlayingAudio(null)}
                                                    ref={el => { if (el) audioRefs.current[audioId] = el; }}
                                                  />
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      const audio = audioRefs.current[audioId];
                                                      if (!audio) return;
                                                      if (playingAudio === audioId) {
                                                        audio.pause();
                                                        setPlayingAudio(null);
                                                      } else {
                                                        // Pause any currently playing
                                                        Object.values(audioRefs.current).forEach(a => a?.pause());
                                                        audio.play();
                                                        setPlayingAudio(audioId);
                                                      }
                                                    }}
                                                    className={`flex-1 text-white text-xs py-1 px-2 rounded flex items-center justify-center gap-1 ${
                                                      playingAudio === audioId ? 'bg-yellow-600' : 'bg-gray-700 hover:bg-gray-600'
                                                    }`}
                                                  >
                                                    {playingAudio === audioId ? '⏸ Pause' : '▶️ Play'}
                                                  </button>
                                                  <button
                                                    onClick={() => window.open(status.audioUrl, '_blank')}
                                                    className="bg-gray-700 hover:bg-gray-600 text-white text-xs py-1 px-2 rounded"
                                                    title="Download"
                                                  >
                                                    📥
                                                  </button>
                                                </>
                                              )}
                                              <button
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  if (confirm(`Regenerar audio del segmento ${i + 1}?`)) {
                                                    await updateSegmentStatus(production.id, i, { audio: 'pending', audioUrl: undefined });
                                                    toast.success('Audio marcado para regeneración');
                                                    refreshProductions();
                                                  }
                                                }}
                                                className="bg-orange-600/50 hover:bg-orange-600 text-white text-xs py-1 px-2 rounded"
                                                title="Regenerate"
                                              >
                                                🔄
                                              </button>
                                            </div>
                                          </div>
                                          
                                          {/* Video Asset */}
                                          <div className={`p-2 rounded border ${
                                            status.video === 'done' ? 'bg-green-500/5 border-green-500/30' :
                                            status.video === 'generating' ? 'bg-yellow-500/5 border-yellow-500/30' :
                                            status.video === 'failed' ? 'bg-red-500/5 border-red-500/30' :
                                            'bg-[#111] border-[#333]'
                                          }`}>
                                            <div className="flex items-center justify-between mb-2">
                                              <span className="text-xs font-medium text-gray-300">🎥 Video</span>
                                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                                status.video === 'done' ? 'bg-green-500/20 text-green-400' :
                                                status.video === 'generating' ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' :
                                                status.video === 'failed' ? 'bg-red-500/20 text-red-400' :
                                                'bg-gray-500/20 text-gray-500'
                                              }`}>
                                                {status.video === 'done' ? '✓' : status.video === 'generating' ? '⏳' : status.video === 'failed' ? '✗' : '○'}
                                              </span>
                                            </div>
                                            
                                            {/* Video Controls */}
                                            <div className="flex gap-1">
                                              {status.videoUrl && (
                                                <button
                                                  onClick={() => window.open(status.videoUrl, '_blank')}
                                                  className="flex-1 bg-purple-700 hover:bg-purple-600 text-white text-xs py-1 px-2 rounded flex items-center justify-center gap-1"
                                                >
                                                  👁️ Ver
                                                </button>
                                              )}
                                              <button
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  if (status.audio !== 'done') {
                                                    toast.error('Necesitas el audio primero');
                                                    return;
                                                  }
                                                  if (confirm(`Regenerar video del segmento ${i + 1}?`)) {
                                                    await updateSegmentStatus(production.id, i, { video: 'pending', videoUrl: undefined });
                                                    toast.success('Video marcado para regeneración');
                                                    refreshProductions();
                                                  }
                                                }}
                                                disabled={status.audio !== 'done'}
                                                className="bg-orange-600/50 hover:bg-orange-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs py-1 px-2 rounded"
                                                title={status.audio !== 'done' ? 'Audio requerido' : 'Regenerate'}
                                              >
                                                🔄
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                        
                                        {/* Error message */}
                                        {status.error && (
                                          <div className="px-3 pb-2">
                                            <p className="text-xs text-red-400 bg-red-500/10 p-2 rounded">⚠️ {status.error}</p>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              
                              {/* Bulk Actions for failed */}
                              {(audiosFailed > 0 || videosFailed > 0) && (
                                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
                                  <span className="text-sm text-red-300">
                                    ⚠️ {audiosFailed + videosFailed} assets fallidos
                                  </span>
                                  <button
                                    onClick={async () => {
                                      for (const [idx, s] of Object.entries(segmentStatus)) {
                                        if (s?.audio === 'failed') {
                                          await updateSegmentStatus(production.id, parseInt(idx), { audio: 'pending' });
                                        }
                                        if (s?.video === 'failed') {
                                          await updateSegmentStatus(production.id, parseInt(idx), { video: 'pending' });
                                        }
                                      }
                                      toast.success('Assets fallidos marcados para regeneración');
                                      refreshProductions();
                                    }}
                                    className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded text-sm font-medium"
                                  >
                                    🔄 Regenerar Fallidos
                                  </button>
                                </div>
                              )}
                            </div>
                            
                            {/* Action Bar */}
                            <div className="border-t border-[#333] p-4 bg-[#0a0a0a] flex flex-wrap gap-2">
                              {onResumeProduction && (production.status === 'in_progress' || production.status === 'draft' || production.status === 'failed') && (
                                <button
                                  onClick={() => { onResumeProduction(production); onExit(); }}
                                  className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-blue-500/20"
                                >
                                  ▶️ Retomar
                                </button>
                              )}
                              
                              {hasVideosForRender(production) && (
                                <button
                                  onClick={async () => {
                                    const toastId = toast.loading('🎬 Rendering...');
                                    const result = await renderProductionToShotstack(production, activeChannel?.name, config.format);
                                    toast.dismiss(toastId);
                                    if (result.success && result.videoUrl) {
                                      toast.success('¡Video listo!');
                                      window.open(result.videoUrl, '_blank');
                                    } else {
                                      toast.error(result.error || 'Error');
                                    }
                                  }}
                                  className="bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg shadow-cyan-500/20"
                                >
                                  🎬 Render Final
                                </button>
                              )}
                              
                              <button
                                onClick={async () => {
                                  const json = await exportProduction(production.id);
                                  if (json) {
                                    const blob = new Blob([json], { type: 'application/json' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = `production-${production.id.slice(0, 8)}.json`;
                                    a.click();
                                    URL.revokeObjectURL(url);
                                    toast.success('Exported!');
                                  }
                                }}
                                className="bg-purple-600 hover:bg-purple-500 text-white px-3 py-2 rounded-lg text-sm font-medium"
                              >
                                📥 Export
                              </button>
                              
                              <button
                                onClick={async () => {
                                  const newVersion = await createProductionVersion(production.id, user?.email);
                                  if (newVersion) {
                                    toast.success(`v${newVersion.version} created!`);
                                    refreshProductions();
                                  }
                                }}
                                className="bg-orange-600 hover:bg-orange-500 text-white px-3 py-2 rounded-lg text-sm font-medium"
                              >
                                🔄 New Version
                              </button>
                              
                              <button
                                onClick={async () => {
                                  if (confirm('¿Eliminar producción?')) {
                                    await deleteProduction(production.id);
                                    toast.success('Eliminada');
                                    refreshProductions();
                                  }
                                }}
                                className="bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white px-3 py-2 rounded-lg text-sm font-medium ml-auto"
                              >
                                🗑️ Eliminar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
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