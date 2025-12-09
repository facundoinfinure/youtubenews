import React, { useState, useEffect, useCallback } from 'react';
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
  ScriptWithScenes
} from '../types';
import { saveProduction, updateSegmentStatus } from '../services/supabaseService';
import { uploadVideoToYouTube } from '../services/youtubeService';
import { renderProductionToShotstack } from '../services/shotstackService';

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
  onGenerateScript: (newsItems: NewsItem[]) => Promise<{ scenes: ScriptWithScenes; metadata: ViralMetadata }>;
  onGenerateAudio: (segmentIndex: number, text: string, speaker: string) => Promise<{ audioUrl: string; duration: number }>;
  onGenerateVideo: (segmentIndex: number, audioUrl: string, speaker: string) => Promise<{ videoUrl: string }>;
}

// =============================================================================================
// STEP INDICATOR COMPONENT
// =============================================================================================

const StepIndicator: React.FC<{
  steps: ProductionStep[];
  currentStep: ProductionStep;
  wizardState: ProductionWizardState;
}> = ({ steps, currentStep, wizardState }) => {
  const getStepStatus = (step: ProductionStep): SubStepStatus => {
    const stepKey = step.replace('_', '') as keyof ProductionWizardState;
    const stepState = wizardState[stepKey as keyof Omit<ProductionWizardState, 'currentStep'>];
    if (typeof stepState === 'object' && 'status' in stepState) {
      return stepState.status;
    }
    return 'pending';
  };

  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
      <div className="flex items-center justify-start sm:justify-between mb-4 sm:mb-8 min-w-max sm:min-w-0 px-2 sm:px-4">
        {steps.filter(s => s !== 'done').map((step, index) => {
          const status = getStepStatus(step);
          const isCurrent = step === currentStep;
          const stepNum = index + 1;
          
          return (
            <React.Fragment key={step}>
              <div className="flex flex-col items-center flex-shrink-0">
                <div 
                  className={`
                    w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-xs sm:text-sm
                    transition-all duration-300
                    ${status === 'completed' ? 'bg-green-500 text-white' : ''}
                    ${status === 'in_progress' || isCurrent ? 'bg-cyan-500 text-white ring-2 sm:ring-4 ring-cyan-500/30' : ''}
                    ${status === 'failed' ? 'bg-red-500 text-white' : ''}
                    ${status === 'pending' && !isCurrent ? 'bg-gray-700 text-gray-400' : ''}
                  `}
                >
                  {status === 'completed' ? '✓' : stepNum}
                </div>
                <span className={`
                  text-[10px] sm:text-xs mt-1 sm:mt-2 text-center max-w-[50px] sm:max-w-[80px] leading-tight
                  ${isCurrent ? 'text-cyan-400 font-medium' : 'text-gray-500'}
                `}>
                  {getStepDisplayName(step).split(' ').slice(1).join(' ')}
                </span>
              </div>
              
              {index < steps.length - 2 && (
                <div className={`
                  w-4 sm:flex-1 h-0.5 sm:h-1 mx-1 sm:mx-2 rounded flex-shrink-0
                  ${status === 'completed' ? 'bg-green-500' : 'bg-gray-700'}
                `} />
              )}
            </React.Fragment>
          );
        })}
      </div>
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
      const d = typeof date === 'string' ? new Date(date) : date;
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
        p-4 rounded-lg border-2 cursor-pointer transition-all
        ${selected 
          ? 'border-cyan-500 bg-cyan-500/10' 
          : 'border-gray-700 bg-[#1a1a1a] hover:border-gray-500'}
      `}
    >
      <div className="flex items-start gap-3">
        <input 
          type="checkbox" 
          checked={selected} 
          onChange={onToggle}
          className="mt-1 w-5 h-5 accent-cyan-500 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          {/* Title */}
          <h4 className="font-medium text-white leading-snug">{news.headline}</h4>
          
          {/* Summary */}
          <p className="text-sm text-gray-300 mt-2 leading-relaxed">{news.summary}</p>
          
          {/* Viral Score Reasoning */}
          {news.viralScoreReasoning && (
            <div className="mt-3 p-2.5 bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-500/30 rounded-lg">
              <div className="flex items-start gap-2">
                <span className="text-purple-400 text-sm">🔥</span>
                <p className="text-xs text-purple-200 leading-relaxed">
                  <span className="font-semibold text-purple-300">¿Por qué es viral?</span>{' '}
                  {news.viralScoreReasoning}
                </p>
              </div>
            </div>
          )}
          
          {/* Metadata row: Source, Date, Viral Score */}
          <div className="flex items-center flex-wrap gap-3 mt-3 text-xs">
            <span className="text-gray-400 font-medium">{news.source}</span>
            
            {news.publicationDate && (
              <span className="text-gray-500 flex items-center gap-1">
                <span>📅</span>
                {formatDate(news.publicationDate)}
              </span>
            )}
            
            <span className={`
              px-2 py-0.5 rounded font-medium
              ${news.viralScore >= 80 ? 'bg-green-500/20 text-green-400' : ''}
              ${news.viralScore >= 60 && news.viralScore < 80 ? 'bg-yellow-500/20 text-yellow-400' : ''}
              ${news.viralScore < 60 ? 'bg-gray-500/20 text-gray-400' : ''}
            `}>
              Viral: {news.viralScore}%
            </span>
          </div>
          
          {/* Link to original article */}
          {news.url && (
            <a
              href={news.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 mt-3 text-xs text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
            >
              <span>🔗</span>
              <span>Leer noticia completa en {news.source}</span>
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
}> = ({ index, segment, audioStatus, videoStatus, audioUrl, videoUrl, onRegenerateAudio, onRegenerateVideo }) => (
  <div className="bg-[#1a1a1a] rounded-lg border border-[#333] p-4">
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm font-medium text-white">
        #{index + 1} - {segment.speaker}
      </span>
      <div className="flex items-center gap-2">
        {/* Audio Status */}
        <span className={`
          text-xs px-2 py-1 rounded flex items-center gap-1
          ${audioStatus === 'completed' ? 'bg-green-500/20 text-green-400' : ''}
          ${audioStatus === 'in_progress' ? 'bg-cyan-500/20 text-cyan-400' : ''}
          ${audioStatus === 'failed' ? 'bg-red-500/20 text-red-400' : ''}
          ${audioStatus === 'pending' ? 'bg-gray-500/20 text-gray-400' : ''}
        `}>
          🎙️ {audioStatus === 'completed' ? '✓' : audioStatus === 'in_progress' ? '...' : audioStatus}
        </span>
        
        {/* Video Status */}
        <span className={`
          text-xs px-2 py-1 rounded flex items-center gap-1
          ${videoStatus === 'completed' ? 'bg-green-500/20 text-green-400' : ''}
          ${videoStatus === 'in_progress' ? 'bg-purple-500/20 text-purple-400' : ''}
          ${videoStatus === 'failed' ? 'bg-red-500/20 text-red-400' : ''}
          ${videoStatus === 'pending' ? 'bg-gray-500/20 text-gray-400' : ''}
        `}>
          🎬 {videoStatus === 'completed' ? '✓' : videoStatus === 'in_progress' ? '...' : videoStatus}
        </span>
      </div>
    </div>
    
    <p className="text-sm text-gray-400 line-clamp-2">{segment.text}</p>
    
    {/* Actions */}
    <div className="flex gap-2 mt-3">
      {audioStatus === 'completed' && audioUrl && (
        <audio src={audioUrl} controls className="h-8 flex-1" />
      )}
      {audioStatus === 'failed' && onRegenerateAudio && (
        <button 
          onClick={onRegenerateAudio}
          className="text-xs bg-red-600/30 hover:bg-red-600 text-red-300 px-2 py-1 rounded"
        >
          🔄 Retry Audio
        </button>
      )}
      {videoStatus === 'completed' && videoUrl && (
        <a 
          href={videoUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs bg-purple-600/30 hover:bg-purple-600 text-purple-300 px-2 py-1 rounded"
        >
          👁️ Ver Video
        </a>
      )}
      {videoStatus === 'failed' && onRegenerateVideo && (
        <button 
          onClick={onRegenerateVideo}
          className="text-xs bg-red-600/30 hover:bg-red-600 text-red-300 px-2 py-1 rounded"
        >
          🔄 Retry Video
        </button>
      )}
    </div>
  </div>
);

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
  
  // Local state
  const [fetchedNews, setFetchedNews] = useState<NewsItem[]>(production.fetched_news || []);
  const [selectedNewsIds, setSelectedNewsIds] = useState<string[]>(production.selected_news_ids || []);
  const [isLoading, setIsLoading] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);

  // All wizard steps
  const allSteps: ProductionStep[] = [
    'news_fetch', 'news_select', 'script_generate', 'script_review',
    'audio_generate', 'video_generate', 'render_final', 'publish', 'done'
  ];

  // Save wizard state to production
  const saveWizardState = useCallback(async (newState: ProductionWizardState) => {
    setWizardState(newState);
    
    const updatedProduction: Production = {
      ...production,
      wizard_state: newState,
      fetched_news: fetchedNews,
      selected_news_ids: selectedNewsIds,
      updated_at: new Date().toISOString(),
      last_checkpoint_at: new Date().toISOString()
    };
    
    await saveProduction(updatedProduction);
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

  // =============================================================================================
  // STEP HANDLERS
  // =============================================================================================

  // Step 1: Fetch News
  const handleFetchNews = async () => {
    setIsLoading(true);
    await updateStepStatus('newsFetch', 'in_progress');
    
    try {
      const news = await onFetchNews();
      setFetchedNews(news);
      
      await updateStepStatus('newsFetch', 'completed', {
        fetchedNews: news,
        fetchedAt: new Date().toISOString(),
        source: config.topicToken || 'default'
      });
      
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
      await updateStepStatus('newsFetch', 'failed', { error: (error as Error).message });
      toast.error(`Error: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
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
    await updateStepStatus('scriptGenerate', 'in_progress');
    
    try {
      const selectedNews = fetchedNews.filter(n => selectedNewsIds.includes(n.id || n.headline));
      const result = await onGenerateScript(selectedNews);
      
      // Update production with script
      const scenes = result.scenes;
      const segments: BroadcastSegment[] = Object.entries(scenes.scenes).map(([key, scene]) => ({
        speaker: scene.video_mode === 'hostA' ? config.characters.hostA.name : config.characters.hostB.name,
        text: scene.text,
        audioBase64: '',
        sceneTitle: scene.title,
        sceneIndex: parseInt(key)
      }));
      
      const updatedProduction: Production = {
        ...production,
        scenes: scenes,
        viral_metadata: result.metadata,
        segments: segments,
        narrative_used: scenes.narrative_used
      };
      
      await saveProduction(updatedProduction);
      onUpdateProduction(updatedProduction);
      
      await updateStepStatus('scriptGenerate', 'completed', {
        narrativeType: scenes.narrative_used,
        generatedAt: new Date().toISOString()
      });
      
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
      await updateStepStatus('scriptGenerate', 'failed', { error: (error as Error).message });
      toast.error(`Error: ${(error as Error).message}`);
    } finally {
      setIsLoading(false);
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

  // Step 5: Generate all audios
  const handleGenerateAudios = async () => {
    const segments = production.segments || [];
    if (segments.length === 0) {
      toast.error('No hay segmentos para generar');
      return;
    }
    
    setIsLoading(true);
    await updateStepStatus('audioGenerate', 'in_progress', {
      totalSegments: segments.length,
      completedSegments: 0
    });
    
    let completedCount = 0;
    const segmentProgress: Record<number, { status: SubStepStatus }> = {};
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      setCurrentSegmentIndex(i);
      
      // Skip if already done
      const existingStatus = production.segment_status?.[i];
      if (existingStatus?.audio === 'done' && existingStatus?.audioUrl) {
        completedCount++;
        segmentProgress[i] = { status: 'completed' };
        continue;
      }
      
      segmentProgress[i] = { status: 'in_progress' };
      
      try {
        // Update segment status to generating
        await updateSegmentStatus(production.id, i, { audio: 'generating' });
        
        const result = await onGenerateAudio(i, segment.text, segment.speaker);
        
        // Update segment with audio URL
        await updateSegmentStatus(production.id, i, {
          audio: 'done',
          audioUrl: result.audioUrl
        });
        
        // Update production segments with duration
        const updatedSegments = [...(production.segments || [])];
        updatedSegments[i] = { ...updatedSegments[i], audioDuration: result.duration, audioUrl: result.audioUrl };
        
        const updatedProduction: Production = {
          ...production,
          segments: updatedSegments
        };
        await saveProduction(updatedProduction);
        onUpdateProduction(updatedProduction);
        
        completedCount++;
        segmentProgress[i] = { status: 'completed' };
        
        // Update wizard progress
        await updateStepStatus('audioGenerate', 'in_progress', {
          completedSegments: completedCount,
          segmentProgress
        });
        
      } catch (error) {
        segmentProgress[i] = { status: 'failed' };
        await updateSegmentStatus(production.id, i, {
          audio: 'failed',
          error: (error as Error).message
        });
        toast.error(`Error en segmento ${i + 1}: ${(error as Error).message}`);
      }
    }
    
    setIsLoading(false);
    
    // Check if all completed
    if (completedCount === segments.length) {
      await updateStepStatus('audioGenerate', 'completed', {
        completedSegments: completedCount,
        segmentProgress
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
      
      toast.success('¡Todos los audios generados!');
    } else {
      toast.error(`${segments.length - completedCount} audios fallaron. Puedes reintentar.`);
    }
  };

  // Step 6: Generate all videos
  const handleGenerateVideos = async () => {
    const segments = production.segments || [];
    if (segments.length === 0) {
      toast.error('No hay segmentos para generar');
      return;
    }
    
    setIsLoading(true);
    await updateStepStatus('videoGenerate', 'in_progress', {
      totalSegments: segments.length,
      completedSegments: 0
    });
    
    let completedCount = 0;
    const segmentProgress: Record<number, { status: SubStepStatus }> = {};
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      setCurrentSegmentIndex(i);
      
      // Skip if already done
      const existingStatus = production.segment_status?.[i];
      if (existingStatus?.video === 'done' && existingStatus?.videoUrl) {
        completedCount++;
        segmentProgress[i] = { status: 'completed' };
        continue;
      }
      
      // Need audio URL to generate video
      if (!existingStatus?.audioUrl) {
        segmentProgress[i] = { status: 'failed' };
        continue;
      }
      
      segmentProgress[i] = { status: 'in_progress' };
      
      try {
        await updateSegmentStatus(production.id, i, { video: 'generating' });
        
        const result = await onGenerateVideo(i, existingStatus.audioUrl, segment.speaker);
        
        await updateSegmentStatus(production.id, i, {
          video: 'done',
          videoUrl: result.videoUrl
        });
        
        completedCount++;
        segmentProgress[i] = { status: 'completed' };
        
        await updateStepStatus('videoGenerate', 'in_progress', {
          completedSegments: completedCount,
          segmentProgress
        });
        
      } catch (error) {
        segmentProgress[i] = { status: 'failed' };
        await updateSegmentStatus(production.id, i, {
          video: 'failed',
          error: (error as Error).message
        });
        toast.error(`Error en video ${i + 1}: ${(error as Error).message}`);
      }
    }
    
    setIsLoading(false);
    
    if (completedCount === segments.length) {
      await updateStepStatus('videoGenerate', 'completed', {
        completedSegments: completedCount,
        segmentProgress
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
      
      toast.success('¡Todos los videos generados!');
    } else {
      toast.error(`${segments.length - completedCount} videos fallaron. Puedes reintentar.`);
    }
  };

  // Step 7: Render final video
  const handleRenderFinal = async () => {
    setIsLoading(true);
    await updateStepStatus('renderFinal', 'in_progress', {
      renderStartedAt: new Date().toISOString()
    });
    
    try {
      const result = await renderProductionToShotstack(production, channel.name, config.format);
      
      if (result.success && result.videoUrl) {
        const updatedProduction: Production = {
          ...production,
          final_video_url: result.videoUrl,
          final_video_poster: result.posterUrl,
          status: 'completed',
          completed_at: new Date().toISOString()
        };
        await saveProduction(updatedProduction);
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
        () => {} // onProgress callback (not used in wizard)
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
                Confirmar Selección →
              </button>
            </div>
          </div>
        );

      // Step 3: Generate Script
      case 'script_generate':
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
              
              <button
                onClick={handleGenerateScript}
                disabled={isLoading}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold"
              >
                {isLoading ? '⏳ Generando...' : '✨ Generar Guión'}
              </button>
            </div>
          </div>
        );

      // Step 4: Review Script
      case 'script_review':
        const scenes = production.scenes?.scenes || {};
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Revisar Guión</h3>
              <span className="text-sm text-gray-400">
                {Object.keys(scenes).length} escenas
              </span>
            </div>
            
            {production.viral_metadata && (
              <div className="bg-gradient-to-r from-purple-900/30 to-pink-900/30 p-4 rounded-lg border border-purple-500/30">
                <h4 className="text-purple-400 font-bold mb-2">📺 Título del Video</h4>
                <p className="text-white text-lg">{production.viral_metadata.title}</p>
              </div>
            )}
            
            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2">
              {Object.entries(scenes).map(([key, scene]) => (
                <div key={key} className="bg-[#1a1a1a] p-4 rounded-lg border border-[#333]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded">
                      Escena {key}
                    </span>
                    <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-1 rounded">
                      {scene.video_mode === 'hostA' ? config.characters.hostA.name : config.characters.hostB.name}
                    </span>
                    {scene.title && (
                      <span className="text-xs text-gray-400">"{scene.title}"</span>
                    )}
                  </div>
                  <p className="text-gray-300 text-sm">{scene.text}</p>
                </div>
              ))}
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
        const audioSegments = production.segments || [];
        const audioCompleted = Object.values(production.segment_status || {}).filter(s => s.audio === 'done').length;
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Generar Audios</h3>
              <span className="text-sm text-gray-400">
                {audioCompleted} / {audioSegments.length} completados
              </span>
            </div>
            
            {/* Progress bar */}
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-500"
                style={{ width: `${(audioCompleted / audioSegments.length) * 100}%` }}
              />
            </div>
            
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
              {audioSegments.map((segment, i) => {
                const status = production.segment_status?.[i];
                return (
                  <SegmentProgressCard
                    key={i}
                    index={i}
                    segment={segment}
                    audioStatus={status?.audio === 'done' ? 'completed' : status?.audio === 'generating' ? 'in_progress' : status?.audio === 'failed' ? 'failed' : 'pending'}
                    videoStatus="pending"
                    audioUrl={status?.audioUrl}
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
                onClick={handleGenerateAudios}
                disabled={isLoading}
                className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold"
              >
                {isLoading 
                  ? `⏳ Generando ${currentSegmentIndex + 1}/${audioSegments.length}...` 
                  : audioCompleted === audioSegments.length 
                    ? 'Continuar →' 
                    : '🎙️ Generar Audios'}
              </button>
            </div>
          </div>
        );

      // Step 6: Generate Videos
      case 'video_generate':
        const videoSegments = production.segments || [];
        const videoCompleted = Object.values(production.segment_status || {}).filter(s => s.video === 'done').length;
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Generar Videos</h3>
              <span className="text-sm text-gray-400">
                {videoCompleted} / {videoSegments.length} completados
              </span>
            </div>
            
            <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ width: `${(videoCompleted / videoSegments.length) * 100}%` }}
              />
            </div>
            
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
              {videoSegments.map((segment, i) => {
                const status = production.segment_status?.[i];
                return (
                  <SegmentProgressCard
                    key={i}
                    index={i}
                    segment={segment}
                    audioStatus={status?.audio === 'done' ? 'completed' : 'pending'}
                    videoStatus={status?.video === 'done' ? 'completed' : status?.video === 'generating' ? 'in_progress' : status?.video === 'failed' ? 'failed' : 'pending'}
                    audioUrl={status?.audioUrl}
                    videoUrl={status?.videoUrl}
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
                onClick={handleGenerateVideos}
                disabled={isLoading}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold"
              >
                {isLoading 
                  ? `⏳ Generando ${currentSegmentIndex + 1}/${videoSegments.length}...` 
                  : videoCompleted === videoSegments.length 
                    ? 'Continuar →' 
                    : '🎬 Generar Videos'}
              </button>
            </div>
          </div>
        );

      // Step 7: Render Final
      case 'render_final':
        return (
          <div className="space-y-6">
            <div className="text-center py-8">
              <span className="text-6xl mb-4 block">🎞️</span>
              <h3 className="text-2xl font-bold text-white mb-2">Renderizar Video Final</h3>
              <p className="text-gray-400 max-w-md mx-auto">
                Todos los segmentos están listos. Ahora combinaremos todo en un video final.
              </p>
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
              
              <button
                onClick={production.final_video_url ? async () => {
                  const newState: ProductionWizardState = {
                    ...wizardState,
                    currentStep: 'publish'
                  };
                  await saveWizardState(newState);
                } : handleRenderFinal}
                disabled={isLoading}
                className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold"
              >
                {isLoading ? '⏳ Renderizando...' : production.final_video_url ? 'Continuar →' : '🎬 Renderizar Final'}
              </button>
            </div>
          </div>
        );

      // Step 8: Publish
      case 'publish':
        return (
          <div className="space-y-6">
            <div className="text-center py-4">
              <span className="text-6xl mb-4 block">📺</span>
              <h3 className="text-2xl font-bold text-white mb-2">Publicar en YouTube</h3>
            </div>
            
            {production.final_video_url && (
              <video 
                src={production.final_video_url} 
                controls 
                className="w-full max-h-[250px] rounded-lg"
                poster={production.final_video_poster}
              />
            )}
            
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
                  {production.viral_metadata.tags?.slice(0, 5).map((tag, i) => (
                    <span key={i} className="text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
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
            ) : null}
            
            <div className="flex justify-between">
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
              
              {production.youtube_id ? (
                <button
                  onClick={onClose}
                  className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white px-8 py-3 rounded-lg font-bold"
                >
                  ✓ Finalizar
                </button>
              ) : (
                <button
                  onClick={handlePublish}
                  disabled={isLoading || !user?.accessToken}
                  className={`${user?.accessToken ? 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500' : 'bg-gray-600'} disabled:opacity-50 text-white px-8 py-3 rounded-lg font-bold`}
                >
                  {isLoading ? '⏳ Publicando...' : !user?.accessToken ? '🔑 Conectar YouTube' : `📺 Publicar ${config.format === '9:16' ? 'Short' : 'Video'}`}
                </button>
              )}
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
              {channel.name} • {new Date(production.news_date).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl sm:text-2xl p-1 ml-2 flex-shrink-0"
          >
            ×
          </button>
        </div>
        
        {/* Step Indicator */}
        <div className="p-2 sm:p-4 border-b border-[#333] bg-[#111]">
          <StepIndicator 
            steps={allSteps} 
            currentStep={wizardState.currentStep}
            wizardState={wizardState}
          />
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-6">
          {renderStepContent()}
        </div>
      </div>
    </div>
  );
};

export default ProductionWizard;

