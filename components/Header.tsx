/**
 * Header Component
 * 
 * Premium app header with logo, channel selector, and user info.
 * Redesigned for minimal, clean aesthetic.
 */

import React, { useState } from 'react';
import { ChannelConfig, Channel, UserProfile } from '../types';
import { connectYouTube } from '../services/supabaseService';
import toast from 'react-hot-toast';
import { IconYoutube, IconSettings, IconChevronDown } from './ui/Icons';

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
  const [showChannelDropdown, setShowChannelDropdown] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/80 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
        
        {/* Left Side - Logo */}
        <div className="flex items-center gap-3">
          {/* Logo Icon */}
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center shadow-lg shadow-accent-500/20">
            <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          
          {/* Logo Text */}
          <span className="font-semibold text-base sm:text-lg tracking-tight text-white hidden sm:block">
            {config.channelName}
          </span>
        </div>

        {/* Center - Channel Selector (only if multiple channels) */}
        {user && channels.length > 1 && (
          <div className="absolute left-1/2 -translate-x-1/2 hidden md:block">
            <div className="relative">
              <button
                onClick={() => setShowChannelDropdown(!showChannelDropdown)}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 rounded-full text-sm font-medium text-white/80 transition-all"
              >
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>{activeChannel?.name || 'Select Channel'}</span>
                <IconChevronDown size={16} className={`text-white/40 transition-transform ${showChannelDropdown ? 'rotate-180' : ''}`} />
              </button>
              
              {/* Dropdown */}
              {showChannelDropdown && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setShowChannelDropdown(false)} 
                  />
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 w-48 py-2 bg-[#1a1a1e] border border-white/10 rounded-xl shadow-xl z-20">
                    {channels.map(ch => (
                      <button
                        key={ch.id}
                        onClick={() => {
                          onChannelChange(ch);
                          setShowChannelDropdown(false);
                        }}
                        className={`
                          w-full px-4 py-2 text-left text-sm transition-colors flex items-center gap-2
                          ${ch.id === activeChannel?.id 
                            ? 'text-white bg-white/5' 
                            : 'text-white/60 hover:text-white hover:bg-white/5'
                          }
                        `}
                      >
                        <div className={`w-2 h-2 rounded-full ${ch.id === activeChannel?.id ? 'bg-emerald-400' : 'bg-white/20'}`} />
                        {ch.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Mobile Channel Selector */}
        {user && channels.length > 0 && (
          <div className="md:hidden">
            <select
              value={activeChannel?.id || ''}
              onChange={(e) => {
                const selected = channels.find(c => c.id === e.target.value);
                if (selected) onChannelChange(selected);
              }}
              className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-accent-500/50"
            >
              {channels.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Right Side - Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Upload Status */}
          {uploadStatus && (
            <div className="hidden sm:flex items-center gap-2 text-xs font-medium bg-accent-500/10 text-accent-400 px-3 py-1.5 rounded-full border border-accent-500/20 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-accent-400" />
              {uploadStatus}
            </div>
          )}

          {/* YouTube Status */}
          {user && (
            <button
              onClick={async () => {
                if (user.accessToken) {
                  toast.success('YouTube está conectado');
                } else {
                  try {
                    await connectYouTube();
                  } catch (error) {
                    toast.error('Error conectando YouTube');
                  }
                }
              }}
              className={`
                h-8 px-3 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all
                ${user.accessToken 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 animate-pulse'
                }
              `}
              title={user.accessToken ? 'YouTube conectado' : 'Clic para conectar YouTube'}
            >
              <IconYoutube size={14} />
              <span className="hidden sm:inline">
                {user.accessToken ? 'Connected' : 'Connect'}
              </span>
            </button>
          )}

          {/* Admin Button */}
          {user && (
            <button 
              onClick={onAdminClick} 
              className="h-8 w-8 sm:w-auto sm:px-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-white/60 hover:text-white flex items-center justify-center gap-2 transition-all"
              title="Admin Dashboard"
            >
              <IconSettings size={16} />
              <span className="hidden sm:inline text-xs font-medium">Admin</span>
            </button>
          )}

          {/* User Avatar */}
          {user && (
            <button 
              className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-white/10 hover:ring-accent-500/50 transition-all flex-shrink-0"
              title={user.name}
            >
              <img 
                src={user.picture} 
                alt={user.name} 
                className="w-full h-full object-cover" 
              />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
