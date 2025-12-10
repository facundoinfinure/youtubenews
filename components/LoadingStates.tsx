/**
 * Loading States & Empty State Components
 * 
 * Premium loading states with better visual feedback.
 */

import React from 'react';
import { motion } from 'framer-motion';
import { IconFilm, IconBarChart, IconNews, IconLoader } from './ui/Icons';

// Skeleton loader for video cards
export const VideoCardSkeleton: React.FC = () => {
  return (
    <div className="flex gap-3 animate-pulse">
      <div className="w-32 h-20 bg-white/5 rounded-xl flex-shrink-0" />
      <div className="flex flex-col gap-2 flex-1">
        <div className="h-4 bg-white/5 rounded-lg w-full" />
        <div className="h-3 bg-white/5 rounded-lg w-2/3" />
        <div className="h-3 bg-white/5 rounded-lg w-1/2" />
      </div>
    </div>
  );
};

// Skeleton loader for admin dashboard analytics cards
export const AnalyticsCardSkeleton: React.FC = () => {
  return (
    <div className="bg-white/[0.02] p-6 rounded-2xl border border-white/5 animate-pulse">
      <div className="h-5 bg-white/5 rounded-lg w-1/3 mb-6" />
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white/[0.02] p-4 rounded-xl">
            <div className="h-3 bg-white/5 rounded-lg mb-2 w-2/3" />
            <div className="h-8 bg-white/5 rounded-lg w-full" />
          </div>
        ))}
      </div>
    </div>
  );
};

// Skeleton for video list in admin dashboard
export const VideoListSkeleton: React.FC = () => {
  return (
    <div className="divide-y divide-white/5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="p-4 animate-pulse">
          <div className="h-4 bg-white/5 rounded-lg mb-2 w-3/4" />
          <div className="flex justify-between">
            <div className="h-3 bg-white/5 rounded-lg w-1/4" />
            <div className="h-3 bg-white/5 rounded-lg w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
};

// Production list skeleton
export const ProductionListSkeleton: React.FC = () => {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-4 bg-white/[0.02] rounded-xl animate-pulse">
          <div className="flex items-center gap-4">
            <div className="w-16 h-10 bg-white/5 rounded-lg flex-shrink-0" />
            <div className="flex-1">
              <div className="h-4 bg-white/5 rounded-lg w-2/3 mb-2" />
              <div className="h-3 bg-white/5 rounded-lg w-1/3" />
            </div>
            <div className="w-24 h-4 bg-white/5 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
};

// Generic empty state component
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}) => {
  // Default icons based on common use cases
  const defaultIcon = (
    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
      <IconFilm size={32} className="text-white/20" />
    </div>
  );

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 px-8 text-center"
    >
      <div className="mb-6">
        {icon || defaultIcon}
      </div>
      <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
      <p className="text-sm text-white/40 max-w-sm mb-6">{description}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="btn-primary"
        >
          {actionLabel}
        </button>
      )}
    </motion.div>
  );
};

// Premium empty states with custom illustrations
export const EmptyProductionsState: React.FC<{ onAction?: () => void }> = ({ onAction }) => (
  <EmptyState
    icon={
      <div className="relative">
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-500/10 to-violet-500/10 
                   border border-white/10 flex items-center justify-center"
        >
          <IconFilm size={36} className="text-accent-400/50" />
        </motion.div>
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-16 h-3 bg-white/5 rounded-full blur-sm" />
      </div>
    }
    title="No productions yet"
    description="Create your first AI-powered news video. The wizard will guide you through each step."
    actionLabel={onAction ? "Start Production" : undefined}
    onAction={onAction}
  />
);

export const EmptyVideosState: React.FC = () => (
  <EmptyState
    icon={
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
        <IconBarChart size={28} className="text-red-400/50" />
      </div>
    }
    title="No published videos"
    description="Complete a production and publish it to YouTube to see analytics and insights here."
  />
);

export const EmptyNewsState: React.FC<{ onAction?: () => void }> = ({ onAction }) => (
  <EmptyState
    icon={
      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
        <IconNews size={28} className="text-amber-400/50" />
      </div>
    }
    title="No news found"
    description="Try changing the date or updating your topic settings to find relevant news."
    actionLabel={onAction ? "Change Settings" : undefined}
    onAction={onAction}
  />
);

// Loading spinner component
export const LoadingSpinner: React.FC<{ 
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  className?: string;
}> = ({
  size = 'md',
  color = 'currentColor',
  className = ''
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-10 h-10',
  };

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        style={{ color }}
      >
        <IconLoader size={size === 'sm' ? 16 : size === 'md' ? 24 : 40} />
      </motion.div>
    </div>
  );
};

// Full-page loading overlay
export const LoadingOverlay: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-[#09090b]/90 backdrop-blur-sm flex flex-col items-center justify-center z-50"
    >
      <div className="relative">
        {/* Glow effect */}
        <div className="absolute inset-0 bg-accent-500/20 rounded-full blur-xl" />
        <LoadingSpinner size="lg" className="text-accent-500" />
      </div>
      <p className="text-white/60 mt-4 font-medium">{message}</p>
    </motion.div>
  );
};

// Progress bar component
export const ProgressBar: React.FC<{
  progress: number;
  label?: string;
  showPercentage?: boolean;
  className?: string;
}> = ({ progress, label, showPercentage = true, className = '' }) => {
  return (
    <div className={className}>
      {(label || showPercentage) && (
        <div className="flex justify-between text-xs text-white/40 mb-2">
          {label && <span>{label}</span>}
          {showPercentage && <span>{Math.round(progress)}%</span>}
        </div>
      )}
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full"
        />
      </div>
    </div>
  );
};

// Inline loading indicator
export const InlineLoader: React.FC<{ text?: string }> = ({ text = 'Loading' }) => (
  <div className="flex items-center gap-2 text-sm text-white/40">
    <LoadingSpinner size="sm" />
    <span>{text}</span>
  </div>
);
