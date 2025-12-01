
import React, { useState, useEffect } from 'react';
import { ChannelConfig, CharacterProfile, StoredVideo } from '../types';
import { fetchVideosFromDB, saveConfigToDB } from '../services/supabaseService';

interface AdminDashboardProps {
  config: ChannelConfig;
  onUpdateConfig: (newConfig: ChannelConfig) => void;
  onExit: () => void;
}

const CharacterEditor: React.FC<{
  profile: CharacterProfile;
  onChange: (p: CharacterProfile) => void;
  label: string;
}> = ({ profile, onChange, label }) => {
  return (
    <div className="bg-[#1a1a1a] p-4 rounded-lg border border-[#333] space-y-3">
      <h4 className="text-yellow-500 font-bold uppercase text-sm border-b border-[#333] pb-2">{label}</h4>
      
      <div>
        <label className="text-xs text-gray-500 block mb-1">Name</label>
        <input 
          type="text" value={profile.name} 
          onChange={(e) => onChange({...profile, name: e.target.value})}
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white"
        />
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Bio / Politics</label>
        <textarea 
          value={profile.bio} 
          onChange={(e) => onChange({...profile, bio: e.target.value})}
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white h-16"
        />
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Visual Prompt (Veo)</label>
        <textarea 
          value={profile.visualPrompt} 
          onChange={(e) => onChange({...profile, visualPrompt: e.target.value})}
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white h-20"
        />
      </div>

      <div>
        <label className="text-xs text-gray-500 block mb-1">Voice ID</label>
        <select 
          value={profile.voiceName} 
          onChange={(e) => onChange({...profile, voiceName: e.target.value})}
          className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-sm text-white"
        >
          <option value="Puck">Puck (Male, Soft)</option>
          <option value="Charon">Charon (Male, Deep)</option>
          <option value="Kore">Kore (Female, Calm)</option>
          <option value="Fenrir">Fenrir (Male, Intense)</option>
          <option value="Zephyr">Zephyr (Female, Bright)</option>
        </select>
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
        return `${x},${y}`;
    }).join(' ');

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
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
                points={`0,${height} ${points} ${width},${height}`} 
            />
        </svg>
    );
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ config, onUpdateConfig, onExit }) => {
  const [tempConfig, setTempConfig] = useState<ChannelConfig>(config);
  const [activeTab, setActiveTab] = useState<'insights' | 'settings'>('insights');
  const [videos, setVideos] = useState<StoredVideo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<StoredVideo | null>(null);

  useEffect(() => {
    if (activeTab === 'insights') {
        fetchVideosFromDB().then(setVideos);
    }
  }, [activeTab]);

  const handleSave = async () => {
    onUpdateConfig(tempConfig);
    await saveConfigToDB(tempConfig);
    alert("Configuration Saved & Synced to Database!");
  };

  return (
    <div className="w-full min-h-screen bg-[#0f0f0f] text-white p-6 md:p-12 font-sans">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="flex justify-between items-center mb-8 border-b border-[#333] pb-4">
          <div>
            <h1 className="text-3xl font-bold">Admin Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">Manage production settings and analyze performance</p>
          </div>
          <div className="flex gap-4">
            <button onClick={onExit} className="text-gray-400 hover:text-white">Exit to App</button>
            <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-full font-bold">Save Changes</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 mb-8">
          <button 
            onClick={() => setActiveTab('insights')} 
            className={`pb-2 border-b-2 font-medium ${activeTab === 'insights' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500'}`}
          >
            Performance Insights
          </button>
          <button 
            onClick={() => setActiveTab('settings')} 
            className={`pb-2 border-b-2 font-medium ${activeTab === 'settings' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500'}`}
          >
            Production Settings
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
                    {videos.map(vid => (
                        <div 
                            key={vid.id} 
                            onClick={() => setSelectedVideo(vid)}
                            className={`p-4 border-b border-[#333] cursor-pointer hover:bg-[#2a2a2a] transition-colors ${selectedVideo?.id === vid.id ? 'bg-[#2a2a2a] border-l-4 border-l-blue-500' : ''}`}
                        >
                            <h4 className="font-bold text-sm line-clamp-2 mb-1">{vid.title}</h4>
                            <div className="flex justify-between text-xs text-gray-500">
                                <span>{new Date(vid.created_at).toLocaleDateString()}</span>
                                <span>{vid.analytics?.views.toLocaleString()} views</span>
                            </div>
                        </div>
                    ))}
                    {videos.length === 0 && (
                        <div className="p-8 text-center text-gray-500 text-sm">No videos found in database.</div>
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
                    </>
                ) : (
                    <div className="bg-[#1a1a1a] rounded-xl border border-[#333] h-full flex items-center justify-center text-gray-500">
                        Select a video to view performance insights.
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
                  <input type="text" value={tempConfig.channelName} onChange={e => setTempConfig({...tempConfig, channelName: e.target.value})} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white"/>
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Tagline</label>
                  <input type="text" value={tempConfig.tagline} onChange={e => setTempConfig({...tempConfig, tagline: e.target.value})} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white"/>
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Primary Color (Hex)</label>
                  <div className="flex gap-2">
                    <input type="color" value={tempConfig.logoColor1} onChange={e => setTempConfig({...tempConfig, logoColor1: e.target.value})} className="h-10 w-10 bg-transparent border-none"/>
                    <input type="text" value={tempConfig.logoColor1} onChange={e => setTempConfig({...tempConfig, logoColor1: e.target.value})} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white"/>
                  </div>
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Secondary Color (Hex)</label>
                  <div className="flex gap-2">
                    <input type="color" value={tempConfig.logoColor2} onChange={e => setTempConfig({...tempConfig, logoColor2: e.target.value})} className="h-10 w-10 bg-transparent border-none"/>
                    <input type="text" value={tempConfig.logoColor2} onChange={e => setTempConfig({...tempConfig, logoColor2: e.target.value})} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white"/>
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
                    <input type="text" value={tempConfig.country} onChange={e => setTempConfig({...tempConfig, country: e.target.value})} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white"/>
                 </div>
                 <div>
                    <label className="text-sm text-gray-400 block mb-1">Language</label>
                    <select value={tempConfig.language} onChange={e => setTempConfig({...tempConfig, language: e.target.value})} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white">
                       <option value="English">English</option>
                       <option value="Spanish">Spanish</option>
                       <option value="Portuguese">Portuguese</option>
                       <option value="French">French</option>
                    </select>
                 </div>
                 <div>
                    <label className="text-sm text-gray-400 block mb-1">Overall Tone</label>
                    <input type="text" value={tempConfig.tone} onChange={e => setTempConfig({...tempConfig, tone: e.target.value})} className="w-full bg-[#111] border border-[#333] p-2 rounded text-white"/>
                 </div>
                 <div>
                    <label className="text-sm text-gray-400 block mb-1">Video Format</label>
                    <div className="flex gap-4 mt-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name="format" checked={tempConfig.format === '16:9'} onChange={() => setTempConfig({...tempConfig, format: '16:9'})} />
                            Landscape (16:9)
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name="format" checked={tempConfig.format === '9:16'} onChange={() => setTempConfig({...tempConfig, format: '9:16'})} />
                            Shorts (9:16)
                        </label>
                    </div>
                 </div>
                 <div className="flex items-center gap-2 mt-6">
                    <input type="checkbox" checked={tempConfig.captionsEnabled} onChange={e => setTempConfig({...tempConfig, captionsEnabled: e.target.checked})} className="w-5 h-5"/>
                    <label className="text-sm text-white">Enable Auto-Captions</label>
                 </div>
              </div>
            </div>

            {/* Characters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <CharacterEditor 
                  label="Host A (Left)" 
                  profile={tempConfig.characters.hostA} 
                  onChange={(p) => setTempConfig({...tempConfig, characters: {...tempConfig.characters, hostA: p}})}
               />
               <CharacterEditor 
                  label="Host B (Right)" 
                  profile={tempConfig.characters.hostB} 
                  onChange={(p) => setTempConfig({...tempConfig, characters: {...tempConfig.characters, hostB: p}})}
               />
            </div>

          </div>
        )}
      </div>
    </div>
  );
};