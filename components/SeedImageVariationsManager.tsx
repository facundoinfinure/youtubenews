import React, { useState } from 'react';
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
        toast.success('✅ Variaciones generadas exitosamente! Se usarán automáticamente en las escenas.', { id: 'variations' });
      } else {
        toast.error('Error generando variaciones. Algunas pueden haber fallado.', { id: 'variations' });
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
              <p className="text-sm text-green-400 mb-2">
                ✅ {variationCount} variaciones generadas y guardadas
              </p>
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
              <div className="text-gray-400 mb-1">Host A:</div>
              <div className="space-y-1 text-gray-500">
                {Object.keys(existingVariations.hostA).map(angle => (
                  <div key={angle}>• {angle.replace('_', '-')}</div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-gray-400 mb-1">Host B:</div>
              <div className="space-y-1 text-gray-500">
                {Object.keys(existingVariations.hostB).map(angle => (
                  <div key={angle}>• {angle.replace('_', '-')}</div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-gray-400 mb-1">Two-Shot:</div>
              <div className="space-y-1 text-gray-500">
                {Object.keys(existingVariations.twoShot).map(angle => (
                  <div key={angle}>• {angle.replace('_', '-')}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
