import React from 'react';

/**
 * Loading States & Empty State Components
 * Provides visual feedback during data fetching and empty states
 */

// Skeleton loader for video cards
export const VideoCardSkeleton: React.FC = () => {
    return (
        <div className="flex gap-2 animate-pulse">
            <div className="w-40 h-24 bg-gray-800 rounded-lg overflow-hidden relative flex-shrink-0 shimmer" />
            <div className="flex flex-col gap-2 flex-1">
                <div className="h-4 bg-gray-800 rounded shimmer w-full" />
                <div className="h-3 bg-gray-800 rounded shimmer w-2/3" />
                <div className="h-3 bg-gray-800 rounded shimmer w-1/2" />
            </div>
        </div>
    );
};

// Skeleton loader for admin dashboard analytics cards
export const AnalyticsCardSkeleton: React.FC = () => {
    return (
        <div className="bg-[#1a1a1a] p-6 rounded-xl border border-[#333] animate-pulse">
            <div className="h-6 bg-gray-800 rounded shimmer w-1/3 mb-4" />
            <div className="grid grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-black/30 p-4 rounded-lg">
                        <div className="h-3 bg-gray-800 rounded shimmer mb-2 w-2/3" />
                        <div className="h-8 bg-gray-800 rounded shimmer w-full" />
                    </div>
                ))}
            </div>
        </div>
    );
};

// Skeleton for video list in admin dashboard
export const VideoListSkeleton: React.FC = () => {
    return (
        <div className="space-y-0">
            {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="p-4 border-b border-[#333] animate-pulse">
                    <div className="h-4 bg-gray-800 rounded shimmer mb-2 w-3/4" />
                    <div className="flex justify-between">
                        <div className="h-3 bg-gray-800 rounded shimmer w-1/4" />
                        <div className="h-3 bg-gray-800 rounded shimmer w-1/4" />
                    </div>
                </div>
            ))}
        </div>
    );
};

// Generic empty state component
interface EmptyStateProps {
    icon?: string;
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
    icon = '📭',
    title,
    description,
    actionLabel,
    onAction,
}) => {
    return (
        <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
            <div className="text-6xl opacity-30 mb-2">{icon}</div>
            <h3 className="text-xl font-semibold text-gray-200">{title}</h3>
            <p className="text-sm text-gray-400 max-w-md leading-relaxed">{description}</p>
            {actionLabel && onAction && (
                <button
                    onClick={onAction}
                    className="btn-primary mt-4"
                >
                    {actionLabel}
                </button>
            )}
        </div>
    );
};

// Loading spinner component
export const LoadingSpinner: React.FC<{ size?: 'sm' | 'md' | 'lg', color?: string }> = ({
    size = 'md',
    color = '#ef4444'
}) => {
    const sizeClasses = {
        sm: 'w-4 h-4 border-2',
        md: 'w-8 h-8 border-3',
        lg: 'w-12 h-12 border-4',
    };

    return (
        <div
            className={`${sizeClasses[size]} border-t-transparent rounded-full animate-spin`}
            style={{ borderColor: color, borderTopColor: 'transparent' }}
        />
    );
};

// Full-page loading overlay
export const LoadingOverlay: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => {
    return (
        <div className="absolute inset-0 bg-[#0f0f0f]/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
            <LoadingSpinner size="lg" />
            <p className="text-gray-300 mt-4 font-medium">{message}</p>
        </div>
    );
};
