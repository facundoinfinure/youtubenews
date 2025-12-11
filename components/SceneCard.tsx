import React, { useState } from 'react';
import { Scene, NarrativeType } from '../types';

// =============================================================================================
// SCENE CARD COMPONENT
// Individual scene display with edit and regeneration capabilities
// v2.6 - Extracted from ProductionWizard to avoid React hooks error
// =============================================================================================

interface SceneCardProps {
  index: string;
  scene: Scene;
  hostAName: string;
  hostBName: string;
  isAudioGenerated?: boolean;
  isVideoGenerated?: boolean;
  onUpdateText: (index: string, newText: string) => Promise<void>;
  onRegenerate: (index: string) => Promise<void>;
  disabled?: boolean;
}

export const SceneCard: React.FC<SceneCardProps> = ({
  index,
  scene,
  hostAName,
  hostBName,
  isAudioGenerated = false,
  isVideoGenerated = false,
  onUpdateText,
  onRegenerate,
  disabled = false
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(scene.text);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const speaker = scene.video_mode === 'hostA' ? hostAName : hostBName;
  const sceneNumber = parseInt(index) + 1;
  
  // Detect if text was edited but not saved
  const hasUnsavedChanges = editedText !== scene.text;
  // If audio/video was already generated and text changed, show warning
  const needsRegeneration = hasUnsavedChanges && (isAudioGenerated || isVideoGenerated);

  const handleSave = async () => {
    if (!hasUnsavedChanges) {
      setIsEditing(false);
      return;
    }
    
    setIsSaving(true);
    try {
      await onUpdateText(index, editedText);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving scene text:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedText(scene.text); // Reset to original
    setIsEditing(false);
  };

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      await onRegenerate(index);
    } catch (error) {
      console.error('Error regenerating scene:', error);
    } finally {
      setIsRegenerating(false);
    }
  };

  // Get shot type icon
  const getShotIcon = (shot?: string) => {
    switch (shot) {
      case 'close_up': return '📹';
      case 'mid_shot': return '🎬';
      case 'two_shot': return '👥';
      default: return '🎥';
    }
  };

  // Get model icon
  const getModelIcon = (model?: string) => {
    switch (model) {
      case 'infinite_talk_multi': return '👥';
      case 'infinite_talk': return '👤';
      default: return '🤖';
    }
  };

  return (
    <div className={`bg-[#1a1a1a] rounded-lg border ${
      needsRegeneration 
        ? 'border-yellow-500/50 ring-1 ring-yellow-500/20' 
        : 'border-[#333]'
    } overflow-hidden transition-all duration-200`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#222] border-b border-[#333]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-500">#{sceneNumber}</span>
          <span className={`text-sm font-medium ${
            scene.video_mode === 'hostA' ? 'text-blue-400' : 'text-pink-400'
          }`}>
            {speaker}
          </span>
          {scene.title && (
            <span className="text-xs text-gray-500 hidden sm:inline">
              — {scene.title}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* Status indicators */}
          <div className="flex items-center gap-1 text-xs">
            <span title={`Shot: ${scene.shot || 'auto'}`} className="text-gray-500">
              {getShotIcon(scene.shot)}
            </span>
            <span title={`Model: ${scene.model || 'auto'}`} className="text-gray-500">
              {getModelIcon(scene.model)}
            </span>
            {isAudioGenerated && (
              <span className="text-green-400" title="Audio generado">🎙️</span>
            )}
            {isVideoGenerated && (
              <span className="text-green-400" title="Video generado">🎬</span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="w-full h-32 bg-[#111] border border-[#444] rounded-lg p-3 text-white text-sm resize-none focus:outline-none focus:border-purple-500 transition-colors"
              placeholder="Texto de la escena..."
              disabled={disabled || isSaving}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {editedText.length} caracteres · ~{Math.ceil(editedText.split(' ').length / 2.5)}s
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving || !hasUnsavedChanges}
                  className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-all ${
                    hasUnsavedChanges
                      ? 'bg-purple-600 hover:bg-purple-500 text-white'
                      : 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {isSaving ? '💾...' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
              {scene.text}
            </p>
            
            {/* Warning if needs regeneration */}
            {needsRegeneration && (
              <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-xs text-yellow-400">
                  ⚠️ El texto cambió. Necesitas regenerar el audio/video para esta escena.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      {!isEditing && (
        <div className="flex items-center justify-end gap-2 px-4 py-2 bg-[#1a1a1a] border-t border-[#333]">
          <button
            onClick={() => setIsEditing(true)}
            disabled={disabled || isRegenerating}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
          >
            ✏️ Editar
          </button>
          <button
            onClick={handleRegenerate}
            disabled={disabled || isRegenerating}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
              isRegenerating
                ? 'bg-orange-600/50 text-orange-200 cursor-wait'
                : 'bg-orange-600/20 hover:bg-orange-600 text-orange-300 hover:text-white'
            }`}
          >
            {isRegenerating ? '🔄 Regenerando...' : '🔄 Regenerar'}
          </button>
        </div>
      )}
    </div>
  );
};

// =============================================================================================
// SCENE LIST COMPONENT
// Displays all scenes with edit/regenerate capabilities
// =============================================================================================

interface SceneListProps {
  scenes: Record<string, Scene>;
  hostAName: string;
  hostBName: string;
  segmentStatus?: Record<number, { audio?: string; video?: string; audioUrl?: string; videoUrl?: string }>;
  onUpdateSceneText: (index: string, newText: string) => Promise<void>;
  onRegenerateScene: (index: string) => Promise<void>;
  disabled?: boolean;
}

export const SceneList: React.FC<SceneListProps> = ({
  scenes,
  hostAName,
  hostBName,
  segmentStatus = {},
  onUpdateSceneText,
  onRegenerateScene,
  disabled = false
}) => {
  const sortedScenes = Object.entries(scenes).sort(([a], [b]) => parseInt(a) - parseInt(b));

  return (
    <div className="space-y-3">
      {sortedScenes.map(([index, scene]) => {
        const status = segmentStatus[parseInt(index)];
        const isAudioGenerated = status?.audio === 'done' && !!status?.audioUrl;
        const isVideoGenerated = status?.video === 'done' && !!status?.videoUrl;

        return (
          <SceneCard
            key={index}
            index={index}
            scene={scene}
            hostAName={hostAName}
            hostBName={hostBName}
            isAudioGenerated={isAudioGenerated}
            isVideoGenerated={isVideoGenerated}
            onUpdateText={onUpdateSceneText}
            onRegenerate={onRegenerateScene}
            disabled={disabled}
          />
        );
      })}
    </div>
  );
};

export default SceneCard;

