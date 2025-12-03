
import React, { useState } from 'react';
import { NewsItem } from '../types';

interface NewsSelectorProps {
  news: NewsItem[];
  onConfirmSelection: (selectedNews: NewsItem[]) => void;
  date: Date;
}

export const NewsSelector: React.FC<NewsSelectorProps> = ({ news, onConfirmSelection, date }) => {
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  // Reset selection when news changes
  React.useEffect(() => {
    setSelectedIndices([]);
  }, [news]);

  const toggleSelection = (index: number) => {
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
      const selectedItems = selectedIndices.map(i => news[i]);
      onConfirmSelection(selectedItems);
    }
  };

  if (!news || news.length === 0) {
    return (
      <div className="w-full bg-[#121212] rounded-xl p-6 shadow-2xl border border-[#333] text-center">
        <div className="text-6xl mb-4">📰</div>
        <h2 className="text-2xl font-bold text-white mb-2">No News Available</h2>
        <p className="text-gray-400">No news stories found for {date.toLocaleDateString()}.</p>
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
          </p>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${selectedIndices.length >= 2 ? 'text-green-500' : 'text-gray-500'}`}>
            {selectedIndices.length}/5
          </div>
          <div className="text-xs text-gray-500 uppercase">Selected</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {news.map((item, idx) => {
          const isSelected = selectedIndices.includes(idx);
          const isDisabled = !isSelected && selectedIndices.length >= 5;

          return (
            <div
              key={idx}
              onClick={() => !isDisabled && toggleSelection(idx)}
              className={`
                relative rounded-lg overflow-hidden border-2 cursor-pointer transition-all duration-200 group
                ${isSelected ? 'border-yellow-500 bg-[#1f1f1f] transform scale-[1.02]' : 'border-[#333] bg-[#1a1a1a] hover:border-gray-500'}
                ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {/* News Image - use real URL if available, fallback to gradient */}
              <div className="h-32 w-full bg-gradient-to-br from-gray-800 to-gray-900 relative overflow-hidden">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.headline}
                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                    loading="lazy"
                    onError={(e) => {
                      // Hide broken image and show gradient background
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
                    {item.imageKeyword}
                  </div>
                )}
                <div className="absolute top-2 right-2 bg-black/70 backdrop-blur text-xs font-bold px-2 py-1 rounded text-white flex items-center gap-1">
                  🔥 {item.viralScore}
                </div>
              </div>

              <div className="p-4">
                <div className="text-xs text-blue-400 font-bold mb-1 uppercase tracking-wider">{item.source}</div>
                <h3 className="text-sm font-bold text-white leading-tight mb-2 line-clamp-2">{item.headline}</h3>
                <p className="text-xs text-gray-400 line-clamp-3 mb-3">{item.summary}</p>

                <div className="flex items-center justify-between mt-auto">
                  {isSelected ? (
                    <div className="bg-yellow-500 text-black text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                      ✓ SELECTED
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600 font-medium">Click to Add</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

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
