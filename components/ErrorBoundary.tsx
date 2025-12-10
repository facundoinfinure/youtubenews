/**
 * Error Boundary Component
 * 
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI.
 * 
 * Features:
 * - Graceful error handling
 * - Error recovery with retry button
 * - Error logging for debugging
 * - Customizable fallback UI
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../services/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback UI */
  fallback?: ReactNode;
  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Component name for logging */
  componentName?: string;
  /** Whether to show detailed error info (dev only) */
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { onError, componentName } = this.props;
    
    // Log the error
    logger.error('ui', `Error in ${componentName || 'component'}`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack
    });
    
    this.setState({ errorInfo });
    
    // Call custom error handler if provided
    onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, showDetails, componentName } = this.props;

    if (hasError) {
      // Custom fallback
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div className="min-h-[200px] flex items-center justify-center p-8">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 max-w-lg w-full text-center">
            <div className="text-4xl mb-4">⚠️</div>
            <h3 className="text-lg font-bold text-red-400 mb-2">
              Algo salió mal
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              {componentName 
                ? `Hubo un error en ${componentName}. ` 
                : 'Hubo un error inesperado. '}
              Tu progreso está guardado.
            </p>
            
            {showDetails && error && (
              <details className="text-left mb-4">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                  Ver detalles del error
                </summary>
                <div className="mt-2 p-3 bg-black/30 rounded-lg">
                  <code className="text-xs text-red-300 break-all">
                    {error.message}
                  </code>
                  {errorInfo?.componentStack && (
                    <pre className="mt-2 text-[10px] text-gray-500 overflow-auto max-h-32">
                      {errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              </details>
            )}
            
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-all"
              >
                🔄 Reintentar
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm transition-all"
              >
                Recargar página
              </button>
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}

/**
 * Higher-order component to wrap any component with error boundary
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  componentName?: string
): React.FC<P> {
  return function WithErrorBoundary(props: P) {
    return (
      <ErrorBoundary componentName={componentName || WrappedComponent.displayName || WrappedComponent.name}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  };
}

/**
 * Simple inline error boundary for smaller UI sections
 */
export const InlineErrorBoundary: React.FC<{ 
  children: ReactNode;
  fallbackText?: string;
}> = ({ children, fallbackText = 'Error al cargar' }) => {
  return (
    <ErrorBoundary
      fallback={
        <div className="text-red-400 text-xs p-2 bg-red-500/10 rounded">
          ⚠️ {fallbackText}
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
};

export default ErrorBoundary;

