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
    if (!confirm('¿Subir archivos de audio iniciales desde fuentes gratuitas? Esto descargará archivos de audio gratuitos y los subirá a Supabase Storage.')) {
      return;
    }

    setRegenerating('all');
    try {
      const vercelUrl = import.meta.env.VITE_BACKEND_URL || window.location.origin;
      
      console.log(`[AudioManager] Uploading initial audio files via ${vercelUrl}/api/upload-audio-simple`);
      toast.loading('Subiendo archivos de audio iniciales...', { id: 'audio-generation' });

      // URLs de archivos de audio gratuitos (puedes reemplazar estas con tus propias URLs)
      // Estos son ejemplos - reemplázalos con URLs reales de archivos gratuitos
      const freeAudioFiles = [
        // Música de fondo (usa tus propias URLs de Mixkit, Pixabay, etc.)
        { name: 'podcast.mp3', url: 'https://assets.mixkit.co/music/download/mixkit-forest-temple-942.mp3', type: 'music' },
        { name: 'energetic.mp3', url: 'https://assets.mixkit.co/music/download/mixkit-tech-house-vibes-130.mp3', type: 'music' },
        { name: 'calm.mp3', url: 'https://assets.mixkit.co/music/download/mixkit-reflections-118.mp3', type: 'music' },
        { name: 'dramatic.mp3', url: 'https://assets.mixkit.co/music/download/mixkit-epic-adventure-12.mp3', type: 'music' },
        { name: 'news.mp3', url: 'https://assets.mixkit.co/music/download/mixkit-corporate-style-120.mp3', type: 'music' },
        { name: 'corporate.mp3', url: 'https://assets.mixkit.co/music/download/mixkit-professional-15.mp3', type: 'music' },
        // Efectos de sonido
        { name: 'transition-whoosh.mp3', url: 'https://assets.mixkit.co/sfx/download/mixkit-whoosh-1123.mp3', type: 'sound-effect' },
        { name: 'transition-swoosh.mp3', url: 'https://assets.mixkit.co/sfx/download/mixkit-quick-jump-arcade-game-239.mp3', type: 'sound-effect' },
        { name: 'transition-swish.mp3', url: 'https://assets.mixkit.co/sfx/download/mixkit-magic-sweep-game-trophy-257.mp3', type: 'sound-effect' },
        { name: 'emphasis-drum-roll.mp3', url: 'https://assets.mixkit.co/sfx/download/mixkit-drum-roll-build-up-2339.mp3', type: 'sound-effect' },
        { name: 'emphasis-pop.mp3', url: 'https://assets.mixkit.co/sfx/download/mixkit-pop-cork-1035.mp3', type: 'sound-effect' },
        { name: 'emphasis-hit.mp3', url: 'https://assets.mixkit.co/sfx/download/mixkit-punch-impact-2804.mp3', type: 'sound-effect' },
        { name: 'notification-news-alert.mp3', url: 'https://assets.mixkit.co/sfx/download/mixkit-news-alert-988.mp3', type: 'sound-effect' },
        { name: 'notification-ding.mp3', url: 'https://assets.mixkit.co/sfx/download/mixkit-notification-alert-991.mp3', type: 'sound-effect' },
        { name: 'notification-bell.mp3', url: 'https://assets.mixkit.co/sfx/download/mixkit-bell-notification-933.mp3', type: 'sound-effect' },
      ];

      const response = await fetch(`${vercelUrl}/api/upload-audio-simple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: freeAudioFiles })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log(`[AudioManager] Upload result:`, result);
      toast.dismiss('audio-generation');

      if (result.summary) {
        const totalSuccess = result.summary.musicUploaded + result.summary.soundEffectsUploaded;
        if (totalSuccess > 0) {
          toast.success(`${totalSuccess} archivos subidos exitosamente`);
        }
        if (result.summary.errors > 0) {
          toast.error(`${result.summary.errors} archivos fallaron. Algunos URLs pueden no estar disponibles.`);
        }
      } else {
        toast.success('Archivos procesados');
      }

      // Wait a bit for files to be available
      await new Promise(resolve => setTimeout(resolve, 2000));
      await loadAudioFiles();
      onRefresh?.();
    } catch (error: any) {
      console.error('Error uploading initial audios:', error);
      toast.dismiss('audio-generation');
      toast.error(`Error al subir: ${error.message}`);
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
