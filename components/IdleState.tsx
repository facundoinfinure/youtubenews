/**
 * Idle State Component
 * 
 * Displays the welcome screen with date picker and start button.
 */

import React from 'react';
import { ChannelConfig, AppState } from '../types';

interface IdleStateProps {
  state: AppState;
  config: ChannelConfig;
  selectedDate: string;
  onDateChange: (date: string) => void;
  onStart: () => void;
}

export const IdleState: React.FC<IdleStateProps> = ({
  state,
  config,
  selectedDate,
  onDateChange,
  onStart
}) => {
  const isFetching = state === AppState.FETCHING_NEWS;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] text-center p-8 space-y-6">
      {/* Logo */}
      <div
        className="w-24 h-24 rounded-full flex items-center justify-center shadow-2xl mb-4"
        style={{ background: `linear-gradient(135deg, ${config.logoColor1}, ${config.logoColor2})` }}
      >
        {isFetching ? (
          <span className="text-4xl animate-spin">🌍</span>
        ) : (
          <span className="text-4xl">🎥</span>
        )}
      </div>

      {/* Title */}
      <h2 className="text-2xl font-bold">
        {isFetching ? "Scanning Markets..." : `${config.channelName} Studio`}
      </h2>

      {/* Content when Idle */}
      {state === AppState.IDLE && (
        <>
          <p className="text-gray-400 max-w-md">
            {config.tagline}. Select a date to scrape news for {config.country}.
          </p>

          <div className="flex flex-col items-center gap-2 w-full max-w-xs">
            <label className="text-xs text-gray-500 uppercase tracking-wider font-bold">
              News Date
            </label>
            <input 
              type="date" 
              value={selectedDate} 
              onChange={(e) => onDateChange(e.target.value)}
              className="bg-[#1f1f1f] border border-[#3f3f3f] text-white px-4 py-2 rounded-lg w-full focus:outline-none focus:border-blue-500" 
            />
          </div>

          <button onClick={onStart} className="btn-primary mt-4">
            ▶ Start Production
          </button>
        </>
      )}
    </div>
  );
};

export default IdleState;
