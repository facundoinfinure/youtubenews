/**
 * Header Component
 * 
 * App header with logo, channel selector, and user info.
 */

import React from 'react';
import { ChannelConfig, Channel, UserProfile } from '../types';

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
