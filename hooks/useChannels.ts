/**
 * Channels Hook
 * 
 * Manages channel state, selection, and configuration.
 */

import { useState, useEffect, useCallback } from 'react';
import { Channel, ChannelConfig, UserProfile } from '../types';
import { 
  getAllChannels, 
  saveChannel, 
  getChannelById,
  fetchVideosFromDB,
  getCompletedProductionsWithVideoInfo,
  ProductionWithVideoInfo
} from '../services/supabaseService';
import { ContentCache } from '../services/ContentCache';
import { CostTracker } from '../services/CostTracker';
import { logger } from '../services/logger';
import { LIMITS } from '../constants';

// Default configuration fallback
const FALLBACK_CONFIG: ChannelConfig = {
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

interface UseChannelsReturn {
  channels: Channel[];
  activeChannel: Channel | null;
  config: ChannelConfig;
  isLoading: boolean;
  storedVideos: any[];
  completedProductions: ProductionWithVideoInfo[];
  selectChannel: (channel: Channel) => Promise<void>;
  updateConfig: (newConfig: ChannelConfig) => void;
  saveChannelConfig: (channel: Channel) => Promise<Channel | null>;
  refreshChannelData: () => Promise<void>;
}

export function useChannels(user: UserProfile | null): UseChannelsReturn {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [config, setConfig] = useState<ChannelConfig>(FALLBACK_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [storedVideos, setStoredVideos] = useState<any[]>([]);
  const [completedProductions, setCompletedProductions] = useState<ProductionWithVideoInfo[]>([]);

  // Load channels on mount
  useEffect(() => {
    const loadChannels = async () => {
      try {
        setIsLoading(true);
        const allChannels = await getAllChannels();
        setChannels(allChannels);
        
        if (allChannels.length > 0) {
          const firstChannel = allChannels[0];
          setActiveChannel(firstChannel);
          setConfig(firstChannel.config);
          
          // Set context for tracking services
          if (user) {
            CostTracker.setContext(firstChannel.id, user.email);
            ContentCache.setContext(firstChannel.id);
            ContentCache.preload().catch(() => {});
          }
          
          logger.info('channel', 'Channels loaded', { 
            count: allChannels.length,
            active: firstChannel.name 
          });
        }
      } catch (error) {
        logger.error('channel', 'Failed to load channels', { error });
      } finally {
        setIsLoading(false);
      }
    };

    loadChannels();
  }, []);

  // Update tracking context when user or channel changes
  useEffect(() => {
    if (activeChannel && user) {
      CostTracker.setContext(activeChannel.id, user.email);
      ContentCache.setContext(activeChannel.id);
    }
  }, [activeChannel, user]);

  // Load channel data (videos, productions)
  const loadChannelData = useCallback(async (channelId: string) => {
    try {
      // Fetch videos
      const videos = await fetchVideosFromDB(channelId);
      setStoredVideos(videos.slice(0, LIMITS.SIDEBAR_ITEMS_COUNT));
      
      // Fetch completed productions
      if (user) {
        const productions = await getCompletedProductionsWithVideoInfo(
          channelId, 
          user.email, 
          LIMITS.MAX_COMPLETED_PRODUCTIONS
        );
        setCompletedProductions(productions.slice(0, LIMITS.SIDEBAR_ITEMS_COUNT));
      }
      
      logger.debug('channel', 'Channel data loaded', { channelId });
    } catch (error) {
      logger.error('channel', 'Failed to load channel data', { error });
      setStoredVideos([]);
      setCompletedProductions([]);
    }
  }, [user]);

  // Load data when active channel changes
  useEffect(() => {
    if (activeChannel) {
      loadChannelData(activeChannel.id);
    }
  }, [activeChannel, loadChannelData]);

  // Select a different channel
  const selectChannel = useCallback(async (channel: Channel) => {
    logger.info('channel', 'Switching channel', { 
      from: activeChannel?.name, 
      to: channel.name 
    });
    
    setActiveChannel(channel);
    setConfig(channel.config);
    
    // Update tracking context
    if (user) {
      CostTracker.setContext(channel.id, user.email);
      ContentCache.setContext(channel.id);
    }
    
    // Update channels array with fresh data
    setChannels(prev => prev.map(c => c.id === channel.id ? channel : c));
  }, [activeChannel, user]);

  // Update config locally (without saving)
  const updateConfig = useCallback((newConfig: ChannelConfig) => {
    setConfig(newConfig);
    
    // Also update active channel config
    if (activeChannel) {
      setActiveChannel({ ...activeChannel, config: newConfig });
    }
  }, [activeChannel]);

  // Save channel config to database
  const saveChannelConfig = useCallback(async (channel: Channel): Promise<Channel | null> => {
    try {
      const saved = await saveChannel(channel);
      if (saved) {
        // Update local state
        setChannels(prev => prev.map(c => c.id === saved.id ? saved : c));
        if (activeChannel?.id === saved.id) {
          setActiveChannel(saved);
          setConfig(saved.config);
        }
        logger.info('channel', 'Channel config saved', { name: saved.name });
      }
      return saved;
    } catch (error) {
      logger.error('channel', 'Failed to save channel config', { error });
      return null;
    }
  }, [activeChannel]);

  // Refresh channel data
  const refreshChannelData = useCallback(async () => {
    if (activeChannel) {
      await loadChannelData(activeChannel.id);
    }
  }, [activeChannel, loadChannelData]);

  return {
    channels,
    activeChannel,
    config,
    isLoading,
    storedVideos,
    completedProductions,
    selectChannel,
    updateConfig,
    saveChannelConfig,
    refreshChannelData
  };
}
