import React from 'react';
import { NewsItem } from '../types';

interface TickerProps {
  news: NewsItem[];
}

export const Ticker: React.FC<TickerProps> = ({ news }) => {
  if (!news || news.length === 0) return null;

  return (
    <div className="bg-yellow-400/90 backdrop-blur text-black h-12 flex items-center overflow-hidden border-t-4 border-black relative">
      <div className="bg-red-600 text-white font-headline px-6 h-full flex items-center font-bold text-xl shrink-0 z-30 shadow-[4px_0_10px_rgba(0,0,0,0.3)]">
        BREAKING NEWS
      </div>
      <div className="whitespace-nowrap animate-marquee flex items-center py-2">
        {news.map((item, idx) => (
          <span key={idx} className="mx-8 font-bold text-lg uppercase font-mono tracking-tight flex items-center">
             <span className="text-red-700 mr-2 text-2xl">•</span> {item.headline} 
             <span className="text-gray-800 text-xs ml-2 opacity-75 font-sans normal-case">via {item.source}</span>
          </span>
        ))}
        {/* Duplicate for seamless loop */}
        {news.map((item, idx) => (
          <span key={`dup-${idx}`} className="mx-8 font-bold text-lg uppercase font-mono tracking-tight flex items-center">
             <span className="text-red-700 mr-2 text-2xl">•</span> {item.headline}
             <span className="text-gray-800 text-xs ml-2 opacity-75 font-sans normal-case">via {item.source}</span>
          </span>
        ))}
      </div>
      
      <style>{`
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
};