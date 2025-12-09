/**
 * Header Component
 * 
 * App header with logo, channel selector, and user info.
 */

import React from 'react';
import { ChannelConfig, Channel, UserProfile } from '../types';
import { connectYouTube } from '../services/supabaseService';
import toast from 'react-hot-toast';

interface HeaderProps {
  config: ChannelConfig;
  user: UserProfile | null;
  channels: Channel[];
  activeChannel: Channel | null;
  uploadStatus: string | null;
  onAdminClick: () => void;
  onChannelChange: (channel: Channel) => void;
}

export const Header: React.FC<HeaderProps> = ({
  config,
  user,
  channels,
  activeChannel,
  uploadStatus,
  onAdminClick,
  onChannelChange
}) => {
  return (
    <header className="bg-[#0f0f0f] px-3 sm:px-6 py-2 sm:py-3 flex justify-between items-center sticky top-0 z-50 border-b border-[#272727]">
      {/* Left Side - Logo */}
      <div className="flex items-center gap-2 sm:gap-4">
        <button className="text-white p-1.5 sm:p-2 hover:bg-[#272727] rounded-full hidden sm:block">
          <svg viewBox="0 0 24 24" className="w-5 h-5 sm:w-6 sm:h-6 fill-current">
            <path d="M21 6H3V5h18v1zm0 5H3v1h18v-1zm0 6H3v1h18v-1z" />
          </svg>
        </button>
        <div className="flex items-center gap-1 cursor-pointer">
          <div className="w-6 h-5 sm:w-8 sm:h-6 bg-red-600 rounded-lg flex items-center justify-center relative">
            <div className="w-0 h-0 border-t-[2px] sm:border-t-[3px] border-t-transparent border-l-[4px] sm:border-l-[6px] border-l-white border-b-[2px] sm:border-b-[3px] border-b-transparent ml-0.5" />
          </div>
          <span className="font-headline text-base sm:text-xl ml-1 truncate max-w-[100px] sm:max-w-none">{config.channelName}</span>
        </div>
      </div>

      {/* Right Side - Controls */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Upload Status - Hidden on very small screens */}
        {uploadStatus && (
          <div className="hidden sm:block text-xs font-mono bg-blue-900/50 text-blue-200 px-2 sm:px-3 py-1 rounded border border-blue-500/30 animate-pulse">
            {uploadStatus}
          </div>
        )}

        {/* Admin Button */}
        {user && (
          <button onClick={onAdminClick} className="btn-secondary text-xs sm:text-sm px-2 sm:px-4 py-1 sm:py-2">
            <span className="hidden sm:inline">ADMIN</span>
            <span className="sm:hidden">⚙️</span>
          </button>
        )}

        {/* Channel Selector */}
        {user && channels.length > 0 && (
          <div className="flex items-center">
            <select
              value={activeChannel?.id || ''}
              onChange={(e) => {
                const selected = channels.find(c => c.id === e.target.value);
                if (selected) {
                  onChannelChange(selected);
                }
              }}
              className="bg-[#1a1a1a] border border-[#333] rounded px-2 sm:px-3 py-1 sm:py-1.5 text-white text-xs sm:text-sm focus:outline-none focus:border-blue-500 max-w-[100px] sm:max-w-none"
              disabled={!activeChannel && channels.length === 0}
            >
              {channels.length === 0 ? (
                <option value="">No channels</option>
              ) : (
                channels.map(ch => (
                  <option key={ch.id} value={ch.id}>{ch.name}</option>
                ))
              )}
            </select>
          </div>
        )}

        {/* YouTube Connection Status */}
        {user && (
          <button
            onClick={async () => {
              if (user.accessToken) {
                toast.success('YouTube ya está conectado');
              } else {
                try {
                  await connectYouTube();
                } catch (error) {
                  toast.error('Error conectando YouTube');
                }
              }
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
              user.accessToken 
                ? 'bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/30' 
                : 'bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 animate-pulse'
            }`}
            title={user.accessToken ? 'YouTube conectado' : 'Clic para conectar YouTube'}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
            <span className="hidden sm:inline">{user.accessToken ? '✓' : 'Conectar'}</span>
          </button>
        )}

        {/* User Info - Simplified on mobile */}
        {user && (
          <div className="flex items-center gap-1 sm:gap-2 bg-[#222] rounded-full pr-2 sm:pr-4 pl-1 py-1 border border-[#333]">
            <img src={user.picture} alt={user.name} className="w-5 h-5 sm:w-6 sm:h-6 rounded-full" />
            <span className="hidden sm:inline text-xs font-bold text-gray-300">{user.name}</span>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
