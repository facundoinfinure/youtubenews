import React, { ReactNode } from 'react';

interface ConfigCardProps {
  title: string;
  description?: string;
  children: ReactNode;
  variant?: 'default' | 'warning' | 'info' | 'success';
  icon?: ReactNode;
}

export const ConfigCard: React.FC<ConfigCardProps> = ({
  title,
  description,
  children,
  variant = 'default',
  icon
}) => {
  const variantStyles = {
    default: 'bg-[#111] border-[#333]',
    warning: 'bg-yellow-900/10 border-yellow-500/30',
    info: 'bg-blue-900/10 border-blue-500/30',
    success: 'bg-green-900/10 border-green-500/30'
  };

  const variantTextColors = {
    default: 'text-white',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
    success: 'text-green-400'
  };

  return (
    <div className={`border rounded-lg p-4 ${variantStyles[variant]}`}>
      <div className="flex items-start gap-3 mb-3">
        {icon && <span className="text-lg">{icon}</span>}
        <div className="flex-1">
          <h4 className={`font-bold ${variantTextColors[variant]}`}>{title}</h4>
          {description && (
            <p className="text-xs text-gray-400 mt-1">{description}</p>
          )}
        </div>
      </div>
      <div className="mt-3">
        {children}
      </div>
    </div>
  );
};
