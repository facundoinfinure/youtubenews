
import React, { useState } from 'react';
import { NewsItem } from '../types';

interface NewsSelectorProps {
  news: NewsItem[];
  onConfirmSelection: (selectedNews: NewsItem[]) => void;
  date: Date;
  usedNewsIds?: Set<string>; // News IDs already used in other productions
}

export const NewsSelector: React.FC<NewsSelectorProps> = ({ news, onConfirmSelection, date, usedNewsIds = new Set() }) => {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [minViralScore, setMinViralScore] = useState<number>(0);
  const [maxViralScore, setMaxViralScore] = useState<number>(100);
  const [hoveredScoreIndex, setHoveredScoreIndex] = useState<number | null>(null);

  // Reset selection when news changes
  React.useEffect(() => {
    setSelectedIndices([]);
  }, [news]);

  // Calculate min/max viral scores from available news
  const viralScores = news.map(n => n.viralScore);
  const actualMin = Math.min(...viralScores, 0);
  const actualMax = Math.max(...viralScores, 100);

  // Filter news by viral score range
  const filteredNews = news.filter(item => 
    item.viralScore >= minViralScore && item.viralScore <= maxViralScore
  );

  const toggleSelection = (index: number) => {
    const item = news[index];
    // Don't allow selection of already used news
    if (item.id && usedNewsIds.has(item.id)) {
      return;
    }
    
    if (selectedIndices.includes(index)) {
      setSelectedIndices(selectedIndices.filter(i => i !== index));
    } else {
      if (selectedIndices.length < 5) {
        setSelectedIndices([...selectedIndices, index]);
      }
    }
  };

  const handleConfirm = () => {
    if (selectedIndices.length >= 2 && selectedIndices.length <= 5) {
      // Map filtered indices back to original news array indices
      const selectedItems = selectedIndices.map(i => filteredNews[i]);
      onConfirmSelection(selectedItems);
    }
  };

  // Update selected indices when filtered news changes
  React.useEffect(() => {
    // Reset selection when filter changes significantly
    setSelectedIndices([]);
  }, [minViralScore, maxViralScore]);

  if (!news || news.length === 0) {
    return (
      <div className="w-full bg-[#121212] rounded-xl p-6 shadow-2xl border border-[#333] text-center">
        <div className="text-6xl mb-4">📰</div>
        <h2 className="text-2xl font-bold text-white mb-2">No News Available</h2>
        <p className="text-gray-400">No news stories found for {date.toLocaleDateString()}.</p>
      </div>
    );
  }

  if (filteredNews.length === 0) {
    return (
      <div className="w-full bg-[#121212] rounded-xl p-6 shadow-2xl border border-[#333]">
        <div className="flex justify-between items-end mb-6">
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Editorial Meeting</h2>
            <p className="text-gray-400 text-sm">
              Wire reports for <span className="text-white font-mono">{date.toLocaleDateString()}</span>.
            </p>
          </div>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4 mb-4">
          <p className="text-yellow-400 text-sm">
            ⚠️ No news found with viral score between {minViralScore} and {maxViralScore}.
            Adjust the filter below to see more news.
          </p>
        </div>
        {/* Filter controls - shown even when no results */}
        <div className="bg-[#1a1a1a] rounded-lg p-4 border border-[#333] mb-4">
          <div className="flex items-center gap-4">
            <label className="text-sm text-gray-400 whitespace-nowrap">Viral Score Filter:</label>
            <div className="flex-1 flex items-center gap-3">
              <input
                type="range"
                min={actualMin}
                max={actualMax}
                value={minViralScore}
                onChange={(e) => setMinViralScore(Number(e.target.value))}
                className="flex-1"
              />
              <div className="text-sm text-white font-mono w-20 text-center">
                {minViralScore} - {maxViralScore}
              </div>
              <input
                type="range"
                min={actualMin}
                max={actualMax}
                value={maxViralScore}
                onChange={(e) => setMaxViralScore(Number(e.target.value))}
                className="flex-1"
              />
            </div>
            <button
              onClick={() => {
                setMinViralScore(actualMin);
                setMaxViralScore(actualMax);
              }}
              className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1 border border-blue-400/50 rounded"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-[#121212] rounded-xl p-6 shadow-2xl border border-[#333]">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Editorial Meeting</h2>
          <p className="text-gray-400 text-sm">
            Wire reports for <span className="text-white font-mono">{date.toLocaleDateString()}</span>.
            Select <span className="text-yellow-400 font-bold">2 to 5 stories</span> for the broadcast.
            {usedNewsIds.size > 0 && (
              <span className="block mt-1 text-xs text-red-400">
                ⚠️ {usedNewsIds.size} story{usedNewsIds.size !== 1 ? 'ies' : ''} already used in other productions (shown in red)
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${selectedIndices.length >= 2 ? 'text-green-500' : 'text-gray-500'}`}>
            {selectedIndices.length}/5
          </div>
          <div className="text-xs text-gray-500 uppercase">Selected</div>
        </div>
      </div>

      {/* Viral Score Filter */}
      <div className="bg-[#1a1a1a] rounded-lg p-4 border border-[#333] mb-4">
        <div className="flex items-center gap-4">
          <label className="text-sm text-gray-400 whitespace-nowrap">Viral Score Filter:</label>
          <div className="flex-1 flex items-center gap-3">
            <input
              type="range"
              min={actualMin}
              max={actualMax}
              value={minViralScore}
              onChange={(e) => setMinViralScore(Number(e.target.value))}
              className="flex-1"
            />
            <div className="text-sm text-white font-mono w-20 text-center">
              {minViralScore} - {maxViralScore}
            </div>
            <input
              type="range"
              min={actualMin}
              max={actualMax}
              value={maxViralScore}
              onChange={(e) => setMaxViralScore(Number(e.target.value))}
              className="flex-1"
            />
          </div>
          <button
            onClick={() => {
              setMinViralScore(actualMin);
              setMaxViralScore(actualMax);
            }}
            className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1 border border-blue-400/50 rounded"
          >
            Reset
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Showing {filteredNews.length} of {news.length} news items
        </p>
      </div>

      <div className="space-y-3 mb-8 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
        {filteredNews.map((item, idx) => {
          const isSelected = selectedIndices.includes(idx);
          const isUsed = item.id ? usedNewsIds.has(item.id) : false;
          const isDisabled = isUsed || (!isSelected && selectedIndices.length >= 5);

          return (
            <div
              key={idx}
              onClick={() => !isDisabled && toggleSelection(idx)}
              className={`
                relative rounded-lg overflow-hidden border-2 cursor-pointer transition-all duration-200 group
                ${isSelected ? 'border-yellow-500 bg-[#1f1f1f] shadow-lg shadow-yellow-500/20' : 'border-[#333] bg-[#1a1a1a] hover:border-gray-500 hover:bg-[#1f1f1f]'}
                ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                ${isUsed ? 'border-red-500/50 bg-[#1a0a0a]' : ''}
              `}
            >
              <div className="flex gap-4 p-4">
                {/* News Image - Thumbnail on the left */}
                <div className="w-36 h-28 bg-gradient-to-br from-gray-800 to-gray-900 relative overflow-hidden rounded-lg flex-shrink-0 border border-[#333]">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.headline}
                      className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                      loading="lazy"
                      onError={(e) => {
                        // Hide broken image and show gradient background
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs px-2 text-center">
                      {item.imageKeyword}
                    </div>
                  )}
                  <div 
                    className="absolute top-2 right-2 bg-black/80 backdrop-blur-sm text-xs font-bold px-2 py-1 rounded-md text-yellow-400 flex items-center gap-1 shadow-lg cursor-help relative z-10"
                    onMouseEnter={() => setHoveredScoreIndex(idx)}
                    onMouseLeave={() => setHoveredScoreIndex(null)}
                  >
                    🔥 {item.viralScore}
                    {hoveredScoreIndex === idx && item.viralScoreReasoning && (
                      <div className="absolute top-full right-0 mt-2 w-64 bg-[#1a1a1a] border border-[#333] rounded-lg p-3 shadow-xl z-20">
                        <div className="text-xs text-yellow-400 font-bold mb-1">Viral Score Explanation:</div>
                        <div className="text-xs text-gray-300 leading-relaxed">{item.viralScoreReasoning}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Content on the right */}
                <div className="flex-1 flex flex-col min-w-0 justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-xs text-blue-400 font-bold uppercase tracking-wider">{item.source}</div>
                      {isUsed ? (
                        <div className="bg-red-500/20 text-red-400 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 border border-red-500/50 flex-shrink-0">
                          ⚠️ USED
                        </div>
                      ) : isSelected ? (
                        <div className="bg-yellow-500 text-black text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 flex-shrink-0">
                          ✓ SELECTED
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500 font-medium flex-shrink-0">Click to Add</div>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-white leading-tight mb-2 line-clamp-2 group-hover:text-yellow-400 transition-colors">{item.headline}</h3>
                    <p className="text-sm text-gray-400 line-clamp-3 leading-relaxed">{item.summary}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1a1a1a;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #444;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
      `}</style>

      <div className="flex justify-center">
        <button
          onClick={handleConfirm}
          disabled={selectedIndices.length < 2}
          className={`
             px-8 py-3 rounded-full font-bold text-lg shadow-lg flex items-center gap-3 transition-all
             ${selectedIndices.length >= 2
              ? 'bg-red-600 text-white hover:bg-red-500 hover:scale-105'
              : 'bg-gray-700 text-gray-400 cursor-not-allowed'}
          `}
        >
          {selectedIndices.length < 2 ? "Select at least 2 Stories" : "START BROADCAST GENERATION"}
          {selectedIndices.length >= 2 && (
            <svg className="w-5 h-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          )}
        </button>
      </div>
    </div>
  );
};
