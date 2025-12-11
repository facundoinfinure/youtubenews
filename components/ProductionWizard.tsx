import React, { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { 
  Production, 
  ProductionStep, 
  ProductionWizardState, 
  SubStepStatus,
  NewsItem, 
  ChannelConfig, 
  Channel,
  UserProfile,
  createEmptyWizardState,
  getNextProductionStep,
  getStepDisplayName,
  getStepNumber,
  ViralMetadata,
  BroadcastSegment,
  ScriptWithScenes,
  ScriptHistoryItem
} from '../types';
import { saveProduction, updateSegmentStatus, deleteAudioFromStorage } from '../services/supabaseService';
import { uploadVideoToYouTube } from '../services/youtubeService';
import { SceneList } from './SceneCard';
import { renderProductionToShotstack } from '../services/shotstackService';
import { parseLocalDate } from '../utils/dateUtils';
import { analyzeScriptForShorts, regenerateScene, ScriptAnalysis } from '../services/geminiService';
import { getTranslationsForChannel, Translations } from '../utils/i18n';
import { AudioManager } from './AudioManager';

// =============================================================================================
// TYPES
// =============================================================================================

interface ProductionWizardProps {
  production: Production;
  channel: Channel;
  config: ChannelConfig;
  user: UserProfile | null;
  onUpdateProduction: (production: Production) => void;
  onClose: () => void;
  // External generation functions
  onFetchNews: () => Promise<NewsItem[]>;
  onGenerateScript: (newsItems: NewsItem[], improvements?: { implement: string[]; maintain: string[] }, narrativeOverride?: 'classic' | 'double_conflict' | 'hot_take' | 'perspective_clash') => Promise<{ scenes: ScriptWithScenes; metadata: ViralMetadata }>;
  onGenerateAudio: (segmentIndex: number, text: string, speaker: string) => Promise<{ audioUrl: string; duration: number }>;
  onGenerateVideo: (segmentIndex: number, audioUrl: string, speaker: string) => Promise<{ videoUrl: string }>;
}

// =============================================================================================
// STEP INDICATOR COMPONENT - with clickable navigation
// =============================================================================================

const StepIndicator: React.FC<{
  steps: ProductionStep[];
  currentStep: ProductionStep;
  wizardState: ProductionWizardState;
  onStepClick?: (step: ProductionStep) => void;
  canNavigate?: (step: ProductionStep) => boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}> = ({ steps, currentStep, wizardState, onStepClick, canNavigate, scrollContainerRef }) => {
  const stepRefs = useRef<Record<string, HTMLDivElement | null>>({});
  
  // Auto-scroll to current step when it changes
  useEffect(() => {
    if (!scrollContainerRef?.current) return;
    
    const currentStepEl = stepRefs.current[currentStep];
    const container = scrollContainerRef.current;
    
    if (currentStepEl && container) {
      // Use requestAnimationFrame + setTimeout to ensure DOM has fully updated
      requestAnimationFrame(() => {
        setTimeout(() => {
          try {
            // Get the step's position relative to its parent
            const stepParent = currentStepEl.parentElement;
            if (!stepParent) return;
            
            // Calculate scroll position to center the step
            const containerWidth = container.clientWidth;
            const stepOffsetLeft = currentStepEl.offsetLeft;
            const stepWidth = currentStepEl.offsetWidth;
            const parentOffsetLeft = stepParent.offsetLeft || 0;
            
            // Calculate scroll to center the step
            const scrollLeft = stepOffsetLeft + parentOffsetLeft - (containerWidth / 2) + (stepWidth / 2);
            
            container.scrollTo({
              left: Math.max(0, scrollLeft),
              behavior: 'smooth'
            });
          } catch (error) {
            console.warn('Error scrolling to step:', error);
          }
        }, 150); // Delay to ensure DOM is fully updated
      });
    }
  }, [currentStep, scrollContainerRef]);
  
  const getStepStatus = (step: ProductionStep): SubStepStatus => {
    const stepKey = step.replace('_', '') as keyof ProductionWizardState;
    const stepState = wizardState[stepKey as keyof Omit<ProductionWizardState, 'currentStep'>];
    if (typeof stepState === 'object' && 'status' in stepState) {
      return stepState.status;
    }
    return 'pending';
  };

  // Step icons for premium look
  const getStepIcon = (step: ProductionStep, status: SubStepStatus) => {
    if (status === 'completed') return '✓';
    const icons: Record<ProductionStep, string> = {
      news_fetch: '🔍',
      news_select: '📰',
      script_generate: '📝',
      script_review: '👁️',
      audio_generate: '🎤',
      video_generate: '🎬',
      render_final: '🎞️',
      publish: '🚀',
      done: '🎉'
    };
    return icons[step] || '●';
  };

  return (
    <div className="flex items-center gap-1 px-2 sm:px-4 py-3 bg-white/[0.02] rounded-xl border border-white/5 overflow-x-auto scrollbar-hide">
        {steps.filter(s => s !== 'done').map((step, index) => {
          const status = getStepStatus(step);
          const isCurrent = step === currentStep;
          const isNavigable = canNavigate?.(step) ?? (status === 'completed');
          
          return (
            <React.Fragment key={step}>
              <div 
                ref={(el) => { stepRefs.current[step] = el; }}
                className={`flex items-center gap-2 flex-shrink-0 px-2 sm:px-3 py-2 rounded-lg transition-all min-h-[44px] touch-manipulation
                  ${isCurrent ? 'bg-accent-500/10 ring-1 ring-accent-500/30' : ''}
                  ${isNavigable && !isCurrent ? 'cursor-pointer hover:bg-white/5 active:bg-white/10' : ''}
                `}
                onClick={() => isNavigable && onStepClick?.(step)}
                title={isNavigable ? `Go to: ${getStepDisplayName(step)}` : undefined}
              >
                <div 
                  className={`
                    w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-sm sm:text-base flex-shrink-0
                    transition-all duration-300
                    ${status === 'completed' ? 'bg-emerald-500 text-white' : ''}
                    ${status === 'in_progress' || isCurrent ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/30' : ''}
                    ${status === 'failed' ? 'bg-red-500 text-white' : ''}
                    ${status === 'pending' && !isCurrent ? 'bg-white/10 text-white/40' : ''}
                  `}
                >
                  {getStepIcon(step, status)}
                </div>
                <span 
                  className={`
                    text-xs sm:text-sm font-medium hidden md:block whitespace-nowrap
                    ${isCurrent ? 'text-accent-400' : status === 'completed' ? 'text-emerald-400' : 'text-white/40'}
                  `}
                >
                  {getStepDisplayName(step).split(' ').slice(1).join(' ')}
                </span>
              </div>
              
              {index < steps.length - 2 && (
                <div className={`
                  w-3 sm:w-6 md:w-8 h-px mx-0.5 sm:mx-1 flex-shrink-0
                  ${status === 'completed' ? 'bg-emerald-500' : 'bg-white/10'}
                `} />
              )}
            </React.Fragment>
          );
        })}
    </div>
  );
};

// =============================================================================================
// NEWS ITEM CARD
// =============================================================================================

const NewsItemCard: React.FC<{
  news: NewsItem;
  selected: boolean;
  onToggle: () => void;
}> = ({ news, selected, onToggle }) => {
  // Format publication date
  const formatDate = (date: Date | string | undefined): string => {
    if (!date) return '';
    try {
      let d: Date;
      if (typeof date === 'string') {
        // Check if it's just a date (YYYY-MM-DD) vs full ISO timestamp
        if (date.length === 10 && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
          // Date only - parse as local date at noon to avoid timezone issues
          const [year, month, day] = date.split('-').map(Number);
          d = new Date(year, month - 1, day, 12, 0, 0);
          // For date-only, don't show time
          return d.toLocaleDateString('es-ES', { 
            day: 'numeric', 
            month: 'short', 
            year: 'numeric'
          });
        } else {
          // Full ISO timestamp - parse normally
          d = new Date(date);
        }
      } else {
        d = date;
      }
      
      return d.toLocaleDateString('es-ES', { 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  return (
    <div 
      onClick={onToggle}
      className={`
        p-4 rounded-xl cursor-pointer transition-all duration-200 group
        ${selected 
          ? 'bg-accent-500/10 border border-accent-500/50 ring-2 ring-accent-500/20' 
          : 'bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04]'}
      `}
    >
      <div className="flex items-start gap-3">
        {/* Custom Checkbox */}
        <div className={`
          w-5 h-5 rounded-md flex-shrink-0 mt-0.5 flex items-center justify-center transition-all
          ${selected 
            ? 'bg-accent-500 text-white' 
            : 'bg-white/5 border border-white/10 group-hover:border-white/20'}
        `}>
          {selected && <span className="text-xs">✓</span>}
        </div>
        
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h4 className="font-medium text-white leading-snug">{news.headline}</h4>
          
          {/* Summary */}
          <p className="text-sm text-white/60 mt-2 leading-relaxed line-clamp-2">{news.summary}</p>
          
          {/* Viral Score Reasoning */}
          {news.viralScoreReasoning && (
            <div className="mt-3 p-3 bg-violet-500/10 border border-violet-500/20 rounded-lg">
              <div className="flex items-start gap-2">
                <span className="text-violet-400 text-sm">🔥</span>
                <p className="text-xs text-violet-300/80 leading-relaxed">
                  <span className="font-medium text-violet-300">Why it's viral:</span>{' '}
                  {news.viralScoreReasoning}
                </p>
              </div>
            </div>
          )}
          
          {/* Metadata row: Source, Date, Viral Score */}
          <div className="flex items-center flex-wrap gap-3 mt-3 text-xs">
            <span className="text-white/40 font-medium">{news.source}</span>
            
            {news.publicationDate && (
              <span className="text-white/30 flex items-center gap-1">
                <span>📅</span>
                {formatDate(news.publicationDate)}
              </span>
            )}
            
            <span className={`
              px-2 py-0.5 rounded-full font-medium
              ${news.viralScore >= 80 ? 'bg-emerald-500/10 text-emerald-400' : ''}
              ${news.viralScore >= 60 && news.viralScore < 80 ? 'bg-amber-500/10 text-amber-400' : ''}
              ${news.viralScore < 60 ? 'bg-white/5 text-white/40' : ''}
            `}>
              {news.viralScore}% viral
            </span>
          </div>
          
          {/* Link to original article */}
          {news.url && (
            <a
              href={news.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 mt-3 text-xs text-accent-400 hover:text-accent-300 transition-colors"
            >
              <span>🔗</span>
              <span>Read full article on {news.source}</span>
              <span className="text-[10px]">↗</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

// =============================================================================================
// SEGMENT PROGRESS CARD
// =============================================================================================

const SegmentProgressCard: React.FC<{
  index: number;
  segment: BroadcastSegment;
  audioStatus: SubStepStatus;
  videoStatus: SubStepStatus;
  audioUrl?: string;
  videoUrl?: string;
  onRegenerateAudio?: () => void;
  onRegenerateVideo?: () => void;
  isGenerating?: boolean;
  showVideoStatus?: boolean;
}> = ({ index, segment, audioStatus, videoStatus, audioUrl, videoUrl, onRegenerateAudio, onRegenerateVideo, isGenerating = false, showVideoStatus = true }) => (
  <div className={`bg-white/[0.02] rounded-xl border p-4 transition-all ${
    audioStatus === 'in_progress' ? 'border-accent-500/50 shadow-lg shadow-accent-500/10' : 'border-white/5'
  }`}>
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-medium text-white flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/60">
          {index + 1}
        </span>
        {segment.speaker}
      </span>
      <div className="flex items-center gap-2">
        {/* Audio Status */}
        <span className={`
          text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium
          ${audioStatus === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : ''}
          ${audioStatus === 'in_progress' ? 'bg-accent-500/10 text-accent-400 animate-pulse' : ''}
          ${audioStatus === 'failed' ? 'bg-red-500/10 text-red-400' : ''}
          ${audioStatus === 'pending' ? 'bg-white/5 text-white/30' : ''}
        `}>
          🎙️ {audioStatus === 'completed' ? '✓' : audioStatus === 'in_progress' ? '...' : audioStatus === 'failed' ? '✗' : '—'}
        </span>
        
        {/* Video Status - only show if requested */}
        {showVideoStatus && (
          <span className={`
            text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium
            ${videoStatus === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : ''}
            ${videoStatus === 'in_progress' ? 'bg-violet-500/10 text-violet-400 animate-pulse' : ''}
            ${videoStatus === 'failed' ? 'bg-red-500/10 text-red-400' : ''}
            ${videoStatus === 'pending' ? 'bg-white/5 text-white/30' : ''}
          `}>
            🎬 {videoStatus === 'completed' ? '✓' : videoStatus === 'in_progress' ? '...' : videoStatus === 'failed' ? '✗' : '—'}
          </span>
        )}
      </div>
    </div>
    
    <p className="text-sm text-white/50 line-clamp-2">{segment.text}</p>
    
    {/* Actions */}
    <div className="flex items-center gap-2 mt-3 flex-wrap">
      {/* Audio Player - show when completed */}
      {audioStatus === 'completed' && audioUrl && (
        <audio src={audioUrl} controls className="h-8 flex-1 min-w-[150px] opacity-80" />
      )}
      
      {/* Regenerate Audio Button - show when completed or failed, but not while generating */}
      {(audioStatus === 'completed' || audioStatus === 'failed') && onRegenerateAudio && !isGenerating && (
        <button 
          onClick={onRegenerateAudio}
          className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
            audioStatus === 'failed' 
              ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400' 
              : 'bg-white/5 hover:bg-white/10 text-white/50 hover:text-white'
          }`}
        >
          🔄 {audioStatus === 'failed' ? 'Retry' : 'Regen'}
        </button>
      )}
      
      {/* In Progress Indicator */}
      {audioStatus === 'in_progress' && (
        <div className="flex items-center gap-2 text-accent-400 text-sm">
          <div className="w-4 h-4 border-2 border-accent-400 border-t-transparent rounded-full animate-spin" />
          <span>Generating audio...</span>
        </div>
      )}
      
      {/* Video Link - show when completed */}
      {videoStatus === 'completed' && videoUrl && (
        <a 
          href={videoUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 px-3 py-1.5 rounded-lg transition-all"
        >
          👁️ View Video
        </a>
      )}
      
      {/* Regenerate Video Button */}
      {(videoStatus === 'completed' || videoStatus === 'failed') && onRegenerateVideo && !isGenerating && (
        <button 
          onClick={onRegenerateVideo}
          className={`text-xs px-3 py-1.5 rounded-lg transition-all ${
            videoStatus === 'failed' 
              ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400' 
              : 'bg-white/5 hover:bg-white/10 text-white/50 hover:text-white'
          }`}
        >
          🔄 {videoStatus === 'failed' ? 'Retry Video' : 'Regen Video'}
        </button>
      )}
    </div>
  </div>
);

// =============================================================================================
// SCRIPT HISTORY PANEL - Shows previously generated scripts with scores
// =============================================================================================

const ScriptHistoryPanel: React.FC<{
  history: ScriptHistoryItem[];
  currentScriptId?: string;
  onRestore: (item: ScriptHistoryItem) => void;
  onClose: () => void;
  hostAName: string;
  hostBName: string;
}> = ({ history, currentScriptId, onRestore, onClose, hostAName, hostBName }) => {
  if (history.length === 0) {
    return (
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-white flex items-center gap-2">
            <span>📜</span> Script History
          </h4>
          <button onClick={onClose} className="text-white/40 hover:text-white text-sm">✕</button>
        </div>
        <p className="text-xs text-white/40 text-center py-4">
          No previous scripts. Generate your first script to start the history.
        </p>
      </div>
    );
  }

  // Sort by date, newest first
  const sortedHistory = [...history].sort((a, b) => 
    new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );

  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 mb-4 max-h-[350px] overflow-hidden flex flex-col">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h4 className="text-sm font-medium text-white flex items-center gap-2">
          <span>📜</span> Script History ({history.length})
        </h4>
        <button onClick={onClose} className="text-white/40 hover:text-white text-sm transition-colors">✕</button>
      </div>
      
      <div className="overflow-y-auto space-y-2 flex-1 pr-1 scrollbar-thin">
        {sortedHistory.map((item, index) => {
          const isCurrentScript = sortedHistory.indexOf(item) === 0;
          const score = item.analysis?.overallScore;
          const hasImprovements = item.improvements && 
            (item.improvements.implement.length > 0 || item.improvements.maintain.length > 0);
          
          return (
            <div 
              key={item.id}
              className={`
                p-3 rounded-xl border transition-all
                ${isCurrentScript 
                  ? 'border-accent-500/30 bg-accent-500/5' 
                  : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
                }
              `}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {/* Header Row */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-white/30 font-mono">
                      #{history.length - index}
                    </span>
                    {isCurrentScript && (
                      <span className="text-[10px] bg-accent-500/20 text-accent-400 px-1.5 py-0.5 rounded-full font-medium">
                        CURRENT
                      </span>
                    )}
                    {hasImprovements && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">
                        IMPROVED
                      </span>
                    )}
                  </div>
                  
                  {/* Title */}
                  <p className="text-sm text-white font-medium line-clamp-1">
                    {item.viralMetadata.title}
                  </p>
                  
                  {/* Metadata */}
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-white/30">
                    <span>
                      {new Date(item.generatedAt).toLocaleString('en-US', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    <span>
                      {Object.keys(item.scenes.scenes).length} scenes
                    </span>
                    <span className="text-violet-400/70">
                      {item.scenes.narrative_used}
                    </span>
                  </div>
                </div>
                
                {/* Score Badge */}
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  {score !== undefined ? (
                    <div className={`
                      text-lg font-bold px-2.5 py-0.5 rounded-lg
                      ${score >= 80 ? 'text-emerald-400 bg-emerald-500/10' : ''}
                      ${score >= 60 && score < 80 ? 'text-amber-400 bg-amber-500/10' : ''}
                      ${score < 60 ? 'text-red-400 bg-red-500/10' : ''}
                    `}>
                      {score}
                    </div>
                  ) : (
                    <div className="text-xs text-white/30 bg-white/5 px-2 py-1 rounded-lg">
                      No score
                    </div>
                  )}
                  
                  {/* Restore Button */}
                  {!isCurrentScript && (
                    <button
                      onClick={() => onRestore(item)}
                      className="text-[10px] bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 px-2 py-1 rounded-lg transition-all font-medium"
                    >
                      ↩ Restore
                    </button>
                  )}
                </div>
              </div>
              
              {/* Preview of first scene */}
              <div className="mt-2 text-[11px] text-white/40 line-clamp-2 bg-black/20 p-2 rounded-lg">
                <span className="text-violet-400">
                  {item.scenes.scenes['1']?.video_mode === 'hostA' ? hostAName : hostBName}:
                </span>{' '}
                {item.scenes.scenes['1']?.text.slice(0, 100)}...
              </div>
              
              {/* Score breakdown if available */}
              {item.analysis && (
                <div className="flex items-center gap-3 mt-2 text-[10px]">
                  <span className="text-white/30">🎯 {item.analysis.hookScore}</span>
                  <span className="text-white/30">⏱️ {item.analysis.retentionScore}</span>
                  <span className="text-white/30">🔄 {item.analysis.pacingScore}</span>
                  <span className="text-white/30">💬 {item.analysis.engagementScore}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// =============================================================================================
// MAIN WIZARD COMPONENT
// =============================================================================================

export const ProductionWizard: React.FC<ProductionWizardProps> = ({
  production,
  channel,
  config,
  user,
  onUpdateProduction,
  onClose,
  onFetchNews,
  onGenerateScript,
  onGenerateAudio,
  onGenerateVideo
}) => {
  // Initialize wizard state
  const [wizardState, setWizardState] = useState<ProductionWizardState>(
    production.wizard_state || createEmptyWizardState()
  );
  
  // Local state - use localProduction to avoid stale prop issues during navigation
  const [localProduction, setLocalProduction] = useState<Production>(production);
  const [fetchedNews, setFetchedNews] = useState<NewsItem[]>(production.fetched_news || []);
  const [selectedNewsIds, setSelectedNewsIds] = useState<string[]>(production.selected_news_ids || []);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  
  // Micro-updates: detailed progress messages for better UX
  const [progressStatus, setProgressStatus] = useState<{
    message: string;
    detail?: string;
    progress?: number; // 0-100
  } | null>(null);
  
  // Script analysis for YouTube Shorts
  const [scriptAnalysis, setScriptAnalysis] = useState<ScriptAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Selected improvements for script regeneration
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [selectedStrengths, setSelectedStrengths] = useState<Set<number>>(new Set());
  
  // Script history for comparison (v2.5)
  const [scriptHistory, setScriptHistory] = useState<ScriptHistoryItem[]>(production.script_history || []);
  const [showScriptHistory, setShowScriptHistory] = useState(false);
  
  // Close confirmation dialog (v2.8 - UX improvement)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  
  // Narrative style selection for script generation
  const [selectedNarrative, setSelectedNarrative] = useState<'auto' | 'classic' | 'double_conflict' | 'hot_take' | 'perspective_clash'>('auto');
  
  // Internationalization - get translations based on channel language
  const t = getTranslationsForChannel(config.language);
  
  // Restore a script from history
  const handleRestoreScript = useCallback(async (historyItem: ScriptHistoryItem) => {
    const scenes = historyItem.scenes;
    const segments: BroadcastSegment[] = Object.entries(scenes.scenes).map(([key, scene]) => ({
      speaker: scene.video_mode === 'hostA' ? config.characters.hostA.name : config.characters.hostB.name,
      text: scene.text,
      audioBase64: '',
      sceneTitle: scene.title,
      sceneIndex: parseInt(key)
    }));
    
    const updatedProduction: Production = {
      ...localProduction,
      scenes: scenes,
      viral_metadata: historyItem.viralMetadata,
      segments: segments,
      narrative_used: scenes.narrative_used
    };
    
    await saveProduction(updatedProduction);
    setLocalProduction(updatedProduction);
    onUpdateProduction(updatedProduction);
    
    // If the restored script had an analysis, restore that too
    if (historyItem.analysis) {
      setScriptAnalysis({
        overallScore: historyItem.analysis.overallScore,
        hookScore: historyItem.analysis.hookScore,
        hookFeedback: '',
        retentionScore: historyItem.analysis.retentionScore,
        retentionFeedback: '',
        pacingScore: historyItem.analysis.pacingScore,
        pacingFeedback: '',
        engagementScore: historyItem.analysis.engagementScore,
        engagementFeedback: '',
        suggestions: historyItem.analysis.suggestions,
        strengths: historyItem.analysis.strengths
      });
    } else {
      setScriptAnalysis(null);
    }
    
    // Clear selections
    setSelectedSuggestions(new Set());
    setSelectedStrengths(new Set());
    setShowScriptHistory(false);
    
    toast.success(`✨ Script restaurado (v${scriptHistory.indexOf(historyItem) + 1})`);
  }, [config, localProduction, scriptHistory, onUpdateProduction]);

  // Ref to always have the latest production (avoids stale closures)
  const productionRef = React.useRef(localProduction);
  productionRef.current = localProduction;
  
  // Ref for step indicator scroll container
  const stepIndicatorScrollRef = React.useRef<HTMLDivElement>(null);
  
  // Sync localProduction when prop changes from parent
  useEffect(() => {
    setLocalProduction(production);
  }, [production]);

  // Sync wizard state when production prop changes (e.g., when production is loaded/updated externally)
  useEffect(() => {
    if (production.wizard_state) {
      setWizardState(production.wizard_state);
    }
    if (production.fetched_news) {
      setFetchedNews(production.fetched_news);
    }
    if (production.selected_news_ids) {
      setSelectedNewsIds(production.selected_news_ids);
    }
    // Sync script history when production changes
    if (production.script_history) {
      setScriptHistory(production.script_history);
    }
  }, [production.id]); // Only sync when production ID changes (loading a different production)
  

  // All wizard steps
  const allSteps: ProductionStep[] = [
    'news_fetch', 'news_select', 'script_generate', 'script_review',
    'audio_generate', 'video_generate', 'render_final', 'publish', 'done'
  ];

  // Save wizard state to production - ONLY updates wizard_state, not other fields
  // IMPORTANT: This must be defined before functions that use it
  const saveWizardState = useCallback(async (newState: ProductionWizardState) => {
    setWizardState(newState);
    
    // Only update wizard-specific fields to avoid overwriting other data like scenes
    const partialUpdate: Partial<Production> = {
      id: production.id,
      wizard_state: newState,
      fetched_news: fetchedNews,
      selected_news_ids: selectedNewsIds,
      updated_at: new Date().toISOString(),
      last_checkpoint_at: new Date().toISOString()
    };
    
    await saveProduction(partialUpdate as Production);
    
    // Merge with current production to preserve all fields
    const updatedProduction: Production = {
      ...production,
      ...partialUpdate
    };
    onUpdateProduction(updatedProduction);
  }, [production, fetchedNews, selectedNewsIds, onUpdateProduction]);

  // Update a specific step's status
  const updateStepStatus = useCallback(async (
    step: keyof Omit<ProductionWizardState, 'currentStep'>,
    status: SubStepStatus,
    data?: any
  ) => {
    const newState: ProductionWizardState = {
      ...wizardState,
      [step]: {
        ...wizardState[step],
        status,
        ...(status === 'in_progress' ? { startedAt: new Date().toISOString() } : {}),
        ...(status === 'completed' ? { completedAt: new Date().toISOString() } : {}),
        ...(data ? { data: { ...(wizardState[step] as any).data, ...data } } : {})
      }
    };
    await saveWizardState(newState);
  }, [wizardState, saveWizardState]);

  // Move to next step
  const goToNextStep = useCallback(async () => {
    const nextStep = getNextProductionStep(wizardState.currentStep);
    if (nextStep) {
      const newState: ProductionWizardState = {
        ...wizardState,
        currentStep: nextStep
      };
      await saveWizardState(newState);
    }
  }, [wizardState, saveWizardState]);

  // Helper to check if step can be navigated to
  const canNavigateToStep = useCallback((step: ProductionStep): boolean => {
    // Always allow going to current step
    if (step === wizardState.currentStep) return true;
    
    // Get step statuses
    const stepStates: Record<string, SubStepStatus> = {
      'news_fetch': wizardState.newsFetch.status,
      'news_select': wizardState.newsSelect.status,
      'script_generate': wizardState.scriptGenerate.status,
      'script_review': wizardState.scriptReview.status,
      'audio_generate': wizardState.audioGenerate.status,
      'video_generate': wizardState.videoGenerate.status,
      'render_final': wizardState.renderFinal.status,
      'publish': wizardState.publish.status,
    };
    
    // Allow navigation to completed steps
    if (stepStates[step] === 'completed') return true;
    
    // Check prerequisites for forward navigation
    switch (step) {
      case 'news_fetch': return true;
      case 'news_select': return fetchedNews.length > 0;
      case 'script_generate': return selectedNewsIds.length > 0;
      case 'script_review': return !!localProduction.scenes?.scenes;
      case 'audio_generate': return !!localProduction.segments?.length;
      case 'video_generate': 
        return Object.values(localProduction.segment_status || {}).some(s => s?.audio === 'done');
      case 'render_final':
        return Object.values(localProduction.segment_status || {}).some(s => s?.video === 'done');
      case 'publish': return !!localProduction.final_video_url;
      default: return false;
    }
  }, [wizardState, fetchedNews, selectedNewsIds, localProduction]);

  // Handle step click navigation
  const handleStepClick = useCallback(async (step: ProductionStep) => {
    if (!canNavigateToStep(step)) {
      toast.error('No puedes navegar a este paso aún');
      return;
    }
    
    if (step === wizardState.currentStep) return; // Already on this step
    
    const newState: ProductionWizardState = {
      ...wizardState,
      currentStep: step
    };
    await saveWizardState(newState);
    toast.success(`Navegando a: ${getStepDisplayName(step)}`);
  }, [wizardState, canNavigateToStep, saveWizardState]);

  // Auto-detect and navigate to pending regenerations on mount
  useEffect(() => {
    const detectPendingWork = () => {
      if (!production.segment_status) return;
      
      const statuses = Object.entries(production.segment_status);
      const audiosPending = statuses.filter(([_, s]) => s.audio === 'pending').map(([i]) => parseInt(i));
      const videosPending = statuses.filter(([_, s]) => s.video === 'pending' && s.audio === 'done').map(([i]) => parseInt(i));
      
      // If there are pending audios and we're past audio step, go back
      if (audiosPending.length > 0 && ['video_generate', 'render_final', 'publish', 'done'].includes(wizardState.currentStep)) {
        toast(`📌 ${audiosPending.length} audio(s) pendiente(s) de regeneración`, { icon: '🎙️' });
        setWizardState(prev => ({ ...prev, currentStep: 'audio_generate' }));
      }
      // If there are pending videos and we're past video step
      else if (videosPending.length > 0 && ['render_final', 'publish', 'done'].includes(wizardState.currentStep)) {
        toast(`📌 ${videosPending.length} video(s) pendiente(s) de regeneración`, { icon: '🎬' });
        setWizardState(prev => ({ ...prev, currentStep: 'video_generate' }));
      }
    };
    
    // Run detection after a short delay to allow state to settle
    const timer = setTimeout(detectPendingWork, 500);
    return () => clearTimeout(timer);
  }, [production.id]); // Only on production change

  // =============================================================================================
  // STEP HANDLERS
  // =============================================================================================

  // Step 1: Fetch News
  const handleFetchNews = async () => {
    setIsLoading(true);
    setProgressStatus({ message: 'Iniciando búsqueda...', progress: 5 });
    await updateStepStatus('newsFetch', 'in_progress');
    
    try {
      setProgressStatus({ message: 'Conectando con fuentes de noticias...', detail: 'Buscando las últimas noticias relevantes', progress: 15 });
      
      // Small delay to show progress updates
      await new Promise(r => setTimeout(r, 500));
      setProgressStatus({ message: 'Obteniendo noticias...', detail: 'Analizando múltiples fuentes', progress: 40 });
      
      const news = await onFetchNews();
      
      setProgressStatus({ message: 'Calculando puntuación viral...', detail: `${news.length} noticias encontradas`, progress: 70 });
      await new Promise(r => setTimeout(r, 300));
      
      setFetchedNews(news);
      
      setProgressStatus({ message: 'Guardando en base de datos...', detail: 'Almacenando noticias para tu canal', progress: 85 });
      
      await updateStepStatus('newsFetch', 'completed', {
        fetchedNews: news,
        fetchedAt: new Date().toISOString(),
        source: config.topicToken || 'default'
      });
      
      setProgressStatus({ message: '¡Completado!', detail: `${news.length} noticias listas para seleccionar`, progress: 100 });
      await new Promise(r => setTimeout(r, 500));
      
      // Auto-advance to selection
      const newState: ProductionWizardState = {
        ...wizardState,
        currentStep: 'news_select',
        newsFetch: {
          ...wizardState.newsFetch,
          status: 'completed',
          completedAt: new Date().toISOString(),
          data: { fetchedNews: news, fetchedAt: new Date().toISOString() }
        }
      };
      await saveWizardState(newState);
      
      toast.success(`¡${news.length} noticias encontradas!`);
    } catch (error) {
      setProgressStatus({ message: 'Error', detail: (error as Error).message });
      await updateStepStatus('newsFetch', 'failed', { error: (error as Error).message });
      toast.error(`Error: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
      setProgressStatus(null);
    }
  };

  // Step 2: Confirm news selection
  const handleConfirmSelection = async () => {
    if (selectedNewsIds.length === 0) {
      toast.error('Selecciona al menos una noticia');
      return;
    }
    
    await updateStepStatus('newsSelect', 'completed', {
      selectedIds: selectedNewsIds,
      confirmedAt: new Date().toISOString()
    });
    
    // Update production with selected news
    const updatedProduction: Production = {
      ...production,
      selected_news_ids: selectedNewsIds,
      fetched_news: fetchedNews
    };
    await saveProduction(updatedProduction);
    onUpdateProduction(updatedProduction);
    
    // Advance to script generation
    const newState: ProductionWizardState = {
      ...wizardState,
      currentStep: 'script_generate',
      newsSelect: {
        ...wizardState.newsSelect,
        status: 'completed',
        completedAt: new Date().toISOString(),
        data: { selectedIds: selectedNewsIds, confirmedAt: new Date().toISOString() }
      }
    };
    await saveWizardState(newState);
    
    toast.success('Noticias seleccionadas');
  };

  // Step 3: Generate script
  const handleGenerateScript = async () => {
    setIsLoading(true);
    setProgressStatus({ message: 'Preparando generación del guión...', progress: 5 });
    await updateStepStatus('scriptGenerate', 'in_progress');
    
    try {
      const selectedNews = fetchedNews.filter(n => selectedNewsIds.includes(n.id || n.headline));
      
      setProgressStatus({ 
        message: 'Analizando noticias seleccionadas...', 
        detail: `${selectedNews.length} noticias a procesar`,
        progress: 15 
      });
      
      await new Promise(r => setTimeout(r, 300));
      setProgressStatus({ 
        message: 'Generando estructura narrativa...', 
        detail: 'La IA está creando el guión con estilo podcast',
        progress: 30 
      });
      
      // Pass narrative override if user selected a specific style (not 'auto')
      const narrativeOverride = selectedNarrative !== 'auto' ? selectedNarrative : undefined;
      const result = await onGenerateScript(selectedNews, undefined, narrativeOverride);
      
      setProgressStatus({ 
        message: 'Procesando escenas...', 
        detail: `${Object.keys(result.scenes.scenes).length} escenas generadas`,
        progress: 70 
      });
      
      // Update production with script
      const scenes = result.scenes;
      const segments: BroadcastSegment[] = Object.entries(scenes.scenes).map(([key, scene]) => ({
        speaker: scene.video_mode === 'hostA' ? config.characters.hostA.name : config.characters.hostB.name,
        text: scene.text,
        audioBase64: '',
        sceneTitle: scene.title,
        sceneIndex: parseInt(key)
      }));
      
      setProgressStatus({ 
        message: 'Guardando guión...', 
        detail: 'Almacenando en la base de datos',
        progress: 85 
      });
      
      // Save to script history before updating production
      // Use production.script_history as source of truth (not local state which might be stale)
      const existingHistory = production.script_history || [];
      const newHistoryItem: ScriptHistoryItem = {
        id: crypto.randomUUID(),
        generatedAt: new Date().toISOString(),
        scenes: scenes,
        viralMetadata: result.metadata,
        analysis: undefined // Will be filled when analyzed
      };
      
      const updatedHistory = [...existingHistory, newHistoryItem];
      setScriptHistory(updatedHistory);
      
      const updatedProduction: Production = {
        ...production,
        scenes: scenes,
        viral_metadata: result.metadata,
        segments: segments,
        narrative_used: scenes.narrative_used,
        script_history: updatedHistory
      };
      
      await saveProduction(updatedProduction);
      setLocalProduction(updatedProduction); // Update local state immediately
      onUpdateProduction(updatedProduction);
      
      await updateStepStatus('scriptGenerate', 'completed', {
        narrativeType: scenes.narrative_used,
        generatedAt: new Date().toISOString()
      });
      
      setProgressStatus({ message: '¡Guión completado!', progress: 100 });
      await new Promise(r => setTimeout(r, 400));
      
      // AUTO-ANALYZE: Automatically analyze the script after generation
      setProgressStatus({ message: 'Analizando guión...', detail: 'Evaluando potencial viral', progress: 95 });
      try {
        const analysis = await analyzeScriptForShorts(
          scenes.scenes,
          config.characters.hostA.name,
          config.characters.hostB.name,
          config.language
        );
        setScriptAnalysis(analysis);
        
        // Update the history item with analysis
        const historyWithAnalysis = [...updatedHistory];
        historyWithAnalysis[historyWithAnalysis.length - 1] = {
          ...historyWithAnalysis[historyWithAnalysis.length - 1],
          analysis: {
            overallScore: analysis.overallScore,
            hookScore: analysis.hookScore,
            retentionScore: analysis.retentionScore,
            pacingScore: analysis.pacingScore,
            engagementScore: analysis.engagementScore,
            suggestions: analysis.suggestions,
            strengths: analysis.strengths
          }
        };
        
        // Save updated history with analysis
        const productionWithAnalysis: Production = {
          ...updatedProduction,
          script_history: historyWithAnalysis
        };
        await saveProduction(productionWithAnalysis);
        setLocalProduction(productionWithAnalysis);
        setScriptHistory(historyWithAnalysis);
        
        console.log(`✅ [Wizard] Auto-analysis complete: ${analysis.overallScore}/100`);
      } catch (analysisError) {
        console.warn('[Wizard] Auto-analysis failed, will need manual analysis:', analysisError);
        // Don't fail the whole flow, user can analyze manually
      }
      
      // Advance to review
      const newState: ProductionWizardState = {
        ...wizardState,
        currentStep: 'script_review',
        scriptGenerate: {
          ...wizardState.scriptGenerate,
          status: 'completed',
          completedAt: new Date().toISOString()
        }
      };
      await saveWizardState(newState);
      
      toast.success('¡Guión generado!');
    } catch (error) {
      setProgressStatus({ message: 'Error', detail: (error as Error).message });
      await updateStepStatus('scriptGenerate', 'failed', { error: (error as Error).message });
      toast.error(`Error: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
      setProgressStatus(null);
    }
  };

  // Step 4: Approve script
  const handleApproveScript = async () => {
    await updateStepStatus('scriptReview', 'completed', {
      approvedAt: new Date().toISOString()
    });
    
    // Initialize segment status for audio generation
    const segments = production.segments || [];
    const initialSegmentStatus: Record<number, { audio: string; video: string }> = {};
    segments.forEach((_, i) => {
      initialSegmentStatus[i] = { audio: 'pending', video: 'pending' };
    });
    
    const updatedProduction: Production = {
      ...production,
      segment_status: initialSegmentStatus as any
    };
    await saveProduction(updatedProduction);
    onUpdateProduction(updatedProduction);
    
    // Advance to audio generation
    const newState: ProductionWizardState = {
      ...wizardState,
      currentStep: 'audio_generate',
      scriptReview: {
        ...wizardState.scriptReview,
        status: 'completed',
        completedAt: new Date().toISOString()
      },
      audioGenerate: {
        ...wizardState.audioGenerate,
        status: 'pending',
        data: {
          totalSegments: segments.length,
          completedSegments: 0,
          segmentProgress: {}
        }
      }
    };
    await saveWizardState(newState);
    
    toast.success('Guión aprobado');
  };

  // Step 5: Generate all audios IN PARALLEL (only pending ones)
  const handleGenerateAudios = async (specificIndex?: number) => {
    const segments = production.segments || [];
    if (segments.length === 0) {
      toast.error('No hay segmentos para generar');
      return;
    }
    
    setIsLoading(true);
    
    // If all audios are already done and no specific index, just advance
    const allDone = segments.every((_, i) => {
      const status = production.segment_status?.[i];
      return status?.audio === 'done' && status?.audioUrl;
    });
    
    if (allDone && specificIndex === undefined) {
      // Advance to video generation
      const newState: ProductionWizardState = {
        ...wizardState,
        currentStep: 'video_generate',
        audioGenerate: {
          ...wizardState.audioGenerate,
          status: 'completed',
          completedAt: new Date().toISOString()
        }
      };
      await saveWizardState(newState);
      setIsLoading(false);
      return;
    }
    
    // Use productionRef for most up-to-date status
    const currentProd = productionRef.current;
    
    await updateStepStatus('audioGenerate', 'in_progress', {
      totalSegments: segments.length,
      completedSegments: Object.values(currentProd.segment_status || {}).filter(s => s.audio === 'done').length
    });
    
    // Determine which segments to process
    const indicesToProcess = specificIndex !== undefined 
      ? [specificIndex] 
      : segments.map((_, i) => i).filter(i => {
          const status = currentProd.segment_status?.[i];
          return !status?.audio || status.audio !== 'done' || !status.audioUrl;
        });
    
    // Mark all as generating immediately
    let currentStatus = { ...(currentProd.segment_status || {}) };
    for (const i of indicesToProcess) {
      currentStatus = {
        ...currentStatus,
        [i]: { ...currentStatus[i], audio: 'generating' }
      };
    }
    let updatedProduction = { ...currentProd, segment_status: currentStatus as any };
    setLocalProduction(updatedProduction);
    onUpdateProduction(updatedProduction);
    
    // Update DB for all generating status
    await Promise.all(indicesToProcess.map(i => 
      updateSegmentStatus(currentProd.id, i, { audio: 'generating' })
    ));
    
    toast.success(`🎙️ Generando ${indicesToProcess.length} audios...`);
    
    // Shared state objects for real-time updates
    const liveStatus: Record<number, any> = { ...(currentProd.segment_status || {}) };
    const liveSegments = [...(currentProd.segments || [])];
    let successCount = 0;
    let failCount = 0;
    
    // Helper function to process a single audio
    const processAudio = async (i: number) => {
      const segment = segments[i];
      
      try {
        const result = await onGenerateAudio(i, segment.text, segment.speaker);
        
        // Update shared state and UI immediately when this audio completes
        liveStatus[i] = { ...liveStatus[i], audio: 'done', audioUrl: result.audioUrl };
        liveSegments[i] = { ...liveSegments[i], audioDuration: result.duration, audioUrl: result.audioUrl };
        successCount++;
        
        // Update UI in real-time
        const updated = { 
          ...productionRef.current, 
          segments: [...liveSegments],
          segment_status: { ...liveStatus } as any 
        };
        setLocalProduction(updated);
        onUpdateProduction(updated);
        
        // Update DB
        await updateSegmentStatus(currentProd.id, i, {
          audio: 'done',
          audioUrl: result.audioUrl
        });
        
        toast.success(`Audio ${i + 1} ✓`);
        return { index: i, success: true };
      } catch (error) {
        // Update shared state and UI immediately on failure
        liveStatus[i] = { ...liveStatus[i], audio: 'failed', error: (error as Error).message };
        failCount++;
        
        // Update UI in real-time
        const updated = { 
          ...productionRef.current, 
          segment_status: { ...liveStatus } as any 
        };
        setLocalProduction(updated);
        onUpdateProduction(updated);
        
        // Update DB
        await updateSegmentStatus(currentProd.id, i, {
          audio: 'failed',
          error: (error as Error).message
        });
        
        // Show more helpful error message
        const errorMsg = (error as Error).message;
        const friendlyError = errorMsg.includes('timeout') 
          ? `Audio ${i + 1}: Tiempo de espera agotado. Reintenta.`
          : errorMsg.includes('rate') || errorMsg.includes('limit') || errorMsg.includes('429')
          ? `Audio ${i + 1}: Límite de API alcanzado. Espera unos minutos.`
          : `Audio ${i + 1} falló: ${errorMsg.substring(0, 50)}`;
        toast.error(friendlyError);
        return { index: i, success: false };
      }
    };
    
    // Process audios with CONCURRENCY LIMIT of 2 (ElevenLabs limit)
    // This prevents 429 "Too Many Concurrent Requests" errors
    const CONCURRENCY_LIMIT = 2;
    
    for (let batchStart = 0; batchStart < indicesToProcess.length; batchStart += CONCURRENCY_LIMIT) {
      const batch = indicesToProcess.slice(batchStart, batchStart + CONCURRENCY_LIMIT);
      
      // Process batch in parallel (max 2 at a time)
      await Promise.allSettled(batch.map(i => processAudio(i)));
      
      // Small delay between batches to be safe with rate limits
      if (batchStart + CONCURRENCY_LIMIT < indicesToProcess.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    
    // Final save to DB with all updates
    const finalProduction = { 
      ...productionRef.current, 
      segments: liveSegments,
      segment_status: liveStatus as any 
    };
    setLocalProduction(finalProduction);
    await saveProduction(finalProduction);
    
    setIsLoading(false);
    
    // Check if all completed now
    const totalCompleted = Object.values(liveStatus).filter((s: any) => s.audio === 'done').length;
    
    if (totalCompleted === segments.length) {
      await updateStepStatus('audioGenerate', 'completed', {
        completedSegments: totalCompleted
      });
      
      // Advance to video generation
      const newState: ProductionWizardState = {
        ...wizardState,
        currentStep: 'video_generate',
        audioGenerate: {
          ...wizardState.audioGenerate,
          status: 'completed',
          completedAt: new Date().toISOString()
        },
        videoGenerate: {
          ...wizardState.videoGenerate,
          status: 'pending',
          data: {
            totalSegments: segments.length,
            completedSegments: 0,
            segmentProgress: {}
          }
        }
      };
      await saveWizardState(newState);
      
      toast.success(`🎉 ¡Todos los audios generados! (${successCount} nuevos)`);
    } else {
      const pendingCount = segments.length - totalCompleted;
      toast(`${totalCompleted}/${segments.length} audios listos. ${failCount > 0 ? `${failCount} fallaron.` : ''} ${pendingCount} pendientes.`);
    }
  };
  
  // Regenerate a single audio
  const handleRegenerateAudio = async (index: number) => {
    // Delete old audio from storage first (cleanup)
    await deleteAudioFromStorage(production.id, index);
    
    // Mark as pending first
    const pendingStatus = {
      ...(production.segment_status || {}),
      [index]: { ...(production.segment_status?.[index] || {}), audio: 'pending', audioUrl: undefined }
    };
    const updatedProduction = { ...production, segment_status: pendingStatus as any };
    onUpdateProduction(updatedProduction);
    await updateSegmentStatus(production.id, index, { audio: 'pending', audioUrl: undefined });
    
    // Now generate just this one
    await handleGenerateAudios(index);
  };

  // Update scene text (editable scenes in script_review)
  const handleUpdateSceneText = async (sceneIndex: string, newText: string) => {
    if (!localProduction.scenes?.scenes?.[sceneIndex]) return;
    
    // Create updated scenes with proper typing
    const updatedScenes: ScriptWithScenes = {
      title: localProduction.scenes.title,
      narrative_used: localProduction.scenes.narrative_used,
      scenes: {
        ...localProduction.scenes.scenes,
        [sceneIndex]: {
          ...localProduction.scenes.scenes[sceneIndex],
          text: newText
        }
      }
    };
    
    // Also update segments array to keep them in sync
    const updatedSegments = [...(localProduction.segments || [])];
    const segmentIdx = parseInt(sceneIndex);
    if (updatedSegments[segmentIdx]) {
      updatedSegments[segmentIdx] = {
        ...updatedSegments[segmentIdx],
        text: newText
      };
    }
    
    // Update production
    const updated: Production = {
      ...localProduction,
      scenes: updatedScenes,
      segments: updatedSegments
    };
    
    setLocalProduction(updated);
    await saveProduction(updated);
    onUpdateProduction(updated);
    
    // If audio was already generated for this segment, mark it as needing regeneration
    const status = localProduction.segment_status?.[segmentIdx];
    if (status?.audio === 'done') {
      await updateSegmentStatus(production.id, segmentIdx, { 
        audio: 'pending', // Mark as pending to indicate it needs regeneration
        audioUrl: undefined // Clear old URL
      });
      toast.success('Texto guardado. El audio necesita regenerarse.');
    } else {
      toast.success('Texto guardado');
    }
  };

  // Regenerate a single scene using AI
  const handleRegenerateScene = async (sceneIndex: string) => {
    const currentScene = localProduction.scenes?.scenes?.[sceneIndex];
    if (!currentScene) return;
    
    setIsLoading(true);
    try {
      toast.loading(`🔄 Regenerando escena ${parseInt(sceneIndex) + 1}...`, { id: 'regen-scene' });
      
      // Get context from surrounding scenes
      const allScenes = localProduction.scenes?.scenes || {};
      const sceneKeys = Object.keys(allScenes).sort((a, b) => parseInt(a) - parseInt(b));
      const currentIdx = sceneKeys.indexOf(sceneIndex);
      const prevScene = currentIdx > 0 ? allScenes[sceneKeys[currentIdx - 1]] : null;
      const nextScene = currentIdx < sceneKeys.length - 1 ? allScenes[sceneKeys[currentIdx + 1]] : null;
      
      // Call AI to regenerate
      const newScene = await regenerateScene(
        currentScene,
        prevScene?.text || null,
        nextScene?.text || null,
        config.characters.hostA.name,
        config.characters.hostB.name,
        config.language
      );
      
      if (!newScene) {
        throw new Error('No se pudo regenerar la escena');
      }
      
      // Ensure we have the full scenes structure
      if (!localProduction.scenes) {
        throw new Error('No hay escenas en la producción');
      }
      
      // Create updated scenes with proper typing
      const updatedScenes: ScriptWithScenes = {
        title: localProduction.scenes.title,
        narrative_used: localProduction.scenes.narrative_used,
        scenes: {
          ...localProduction.scenes.scenes,
          [sceneIndex]: {
            ...currentScene,
            text: newScene.text,
            title: newScene.title || currentScene.title
          }
        }
      };
      
      // Also update segments array
      const updatedSegments = [...(localProduction.segments || [])];
      const segmentIdx = parseInt(sceneIndex);
      if (updatedSegments[segmentIdx]) {
        updatedSegments[segmentIdx] = {
          ...updatedSegments[segmentIdx],
          text: newScene.text,
          sceneTitle: newScene.title || currentScene.title
        };
      }
      
      // Update production
      const updated: Production = {
        ...localProduction,
        scenes: updatedScenes,
        segments: updatedSegments
      };
      
      setLocalProduction(updated);
      await saveProduction(updated);
      onUpdateProduction(updated);
      
      // Mark audio as needing regeneration if it was already done
      const status = localProduction.segment_status?.[segmentIdx];
      if (status?.audio === 'done') {
        await updateSegmentStatus(production.id, segmentIdx, { 
          audio: 'pending', // Mark as pending to indicate needs regeneration
          audioUrl: undefined // Clear old URL
        });
      }
      
      toast.success(`✅ Escena ${parseInt(sceneIndex) + 1} regenerada`, { id: 'regen-scene' });
    } catch (error) {
      console.error('Error regenerating scene:', error);
      toast.error(`Error: ${(error as Error).message}`, { id: 'regen-scene' });
    } finally {
      setIsLoading(false);
    }
  };

  // Step 6: Generate all videos IN PARALLEL (only pending ones)
  const handleGenerateVideos = async (specificIndex?: number) => {
    const segments = production.segments || [];
    if (segments.length === 0) {
      toast.error('No hay segmentos para generar');
      return;
    }
    
    setIsLoading(true);
    
    // If all videos are already done and no specific index, just advance
    const allDone = segments.every((_, i) => {
      const status = production.segment_status?.[i];
      return status?.video === 'done' && status?.videoUrl;
    });
    
    if (allDone && specificIndex === undefined) {
      // Advance to render step
      const newState: ProductionWizardState = {
        ...wizardState,
        currentStep: 'render_final',
        videoGenerate: {
          ...wizardState.videoGenerate,
          status: 'completed',
          completedAt: new Date().toISOString()
        }
      };
      await saveWizardState(newState);
      setIsLoading(false);
      return;
    }
    
    // Use productionRef for most up-to-date status
    const currentProd = productionRef.current;
    
    await updateStepStatus('videoGenerate', 'in_progress', {
      totalSegments: segments.length,
      completedSegments: Object.values(currentProd.segment_status || {}).filter(s => s.video === 'done').length
    });
    
    // Determine which segments to process
    const indicesToProcess = specificIndex !== undefined 
      ? [specificIndex] 
      : segments.map((_, i) => i).filter(i => {
          const status = currentProd.segment_status?.[i];
          return !status?.video || status.video !== 'done' || !status.videoUrl;
        });
    
    // Check all segments have audio before starting - use current production ref
    const missingAudio = indicesToProcess.filter(i => !currentProd.segment_status?.[i]?.audioUrl);
    if (missingAudio.length > 0) {
      toast.error(`Segmentos ${missingAudio.map(i => i + 1).join(', ')}: No tienen audio. Genera los audios primero.`);
      setIsLoading(false);
      return;
    }
    
    // Mark all as generating immediately
    let currentStatus = { ...(currentProd.segment_status || {}) };
    for (const i of indicesToProcess) {
      currentStatus = {
        ...currentStatus,
        [i]: { ...currentStatus[i], video: 'generating' }
      };
    }
    let updatedProduction = { ...currentProd, segment_status: currentStatus as any };
    setLocalProduction(updatedProduction);
    onUpdateProduction(updatedProduction);
    
    // Update DB for all generating status
    await Promise.all(indicesToProcess.map(i => 
      updateSegmentStatus(currentProd.id, i, { video: 'generating' })
    ));
    
    toast.success(`🚀 Generando ${indicesToProcess.length} videos en paralelo...`);
    
    // Shared state object for real-time updates
    const liveStatus: Record<number, any> = { ...(currentProd.segment_status || {}) };
    let successCount = 0;
    let failCount = 0;
    
    // Generate all videos in PARALLEL with real-time UI updates
    await Promise.allSettled(
      indicesToProcess.map(async (i) => {
        const segment = segments[i];
        const audioUrl = currentProd.segment_status?.[i]?.audioUrl!;
        
        try {
          const result = await onGenerateVideo(i, audioUrl, segment.speaker);
          
          // Update shared state and UI immediately when this video completes
          liveStatus[i] = { ...liveStatus[i], video: 'done', videoUrl: result.videoUrl };
          successCount++;
          
          // Update UI in real-time
          const updated = { ...productionRef.current, segment_status: { ...liveStatus } as any };
          setLocalProduction(updated);
          onUpdateProduction(updated);
          
          // Update DB
          await updateSegmentStatus(currentProd.id, i, {
            video: 'done',
            videoUrl: result.videoUrl
          });
          
          toast.success(`Video ${i + 1} ✓`);
          return { index: i, success: true };
        } catch (error) {
          // Update shared state and UI immediately on failure
          liveStatus[i] = { ...liveStatus[i], video: 'failed', error: (error as Error).message };
          failCount++;
          
          // Update UI in real-time
          const updated = { ...productionRef.current, segment_status: { ...liveStatus } as any };
          setLocalProduction(updated);
          onUpdateProduction(updated);
          
          // Update DB
          await updateSegmentStatus(currentProd.id, i, {
            video: 'failed',
            error: (error as Error).message
          });
          
          toast.error(`Video ${i + 1} ✗`);
          return { index: i, success: false };
        }
      })
    );
    
    // Final save to DB with all updates
    const finalProduction = { ...productionRef.current, segment_status: liveStatus as any };
    setLocalProduction(finalProduction);
    await saveProduction(finalProduction);
    
    setIsLoading(false);
    
    // Check if all completed now
    const totalCompleted = Object.values(liveStatus).filter((s: any) => s.video === 'done').length;
    
    if (totalCompleted === segments.length) {
      await updateStepStatus('videoGenerate', 'completed', {
        completedSegments: totalCompleted
      });
      
      const newState: ProductionWizardState = {
        ...wizardState,
        currentStep: 'render_final',
        videoGenerate: {
          ...wizardState.videoGenerate,
          status: 'completed',
          completedAt: new Date().toISOString()
        }
      };
      await saveWizardState(newState);
      
      toast.success(`🎉 ¡Todos los videos generados! (${successCount} nuevos)`);
    } else {
      const pendingCount = segments.length - totalCompleted;
      toast(`${totalCompleted}/${segments.length} videos listos. ${failCount > 0 ? `${failCount} fallaron.` : ''} ${pendingCount} pendientes.`);
    }
  };
  
  // Regenerate a single video
  const handleRegenerateVideo = async (index: number) => {
    // Mark as pending first
    const pendingStatus = {
      ...(production.segment_status || {}),
      [index]: { ...(production.segment_status?.[index] || {}), video: 'pending', videoUrl: undefined }
    };
    const updatedProduction = { ...production, segment_status: pendingStatus as any };
    onUpdateProduction(updatedProduction);
    await updateSegmentStatus(production.id, index, { video: 'pending', videoUrl: undefined });
    
    // Now generate just this one
    await handleGenerateVideos(index);
  };

  // Step 7: Render final video
  const handleRenderFinal = async () => {
    setIsLoading(true);
    await updateStepStatus('renderFinal', 'in_progress', {
      renderStartedAt: new Date().toISOString()
    });
    
    try {
      // Use productionRef for most up-to-date data
      const currentProd = productionRef.current;
      const result = await renderProductionToShotstack(currentProd, channel.name, config.format);
      
      if (result.success && result.videoUrl) {
        const updatedProduction: Production = {
          ...currentProd,
          final_video_url: result.videoUrl,
          final_video_poster: result.posterUrl,
          status: 'completed',
          completed_at: new Date().toISOString()
        };
        await saveProduction(updatedProduction);
        setLocalProduction(updatedProduction);
        onUpdateProduction(updatedProduction);
        
        await updateStepStatus('renderFinal', 'completed', {
          videoUrl: result.videoUrl,
          posterUrl: result.posterUrl,
          renderId: result.renderId
        });
        
        const newState: ProductionWizardState = {
          ...wizardState,
          currentStep: 'publish',
          renderFinal: {
            ...wizardState.renderFinal,
            status: 'completed',
            completedAt: new Date().toISOString(),
            data: { videoUrl: result.videoUrl, posterUrl: result.posterUrl }
          }
        };
        await saveWizardState(newState);
        
        toast.success('¡Video renderizado!');
      } else {
        throw new Error(result.error || 'Error desconocido');
      }
    } catch (error) {
      await updateStepStatus('renderFinal', 'failed', { error: (error as Error).message });
      toast.error(`Error: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 8: Publish to YouTube
  const handlePublish = async () => {
    if (!user?.accessToken) {
      toast.error('Necesitas conectar tu cuenta de YouTube');
      return;
    }
    
    if (!production.final_video_url || !production.viral_metadata) {
      toast.error('Falta el video o metadata');
      return;
    }
    
    setIsLoading(true);
    await updateStepStatus('publish', 'in_progress');
    
    try {
      const response = await fetch(production.final_video_url);
      const videoBlob = await response.blob();
      
      const isShort = config.format === '9:16';
      const metadata = {
        ...production.viral_metadata,
        tags: isShort 
          ? ['Shorts', ...(production.viral_metadata.tags || [])]
          : production.viral_metadata.tags,
        description: isShort
          ? `${production.viral_metadata.description}\n\n#Shorts`
          : production.viral_metadata.description
      };
      
      const youtubeUrl = await uploadVideoToYouTube(
        videoBlob,
        metadata,
        user.accessToken,
        null,
        () => {}, // onProgress callback (not used in wizard)
        config.language // Pass channel language for YouTube metadata
      );
      
      const youtubeId = youtubeUrl.split('/').pop() || '';
      
      const updatedProduction: Production = {
        ...production,
        youtube_id: youtubeId,
        published_at: new Date().toISOString()
      };
      await saveProduction(updatedProduction);
      onUpdateProduction(updatedProduction);
      
      await updateStepStatus('publish', 'completed', {
        youtubeId,
        publishedAt: new Date().toISOString(),
        isShort
      });
      
      const newState: ProductionWizardState = {
        ...wizardState,
        currentStep: 'done',
        publish: {
          ...wizardState.publish,
          status: 'completed',
          completedAt: new Date().toISOString(),
          data: { youtubeId, publishedAt: new Date().toISOString(), isShort }
        }
      };
      await saveWizardState(newState);
      
      toast.success('¡Publicado en YouTube!');
    } catch (error) {
      await updateStepStatus('publish', 'failed', { error: (error as Error).message });
      toast.error(`Error: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // =============================================================================================
  // RENDER
  // =============================================================================================

  const renderStepContent = () => {
    switch (wizardState.currentStep) {
      // Step 1: Fetch News
      case 'news_fetch':
        return (
          <div className="space-y-6">
            <div className="text-center py-8">
              <span className="text-6xl mb-4 block">📰</span>
              <h3 className="text-2xl font-bold text-white mb-2">Buscar Noticias</h3>
              <p className="text-gray-400 max-w-md mx-auto">
                Buscaremos las últimas noticias relevantes para tu canal "{channel.name}".
                Después podrás seleccionar cuáles usar.
              </p>
            </div>
            
            {fetchedNews.length > 0 ? (
              <div className="bg-green-900/20 border border-green-500/30 p-4 rounded-lg">
                <p className="text-green-400">
                  ✓ Ya tienes {fetchedNews.length} noticias cargadas. Puedes continuar o buscar nuevas.
                </p>
              </div>
            ) : null}
            
            {/* Progress Status Indicator */}
            {isLoading && progressStatus && (
              <div className="bg-[#1a1a1a] border border-cyan-500/30 rounded-xl p-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                  <div className="flex-1">
                    <p className="text-white font-medium">{progressStatus.message}</p>
                    {progressStatus.detail && (
                      <p className="text-gray-400 text-sm">{progressStatus.detail}</p>
                    )}
                  </div>
                </div>
                {progressStatus.progress !== undefined && (
                  <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
                      style={{ width: `${progressStatus.progress}%` }}
                    />
                  </div>
                )}
              </div>
            )}
            
            <div className="flex justify-center gap-4">
              <button
                onClick={handleFetchNews}
                disabled={isLoading}
                className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white px-8 py-4 rounded-xl font-bold text-lg shadow-lg"
              >
                {isLoading ? '⏳ Buscando...' : '🔍 Buscar Noticias'}
              </button>
              
              {fetchedNews.length > 0 && (
                <button
                  onClick={async () => {
                    const newState: ProductionWizardState = {
                      ...wizardState,
                      currentStep: 'news_select',
                      newsFetch: { ...wizardState.newsFetch, status: 'completed' }
                    };
                    await saveWizardState(newState);
                  }}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-8 py-4 rounded-xl font-bold text-lg"
                >
                  Usar Existentes →
                </button>
              )}
            </div>
          </div>
        );

      // Step 2: Select News
      case 'news_select':
        const hasConfirmedSelection = production.selected_news_ids && production.selected_news_ids.length > 0;
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">
                Selecciona las noticias ({selectedNewsIds.length} seleccionadas)
              </h3>
              <span className="text-sm text-gray-400">
                Recomendado: 2-4 noticias
              </span>
            </div>
            
            {hasConfirmedSelection && selectedNewsIds.length === production.selected_news_ids?.length && (
              <div className="bg-green-900/20 border border-green-500/30 p-3 rounded-lg">
                <p className="text-green-400 text-sm">
                  ✓ Ya tienes {selectedNewsIds.length} noticias seleccionadas. Puedes cambiar la selección o continuar.
                </p>
              </div>
            )}
            
            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
              {fetchedNews.map((news, i) => (
                <NewsItemCard
                  key={news.id || i}
                  news={news}
                  selected={selectedNewsIds.includes(news.id || news.headline)}
                  onToggle={() => {
                    const id = news.id || news.headline;
                    setSelectedNewsIds(prev => 
                      prev.includes(id) 
                        ? prev.filter(x => x !== id)
                        : [...prev, id]
                    );
                  }}
                />
              ))}
            </div>
            
            <div className="flex justify-between">
              <button
                onClick={async () => {
                  const newState: ProductionWizardState = {
                    ...wizardState,
                    currentStep: 'news_fetch'
                  };
                  await saveWizardState(newState);
                }}
                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg"
              >
                ← Volver
              </button>
              
              <button
                onClick={handleConfirmSelection}
                disabled={selectedNewsIds.length === 0}
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold"
              >
                {hasConfirmedSelection && selectedNewsIds.length > 0 ? '✓ Continuar →' : 'Confirmar Selección →'}
              </button>
            </div>
          </div>
        );

      // Step 3: Generate Script
      case 'script_generate':
        const hasExistingScript = localProduction.scenes?.scenes && Object.keys(localProduction.scenes.scenes).length > 0;
        return (
          <div className="space-y-6">
            <div className="text-center py-8">
              <span className="text-6xl mb-4 block">📝</span>
              <h3 className="text-2xl font-bold text-white mb-2">Generar Guión</h3>
              <p className="text-gray-400 max-w-md mx-auto">
                Generaremos un guión con {selectedNewsIds.length} noticias seleccionadas
                usando el estilo de "{config.tone}".
              </p>
            </div>
            
            {hasExistingScript && (
              <div className="bg-green-900/20 border border-green-500/30 p-4 rounded-lg">
                <p className="text-green-400">
                  ✓ Ya tienes un guión con {Object.keys(localProduction.scenes!.scenes).length} escenas. 
                  Puedes usarlo o regenerar uno nuevo.
                </p>
              </div>
            )}
            
            <div className="bg-[#1a1a1a] p-4 rounded-lg border border-[#333]">
              <h4 className="text-sm font-medium text-gray-400 mb-2">Noticias seleccionadas:</h4>
              <ul className="space-y-1">
                {fetchedNews
                  .filter(n => selectedNewsIds.includes(n.id || n.headline))
                  .map((news, i) => (
                    <li key={i} className="text-sm text-white">• {news.headline}</li>
                  ))}
              </ul>
            </div>
            
            {/* Narrative Style Selector */}
            <div className="bg-[#1a1a1a] p-4 rounded-lg border border-[#333]">
              <h4 className="text-sm font-medium text-gray-400 mb-3">🎭 Estilo de Narrativa</h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { value: 'auto', label: '🎲 Auto', desc: 'Selección automática según el contenido' },
                  { value: 'classic', label: '📰 Clásica', desc: 'Formato tradicional de noticias' },
                  { value: 'double_conflict', label: '⚔️ Conflicto', desc: 'Dos perspectivas enfrentadas' },
                  { value: 'hot_take', label: '🔥 Hot Take', desc: 'Opinión fuerte y provocativa' },
                  { value: 'perspective_clash', label: '💥 Debate', desc: 'Hosts con visiones opuestas' }
                ].map(({ value, label, desc }) => (
                  <button
                    key={value}
                    onClick={() => setSelectedNarrative(value as typeof selectedNarrative)}
                    title={desc}
                    className={`p-3 rounded-lg text-sm font-medium transition-all ${
                      selectedNarrative === value
                        ? 'bg-purple-600 text-white ring-2 ring-purple-400'
                        : 'bg-[#222] text-gray-300 hover:bg-[#333]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {selectedNarrative === 'auto' && '🎲 La IA elegirá el mejor estilo según las noticias'}
                {selectedNarrative === 'classic' && '📰 Estructura tradicional: Intro → Desarrollo → Cierre'}
                {selectedNarrative === 'double_conflict' && '⚔️ Dos fuentes de conflicto/tensión en la historia'}
                {selectedNarrative === 'hot_take' && '🔥 Opinión provocativa y directa al grano (más corto)'}
                {selectedNarrative === 'perspective_clash' && '💥 Los hosts debaten desde posturas opuestas'}
              </p>
            </div>
            
            {/* Progress Status Indicator */}
            {isLoading && progressStatus && (
              <div className="bg-[#1a1a1a] border border-purple-500/30 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                  <div className="flex-1">
                    <p className="text-white font-medium">{progressStatus.message}</p>
                    {progressStatus.detail && (
                      <p className="text-gray-400 text-sm">{progressStatus.detail}</p>
                    )}
                  </div>
                </div>
                {progressStatus.progress !== undefined && (
                  <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                      style={{ width: `${progressStatus.progress}%` }}
                    />
                  </div>
                )}
              </div>
            )}
            
            <div className="flex justify-between">
              <button
                onClick={async () => {
                  const newState: ProductionWizardState = {
                    ...wizardState,
                    currentStep: 'news_select'
                  };
                  await saveWizardState(newState);
                }}
                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg"
              >
                ← Volver
              </button>
              
              <div className="flex gap-3">
                <button
                  onClick={handleGenerateScript}
                  disabled={isLoading}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold"
                >
                  {isLoading ? '⏳ Generando...' : hasExistingScript ? '🔄 Regenerar Guión' : '✨ Generar Guión'}
                </button>
                
                {hasExistingScript && !isLoading && (
                  <button
                    onClick={async () => {
                      const newState: ProductionWizardState = {
                        ...wizardState,
                        currentStep: 'script_review',
                        scriptGenerate: { ...wizardState.scriptGenerate, status: 'completed' }
                      };
                      await saveWizardState(newState);
                    }}
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white px-8 py-3 rounded-lg font-bold"
                  >
                    ✓ Usar Existente →
                  </button>
                )}
              </div>
            </div>
          </div>
        );

      // Step 4: Review Script
      case 'script_review':
        const scenes = localProduction.scenes?.scenes || {};
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Revisar Guión</h3>
              <span className="text-sm text-gray-400">
                {Object.keys(scenes).length} escenas
              </span>
            </div>
            
            {localProduction.viral_metadata && (
              <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 p-4 rounded-lg border border-purple-500/30 flex items-center justify-between">
                <div>
                  <h4 className="text-purple-400 font-bold mb-1">📺 Título del Video</h4>
                  <p className="text-white text-lg">{localProduction.viral_metadata.title}</p>
                </div>
                {localProduction.viral_metadata.title && (
                  <button className="text-purple-400 hover:text-purple-300 p-2" title="Editar título">✏️</button>
                )}
              </div>
            )}
            
            {/* Script History Panel */}
            {showScriptHistory && scriptHistory.length > 0 && (
              <ScriptHistoryPanel
                history={scriptHistory}
                onRestore={handleRestoreScript}
                onClose={() => setShowScriptHistory(false)}
                hostAName={config.characters.hostA.name}
                hostBName={config.characters.hostB.name}
              />
            )}
            
            {/* Script Analysis for YouTube Shorts */}
            {Object.keys(scenes).length > 0 && (
              <div className="bg-[#1a1a1a] p-4 rounded-lg border border-[#333]">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-gray-300 flex items-center gap-2">
                    <span>📊</span> Análisis para YouTube Shorts
                  </h4>
                  <div className="flex items-center gap-2">
                    {/* History Button */}
                    {scriptHistory.length > 0 && (
                      <button
                        onClick={() => setShowScriptHistory(!showScriptHistory)}
                        className={`text-xs px-3 py-1 rounded transition-all flex items-center gap-1 ${
                          showScriptHistory 
                            ? 'bg-purple-600 text-white' 
                            : 'bg-purple-600/20 hover:bg-purple-600 text-purple-400 hover:text-white'
                        }`}
                      >
                        <span>📜</span>
                        Historial ({scriptHistory.length})
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        if (isAnalyzing) return;
                        setIsAnalyzing(true);
                        try {
                          const analysis = await analyzeScriptForShorts(
                            scenes,
                            config.characters.hostA.name,
                            config.characters.hostB.name,
                            config.language // Pass language for localized analysis
                          );
                          setScriptAnalysis(analysis);
                          
                          // Save analysis to the most recent script in history
                          // Use localProduction.script_history as source of truth
                          const existingHistory = localProduction.script_history || [];
                          if (existingHistory.length > 0) {
                            const updatedHistory = [...existingHistory];
                            const latestIndex = updatedHistory.length - 1;
                            updatedHistory[latestIndex] = {
                              ...updatedHistory[latestIndex],
                              analysis: {
                                overallScore: analysis.overallScore,
                                hookScore: analysis.hookScore,
                                retentionScore: analysis.retentionScore,
                                pacingScore: analysis.pacingScore,
                                engagementScore: analysis.engagementScore,
                                suggestions: analysis.suggestions,
                                strengths: analysis.strengths
                              }
                            };
                            setScriptHistory(updatedHistory);
                            
                            // Also update production with updated history
                            const updatedProduction: Production = {
                              ...localProduction,
                              script_history: updatedHistory
                            };
                            await saveProduction(updatedProduction);
                            onUpdateProduction(updatedProduction);
                          }
                          
                          toast.success('Análisis completado');
                        } catch (error) {
                          toast.error('Error al analizar');
                        } finally {
                          setIsAnalyzing(false);
                        }
                      }}
                      disabled={isAnalyzing}
                      className="text-xs bg-cyan-600/20 hover:bg-cyan-600 text-cyan-400 hover:text-white px-3 py-1 rounded transition-all disabled:opacity-50"
                    >
                      {isAnalyzing ? '⏳ Analizando...' : scriptAnalysis ? '🔄 Re-analizar' : '🎯 Analizar Script'}
                    </button>
                  </div>
                </div>
                
                {scriptAnalysis ? (
                  <div className="space-y-3">
                    {/* Overall Score */}
                    <div className="flex items-center gap-3">
                      <div className={`text-3xl font-bold ${
                        scriptAnalysis.overallScore >= 80 ? 'text-green-400' :
                        scriptAnalysis.overallScore >= 60 ? 'text-yellow-400' : 'text-red-400'
                      }`}>
                        {scriptAnalysis.overallScore}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs text-gray-400 mb-1">Score General</div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all ${
                              scriptAnalysis.overallScore >= 80 ? 'bg-green-500' :
                              scriptAnalysis.overallScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${scriptAnalysis.overallScore}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    
                    {/* Individual Scores */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-[#111] p-2 rounded">
                        <div className="text-xs text-gray-500 mb-1">🎯 Hook</div>
                        <div className={`text-lg font-bold ${scriptAnalysis.hookScore >= 70 ? 'text-green-400' : 'text-yellow-400'}`}>
                          {scriptAnalysis.hookScore}%
                        </div>
                        <div className="text-[10px] text-gray-500 line-clamp-1">{scriptAnalysis.hookFeedback}</div>
                      </div>
                      <div className="bg-[#111] p-2 rounded">
                        <div className="text-xs text-gray-500 mb-1">⏱️ Retención</div>
                        <div className={`text-lg font-bold ${scriptAnalysis.retentionScore >= 70 ? 'text-green-400' : 'text-yellow-400'}`}>
                          {scriptAnalysis.retentionScore}%
                        </div>
                        <div className="text-[10px] text-gray-500 line-clamp-1">{scriptAnalysis.retentionFeedback}</div>
                      </div>
                      <div className="bg-[#111] p-2 rounded">
                        <div className="text-xs text-gray-500 mb-1">🔄 Ritmo</div>
                        <div className={`text-lg font-bold ${scriptAnalysis.pacingScore >= 70 ? 'text-green-400' : 'text-yellow-400'}`}>
                          {scriptAnalysis.pacingScore}%
                        </div>
                        <div className="text-[10px] text-gray-500 line-clamp-1">{scriptAnalysis.pacingFeedback}</div>
                      </div>
                      <div className="bg-[#111] p-2 rounded">
                        <div className="text-xs text-gray-500 mb-1">💬 Engagement</div>
                        <div className={`text-lg font-bold ${scriptAnalysis.engagementScore >= 70 ? 'text-green-400' : 'text-yellow-400'}`}>
                          {scriptAnalysis.engagementScore}%
                        </div>
                        <div className="text-[10px] text-gray-500 line-clamp-1">{scriptAnalysis.engagementFeedback}</div>
                      </div>
                    </div>
                    
                    {/* Suggestions & Strengths with Checkboxes */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-gray-500 mb-2 flex items-center justify-between">
                          <span>💡 Sugerencias a implementar</span>
                          <button
                            onClick={() => {
                              if (selectedSuggestions.size === scriptAnalysis.suggestions.length) {
                                setSelectedSuggestions(new Set());
                              } else {
                                setSelectedSuggestions(new Set(scriptAnalysis.suggestions.map((_, i) => i)));
                              }
                            }}
                            className="text-[10px] text-yellow-400 hover:text-yellow-300"
                          >
                            {selectedSuggestions.size === scriptAnalysis.suggestions.length ? 'Ninguna' : 'Todas'}
                          </button>
                        </div>
                        <ul className="text-xs space-y-2">
                          {scriptAnalysis.suggestions.slice(0, 3).map((s, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={selectedSuggestions.has(i)}
                                onChange={(e) => {
                                  const newSet = new Set(selectedSuggestions);
                                  if (e.target.checked) {
                                    newSet.add(i);
                                  } else {
                                    newSet.delete(i);
                                  }
                                  setSelectedSuggestions(newSet);
                                }}
                                className="mt-0.5 w-3 h-3 accent-yellow-500 cursor-pointer flex-shrink-0"
                              />
                              <span className={selectedSuggestions.has(i) ? 'text-yellow-300' : 'text-gray-500'}>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-2 flex items-center justify-between">
                          <span>✅ Fortalezas a mantener</span>
                          <button
                            onClick={() => {
                              if (selectedStrengths.size === scriptAnalysis.strengths.length) {
                                setSelectedStrengths(new Set());
                              } else {
                                setSelectedStrengths(new Set(scriptAnalysis.strengths.map((_, i) => i)));
                              }
                            }}
                            className="text-[10px] text-green-400 hover:text-green-300"
                          >
                            {selectedStrengths.size === scriptAnalysis.strengths.length ? 'Ninguna' : 'Todas'}
                          </button>
                        </div>
                        <ul className="text-xs space-y-2">
                          {scriptAnalysis.strengths.slice(0, 3).map((s, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={selectedStrengths.has(i)}
                                onChange={(e) => {
                                  const newSet = new Set(selectedStrengths);
                                  if (e.target.checked) {
                                    newSet.add(i);
                                  } else {
                                    newSet.delete(i);
                                  }
                                  setSelectedStrengths(newSet);
                                }}
                                className="mt-0.5 w-3 h-3 accent-green-500 cursor-pointer flex-shrink-0"
                              />
                              <span className={selectedStrengths.has(i) ? 'text-green-300' : 'text-gray-500'}>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    
                    {/* Regenerate with Improvements Button */}
                    {(selectedSuggestions.size > 0 || selectedStrengths.size > 0) && (
                      <button
                        onClick={async () => {
                          const improvements = {
                            implement: scriptAnalysis.suggestions.filter((_, i) => selectedSuggestions.has(i)),
                            maintain: scriptAnalysis.strengths.filter((_, i) => selectedStrengths.has(i))
                          };
                          
                          setIsLoading(true);
                          setProgressStatus({ message: 'Regenerando con mejoras...', detail: `${improvements.implement.length} mejoras, ${improvements.maintain.length} fortalezas`, progress: 20 });
                          
                          try {
                            const selectedNews = fetchedNews.filter(n => selectedNewsIds.includes(n.id || n.headline));
                            const result = await onGenerateScript(selectedNews, improvements);
                            
                            setProgressStatus({ message: 'Procesando nuevo guión...', progress: 70 });
                            
                            const scenes = result.scenes;
                            const segments: BroadcastSegment[] = Object.entries(scenes.scenes).map(([key, scene]) => ({
                              speaker: scene.video_mode === 'hostA' ? config.characters.hostA.name : config.characters.hostB.name,
                              text: scene.text,
                              audioBase64: '',
                              sceneTitle: scene.title,
                              sceneIndex: parseInt(key)
                            }));
                            
                            // Save to script history with improvements info
                            // Use localProduction.script_history as source of truth (not local state which might be stale)
                            const existingHistory = localProduction.script_history || [];
                            const newHistoryItem: ScriptHistoryItem = {
                              id: crypto.randomUUID(),
                              generatedAt: new Date().toISOString(),
                              scenes: scenes,
                              viralMetadata: result.metadata,
                              analysis: undefined,
                              improvements
                            };
                            
                            const updatedHistory = [...existingHistory, newHistoryItem];
                            setScriptHistory(updatedHistory);
                            
                            const updatedProduction: Production = {
                              ...localProduction,
                              scenes: scenes,
                              viral_metadata: result.metadata,
                              segments: segments,
                              narrative_used: scenes.narrative_used,
                              script_history: updatedHistory
                            };
                            
                            await saveProduction(updatedProduction);
                            setLocalProduction(updatedProduction);
                            onUpdateProduction(updatedProduction);
                            
                            // Clear selections and analysis for fresh re-analysis
                            setScriptAnalysis(null);
                            setSelectedSuggestions(new Set());
                            setSelectedStrengths(new Set());
                            
                            setProgressStatus({ message: '¡Listo!', progress: 100 });
                            await new Promise(r => setTimeout(r, 300));
                            
                            toast.success('✨ Script regenerado con mejoras');
                          } catch (error) {
                            toast.error(`Error: ${(error as Error).message}`);
                          } finally {
                            setIsLoading(false);
                            setProgressStatus(null);
                          }
                        }}
                        disabled={isLoading}
                        className="w-full bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all"
                      >
                        {isLoading ? (
                          <>
                            <span className="animate-spin">⏳</span>
                            Regenerando...
                          </>
                        ) : (
                          <>
                            ✨ Regenerar Script con {selectedSuggestions.size + selectedStrengths.size} mejora(s)
                          </>
                        )}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 text-center py-2">
                    Haz clic en "Analizar Script" para ver qué tan efectivo es tu guión para YouTube Shorts
                  </p>
                )}
              </div>
            )}
            
            {/* Scene List with Edit/Regenerate capabilities */}
            <div className="max-h-[350px] overflow-y-auto pr-2">
              <SceneList
                scenes={scenes}
                hostAName={config.characters.hostA.name}
                hostBName={config.characters.hostB.name}
                segmentStatus={localProduction.segment_status}
                onUpdateSceneText={handleUpdateSceneText}
                onRegenerateScene={handleRegenerateScene}
                disabled={isLoading}
              />
            </div>
            
            <div className="flex justify-between">
              <button
                onClick={async () => {
                  const newState: ProductionWizardState = {
                    ...wizardState,
                    currentStep: 'script_generate'
                  };
                  await saveWizardState(newState);
                }}
                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg"
              >
                ← Regenerar
              </button>
              
              <button
                onClick={handleApproveScript}
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white px-8 py-3 rounded-lg font-bold"
              >
                ✓ Aprobar y Continuar
              </button>
            </div>
          </div>
        );

      // Step 5: Generate Audios
      case 'audio_generate':
        const audioSegments = localProduction.segments || [];
        const audioCompleted = Object.values(localProduction.segment_status || {}).filter(s => s.audio === 'done').length;
        const audioFailed = Object.values(localProduction.segment_status || {}).filter(s => s.audio === 'failed').length;
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Generar Audios</h3>
              <div className="flex items-center gap-3">
                {audioFailed > 0 && (
                  <span className="text-sm text-red-400 bg-red-500/10 px-2 py-1 rounded">
                    {audioFailed} fallido(s)
                  </span>
                )}
                <span className="text-sm text-gray-400">
                  {audioCompleted} / {audioSegments.length} completados
                </span>
              </div>
            </div>
            
            {/* Progress bar */}
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
                style={{ width: `${(audioCompleted / audioSegments.length) * 100}%` }}
              />
            </div>
            
            {/* Regenerate All Failed button */}
            {audioFailed > 0 && !isLoading && (
              <button
                onClick={async () => {
                  const failedIndices = Object.entries(localProduction.segment_status || {})
                    .filter(([_, s]) => s.audio === 'failed')
                    .map(([i]) => parseInt(i));
                  
                  toast.success(`🔄 Regenerando ${failedIndices.length} audio(s) fallido(s)...`);
                  for (const i of failedIndices) {
                    await handleRegenerateAudio(i);
                  }
                }}
                className="w-full bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                🔄 Regenerar {audioFailed} Audio(s) Fallido(s)
              </button>
            )}
            
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
              {audioSegments.map((segment, i) => {
                const status = localProduction.segment_status?.[i];
                return (
                  <SegmentProgressCard
                    key={i}
                    index={i}
                    segment={segment}
                    audioStatus={status?.audio === 'done' ? 'completed' : status?.audio === 'generating' ? 'in_progress' : status?.audio === 'failed' ? 'failed' : 'pending'}
                    videoStatus="pending"
                    audioUrl={status?.audioUrl}
                    onRegenerateAudio={() => handleRegenerateAudio(i)}
                    isGenerating={isLoading}
                    showVideoStatus={false}
                  />
                );
              })}
            </div>
            
            <div className="flex justify-between">
              <button
                onClick={async () => {
                  const newState: ProductionWizardState = {
                    ...wizardState,
                    currentStep: 'script_review'
                  };
                  await saveWizardState(newState);
                }}
                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg"
              >
                ← Volver
              </button>
              
              <button
                onClick={() => handleGenerateAudios()}
                disabled={isLoading}
                className={`${
                  audioCompleted === audioSegments.length && !isLoading
                    ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500'
                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500'
                } disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold`}
              >
                {isLoading 
                  ? `⏳ Generando ${audioSegments.length - audioCompleted} audios...` 
                  : audioCompleted === audioSegments.length 
                    ? '✓ Continuar →' 
                    : audioCompleted > 0
                      ? `🎙️ Generar Pendientes (${audioSegments.length - audioCompleted})`
                      : '🎙️ Generar Audios'}
              </button>
            </div>
          </div>
        );

      // Step 6: Generate Videos
      case 'video_generate':
        const videoSegments = localProduction.segments || [];
        const videoCompleted = Object.values(localProduction.segment_status || {}).filter(s => s.video === 'done').length;
        const videoFailed = Object.values(localProduction.segment_status || {}).filter(s => s.video === 'failed').length;
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Generar Videos</h3>
              <div className="flex items-center gap-3">
                {videoFailed > 0 && (
                  <span className="text-sm text-red-400 bg-red-500/10 px-2 py-1 rounded">
                    {videoFailed} fallido(s)
                  </span>
                )}
                <span className="text-sm text-gray-400">
                  {videoCompleted} / {videoSegments.length} completados
                </span>
              </div>
            </div>
            
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ width: `${(videoCompleted / videoSegments.length) * 100}%` }}
              />
            </div>
            
            {/* Regenerate All Failed button */}
            {videoFailed > 0 && !isLoading && (
              <button
                onClick={async () => {
                  const failedIndices = Object.entries(localProduction.segment_status || {})
                    .filter(([_, s]) => s.video === 'failed')
                    .map(([i]) => parseInt(i));
                  
                  toast.success(`🔄 Regenerando ${failedIndices.length} video(s) fallido(s)...`);
                  for (const i of failedIndices) {
                    await handleRegenerateVideo(i);
                  }
                }}
                className="w-full bg-red-600/30 hover:bg-red-600 text-red-300 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                🔄 Regenerar {videoFailed} Video(s) Fallido(s)
              </button>
            )}
            
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
              {videoSegments.map((segment, i) => {
                const status = localProduction.segment_status?.[i];
                return (
                  <SegmentProgressCard
                    key={i}
                    index={i}
                    segment={segment}
                    audioStatus={status?.audio === 'done' ? 'completed' : 'pending'}
                    videoStatus={status?.video === 'done' ? 'completed' : status?.video === 'generating' ? 'in_progress' : status?.video === 'failed' ? 'failed' : 'pending'}
                    audioUrl={status?.audioUrl}
                    videoUrl={status?.videoUrl}
                    onRegenerateVideo={() => handleRegenerateVideo(i)}
                    isGenerating={isLoading}
                    showVideoStatus={true}
                  />
                );
              })}
            </div>
            
            <div className="flex justify-between">
              <button
                onClick={async () => {
                  const newState: ProductionWizardState = {
                    ...wizardState,
                    currentStep: 'audio_generate'
                  };
                  await saveWizardState(newState);
                }}
                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg"
              >
                ← Volver
              </button>
              
              <button
                onClick={() => handleGenerateVideos()}
                disabled={isLoading}
                className={`${
                  videoCompleted === videoSegments.length && !isLoading
                    ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500'
                    : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500'
                } disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold`}
              >
                {isLoading 
                  ? `⏳ Generando ${videoSegments.length - videoCompleted} videos...` 
                  : videoCompleted === videoSegments.length 
                    ? '✓ Continuar →' 
                    : videoCompleted > 0
                      ? `🎬 Generar Pendientes (${videoSegments.length - videoCompleted})`
                      : '🎬 Generar Videos'}
              </button>
            </div>
          </div>
        );

      // Step 7: Render Final
      case 'render_final':
        return (
          <div className="space-y-6">
            <div className="text-center py-4 sm:py-8">
              <span className="text-4xl sm:text-6xl mb-2 sm:mb-4 block">🎞️</span>
              <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">Renderizar Video Final</h3>
              <p className="text-gray-400 max-w-md mx-auto text-sm sm:text-base">
                Todos los segmentos están listos. Ahora combinaremos todo en un video final.
              </p>
            </div>
            
            {/* Audio Manager Section */}
            <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-4 sm:p-6">
              <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                🎵 Gestión de Audio
              </h4>
              <AudioManager 
                channelId={channel.id} 
                onRefresh={() => {
                  // Refresh could trigger a re-render if needed
                }}
              />
            </div>
            
            {production.final_video_url ? (
              <div className="bg-green-900/20 border border-green-500/30 p-4 rounded-lg">
                <p className="text-green-400 mb-4">✓ Video ya renderizado</p>
                <video 
                  src={production.final_video_url} 
                  controls 
                  className="w-full max-h-[300px] rounded-lg"
                  poster={production.final_video_poster}
                />
              </div>
            ) : null}
            
            <div className="flex justify-between">
              <button
                onClick={async () => {
                  const newState: ProductionWizardState = {
                    ...wizardState,
                    currentStep: 'video_generate'
                  };
                  await saveWizardState(newState);
                }}
                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg"
              >
                ← Volver
              </button>
              
              <div className="flex gap-3">
                <button
                  onClick={handleRenderFinal}
                  disabled={isLoading}
                  className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold"
                >
                  {isLoading ? '⏳ Renderizando...' : production.final_video_url ? '🔄 Re-Renderizar' : '🎬 Renderizar Final'}
                </button>
                
                {production.final_video_url && !isLoading && (
                  <button
                    onClick={async () => {
                      const newState: ProductionWizardState = {
                        ...wizardState,
                        currentStep: 'publish',
                        renderFinal: { ...wizardState.renderFinal, status: 'completed' }
                      };
                      await saveWizardState(newState);
                    }}
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white px-8 py-3 rounded-lg font-bold"
                  >
                    ✓ Continuar →
                  </button>
                )}
              </div>
            </div>
          </div>
        );

      // Step 8: Publish
      case 'publish':
        return (
          <div className="space-y-4">
            <div className="text-center py-2">
              <h3 className="text-xl font-bold text-white">📺 Previsualizar y Publicar</h3>
            </div>
            
            {/* Video Preview - Prominent */}
            {production.final_video_url ? (
              <div className="bg-black rounded-xl overflow-hidden">
                <video 
                  src={production.final_video_url} 
                  controls 
                  className="w-full max-h-[280px] mx-auto"
                  poster={production.final_video_poster}
                  preload="metadata"
                />
                <div className="bg-[#111] p-3 flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    Formato: {config.format === '9:16' ? '📱 Short (9:16)' : '📺 Video (16:9)'}
                  </span>
                  <a 
                    href={production.final_video_url}
                    download={`${production.viral_metadata?.title || 'video'}.mp4`}
                    className="text-xs bg-cyan-600/30 hover:bg-cyan-600 text-cyan-300 px-3 py-1.5 rounded flex items-center gap-1"
                  >
                    📥 Descargar MP4
                  </a>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-900/20 border border-yellow-500/30 p-4 rounded-lg text-center">
                <p className="text-yellow-400">⚠️ No hay video renderizado. Vuelve al paso anterior.</p>
              </div>
            )}
            
            {/* Metadata Preview */}
            {production.viral_metadata && (
              <div className="bg-[#1a1a1a] p-4 rounded-lg border border-[#333] space-y-2">
                <div>
                  <span className="text-xs text-gray-400">Título:</span>
                  <p className="text-white font-medium">{production.viral_metadata.title}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">Descripción:</span>
                  <p className="text-gray-300 text-sm line-clamp-2">{production.viral_metadata.description}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {production.viral_metadata.tags?.slice(0, 8).map((tag, i) => (
                    <span key={i} className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* YouTube Status */}
            {production.youtube_id ? (
              <div className="bg-green-900/20 border border-green-500/30 p-4 rounded-lg text-center">
                <p className="text-green-400 mb-2">✓ ¡Publicado exitosamente!</p>
                <a 
                  href={`https://youtu.be/${production.youtube_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline"
                >
                  Ver en YouTube →
                </a>
              </div>
            ) : !user?.accessToken ? (
              <div className="bg-yellow-900/20 border border-yellow-500/30 p-3 rounded-lg">
                <p className="text-yellow-400 text-sm text-center">
                  ⚠️ Para publicar en YouTube, necesitas cerrar sesión y volver a iniciar con Google 
                  dando permisos de YouTube.
                </p>
              </div>
            ) : null}
            
            {/* Action Buttons */}
            <div className="flex justify-between pt-2">
              <button
                onClick={async () => {
                  const newState: ProductionWizardState = {
                    ...wizardState,
                    currentStep: 'render_final'
                  };
                  await saveWizardState(newState);
                }}
                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-3 rounded-lg"
              >
                ← Volver
              </button>
              
              <div className="flex gap-3">
                {production.youtube_id ? (
                  <button
                    onClick={onClose}
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white px-8 py-3 rounded-lg font-bold"
                  >
                    ✓ Finalizar
                  </button>
                ) : (
                  <>
                    <button
                      onClick={onClose}
                      className="bg-gray-600 hover:bg-gray-500 text-white px-6 py-3 rounded-lg"
                    >
                      Guardar sin Publicar
                    </button>
                    {user?.accessToken && production.final_video_url && (
                      <button
                        onClick={handlePublish}
                        disabled={isLoading}
                        className="bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold"
                      >
                        {isLoading ? '⏳ Publicando...' : `📺 Publicar ${config.format === '9:16' ? 'Short' : 'Video'}`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );

      // Done
      case 'done':
        return (
          <div className="text-center py-12">
            <span className="text-8xl mb-6 block">🎉</span>
            <h3 className="text-3xl font-bold text-white mb-4">¡Producción Completada!</h3>
            <p className="text-gray-400 mb-8">
              Tu video ha sido creado y publicado exitosamente.
            </p>
            {production.youtube_id && (
              <a 
                href={`https://youtu.be/${production.youtube_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-red-600 hover:bg-red-500 text-white px-8 py-4 rounded-xl font-bold text-lg"
              >
                📺 Ver en YouTube
              </a>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
      <div className="bg-[#0d0d0d] border border-[#333] rounded-xl sm:rounded-2xl max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-3 sm:p-6 border-b border-[#333] flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg sm:text-2xl font-bold text-white flex items-center gap-2 sm:gap-3">
              🎬 <span className="truncate">Production Wizard</span>
            </h2>
            <p className="text-xs sm:text-sm text-gray-400 mt-0.5 sm:mt-1 truncate">
              {channel.name} • {parseLocalDate(production.news_date).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={() => {
              // Show confirmation if there's work in progress
              const hasProgress = wizardState.currentStep !== 'news_fetch' || 
                fetchedNews.length > 0 ||
                (localProduction.segments && localProduction.segments.length > 0);
              
              if (hasProgress && !showCloseConfirm) {
                setShowCloseConfirm(true);
              } else {
                onClose();
              }
            }}
            className="text-gray-400 hover:text-white text-xl sm:text-2xl p-1 ml-2 flex-shrink-0"
            title="Cerrar wizard"
          >
            ×
          </button>
        </div>
        
        {/* Step Indicator - with clickable navigation and horizontal scroll */}
        <div 
          ref={stepIndicatorScrollRef}
          className="p-2 sm:p-4 border-b border-[#333] bg-[#111] overflow-x-auto scrollbar-hide" 
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <StepIndicator 
            steps={allSteps} 
            currentStep={wizardState.currentStep}
            wizardState={wizardState}
            onStepClick={handleStepClick}
            canNavigate={canNavigateToStep}
            scrollContainerRef={stepIndicatorScrollRef}
          />
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6">
          {renderStepContent()}
        </div>
      </div>
      
      {/* Close Confirmation Dialog */}
      {showCloseConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60]">
          <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              ⚠️ {t.wizard.closeConfirmTitle}
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              {t.wizard.closeConfirmMessage}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-sm transition-all"
              >
                {t.cancel}
              </button>
              <button
                onClick={() => {
                  setShowCloseConfirm(false);
                  onClose();
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium transition-all"
              >
                {t.wizard.closeConfirmYes}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionWizard;

