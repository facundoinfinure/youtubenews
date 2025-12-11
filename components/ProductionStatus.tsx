/**
 * Production Status Component
 * 
 * Shows the current production progress with a progress bar and status messages.
 */

import React from 'react';
import { ChannelConfig } from '../types';

interface ProductionStatusProps {
  progress: {
    current: number;
    total: number;
    step: string;
  };
  logs: string[];
  config: ChannelConfig;
  productionId: string | null;
  onAbort: () => void;
  isGenerating: boolean;
}

export const ProductionStatus: React.FC<ProductionStatusProps> = ({
  progress,
  logs,
  config,
  productionId,
  onAbort,
  isGenerating
}) => {
  const lastLog = logs[logs.length - 1] || "Initializing...";
  const progressPercent = progress.total > 0 
    ? (progress.current / progress.total) * 100 
    : 0;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] text-center p-4 sm:p-8 overflow-y-auto">
      {/* Spinner */}
      <div 
        className="w-16 h-16 sm:w-20 sm:h-20 border-4 border-t-transparent rounded-full animate-spin mb-4 sm:mb-6" 
        style={{ 
          borderColor: config.logoColor1, 
          borderTopColor: 'transparent' 
        }}
      />
      
      <h3 className="text-lg sm:text-xl font-bold mb-2">PRODUCING BROADCAST</h3>

      {/* Progress Bar */}
      {progress.total > 0 && (
        <div className="w-full max-w-md mb-4 px-2">
          <div className="flex justify-between text-xs sm:text-sm mb-2 text-gray-400 gap-2">
            <span className="truncate flex-1 text-left">{progress.step}</span>
            <span className="ml-2 flex-shrink-0">{progress.current}/{progress.total}</span>
          </div>
          <div className="h-2.5 sm:h-3 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r transition-all duration-500"
              style={{
                width: `${progressPercent}%`,
                backgroundImage: `linear-gradient(90deg, ${config.logoColor1}, ${config.logoColor2})`
              }}
            />
          </div>
        </div>
      )}

      {/* Current Status */}
      <div className="text-gray-400 font-mono text-xs sm:text-sm max-w-lg mx-auto mb-4 px-2 break-words">
        {lastLog}
      </div>

      {/* Abort Button */}
      {isGenerating && productionId && (
        <button
          onClick={onAbort}
          className="px-5 sm:px-6 py-3 sm:py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-sm sm:text-base transition-colors min-h-[44px]"
        >
          🛑 Abort
        </button>
      )}
    </div>
  );
};

export default ProductionStatus;
