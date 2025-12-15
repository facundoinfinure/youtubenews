import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { ChannelConfig } from '../types';
import { generateAllSeedVariations, SeedImageVariations, generateSingleVariation } from '../services/seedImageVariations';
import { supabase } from '../services/supabaseService';

interface SeedImageVariationsManagerProps {
  config: ChannelConfig;
  channelId: string;
  onVariationsGenerated?: (variations: SeedImageVariations) => void;
  onVariationsDeleted?: () => void;
}

const ANGLE_LABELS: Record<string, string> = {
  eye_level: 'Eye Level',
  low_angle: 'Low Angle',
  high_angle: 'High Angle',
  closeup: 'Close-up',
  wide: 'Wide Shot'
};

const ANGLE_ICONS: Record<string, string> = {
  eye_level: '👁️',
  low_angle: '⬆️',
  high_angle: '⬇️',
  closeup: '🔍',
  wide: '🌐'
};

const ALL_ANGLES = ['eye_level', 'low_angle', 'high_angle', 'closeup', 'wide'] as const;

export const SeedImageVariationsManager: React.FC<SeedImageVariationsManagerProps> = ({
  config,
  channelId,
  onVariationsGenerated,
  onVariationsDeleted
}) => {
  const [loading, setLoading] = useState(true);
  const [generatingVariations, setGeneratingVariations] = useState(false);
  const [deletingVariations, setDeletingVariations] = useState(false);
  const [regeneratingAngle, setRegeneratingAngle] = useState<string | null>(null);
  const [existingVariations, setExistingVariations] = useState<SeedImageVariations | null>(null);
  const [selectedImage, setSelectedImage] = useState<{ url: string; label: string } | null>(null);
  const [expandedHost, setExpandedHost] = useState<'hostA' | 'hostB' | 'twoShot' | null>('hostA');

  const seedImages = config.seedImages || {};
  const seedImageFormat = config.format || '16:9';
  
  const hasHostA = seedImageFormat === '16:9' 
    ? seedImages.hostASoloUrl 
    : seedImages.hostASoloUrl_9_16;
  const hasHostB = seedImageFormat === '16:9'
    ? seedImages.hostBSoloUrl
    : seedImages.hostBSoloUrl_9_16;

  // Fetch variations from Supabase on mount
  const fetchVariations = useCallback(async () => {
    if (!channelId) {
      setLoading(false);
      return;
    }

    try {
      const { data: channel, error } = await supabase
        .from('channels')
        .select('config')
        .eq('id', channelId)
        .single();

      if (error) {
        console.error('Error fetching channel config:', error);
        setLoading(false);
        return;
      }

      const variations = channel?.config?.seed_image_variations as SeedImageVariations | undefined;
      if (variations) {
        console.log('📷 [Variations] Loaded from Supabase:', {
          hostA: Object.keys(variations.hostA || {}).length,
          hostB: Object.keys(variations.hostB || {}).length,
          twoShot: Object.keys(variations.twoShot || {}).length
        });
        setExistingVariations(variations);
      } else {
        console.log('📷 [Variations] No variations found in Supabase');
        setExistingVariations(null);
      }
    } catch (error) {
      console.error('Error loading variations:', error);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    fetchVariations();
  }, [fetchVariations]);

  const getOriginalUrl = (hostType: 'hostA' | 'hostB' | 'twoShot'): string => {
    if (hostType === 'hostA') {
      return seedImageFormat === '16:9' ? seedImages.hostASoloUrl || '' : seedImages.hostASoloUrl_9_16 || '';
    } else if (hostType === 'hostB') {
      return seedImageFormat === '16:9' ? seedImages.hostBSoloUrl || '' : seedImages.hostBSoloUrl_9_16 || '';
    } else {
      return seedImageFormat === '16:9' ? seedImages.twoShotUrl || seedImages.hostASoloUrl || '' : seedImages.twoShotUrl_9_16 || seedImages.hostASoloUrl_9_16 || '';
    }
  };

  const isOriginalImage = (hostType: 'hostA' | 'hostB' | 'twoShot', url: string): boolean => {
    const originalUrl = getOriginalUrl(hostType);
    return url === originalUrl || !url;
  };

  const handleGenerateVariations = async () => {
    if (!channelId) {
      toast.error('Selecciona un canal primero');
      return;
    }

    if (!hasHostA || !hasHostB) {
      toast.error('Primero genera o sube las imágenes semilla base (Host A y Host B)');
      return;
    }

    setGeneratingVariations(true);
    try {
      toast.loading('Generando variaciones de ángulos... Esto puede tomar varios minutos.', { id: 'variations' });
      
      const variations = await generateAllSeedVariations(config, channelId);
      
      if (variations) {
        setExistingVariations(variations);
        onVariationsGenerated?.(variations);
        
        const totalVariations = Object.keys(variations.hostA).length + 
                                Object.keys(variations.hostB).length + 
                                Object.keys(variations.twoShot).length;
        
        const allUrls = [
          ...Object.values(variations.hostA),
          ...Object.values(variations.hostB),
          ...Object.values(variations.twoShot)
        ];
        const uniqueUrls = new Set(allUrls);
        
        if (uniqueUrls.size <= 3) {
          toast(`⚠️ Backend no disponible. Se usan imágenes originales como fallback.`, { 
            id: 'variations', 
            duration: 8000,
            icon: '⚠️',
            style: { background: '#fbbf24', color: '#000' }
          });
        } else {
          toast.success(`✅ ${totalVariations} variaciones generadas!`, { id: 'variations', duration: 5000 });
        }
      } else {
        toast.error('❌ Error generando variaciones.', { id: 'variations', duration: 6000 });
      }
    } catch (error) {
      console.error('Error generating variations:', error);
      toast.error(`Error: ${(error as Error).message}`, { id: 'variations' });
    } finally {
      setGeneratingVariations(false);
    }
  };

  const handleRegenerateSingle = async (hostType: 'hostA' | 'hostB' | 'twoShot', angle: string) => {
    const key = `${hostType}-${angle}`;
    setRegeneratingAngle(key);
    
    try {
      const baseUrl = getOriginalUrl(hostType);
      if (!baseUrl) {
        toast.error('No hay imagen base para regenerar');
        return;
      }

      toast.loading(`Regenerando ${ANGLE_LABELS[angle]}...`, { id: 'regen' });
      
      const newUrl = await generateSingleVariation(
        baseUrl,
        angle as any,
        channelId,
        hostType
      );

      if (newUrl && newUrl !== baseUrl) {
        // Update local state
        const emptyHostVariations = {
          eye_level: '',
          low_angle: '',
          high_angle: '',
          closeup: '',
          wide: ''
        };
        const emptyTwoShotVariations = {
          eye_level: '',
          low_angle: '',
          high_angle: '',
          wide: ''
        };
        
        const updatedVariations: SeedImageVariations = existingVariations 
          ? {
              ...existingVariations,
              [hostType]: {
                ...existingVariations[hostType],
                [angle]: newUrl
              }
            } as SeedImageVariations
          : {
              hostA: hostType === 'hostA' ? { ...emptyHostVariations, [angle]: newUrl } : emptyHostVariations,
              hostB: hostType === 'hostB' ? { ...emptyHostVariations, [angle]: newUrl } : emptyHostVariations,
              twoShot: hostType === 'twoShot' ? { ...emptyTwoShotVariations, [angle]: newUrl } : emptyTwoShotVariations
            } as SeedImageVariations;

        // Save to Supabase
        const { data: channel } = await supabase
          .from('channels')
          .select('config')
          .eq('id', channelId)
          .single();
        
        if (channel) {
          const updatedConfig = {
            ...channel.config,
            seed_image_variations: updatedVariations
          };

          await supabase
            .from('channels')
            .update({ config: updatedConfig })
            .eq('id', channelId);
        }

        setExistingVariations(updatedVariations);
        toast.success(`✅ ${ANGLE_LABELS[angle]} regenerada!`, { id: 'regen' });
      } else {
        toast.error('No se pudo regenerar la variación', { id: 'regen' });
      }
    } catch (error) {
      console.error('Error regenerating:', error);
      toast.error(`Error: ${(error as Error).message}`, { id: 'regen' });
    } finally {
      setRegeneratingAngle(null);
    }
  };

  const handleDeleteAllVariations = async () => {
    if (!confirm('¿Estás seguro de eliminar todas las variaciones? Esto no se puede deshacer.')) {
      return;
    }

    setDeletingVariations(true);
    try {
      const { data: channel, error: fetchError } = await supabase
        .from('channels')
        .select('config')
        .eq('id', channelId)
        .single();
      
      if (fetchError || !channel) {
        throw new Error('No se pudo obtener la configuración del canal');
      }

      const updatedConfig = { ...channel.config };
      delete updatedConfig.seed_image_variations;

      const { error } = await supabase
        .from('channels')
        .update({ config: updatedConfig })
        .eq('id', channelId);

      if (error) throw error;

      setExistingVariations(null);
      onVariationsDeleted?.();
      toast.success('Variaciones eliminadas correctamente');
    } catch (error) {
      console.error('Error deleting variations:', error);
      toast.error(`Error eliminando variaciones: ${(error as Error).message}`);
    } finally {
      setDeletingVariations(false);
    }
  };

  const handleDeleteSingleVariation = async (hostType: 'hostA' | 'hostB' | 'twoShot', angle: string) => {
    if (!existingVariations) return;

    try {
      const fallbackUrl = getOriginalUrl(hostType);

      const updatedVariations: SeedImageVariations = {
        ...existingVariations,
        [hostType]: {
          ...existingVariations[hostType],
          [angle]: fallbackUrl
        }
      };

      const { data: channel, error: fetchError } = await supabase
        .from('channels')
        .select('config')
        .eq('id', channelId)
        .single();
      
      if (fetchError || !channel) {
        throw new Error('No se pudo obtener la configuración del canal');
      }

      const updatedConfig = {
        ...channel.config,
        seed_image_variations: updatedVariations
      };

      const { error } = await supabase
        .from('channels')
        .update({ config: updatedConfig })
        .eq('id', channelId);

      if (error) throw error;

      setExistingVariations(updatedVariations);
      toast.success(`Variación ${ANGLE_LABELS[angle]} eliminada`);
    } catch (error) {
      console.error('Error deleting variation:', error);
      toast.error(`Error: ${(error as Error).message}`);
    }
  };

  // Calculate stats
  const getVariationStats = () => {
    if (!existingVariations) return { total: 0, generated: 0, missing: 15 };
    
    let generated = 0;

    // Host A and Host B have 5 angles each
    ['hostA', 'hostB'].forEach((hostType) => {
      const hostVariations = existingVariations[hostType as 'hostA' | 'hostB'] || {};
      ALL_ANGLES.forEach((angle) => {
        const url = (hostVariations as Record<string, string>)[angle];
        if (url && !isOriginalImage(hostType as 'hostA' | 'hostB', url)) {
          generated++;
        }
      });
    });
    
    // Two-shot has 4 angles (no closeup)
    const twoShotVariations = existingVariations.twoShot || {};
    ['eye_level', 'low_angle', 'high_angle', 'wide'].forEach((angle) => {
      const url = (twoShotVariations as Record<string, string>)[angle];
      if (url && !isOriginalImage('twoShot', url)) {
        generated++;
      }
    });

    return { total: 14, generated, missing: 14 - generated };
  };

  const stats = getVariationStats();

  const renderVariationCard = (
    hostType: 'hostA' | 'hostB' | 'twoShot',
    angle: string,
    url: string | undefined
  ) => {
    const actualUrl = url || getOriginalUrl(hostType);
    const isOriginal = !url || isOriginalImage(hostType, url);
    const isMissing = !url;
    const label = `${hostType === 'hostA' ? 'Host A' : hostType === 'hostB' ? 'Host B' : 'Two-Shot'} - ${ANGLE_LABELS[angle] || angle}`;
    const isRegenerating = regeneratingAngle === `${hostType}-${angle}`;
    
    return (
      <div 
        key={`${hostType}-${angle}`}
        className={`relative group rounded-lg overflow-hidden border-2 transition-all ${
          isMissing 
            ? 'border-red-500/50 bg-red-900/10' 
            : isOriginal 
              ? 'border-yellow-500/50 bg-yellow-900/10' 
              : 'border-green-500/50 bg-green-900/10'
        }`}
      >
        <div className="aspect-[9/16] relative bg-black/50">
          {actualUrl ? (
            <img 
              src={actualUrl} 
              alt={label}
              className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => setSelectedImage({ url: actualUrl, label })}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500">
              <span className="text-3xl">📷</span>
            </div>
          )}
          
          {/* Loading overlay */}
          {isRegenerating && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="text-center">
                <span className="animate-spin text-2xl block mb-2">⏳</span>
                <span className="text-sm text-white">Generando...</span>
              </div>
            </div>
          )}
          
          {/* Hover overlay */}
          {!isRegenerating && (
            <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
              {actualUrl && (
                <button
                  onClick={() => setSelectedImage({ url: actualUrl, label })}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-medium w-full"
                >
                  👁️ Ver Grande
                </button>
              )}
              <button
                onClick={() => handleRegenerateSingle(hostType, angle)}
                className="bg-yellow-600 hover:bg-yellow-500 text-white px-3 py-1.5 rounded text-xs font-medium w-full"
              >
                🔄 {isMissing ? 'Generar' : 'Regenerar'}
              </button>
              {!isOriginal && !isMissing && (
                <button
                  onClick={() => handleDeleteSingleVariation(hostType, angle)}
                  className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded text-xs font-medium w-full"
                >
                  🗑️ Eliminar
                </button>
              )}
            </div>
          )}
        </div>
        
        <div className="p-2">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1">
              <span className="text-sm">{ANGLE_ICONS[angle] || '📷'}</span>
              <span className="text-xs text-gray-300 truncate">{ANGLE_LABELS[angle] || angle}</span>
            </div>
            {isMissing ? (
              <span className="text-[10px] text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">Falta</span>
            ) : isOriginal ? (
              <span className="text-[10px] text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">Original</span>
            ) : (
              <span className="text-[10px] text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded">✓</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderHostSection = (
    hostType: 'hostA' | 'hostB' | 'twoShot',
    label: string,
    emoji: string
  ) => {
    const variations = existingVariations?.[hostType] || {};
    const isExpanded = expandedHost === hostType;
    
    // Count stats for this host
    let hostGenerated = 0;
    ALL_ANGLES.forEach((angle) => {
      const url = variations[angle];
      if (url && !isOriginalImage(hostType, url)) {
        hostGenerated++;
      }
    });
    
    return (
      <div className="border border-[#333] rounded-lg overflow-hidden">
        <button
          onClick={() => setExpandedHost(isExpanded ? null : hostType)}
          className="w-full px-4 py-3 bg-[#1a1a1a] hover:bg-[#222] flex items-center justify-between transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-xl">{emoji}</span>
            <span className="font-medium text-white">{label}</span>
            <div className="flex items-center gap-1 ml-2">
              {hostGenerated === 5 ? (
                <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded">
                  ✅ 5/5 completo
                </span>
              ) : hostGenerated > 0 ? (
                <span className="text-xs text-yellow-400 bg-yellow-900/30 px-2 py-0.5 rounded">
                  ⚠️ {hostGenerated}/5 generadas
                </span>
              ) : (
                <span className="text-xs text-red-400 bg-red-900/30 px-2 py-0.5 rounded">
                  ❌ Sin variaciones
                </span>
              )}
            </div>
          </div>
          <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </button>
        
        {isExpanded && (
          <div className="p-4 bg-[#0d0d0d] grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {ALL_ANGLES.map((angle) => 
              renderVariationCard(hostType, angle, variations[angle])
            )}
          </div>
        )}
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-8 text-center">
          <div className="animate-spin text-4xl mb-3">⏳</div>
          <p className="text-gray-400">Cargando variaciones desde Supabase...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/30 rounded-lg p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h4 className="text-lg font-bold text-purple-400 mb-2 flex items-center gap-2">
              🎬 Variaciones de Ángulos de Cámara
            </h4>
            <p className="text-sm text-gray-400 mb-3">
              Variaciones con diferentes ángulos (eye-level, low-angle, high-angle, closeup, wide) 
              para crear escenas más dinámicas.
            </p>
            
            {/* Stats bar */}
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span className="text-sm text-gray-300">
                  <strong className="text-green-400">{stats.generated}</strong> generadas
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-sm text-gray-300">
                  <strong className="text-red-400">{stats.missing}</strong> pendientes
                </span>
              </div>
              <div className="h-2 flex-1 bg-gray-700 rounded-full overflow-hidden max-w-[200px]">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all"
                  style={{ width: `${(stats.generated / 15) * 100}%` }}
                />
              </div>
            </div>

            <p className="text-xs text-gray-500">
              💡 Costo aproximado: ~$0.70 por host (5 variaciones × $0.14)
            </p>
          </div>
          
          <div className="flex flex-col gap-2">
            <button
              onClick={handleGenerateVariations}
              disabled={generatingVariations || !channelId || !hasHostA || !hasHostB}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all whitespace-nowrap shadow-lg"
            >
              {generatingVariations ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Generando...
                </>
              ) : stats.generated > 0 ? (
                <>
                  🔄 Regenerar Todas
                </>
              ) : (
                <>
                  🎬 Generar Todas
                </>
              )}
            </button>
            
            {stats.generated > 0 && (
              <button
                onClick={handleDeleteAllVariations}
                disabled={deletingVariations}
                className="bg-red-600/80 hover:bg-red-600 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all"
              >
                {deletingVariations ? (
                  <span className="animate-spin">⏳</span>
                ) : (
                  <>🗑️ Eliminar Todas</>
                )}
              </button>
            )}
            
            <button
              onClick={fetchVariations}
              className="text-gray-400 hover:text-white text-xs flex items-center justify-center gap-1 py-1"
            >
              🔃 Recargar desde DB
            </button>
          </div>
        </div>
      </div>

      {/* Variations Gallery */}
      <div className="space-y-2">
        {renderHostSection('hostA', 'Host A (Presentador Principal)', '👤')}
        {renderHostSection('hostB', 'Host B (Co-presentador)', '👥')}
        {renderHostSection('twoShot', 'Two-Shot (Ambos)', '👫')}
      </div>

      {/* No base images warning */}
      {(!hasHostA || !hasHostB) && (
        <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4 text-center">
          <span className="text-yellow-400 text-sm">
            ⚠️ Primero configura las imágenes semilla base (Host A y Host B) para poder generar variaciones.
          </span>
        </div>
      )}

      {/* Image Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full">
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 text-xl font-bold"
            >
              ✕ Cerrar
            </button>
            <div className="bg-[#1a1a1a] rounded-lg overflow-hidden">
              <div className="p-3 border-b border-[#333]">
                <h4 className="text-white font-medium">{selectedImage.label}</h4>
              </div>
              <img 
                src={selectedImage.url} 
                alt={selectedImage.label}
                className="w-full h-auto max-h-[75vh] object-contain"
                onClick={(e) => e.stopPropagation()}
              />
              <div className="p-3 border-t border-[#333] flex justify-between items-center">
                <a
                  href={selectedImage.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  🔗 Abrir en nueva pestaña
                </a>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(selectedImage.url);
                    toast.success('URL copiada al portapapeles');
                  }}
                  className="text-gray-400 hover:text-white text-sm"
                >
                  📋 Copiar URL
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
