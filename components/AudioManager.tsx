/**
 * Audio Manager Component
 * 
 * Manages background music and sound effects:
 * - Lists all available audio files from Supabase Storage
 * - Allows previewing audio files
 * - Regenerates missing or specific audio files via API
 */

import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { listBackgroundMusicFiles, listSoundEffectFiles, deleteAudioFile } from '../services/supabaseService';

interface AudioFile {
  name: string;
  url: string;
  path: string;
  type?: string;
  description?: string;
}

interface AudioManagerProps {
  channelId?: string;
  onRefresh?: () => void;
}

export const AudioManager: React.FC<AudioManagerProps> = ({ channelId, onRefresh }) => {
  const [musicFiles, setMusicFiles] = useState<AudioFile[]>([]);
  const [soundEffectFiles, setSoundEffectFiles] = useState<AudioFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'music' | 'effects'>('music');
  const [regenerating, setRegenerating] = useState<string | null>(null);

  // Load audio files
  useEffect(() => {
    loadAudioFiles();
  }, [channelId]);

  const loadAudioFiles = async () => {
    setLoading(true);
    try {
      const [music, effects] = await Promise.all([
        listBackgroundMusicFiles(channelId),
        listSoundEffectFiles(channelId)
      ]);
      setMusicFiles(music);
      setSoundEffectFiles(effects);
    } catch (error) {
      console.error('Error loading audio files:', error);
      toast.error('Error al cargar archivos de audio');
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = (url: string) => {
    if (playingUrl === url) {
      setPlayingUrl(null);
    } else {
      setPlayingUrl(url);
    }
  };

  const handleRegenerate = async (type: 'music' | 'effect', name: string) => {
    setRegenerating(name);
    try {
      const vercelUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;
      const body = type === 'music' 
        ? { music: true, soundEffects: false, regenerate: [name] }
        : { music: false, soundEffects: true, regenerate: [name] };

      const response = await fetch(`${vercelUrl}/api/upload-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error('Error al regenerar audio');
      }

      const result = await response.json();
      toast.success(`${type === 'music' ? 'Música' : 'Efecto'} regenerado exitosamente`);
      await loadAudioFiles();
      onRefresh?.();
    } catch (error: any) {
      console.error('Error regenerating audio:', error);
      toast.error(`Error al regenerar: ${error.message}`);
    } finally {
      setRegenerating(null);
    }
  };

  const handleRegenerateAll = async (type: 'music' | 'effects') => {
    if (!confirm(`¿Regenerar todos los archivos de ${type === 'music' ? 'música' : 'efectos'}? Esto puede tardar varios minutos.`)) {
      return;
    }

    setRegenerating('all');
    try {
      const vercelUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;
      const body = type === 'music' 
        ? { music: true, soundEffects: false }
        : { music: false, soundEffects: true };

      console.log(`[AudioManager] Generating ${type} files via ${vercelUrl}/api/upload-audio`);
      
      const response = await fetch(`${vercelUrl}/api/upload-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`[AudioManager] Generation result:`, result);
      
      if (result.summary) {
        toast.success(`${result.summary.generated || 0} archivos generados, ${result.summary.fromCache || 0} desde cache`);
      } else {
        toast.success('Archivos procesados');
      }
      
      // Wait a bit for files to be available
      await new Promise(resolve => setTimeout(resolve, 2000));
      await loadAudioFiles();
      onRefresh?.();
    } catch (error: any) {
      console.error('Error regenerating audios:', error);
      toast.error(`Error al regenerar: ${error.message}`);
    } finally {
      setRegenerating(null);
    }
  };

  const handleGenerateInitial = async () => {
    if (!confirm('¿Generar archivos de audio iniciales (música y efectos básicos)? Esto puede tardar varios minutos. Se procesarán en lotes para evitar timeouts.')) {
      return;
    }

    setRegenerating('all');
    try {
      const vercelUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;
      
      console.log(`[AudioManager] Generating initial audio files in batches via ${vercelUrl}/api/upload-audio`);
      toast.loading('Generando archivos de audio (lote 1/2: música)...', { id: 'audio-generation' });
      
      // Batch 1: Generate music files first
      let musicResult = null;
      try {
        const musicResponse = await fetch(`${vercelUrl}/api/upload-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ music: true, soundEffects: false })
        });

        if (!musicResponse.ok) {
          const errorText = await musicResponse.text();
          throw new Error(`HTTP ${musicResponse.status}: ${errorText}`);
        }

        musicResult = await musicResponse.json();
        console.log(`[AudioManager] Music generation result:`, musicResult);
        toast.loading('Generando archivos de audio (lote 2/2: efectos)...', { id: 'audio-generation' });
      } catch (error: any) {
        console.error('Error generating music:', error);
        toast.dismiss('audio-generation');
        toast.error(`Error al generar música: ${error.message}`);
        throw error;
      }
      
      // Batch 2: Generate sound effects in smaller sub-batches
      // Split into 2 batches: transitions/emphasis (5 files) and notifications/ambient (5 files)
      let effectsResult1 = null;
      let effectsResult2 = null;
      
      try {
        // Sub-batch 2a: Transitions and emphasis effects (5 files)
        toast.loading('Generando archivos de audio (lote 2a/3: transiciones y énfasis)...', { id: 'audio-generation' });
        const effects1Response = await fetch(`${vercelUrl}/api/upload-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            music: false, 
            soundEffects: true,
            batch: 'transitions-emphasis' // Only generate these types
          })
        });

        if (!effects1Response.ok) {
          const errorText = await effects1Response.text();
          throw new Error(`HTTP ${effects1Response.status}: ${errorText}`);
        }

        effectsResult1 = await effects1Response.json();
        console.log(`[AudioManager] Sound effects batch 1 result:`, effectsResult1);
        
        // Sub-batch 2b: Notifications and ambient effects (5 files)
        toast.loading('Generando archivos de audio (lote 2b/3: notificaciones y ambiente)...', { id: 'audio-generation' });
        const effects2Response = await fetch(`${vercelUrl}/api/upload-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            music: false, 
            soundEffects: true,
            batch: 'notifications-ambient' // Only generate these types
          })
        });

        if (!effects2Response.ok) {
          const errorText = await effects2Response.text();
          throw new Error(`HTTP ${effects2Response.status}: ${errorText}`);
        }

        effectsResult2 = await effects2Response.json();
        console.log(`[AudioManager] Sound effects batch 2 result:`, effectsResult2);
        
        // Combine both results
        effectsResult = {
          success: effectsResult1.success && effectsResult2.success,
          results: {
            soundEffects: { ...effectsResult1.results.soundEffects, ...effectsResult2.results.soundEffects },
            errors: [...(effectsResult1.results.errors || []), ...(effectsResult2.results.errors || [])]
          },
          summary: {
            soundEffectsUploaded: (effectsResult1.summary?.soundEffectsUploaded || 0) + (effectsResult2.summary?.soundEffectsUploaded || 0),
            fromCache: (effectsResult1.summary?.fromCache || 0) + (effectsResult2.summary?.fromCache || 0),
            generated: (effectsResult1.summary?.generated || 0) + (effectsResult2.summary?.generated || 0),
            errors: (effectsResult1.summary?.errors || 0) + (effectsResult2.summary?.errors || 0)
          }
        };
      } catch (error: any) {
        console.error('Error generating sound effects:', error);
        toast.dismiss('audio-generation');
        toast.error(`Error al generar efectos: ${error.message}`);
        throw error;
      }
      
      toast.dismiss('audio-generation');
      
      // Combine results
      const totalGenerated = (musicResult?.summary?.generated || 0) + (effectsResult?.summary?.generated || 0);
      const totalFromCache = (musicResult?.summary?.fromCache || 0) + (effectsResult?.summary?.fromCache || 0);
      const totalErrors = (musicResult?.errors?.length || 0) + (effectsResult?.errors?.length || 0);
      
      if (totalGenerated > 0 || totalFromCache > 0) {
        toast.success(`${totalGenerated + totalFromCache} archivos procesados (${totalGenerated} nuevos, ${totalFromCache} desde cache)`);
      } else {
        toast.success('Archivos procesados');
      }
      
      if (totalErrors > 0) {
        const allErrors = [...(musicResult?.results?.errors || []), ...(effectsResult?.results?.errors || [])];
        console.warn('[AudioManager] Errors during generation:', allErrors);
        
        // Check for specific error types
        const has402Error = allErrors.some((e: any) => e.error?.includes('402') || e.error?.includes('Payment Required'));
        if (has402Error) {
          toast.error('Error 402: Tu plan de ElevenLabs no incluye Music API. Actualiza a un plan que incluya Music API y Sound Effects API.', { duration: 8000 });
        } else {
          toast.error(`${totalErrors} errores durante la generación. Revisa la consola.`, { duration: 5000 });
        }
      }
      
      // Wait a bit for files to be available
      await new Promise(resolve => setTimeout(resolve, 3000));
      await loadAudioFiles();
      onRefresh?.();
    } catch (error: any) {
      console.error('Error generating initial audios:', error);
      toast.dismiss('audio-generation');
      toast.error(`Error al generar: ${error.message}`);
    } finally {
      setRegenerating(null);
    }
  };

  const handleDelete = async (path: string, name: string) => {
    if (!confirm(`¿Eliminar ${name}?`)) {
      return;
    }

    try {
      const success = await deleteAudioFile(path);
      if (success) {
        toast.success('Archivo eliminado');
        await loadAudioFiles();
        onRefresh?.();
      } else {
        toast.error('Error al eliminar archivo');
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      toast.error('Error al eliminar archivo');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-700">
        <button
          onClick={() => setActiveTab('music')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'music'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          🎵 Música ({musicFiles.length})
        </button>
        <button
          onClick={() => setActiveTab('effects')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'effects'
              ? 'text-cyan-400 border-b-2 border-cyan-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          🔊 Efectos ({soundEffectFiles.length})
        </button>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <button
          onClick={loadAudioFiles}
          className="text-sm text-gray-400 hover:text-gray-300 px-3 py-1.5 rounded hover:bg-gray-800"
        >
          🔄 Actualizar
        </button>
        
        {/* Generate Initial Files Button - Show when no files exist */}
        {(musicFiles.length === 0 && soundEffectFiles.length === 0) && (
          <button
            onClick={handleGenerateInitial}
            disabled={regenerating === 'all'}
            className="text-sm bg-green-600/20 hover:bg-green-600/30 text-green-400 px-4 py-2 rounded disabled:opacity-50 font-medium"
          >
            {regenerating === 'all' ? '⏳ Generando...' : '✨ Generar Archivos Iniciales'}
          </button>
        )}
        
        {activeTab === 'music' && musicFiles.length > 0 && (
          <button
            onClick={() => handleRegenerateAll('music')}
            disabled={regenerating === 'all'}
            className="text-sm bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 px-4 py-2 rounded disabled:opacity-50"
          >
            {regenerating === 'all' ? '⏳ Regenerando...' : '🔄 Regenerar Todo'}
          </button>
        )}
        {activeTab === 'effects' && soundEffectFiles.length > 0 && (
          <button
            onClick={() => handleRegenerateAll('effects')}
            disabled={regenerating === 'all'}
            className="text-sm bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 px-4 py-2 rounded disabled:opacity-50"
          >
            {regenerating === 'all' ? '⏳ Regenerando...' : '🔄 Regenerar Todo'}
          </button>
        )}
      </div>

      {/* Music Files */}
      {activeTab === 'music' && (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {musicFiles.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No hay archivos de música disponibles</p>
              <p className="text-sm mt-2">Haz clic en "Generar Archivos Iniciales" para crearlos</p>
            </div>
          ) : (
            musicFiles.map((file) => (
              <div
                key={file.path}
                className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium truncate">{file.name}</span>
                    <span className="text-xs text-gray-500">.mp3</span>
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-1">{file.path}</div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePlay(file.url)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm min-h-[32px]"
                  >
                    {playingUrl === file.url ? '⏸️' : '▶️'}
                  </button>
                  <button
                    onClick={() => handleRegenerate('music', file.name)}
                    disabled={regenerating === file.name}
                    className="px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 rounded text-sm disabled:opacity-50 min-h-[32px]"
                  >
                    {regenerating === file.name ? '⏳' : '🔄'}
                  </button>
                  <button
                    onClick={() => handleDelete(file.path, file.name)}
                    className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm min-h-[32px]"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Sound Effect Files */}
      {activeTab === 'effects' && (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {soundEffectFiles.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No hay efectos de sonido disponibles</p>
              <p className="text-sm mt-2">Haz clic en "Generar Archivos Iniciales" para crearlos</p>
            </div>
          ) : (
            soundEffectFiles.map((file) => (
              <div
                key={file.path}
                className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium truncate">{file.name}</span>
                    <span className="text-xs text-gray-500">.mp3</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {file.type && (
                      <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                        {file.type}
                      </span>
                    )}
                    {file.description && (
                      <span className="text-xs text-gray-500">{file.description}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 truncate mt-1">{file.path}</div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handlePlay(file.url)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm min-h-[32px]"
                  >
                    {playingUrl === file.url ? '⏸️' : '▶️'}
                  </button>
                  <button
                    onClick={() => handleRegenerate('effect', file.name)}
                    disabled={regenerating === file.name}
                    className="px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 rounded text-sm disabled:opacity-50 min-h-[32px]"
                  >
                    {regenerating === file.name ? '⏳' : '🔄'}
                  </button>
                  <button
                    onClick={() => handleDelete(file.path, file.name)}
                    className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm min-h-[32px]"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Audio Player */}
      {playingUrl && (
        <div className="fixed bottom-4 right-4 bg-gray-900 border border-gray-700 rounded-lg p-4 shadow-xl z-50 max-w-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium">Reproduciendo</span>
            <button
              onClick={() => setPlayingUrl(null)}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <audio
            src={playingUrl}
            controls
            autoPlay
            className="w-full"
            onEnded={() => setPlayingUrl(null)}
          />
        </div>
      )}
    </div>
  );
};

export default AudioManager;
