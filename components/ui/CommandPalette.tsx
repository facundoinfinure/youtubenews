/**
 * Command Palette Component
 * 
 * Quick-access command menu triggered by ⌘K (Cmd+K / Ctrl+K)
 * Similar to Linear, Notion, VS Code command palettes
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  IconSearch,
  IconPlus,
  IconLayoutDashboard,
  IconSettings,
  IconFilm,
  IconBarChart,
  IconHardDrive,
  IconSliders,
  IconRefresh,
  IconDownload,
  IconYoutube,
  IconArrowLeft,
  IconCommand,
} from './Icons';

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: React.FC<{ size?: number; className?: string }>;
  shortcut?: string;
  category: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  onNewProduction?: () => void;
  onExitAdmin?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onNewProduction,
  onExitAdmin,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands: Command[] = [
    // Actions
    {
      id: 'new-production',
      label: 'New Production',
      description: 'Start a new video production',
      icon: IconPlus,
      shortcut: '⌘N',
      category: 'Actions',
      action: () => {
        onNewProduction?.();
        onClose();
      },
    },
    {
      id: 'refresh',
      label: 'Refresh Data',
      description: 'Reload current data',
      icon: IconRefresh,
      shortcut: '⌘R',
      category: 'Actions',
      action: () => {
        window.location.reload();
      },
    },
    // Navigation
    {
      id: 'nav-overview',
      label: 'Go to Overview',
      icon: IconLayoutDashboard,
      shortcut: '⌘1',
      category: 'Navigation',
      action: () => {
        onNavigate('overview');
        onClose();
      },
    },
    {
      id: 'nav-productions',
      label: 'Go to Productions',
      icon: IconFilm,
      shortcut: '⌘2',
      category: 'Navigation',
      action: () => {
        onNavigate('productions');
        onClose();
      },
    },
    {
      id: 'nav-insights',
      label: 'Go to Insights',
      icon: IconBarChart,
      shortcut: '⌘3',
      category: 'Navigation',
      action: () => {
        onNavigate('insights');
        onClose();
      },
    },
    {
      id: 'nav-settings',
      label: 'Go to Settings',
      icon: IconSettings,
      shortcut: '⌘,',
      category: 'Navigation',
      action: () => {
        onNavigate('settings');
        onClose();
      },
    },
    {
      id: 'nav-render',
      label: 'Go to Render Config',
      icon: IconSliders,
      category: 'Navigation',
      action: () => {
        onNavigate('render');
        onClose();
      },
    },
    {
      id: 'nav-costs',
      label: 'Go to Costs & Usage',
      icon: IconBarChart,
      category: 'Navigation',
      action: () => {
        onNavigate('costs');
        onClose();
      },
    },
    {
      id: 'nav-storage',
      label: 'Go to Storage',
      icon: IconHardDrive,
      category: 'Navigation',
      action: () => {
        onNavigate('cache');
        onClose();
      },
    },
    {
      id: 'exit-admin',
      label: 'Exit to Studio',
      icon: IconArrowLeft,
      shortcut: 'Esc',
      category: 'Navigation',
      action: () => {
        onExitAdmin?.();
        onClose();
      },
    },
    // External
    {
      id: 'open-youtube',
      label: 'Open YouTube Studio',
      icon: IconYoutube,
      category: 'External',
      action: () => {
        window.open('https://studio.youtube.com', '_blank');
        onClose();
      },
    },
  ];

  // Filter commands based on query
  const filteredCommands = query
    ? commands.filter(
        (cmd) =>
          cmd.label.toLowerCase().includes(query.toLowerCase()) ||
          cmd.description?.toLowerCase().includes(query.toLowerCase()) ||
          cmd.category.toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  // Group filtered commands by category
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {} as Record<string, Command[]>);

  // Flatten for keyboard navigation
  const flatCommands = Object.values(groupedCommands).flat();

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % flatCommands.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + flatCommands.length) % flatCommands.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (flatCommands[selectedIndex]) {
            flatCommands[selectedIndex].action();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatCommands, selectedIndex, onClose]
  );

  // Scroll selected item into view
  useEffect(() => {
    const selected = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }}
            className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-xl z-[101]"
          >
            <div className="bg-[#1a1a1e] rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
              {/* Search input */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                <IconSearch size={20} className="text-white/30 flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a command or search..."
                  className="flex-1 bg-transparent text-white text-base placeholder:text-white/30 focus:outline-none"
                />
                <kbd className="px-2 py-1 bg-white/5 rounded text-xs text-white/30 font-mono flex-shrink-0">
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
                {Object.entries(groupedCommands).length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <p className="text-white/40 text-sm">No commands found</p>
                  </div>
                ) : (
                  Object.entries(groupedCommands).map(([category, cmds]) => (
                    <div key={category}>
                      <div className="px-4 py-2 text-xs text-white/30 font-medium uppercase tracking-wider">
                        {category}
                      </div>
                      {cmds.map((cmd) => {
                        const index = flatCommands.indexOf(cmd);
                        const isSelected = index === selectedIndex;

                        return (
                          <button
                            key={cmd.id}
                            data-index={index}
                            onClick={cmd.action}
                            onMouseEnter={() => setSelectedIndex(index)}
                            className={`
                              w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                              ${isSelected ? 'bg-white/5' : 'hover:bg-white/[0.02]'}
                            `}
                          >
                            <div
                              className={`
                              w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                              ${isSelected ? 'bg-accent-500/20' : 'bg-white/5'}
                            `}
                            >
                              <cmd.icon
                                size={18}
                                className={isSelected ? 'text-accent-400' : 'text-white/50'}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div
                                className={`font-medium text-sm ${
                                  isSelected ? 'text-white' : 'text-white/80'
                                }`}
                              >
                                {cmd.label}
                              </div>
                              {cmd.description && (
                                <div className="text-xs text-white/40 truncate">
                                  {cmd.description}
                                </div>
                              )}
                            </div>
                            {cmd.shortcut && (
                              <kbd className="px-2 py-0.5 bg-white/5 rounded text-xs text-white/30 font-mono flex-shrink-0">
                                {cmd.shortcut}
                              </kbd>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between text-xs text-white/30">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-[10px]">↑↓</kbd>
                    Navigate
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.5 bg-white/5 rounded text-[10px]">↵</kbd>
                    Select
                  </span>
                </div>
                <span className="flex items-center gap-1">
                  <IconCommand size={12} />
                  <span>K to open</span>
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

// Hook for global keyboard shortcut
export const useCommandPalette = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘K or Ctrl+K to open
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      // Escape to close (handled internally too, but good to have globally)
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((prev) => !prev),
  };
};

export default CommandPalette;

