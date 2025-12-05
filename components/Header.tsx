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
    <header className="bg-[#0f0f0f] px-6 py-3 flex justify-between items-center sticky top-0 z-50 border-b border-[#272727]">
      {/* Left Side - Logo */}
      <div className="flex items-center gap-4">
        <button className="text-white p-2 hover:bg-[#272727] rounded-full">
          <svg viewBox="0 0 24 24" className="w-6 h-6 fill-current">
            <path d="M21 6H3V5h18v1zm0 5H3v1h18v-1zm0 6H3v1h18v-1z" />
          </svg>
        </button>
        <div className="flex items-center gap-1 cursor-pointer">
          <div className="w-8 h-6 bg-red-600 rounded-lg flex items-center justify-center relative">
            <div className="w-0 h-0 border-t-[3px] border-t-transparent border-l-[6px] border-l-white border-b-[3px] border-b-transparent ml-0.5" />
          </div>
          <span className="font-headline text-xl ml-1">{config.channelName}</span>
        </div>
      </div>

      {/* Right Side - Controls */}
      <div className="flex items-center gap-4">
        {/* Upload Status */}
        {uploadStatus && (
          <div className="text-xs font-mono bg-blue-900/50 text-blue-200 px-3 py-1 rounded border border-blue-500/30 animate-pulse">
            {uploadStatus}
          </div>
        )}

        {/* Admin Button */}
        {user && (
          <button onClick={onAdminClick} className="btn-secondary">
            ADMIN
          </button>
        )}

        {/* Channel Selector */}
        {user && channels.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={activeChannel?.id || ''}
              onChange={(e) => {
                const selected = channels.find(c => c.id === e.target.value);
                if (selected) {
                  onChannelChange(selected);
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

        {/* User Info */}
        {user && (
          <div className="flex items-center gap-2 bg-[#222] rounded-full pr-4 pl-1 py-1 border border-[#333]">
            <img src={user.picture} alt={user.name} className="w-6 h-6 rounded-full" />
            <span className="text-xs font-bold text-gray-300">{user.name}</span>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
