import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ChannelConfig } from '../types';
import { generateAllSeedVariations, SeedImageVariations } from '../services/seedImageVariations';

interface SeedImageVariationsManagerProps {
  config: ChannelConfig;
  channelId: string;
  onVariationsGenerated?: (variations: SeedImageVariations) => void;
}

export const SeedImageVariationsManager: React.FC<SeedImageVariationsManagerProps> = ({
  config,
  channelId,
  onVariationsGenerated
}) => {
  const [generatingVariations, setGeneratingVariations] = useState(false);
  const [existingVariations, setExistingVariations] = useState<SeedImageVariations | null>(
    (config as any).seed_image_variations || null
  );

  // Update state when config changes
  useEffect(() => {
    const variations = (config as any).seed_image_variations;
    if (variations) {
      setExistingVariations(variations);
    }
  }, [config]);

  const seedImages = config.seedImages || {};
  const seedImageFormat = config.format || '16:9';
  
  const hasHostA = seedImageFormat === '16:9' 
    ? seedImages.hostASoloUrl 
    : seedImages.hostASoloUrl_9_16;
  const hasHostB = seedImageFormat === '16:9'
    ? seedImages.hostBSoloUrl
    : seedImages.hostBSoloUrl_9_16;

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
        
        // Count total variations (all should be present)
        const totalVariations = Object.keys(variations.hostA).length + 
                                Object.keys(variations.hostB).length + 
                                Object.keys(variations.twoShot).length;
        
        // Check if backend is available (if all are original URLs, generation likely failed)
        const allUrls = [
          ...Object.values(variations.hostA),
          ...Object.values(variations.hostB),
          ...Object.values(variations.twoShot)
        ];
        const uniqueUrls = new Set(allUrls);
        
        if (uniqueUrls.size <= 3) {
          // Likely all are original images (fallback)
          toast(`⚠️ Las variaciones se generaron pero el backend no está disponible. Se están usando las imágenes originales como fallback. Verifica que VITE_BACKEND_URL esté configurado.`, { 
            id: 'variations', 
            duration: 8000,
            icon: '⚠️',
            style: { background: '#fbbf24', color: '#000' }
          });
        } else {
          toast.success(`✅ ${totalVariations} variaciones generadas exitosamente! Se usarán automáticamente en las escenas.`, { id: 'variations', duration: 5000 });
        }
      } else {
        toast.error('❌ Error generando variaciones. Verifica que las imágenes semilla base estén configuradas y que el backend esté disponible.', { id: 'variations', duration: 6000 });
      }
    } catch (error) {
      console.error('Error generating variations:', error);
      toast.error(`Error: ${(error as Error).message}`, { id: 'variations' });
    } finally {
      setGeneratingVariations(false);
    }
  };

  const variationCount = existingVariations 
    ? (Object.keys(existingVariations.hostA).length + 
       Object.keys(existingVariations.hostB).length + 
       Object.keys(existingVariations.twoShot).length)
    : 0;

  return (
    <div className="space-y-4">
      <div className="bg-yellow-900/10 border border-yellow-500/30 rounded-lg p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h4 className="text-lg font-bold text-yellow-400 mb-2 flex items-center gap-2">
              🎬 Variaciones de Ángulos de Cámara
            </h4>
            <p className="text-sm text-gray-400 mb-2">
              Genera automáticamente variaciones de las imágenes semilla con diferentes ángulos de cámara 
              (eye-level, low-angle, high-angle, closeup, wide) para crear escenas más dinámicas.
            </p>
            {existingVariations && (
              <div className="space-y-1 mb-2">
                <p className="text-sm text-green-400">
                  ✅ {variationCount} variaciones generadas y guardadas
                </p>
                <p className="text-xs text-gray-500">
                  Las variaciones se seleccionan automáticamente según el tipo de escena y ángulo de cámara.
                </p>
              </div>
            )}
            <p className="text-xs text-yellow-300/70">
              ⚠️ Requiere que las imágenes semilla base estén configuradas. Costo aproximado: ~$0.70 por host (5 variaciones × $0.14).
            </p>
          </div>
          <button
            onClick={handleGenerateVariations}
            disabled={generatingVariations || !channelId || !hasHostA || !hasHostB}
            className="bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all whitespace-nowrap"
          >
            {generatingVariations ? (
              <>
                <span className="animate-spin">⏳</span>
                Generando...
              </>
            ) : existingVariations ? (
              <>
                🔄 Regenerar Variaciones
              </>
            ) : (
              <>
                🎬 Generar Variaciones
              </>
            )}
          </button>
        </div>
      </div>

      {existingVariations && (
        <div className="bg-[#1a1a1a] border border-[#333] rounded-lg p-4">
          <h5 className="text-sm font-bold text-gray-300 mb-3">Variaciones Disponibles:</h5>
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <div className="text-gray-400 mb-1 font-semibold">Host A:</div>
              <div className="space-y-1 text-gray-500">
                {Object.entries(existingVariations.hostA).map(([angle, url]) => {
                  const isOriginal = url === (seedImageFormat === '16:9' ? seedImages.hostASoloUrl : seedImages.hostASoloUrl_9_16);
                  return (
                    <div key={angle} className={isOriginal ? 'text-yellow-500' : 'text-green-400'}>
                      {isOriginal ? '⚠️' : '✅'} {angle.replace('_', '-')}
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-gray-400 mb-1 font-semibold">Host B:</div>
              <div className="space-y-1 text-gray-500">
                {Object.entries(existingVariations.hostB).map(([angle, url]) => {
                  const isOriginal = url === (seedImageFormat === '16:9' ? seedImages.hostBSoloUrl : seedImages.hostBSoloUrl_9_16);
                  return (
                    <div key={angle} className={isOriginal ? 'text-yellow-500' : 'text-green-400'}>
                      {isOriginal ? '⚠️' : '✅'} {angle.replace('_', '-')}
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="text-gray-400 mb-1 font-semibold">Two-Shot:</div>
              <div className="space-y-1 text-gray-500">
                {Object.entries(existingVariations.twoShot).map(([angle, url]) => {
                  const twoShotBase = seedImageFormat === '16:9' ? seedImages.twoShotUrl : seedImages.twoShotUrl_9_16;
                  const isOriginal = url === twoShotBase || url === (seedImageFormat === '16:9' ? seedImages.hostASoloUrl : seedImages.hostASoloUrl_9_16);
                  return (
                    <div key={angle} className={isOriginal ? 'text-yellow-500' : 'text-green-400'}>
                      {isOriginal ? '⚠️' : '✅'} {angle.replace('_', '-')}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            ✅ = Nueva variación generada | ⚠️ = Usando imagen original (fallback)
          </p>
        </div>
      )}
    </div>
  );
};
