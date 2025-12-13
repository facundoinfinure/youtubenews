import React, { useState, ReactNode } from 'react';

interface SettingsSectionProps {
  title: string;
  icon?: ReactNode;
  description?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  variant?: 'default' | 'warning' | 'info';
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  icon,
  description,
  children,
  collapsible = false,
  defaultExpanded = true,
  variant = 'default'
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const variantStyles = {
    default: 'border-[#333]',
    warning: 'border-yellow-500/30 bg-yellow-900/5',
    info: 'border-blue-500/30 bg-blue-900/5'
  };

  return (
    <div className={`bg-[#1a1a1a] rounded-xl border ${variantStyles[variant]}`}>
      <div 
        className={`p-6 ${collapsible ? 'cursor-pointer' : ''}`}
        onClick={collapsible ? () => setIsExpanded(!isExpanded) : undefined}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {icon && <span className="text-xl">{icon}</span>}
            <h3 className="text-xl font-bold text-white">{title}</h3>
          </div>
          {collapsible && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="text-gray-400 hover:text-white transition-colors"
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
        </div>
        {description && (
          <p className="text-sm text-gray-400 mb-4">{description}</p>
        )}
      </div>
      
      {isExpanded && (
        <div className="px-6 pb-6">
          {children}
        </div>
      )}
    </div>
  );
};
