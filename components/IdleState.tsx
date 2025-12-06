/**
 * Idle State Component
 * 
 * Displays the welcome screen with options to:
 * - Start a new production (opens wizard)
 * - Resume an existing production
 */

import React from 'react';
import { ChannelConfig, AppState, Production, getStepDisplayName, getStepNumber } from '../types';

interface IdleStateProps {
  state: AppState;
  config: ChannelConfig;
  selectedDate: string;
  onDateChange: (date: string) => void;
  onStart: () => void;
  // New props for wizard integration
  incompleteProductions?: Production[];
  onResumeProduction?: (production: Production) => void;
  onStartWizard?: () => void;
}

export const IdleState: React.FC<IdleStateProps> = ({
  state,
  config,
  selectedDate,
  onDateChange,
  onStart,
  incompleteProductions = [],
  onResumeProduction,
  onStartWizard
}) => {
  const isFetching = state === AppState.FETCHING_NEWS;

  // Get wizard step info for a production
  const getProductionStepInfo = (prod: Production) => {
    if (prod.wizard_state?.currentStep) {
      const step = prod.wizard_state.currentStep;
      return {
        stepName: getStepDisplayName(step),
        stepNumber: getStepNumber(step),
        totalSteps: 8
      };
    }
    // Fallback for legacy productions
    return {
      stepName: prod.status === 'in_progress' ? '🔄 En progreso' : '📝 Borrador',
      stepNumber: prod.progress_step || 0,
      totalSteps: 8
    };
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f0f0f] text-center p-4 sm:p-8 overflow-y-auto">
      <div className="max-w-2xl w-full space-y-4 sm:space-y-8 my-auto">
        {/* Logo */}
        <div
          className="w-16 h-16 sm:w-24 sm:h-24 rounded-full flex items-center justify-center shadow-2xl mx-auto"
          style={{ background: `linear-gradient(135deg, ${config.logoColor1}, ${config.logoColor2})` }}
        >
          {isFetching ? (
            <span className="text-2xl sm:text-4xl animate-spin">🌍</span>
          ) : (
            <span className="text-2xl sm:text-4xl">🎥</span>
          )}
        </div>

        {/* Title */}
        <div>
          <h2 className="text-xl sm:text-3xl font-bold mb-1 sm:mb-2">
            {isFetching ? "Scanning Markets..." : `${config.channelName} Studio`}
          </h2>
          <p className="text-gray-400 text-sm sm:text-base">{config.tagline}</p>
        </div>

        {/* Content when Idle */}
        {state === AppState.IDLE && (
          <div className="space-y-4 sm:space-y-6">
            {/* Date Selector + New Production Button */}
            <div className="bg-[#1a1a1a] rounded-xl p-4 sm:p-6 border border-[#333]">
              <h3 className="text-base sm:text-lg font-bold mb-3 sm:mb-4 flex items-center justify-center gap-2">
                <span className="text-xl sm:text-2xl">✨</span> Nueva Producción
              </h3>
              
              <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 justify-center">
                <div className="flex flex-col items-start w-full sm:w-auto">
                  <label className="text-xs text-gray-500 uppercase tracking-wider font-bold mb-1">
                    Fecha de Noticias
                  </label>
                  <input 
                    type="date" 
                    value={selectedDate} 
                    onChange={(e) => onDateChange(e.target.value)}
                    className="bg-[#111] border border-[#333] text-white px-3 sm:px-4 py-2 rounded-lg focus:outline-none focus:border-cyan-500 w-full sm:w-auto" 
                  />
                </div>

                <button 
                  onClick={onStartWizard || onStart} 
                  className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-bold shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 w-full sm:w-auto text-sm sm:text-base"
                >
                  🎬 Iniciar Producción
                </button>
              </div>
            </div>

            {/* Incomplete Productions */}
            {incompleteProductions.length > 0 && (
              <div className="bg-[#1a1a1a] rounded-xl p-4 sm:p-6 border border-[#333]">
                <h3 className="text-base sm:text-lg font-bold mb-3 sm:mb-4 flex items-center justify-center gap-2">
                  <span className="text-xl sm:text-2xl">📂</span> Producciones Pendientes
                </h3>
                
                <div className="space-y-2 sm:space-y-3">
                  {incompleteProductions.slice(0, 3).map((prod) => {
                    const stepInfo = getProductionStepInfo(prod);
                    const progressPercent = (stepInfo.stepNumber / stepInfo.totalSteps) * 100;
                    
                    return (
                      <div 
                        key={prod.id}
                        className="bg-[#111] rounded-lg p-3 sm:p-4 border border-[#333] hover:border-cyan-500/50 transition-all cursor-pointer group"
                        onClick={() => onResumeProduction?.(prod)}
                      >
                        <div className="flex items-center justify-between mb-2 gap-2">
                          <div className="flex-1 text-left min-w-0">
                            <h4 className="font-medium text-white truncate text-sm sm:text-base">
                              {prod.viral_metadata?.title || `Producción ${new Date(prod.news_date).toLocaleDateString()}`}
                            </h4>
                            <p className="text-[10px] sm:text-xs text-gray-400">
                              {new Date(prod.updated_at).toLocaleDateString()} • {stepInfo.stepName}
                            </p>
                          </div>
                          <button className="bg-cyan-600/20 hover:bg-cyan-600 text-cyan-400 hover:text-white px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium sm:opacity-0 sm:group-hover:opacity-100 transition-all flex-shrink-0">
                            <span className="hidden sm:inline">Retomar →</span>
                            <span className="sm:hidden">→</span>
                          </button>
                        </div>
                        
                        {/* Progress bar */}
                        <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                        <div className="text-xs text-gray-500 mt-1 text-right">
                          Paso {stepInfo.stepNumber} de {stepInfo.totalSteps}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {incompleteProductions.length > 3 && (
                  <p className="text-sm text-gray-500 mt-3">
                    +{incompleteProductions.length - 3} más en el Dashboard
                  </p>
                )}
              </div>
            )}

            {/* Quick tip */}
            <p className="text-sm text-gray-500">
              💡 El wizard te guiará paso a paso: noticias → guión → audio → video → publicar
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default IdleState;
