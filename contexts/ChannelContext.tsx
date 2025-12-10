/**
 * Channel Context
 * 
 * Provides global state management for channel configuration.
 * This ensures config is always synchronized across all components.
 * 
 * Features:
 * - Single source of truth for channel config
 * - Auto-refresh from Supabase
 * - Optimistic updates with rollback on error
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Channel, ChannelConfig } from '../types';
import { getChannelById, saveChannel, getAllChannels } from '../services/supabaseService';
import { logger } from '../services/logger';

interface ChannelContextValue {
  // Current channel and config
  activeChannel: Channel | null;
  config: ChannelConfig;
  channels: Channel[];
  isLoading: boolean;
  
  // Actions
  setActiveChannel: (channel: Channel) => void;
  updateConfig: (newConfig: ChannelConfig) => Promise<boolean>;
  refreshConfig: () => Promise<void>;
  refreshChannels: () => Promise<void>;
  addChannel: (channel: Channel) => void;
  
  // Get fresh config (useful for callbacks that might have stale closure)
  getFreshConfig: () => Promise<ChannelConfig>;
}

// Default config fallback
const DEFAULT_CONFIG: ChannelConfig = {
  channelName: "ChimpNews",
  tagline: "Investing is Bananas",
  country: "USA",
  language: "English",
  format: '16:9',
  tone: "Sarcastic, Witty, Informative",
  logoColor1: "#FACC15",
  logoColor2: "#DC2626",
  captionsEnabled: false,
  characters: {
    hostA: {
      id: 'hostA',
      name: "Rusty",
      bio: "Male chimpanzee podcaster, sarcastic, dry humor",
      visualPrompt: "Male chimpanzee podcaster wearing a dark hoodie",
      voiceName: "echo",
      outfit: "dark hoodie",
      personality: "sarcastic, dry humor, skeptical",
      gender: "male"
    },
    hostB: {
      id: 'hostB',
      name: "Dani",
      bio: "Female chimpanzee podcaster, playful, witty",
      visualPrompt: "Female chimpanzee podcaster wearing a teal blazer",
      voiceName: "shimmer",
      outfit: "teal blazer and white shirt",
      personality: "playful, witty, energetic",
      gender: "female"
    }
  }
};

const ChannelContext = createContext<ChannelContextValue | null>(null);

interface ChannelProviderProps {
  children: ReactNode;
  initialChannel?: Channel | null;
  initialChannels?: Channel[];
}

export const ChannelProvider: React.FC<ChannelProviderProps> = ({ 
  children, 
  initialChannel = null,
  initialChannels = []
}) => {
  const [activeChannel, setActiveChannelState] = useState<Channel | null>(initialChannel);
  const [config, setConfig] = useState<ChannelConfig>(initialChannel?.config || DEFAULT_CONFIG);
  const [channels, setChannels] = useState<Channel[]>(initialChannels);
  const [isLoading, setIsLoading] = useState(false);

  // Set active channel and update config
  const setActiveChannel = useCallback((channel: Channel) => {
    logger.info('channel', `Switching to channel: ${channel.name}`);
    setActiveChannelState(channel);
    setConfig(channel.config);
  }, []);

  // Add a new channel to the list
  const addChannel = useCallback((channel: Channel) => {
    setChannels(prev => {
      // Check if already exists
      if (prev.some(c => c.id === channel.id)) {
        return prev.map(c => c.id === channel.id ? channel : c);
      }
      return [...prev, channel];
    });
  }, []);

  // Refresh channels from Supabase
  const refreshChannels = useCallback(async () => {
    try {
      setIsLoading(true);
      const freshChannels = await getAllChannels();
      setChannels(freshChannels);
      logger.info('channel', `Refreshed ${freshChannels.length} channels`);
    } catch (error) {
      logger.error('channel', 'Failed to refresh channels', { error: (error as Error).message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Refresh current config from Supabase
  const refreshConfig = useCallback(async () => {
    if (!activeChannel) return;
    
    try {
      setIsLoading(true);
      const freshChannel = await getChannelById(activeChannel.id);
      if (freshChannel) {
        setActiveChannelState(freshChannel);
        setConfig(freshChannel.config);
        // Update in channels list too
        setChannels(prev => prev.map(c => c.id === freshChannel.id ? freshChannel : c));
        logger.info('channel', 'Config refreshed from Supabase');
      }
    } catch (error) {
      logger.error('channel', 'Failed to refresh config', { error: (error as Error).message });
    } finally {
      setIsLoading(false);
    }
  }, [activeChannel]);

  // Update config with optimistic update
  const updateConfig = useCallback(async (newConfig: ChannelConfig): Promise<boolean> => {
    if (!activeChannel) return false;
    
    const previousConfig = config;
    const previousChannel = activeChannel;
    
    // Optimistic update
    setConfig(newConfig);
    const updatedChannel = { ...activeChannel, config: newConfig };
    setActiveChannelState(updatedChannel);
    setChannels(prev => prev.map(c => c.id === activeChannel.id ? updatedChannel : c));
    
    try {
      const saved = await saveChannel(updatedChannel);
      if (saved) {
        logger.info('channel', 'Config saved to Supabase');
        return true;
      }
      throw new Error('Save returned null');
    } catch (error) {
      // Rollback on error
      logger.error('channel', 'Failed to save config, rolling back', { error: (error as Error).message });
      setConfig(previousConfig);
      setActiveChannelState(previousChannel);
      setChannels(prev => prev.map(c => c.id === activeChannel.id ? previousChannel : c));
      return false;
    }
  }, [activeChannel, config]);

  // Get fresh config from Supabase (for callbacks with stale closures)
  const getFreshConfig = useCallback(async (): Promise<ChannelConfig> => {
    if (!activeChannel) return config;
    
    try {
      const freshChannel = await getChannelById(activeChannel.id);
      if (freshChannel) {
        // Update state while we're at it
        setActiveChannelState(freshChannel);
        setConfig(freshChannel.config);
        return freshChannel.config;
      }
    } catch (error) {
      logger.warn('channel', 'Failed to get fresh config, using cached', { error: (error as Error).message });
    }
    
    return config;
  }, [activeChannel, config]);

  // Sync with initialChannel changes
  useEffect(() => {
    if (initialChannel && initialChannel.id !== activeChannel?.id) {
      setActiveChannel(initialChannel);
    }
  }, [initialChannel, activeChannel?.id, setActiveChannel]);

  // Sync with initialChannels changes
  useEffect(() => {
    if (initialChannels.length > 0 && channels.length === 0) {
      setChannels(initialChannels);
    }
  }, [initialChannels, channels.length]);

  const value: ChannelContextValue = {
    activeChannel,
    config,
    channels,
    isLoading,
    setActiveChannel,
    updateConfig,
    refreshConfig,
    refreshChannels,
    addChannel,
    getFreshConfig
  };

  return (
    <ChannelContext.Provider value={value}>
      {children}
    </ChannelContext.Provider>
  );
};

// Hook to use channel context
export const useChannel = (): ChannelContextValue => {
  const context = useContext(ChannelContext);
  if (!context) {
    throw new Error('useChannel must be used within a ChannelProvider');
  }
  return context;
};

// Optional hook that returns null if not in provider (for gradual migration)
export const useChannelOptional = (): ChannelContextValue | null => {
  return useContext(ChannelContext);
};

export default ChannelContext;

