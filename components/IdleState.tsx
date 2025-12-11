/**
 * Idle State Component
 * 
 * Premium welcome screen with options to:
 * - Start a new production (opens wizard)
 * - Resume an existing production
 */

import React from 'react';
import { motion } from 'framer-motion';
import { ChannelConfig, AppState, Production, getStepDisplayName, getStepNumber } from '../types';
import { parseLocalDate } from '../utils/dateUtils';
import { IconPlay, IconFilm, IconClock, IconChevronRight, IconSparkles } from './ui/Icons';

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
      stepName: prod.status === 'in_progress' ? 'En progreso' : 'Borrador',
      stepNumber: prod.progress_step || 0,
      totalSteps: 8
    };
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#09090b] p-4 sm:p-8 overflow-y-auto">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-accent-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-violet-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative max-w-xl w-full space-y-8 my-auto">
        {/* Logo & Title */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", bounce: 0.4 }}
            className="relative w-20 h-20 mx-auto mb-6"
          >
            <div 
              className="absolute inset-0 rounded-2xl blur-xl opacity-50"
              style={{ background: `linear-gradient(135deg, ${config.logoColor1}, ${config.logoColor2})` }}
            />
            <div 
              className="relative w-full h-full rounded-2xl flex items-center justify-center shadow-xl"
              style={{ background: `linear-gradient(135deg, ${config.logoColor1}, ${config.logoColor2})` }}
            >
              {isFetching ? (
                <motion.span 
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="text-3xl"
                >
                  🌍
                </motion.span>
              ) : (
                <span className="text-3xl">🎥</span>
              )}
            </div>
          </motion.div>

          {/* Title */}
          <h1 className="text-2xl sm:text-3xl font-semibold text-white mb-2">
            {isFetching ? "Scanning Markets..." : `${config.channelName} Studio`}
          </h1>
          <p className="text-white/50">{config.tagline}</p>
        </motion.div>

        {/* Content when Idle */}
        {state === AppState.IDLE && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-6"
          >
            {/* New Production Card */}
            <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl p-6 border border-white/10">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-accent-500/10 flex items-center justify-center">
                  <IconSparkles size={20} className="text-accent-400" />
                </div>
                <div>
                  <h2 className="font-semibold text-white">New Production</h2>
                  <p className="text-xs text-white/40">Create AI-powered news video</p>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4">
                {/* Date Selector */}
                <div className="flex-1">
                  <label className="text-xs text-white/40 uppercase tracking-wider font-medium mb-2 block">
                    News Date
                  </label>
                  <input 
                    type="date" 
                    value={selectedDate} 
                    onChange={(e) => onDateChange(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 text-white px-4 py-3 rounded-xl 
                             focus:outline-none focus:border-accent-500/50 focus:ring-2 focus:ring-accent-500/20
                             transition-all"
                  />
                </div>

                {/* Start Button */}
                <button 
                  onClick={onStartWizard || onStart} 
                  className="w-full sm:w-auto flex-shrink-0 bg-accent-500 hover:bg-accent-400 text-white px-6 py-3.5 sm:py-3 rounded-xl 
                           font-semibold shadow-lg shadow-accent-500/20 hover:shadow-xl hover:shadow-accent-500/30
                           transition-all flex items-center justify-center gap-2 min-h-[44px] text-sm sm:text-base"
                >
                  <IconPlay size={18} />
                  Start Production
                </button>
              </div>
            </div>

            {/* Incomplete Productions */}
            {incompleteProductions.length > 0 && (
              <div className="bg-white/[0.02] rounded-2xl border border-white/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <IconClock size={16} className="text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white text-sm">Pending Productions</h3>
                    <p className="text-xs text-white/40">{incompleteProductions.length} in progress</p>
                  </div>
                </div>
                
                <div className="divide-y divide-white/5">
                  {incompleteProductions.slice(0, 3).map((prod, index) => {
                    const stepInfo = getProductionStepInfo(prod);
                    const progressPercent = (stepInfo.stepNumber / stepInfo.totalSteps) * 100;
                    
                    return (
                      <motion.div 
                        key={prod.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="p-4 hover:bg-white/[0.02] transition-colors cursor-pointer group"
                        onClick={() => onResumeProduction?.(prod)}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-white text-sm truncate group-hover:text-accent-400 transition-colors">
                              {prod.viral_metadata?.title || `Production ${parseLocalDate(prod.news_date).toLocaleDateString()}`}
                            </h4>
                            <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                              <span>{new Date(prod.updated_at).toLocaleDateString()}</span>
                              <span>•</span>
                              <span>{stepInfo.stepName}</span>
                            </div>
                          </div>
                          
                          {/* Progress */}
                          <div className="flex items-center gap-3">
                            <div className="w-24 hidden sm:block">
                              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-accent-500 rounded-full transition-all"
                                  style={{ width: `${progressPercent}%` }}
                                />
                              </div>
                              <div className="text-[10px] text-white/30 mt-1 text-right">
                                {stepInfo.stepNumber}/{stepInfo.totalSteps}
                              </div>
                            </div>
                            
                            <div className="w-8 h-8 rounded-lg bg-accent-500/10 flex items-center justify-center 
                                          opacity-0 group-hover:opacity-100 transition-all">
                              <IconChevronRight size={16} className="text-accent-400" />
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
                
                {incompleteProductions.length > 3 && (
                  <div className="px-5 py-3 border-t border-white/5">
                    <p className="text-xs text-white/30 text-center">
                      +{incompleteProductions.length - 3} more in Dashboard
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Quick tip */}
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-center text-sm text-white/30 flex items-center justify-center gap-2"
            >
              <span className="text-accent-400">💡</span>
              The wizard guides you: news → script → audio → video → publish
            </motion.p>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default IdleState;
