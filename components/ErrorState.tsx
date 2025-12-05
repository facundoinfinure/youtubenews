/**
 * Error State Component
 * 
 * Displays an error message with retry and go back options.
 */

import React from 'react';

interface ErrorStateProps {
  message?: string;
  onGoBack: () => void;
  onRetry: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message = "An error occurred during production.",
  onGoBack,
  onRetry
}) => {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] text-center p-8 space-y-6">
      <div className="w-24 h-24 rounded-full flex items-center justify-center bg-red-900/50 mb-4">
        <span className="text-4xl">⚠️</span>
      </div>
      <h2 className="text-2xl font-bold text-red-400">Production Error</h2>
      <p className="text-gray-400 max-w-md">{message}</p>
      <div className="flex gap-4">
        <button onClick={onGoBack} className="btn-secondary">
          Go Back
        </button>
        <button onClick={onRetry} className="btn-primary">
          Retry
        </button>
      </div>
    </div>
  );
};

export default ErrorState;
