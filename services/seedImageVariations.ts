/**
 * Seed Image Variations Service
 * 
 * Genera variaciones de imágenes semilla con diferentes ángulos de cámara
 * para crear escenas más dinámicas sin necesidad de múltiples imágenes manuales.
 * 
 * Estrategia:
 * 1. Toma la imagen semilla original
 * 2. Genera variaciones usando DALL-E/WaveSpeed con diferentes ángulos
 * 3. Almacena las variantes en Supabase Storage
 * 4. Las variantes se usan automáticamente según el tipo de escena
 */

import { ChannelConfig } from '../types';
import { supabase } from './supabaseService';
import { CostTracker } from './CostTracker';
import { generateImageWithDALLE } from './openaiService';

export interface SeedImageVariations {
  hostA: {
    eye_level: string;      // Original/standard
    low_angle: string;       // Dramatic, powerful
    high_angle: string;      // Overview, conclusion
    closeup: string;         // Intimate, emotional
    wide: string;            // Context, establishing
  };
  hostB: {
    eye_level: string;
    low_angle: string;
    high_angle: string;
    closeup: string;
    wide: string;
  };
  twoShot: {
    eye_level: string;
    low_angle: string;
    high_angle: string;
    wide: string;
  };
}

/**
 * Genera variaciones de una imagen semilla con diferentes ángulos
 * usando DALL-E o WaveSpeed
 */
export const generateSeedImageVariation = async (
  originalImageUrl: string,
  angle: 'eye_level' | 'low_angle' | 'high_angle' | 'closeup' | 'wide',
  characterDescription: string,
  channelId: string
): Promise<string | null> => {
  try {
    console.log(`🎨 [Seed Variations] Generating ${angle} variation for character...`);

    // Construir prompt para la variación
    const anglePrompts: Record<string, string> = {
      eye_level: 'eye-level shot, standard perspective, camera at character eye height, professional framing',
      low_angle: 'low angle shot, camera looking up at character, dramatic perspective, creates power and intensity, cinematic framing',
      high_angle: 'high angle shot, camera looking down at character, creates overview and conclusion, establishing perspective',
      closeup: 'extreme close-up shot, very tight framing on face, maximum emotional impact, intimate framing',
      wide: 'wide shot, showing full context and environment, establishing shot, full body visible'
    };

    const prompt = `
${characterDescription}

CAMERA ANGLE: ${anglePrompts[angle]}
STUDIO: Modern podcast news studio, warm tungsten key light, purple/blue LED accents, acoustic foam panels, Shure SM7B microphone.

CRITICAL: Maintain exact character appearance, outfit, and features from the reference image. Only change the camera angle and framing.
STYLE: Ultra-detailed 3D render, professional photography quality, consistent character design.
`.trim();

    // Try WaveSpeed image edit endpoint first (if backend is available)
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';
    
    if (BACKEND_URL) {
      try {
        // FIXED: Use query parameter 'path' for the WaveSpeed proxy
        // API docs: https://wavespeed.ai/docs/docs-api/google/google-nano-banana-pro-edit
        const wavespeedPath = 'api/v3/google/nano-banana-pro/edit';
        const response = await fetch(`${BACKEND_URL}/api/wavespeed?path=${encodeURIComponent(wavespeedPath)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: prompt,
            images: [originalImageUrl], // FIXED: 'images' is an array of URLs (1-14 items)
            aspect_ratio: '16:9',
            resolution: '1k', // Options: 1k, 2k, 4k
            output_format: 'png',
            enable_sync_mode: true // Wait for result directly
          })
        });

        if (response.ok) {
          const result = await response.json();
          // WaveSpeed returns data.outputs array when sync mode is enabled
          const imageUrl = result.data?.outputs?.[0] || result.output?.[0] || result.url || result.image_url;
          if (imageUrl) {
            // Track cost and return
            CostTracker.track('seed_image_variation', 'wavespeed/nano-banana-pro', 0.14);
            console.log(`✅ [Seed Variations] Generated ${angle} variation via WaveSpeed`);
            return imageUrl;
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.warn(`⚠️ [Seed Variations] WaveSpeed returned ${response.status}, trying DALL-E fallback...`, errorData);
        }
      } catch (error) {
        console.warn('⚠️ [Seed Variations] WaveSpeed request failed (backend may not be available), trying DALL-E fallback:', (error as Error).message);
      }
    } else {
      console.log('ℹ️ [Seed Variations] VITE_BACKEND_URL not configured, skipping WaveSpeed, using DALL-E directly...');
    }

    // Fallback: Use DALL-E with enhanced prompt that includes angle description
    // Since DALL-E doesn't support image-to-image directly, we enhance the prompt
    // to describe the character AND the angle
    console.log(`🎨 [Seed Variations] WaveSpeed failed, trying DALL-E fallback for ${angle}...`);
    
    try {
      const enhancedPrompt = `${prompt}\n\nMaintain exact character appearance, outfit, and features. Only change camera angle to ${angle}.`;
      const dalleImage = await generateImageWithDALLE(enhancedPrompt, '1792x1024'); // 16:9 format
      
      if (dalleImage) {
        // Upload to Supabase Storage
        if (supabase) {
          try {
            // Store in a known/verified bucket so URLs are consistently accessible.
            // `channel-assets` is verified at runtime in the app logs.
            const fileName = `images/seed-variations/${channelId}/${angle}-${Date.now()}.png`;
            // Convert data URI to blob
            const response = await fetch(dalleImage);
            const blob = await response.blob();
            
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('channel-assets')
              .upload(fileName, blob, {
                cacheControl: '3600',
                upsert: false
              });

            if (!uploadError && uploadData) {
              const { data: { publicUrl } } = supabase.storage
                .from('channel-assets')
                .getPublicUrl(fileName);
              
              CostTracker.track('seed_image_variation', 'dalle-3', 0.04); // DALL-E is cheaper
              console.log(`✅ [Seed Variations] Generated ${angle} variation via DALL-E: ${publicUrl}`);
              return publicUrl;
            }
          } catch (storageError) {
            console.warn('⚠️ [Seed Variations] Storage upload failed, using direct DALL-E URL:', storageError);
          }
        }
        
        // Return DALL-E image directly if storage fails
        CostTracker.track('seed_image_variation', 'dalle-3', 0.04);
        console.log(`✅ [Seed Variations] Generated ${angle} variation via DALL-E (direct URL)`);
        return dalleImage;
      }
    } catch (dalleError) {
      console.error(`❌ [Seed Variations] DALL-E fallback also failed:`, dalleError);
    }
    
    // Last resort: return original image
    console.warn(`⚠️ [Seed Variations] All generation methods failed for ${angle}, using original image`);
    return originalImageUrl;

  } catch (error) {
    console.error(`❌ [Seed Variations] Failed to generate ${angle} variation:`, error);
    return null;
  }
};

/**
 * Genera todas las variaciones necesarias para un host
 */
export const generateAllHostVariations = async (
  originalImageUrl: string,
  characterDescription: string,
  channelId: string,
  hostType: 'hostA' | 'hostB'
): Promise<Partial<SeedImageVariations['hostA']>> => {
  const angles: Array<'eye_level' | 'low_angle' | 'high_angle' | 'closeup' | 'wide'> = [
    'eye_level',
    'low_angle',
    'high_angle',
    'closeup',
    'wide'
  ];

  const variations: Partial<SeedImageVariations['hostA']> = {};
  let successCount = 0;
  let failCount = 0;

  // Generate all variations in parallel (but limit to 3 at a time to avoid rate limits)
  const batchSize = 3;
  for (let i = 0; i < angles.length; i += batchSize) {
    const batch = angles.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(angle => 
        generateSeedImageVariation(originalImageUrl, angle, characterDescription, channelId)
          .then(url => {
            if (url && url !== originalImageUrl) {
              successCount++;
              return { angle, url, success: true };
            } else {
              failCount++;
              return { angle, url: null, success: false };
            }
          })
          .catch((error) => {
            failCount++;
            console.error(`❌ [Seed Variations] Failed to generate ${angle}:`, error);
            return { angle, url: null, success: false };
          })
      )
    );

    results.forEach(({ angle, url, success }) => {
      if (url && url !== originalImageUrl) {
        variations[angle] = url;
      } else if (!success) {
        // Use original as fallback only if generation completely failed
        variations[angle] = originalImageUrl;
      }
    });

    // Small delay between batches
    if (i + batchSize < angles.length) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`📊 [Seed Variations] ${hostType}: ${successCount} generated, ${failCount} failed (using original as fallback)`);
  return variations;
};

/**
 * Genera todas las variaciones para ambos hosts y two-shot
 */
export const generateAllSeedVariations = async (
  config: ChannelConfig,
  channelId: string
): Promise<SeedImageVariations | null> => {
  try {
    console.log(`🎨 [Seed Variations] Generating all variations for channel ${channelId}...`);

    const seedImages = config.seedImages || {};
    const hostAUrl = config.format === '9:16' 
      ? (seedImages.hostASoloUrl_9_16 || seedImages.hostASoloUrl)
      : (seedImages.hostASoloUrl || seedImages.hostASoloUrl_9_16);
    const hostBUrl = config.format === '9:16'
      ? (seedImages.hostBSoloUrl_9_16 || seedImages.hostBSoloUrl)
      : (seedImages.hostBSoloUrl || seedImages.hostBSoloUrl_9_16);
    const twoShotUrl = config.format === '9:16'
      ? (seedImages.twoShotUrl_9_16 || seedImages.twoShotUrl)
      : (seedImages.twoShotUrl || seedImages.twoShotUrl_9_16);

    if (!hostAUrl || !hostBUrl) {
      console.warn('⚠️ [Seed Variations] Missing base seed images, cannot generate variations');
      return null;
    }

    // Get character descriptions from config
    const hostAVisual = config.seedImages?.hostASolo || 'Professional podcaster';
    const hostBVisual = config.seedImages?.hostBSolo || 'Professional podcaster';
    const hostADescription = `${config.characters?.hostA?.name || 'Host A'} - ${hostAVisual}`;
    const hostBDescription = `${config.characters?.hostB?.name || 'Host B'} - ${hostBVisual}`;
    const twoShotDescription = `${hostADescription} and ${hostBDescription} together at podcast desk`;

    // Generate variations in parallel for efficiency
    const [hostAVariations, hostBVariations, twoShotVariations] = await Promise.all([
      generateAllHostVariations(hostAUrl, hostADescription, channelId, 'hostA'),
      generateAllHostVariations(hostBUrl, hostBDescription, channelId, 'hostB'),
      twoShotUrl ? generateAllHostVariations(twoShotUrl, twoShotDescription, channelId, 'hostA') : Promise.resolve({})
    ]);

    // Build result, ensuring we have valid URLs (not just original fallbacks)
    const result: SeedImageVariations = {
      hostA: {
        eye_level: (hostAVariations.eye_level as string) || hostAUrl,
        low_angle: (hostAVariations.low_angle as string) || hostAUrl,
        high_angle: (hostAVariations.high_angle as string) || hostAUrl,
        closeup: (hostAVariations.closeup as string) || hostAUrl,
        wide: (hostAVariations.wide as string) || hostAUrl,
      },
      hostB: {
        eye_level: (hostBVariations.eye_level as string) || hostBUrl,
        low_angle: (hostBVariations.low_angle as string) || hostBUrl,
        high_angle: (hostBVariations.high_angle as string) || hostBUrl,
        closeup: (hostBVariations.closeup as string) || hostBUrl,
        wide: (hostBVariations.wide as string) || hostBUrl,
      },
      twoShot: {
        eye_level: ((twoShotVariations as any).eye_level as string) || twoShotUrl || hostAUrl,
        low_angle: ((twoShotVariations as any).low_angle as string) || twoShotUrl || hostAUrl,
        high_angle: ((twoShotVariations as any).high_angle as string) || twoShotUrl || hostAUrl,
        wide: ((twoShotVariations as any).wide as string) || twoShotUrl || hostAUrl,
      }
    };

    // Count how many are actually new (not just original fallbacks)
    const newVariations = [
      ...Object.values(result.hostA),
      ...Object.values(result.hostB),
      ...Object.values(result.twoShot)
    ].filter(url => url && url !== hostAUrl && url !== hostBUrl && url !== twoShotUrl).length;

    console.log(`📊 [Seed Variations] Total: ${newVariations} new variations generated, ${15 - newVariations} using original as fallback`);

    // Save variations to channel config in Supabase
    const saveError = await saveVariationsToConfig(channelId, result);
    if (saveError) {
      console.warn('⚠️ [Seed Variations] Variations generated but failed to save to config:', saveError);
      // Still return result even if save failed - user can regenerate
    } else {
      console.log(`✅ [Seed Variations] Saved variations to channel config`);
    }

    console.log(`✅ [Seed Variations] Generated all variations for channel ${channelId}`);
    return result;

  } catch (error) {
    console.error('❌ [Seed Variations] Failed to generate all variations:', error);
    return null;
  }
};

/**
 * Guarda las variaciones en la configuración del canal
 * Returns error message if failed, null if successful
 */
const saveVariationsToConfig = async (
  channelId: string,
  variations: SeedImageVariations
): Promise<string | null> => {
  try {
    if (!supabase) {
      return 'Supabase not initialized';
    }
    
    // Get current channel config
    const { data: channel, error: fetchError } = await supabase
      .from('channels')
      .select('config')
      .eq('id', channelId)
      .single();
    
    if (fetchError || !channel) {
      return `Failed to fetch channel: ${fetchError?.message || 'Channel not found'}`;
    }
    
    // Update config with variations (store in config JSONB)
    const updatedConfig = {
      ...channel.config,
      seed_image_variations: variations
    };
    
    const { error } = await supabase
      .from('channels')
      .update({
        config: updatedConfig
      })
      .eq('id', channelId);

    if (error) {
      return `Failed to save: ${error.message}`;
    }
    
    return null; // Success
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
};

/**
 * Obtiene la variación apropiada según el tipo de escena y ángulo de cámara
 */
export const getSeedImageForScene = (
  config: ChannelConfig,
  hostType: 'hostA' | 'hostB' | 'twoShot',
  cameraAngle?: 'eye_level' | 'low_angle' | 'high_angle' | 'closeup' | 'wide' | 'bird_eye' | 'worm_eye'
): string => {
  // Check if variations exist in config (stored in config JSONB)
  const variations = (config as any).seed_image_variations as SeedImageVariations | undefined;

  if (!variations) {
    // Fallback to original seed images
    const seedImages = config.seedImages || {};
    if (hostType === 'hostA') {
      return config.format === '9:16' 
        ? (seedImages.hostASoloUrl_9_16 || seedImages.hostASoloUrl || '')
        : (seedImages.hostASoloUrl || seedImages.hostASoloUrl_9_16 || '');
    } else if (hostType === 'hostB') {
      return config.format === '9:16'
        ? (seedImages.hostBSoloUrl_9_16 || seedImages.hostBSoloUrl || '')
        : (seedImages.hostBSoloUrl || seedImages.hostBSoloUrl_9_16 || '');
    } else {
      return config.format === '9:16'
        ? (seedImages.twoShotUrl_9_16 || seedImages.twoShotUrl || '')
        : (seedImages.twoShotUrl || seedImages.twoShotUrl_9_16 || '');
    }
  }

  // Use provided camera angle or default to eye_level
  // Map bird_eye and worm_eye to closest equivalents
  let effectiveAngle: 'eye_level' | 'low_angle' | 'high_angle' | 'closeup' | 'wide' = 'eye_level';
  if (cameraAngle) {
    if (cameraAngle === 'bird_eye') {
      effectiveAngle = 'high_angle';
    } else if (cameraAngle === 'worm_eye') {
      effectiveAngle = 'low_angle';
    } else {
      effectiveAngle = cameraAngle;
    }
  }

  // Get appropriate variation
  const hostVariations = variations[hostType];
  
  // Handle twoShot which doesn't have 'closeup'
  if (hostType === 'twoShot' && effectiveAngle === 'closeup') {
    effectiveAngle = 'eye_level'; // Fallback for twoShot
  }
  
  // Type-safe access
  if ('closeup' in hostVariations) {
    return (hostVariations as SeedImageVariations['hostA'])[effectiveAngle] || hostVariations.eye_level || '';
  } else {
    return hostVariations[effectiveAngle as 'eye_level' | 'low_angle' | 'high_angle' | 'wide'] || hostVariations.eye_level || '';
  }
};

/**
 * Genera una única variación de ángulo de cámara
 * Función simplificada para regenerar variaciones individuales
 */
export const generateSingleVariation = async (
  originalImageUrl: string,
  angle: 'eye_level' | 'low_angle' | 'high_angle' | 'closeup' | 'wide',
  channelId: string,
  hostType: 'hostA' | 'hostB' | 'twoShot'
): Promise<string | null> => {
  // Character descriptions based on host type
  const descriptions: Record<string, string> = {
    hostA: 'Professional podcast host, confident posture, looking at camera, news anchor aesthetic',
    hostB: 'Professional podcast co-host, engaged expression, news anchor aesthetic',
    twoShot: 'Two professional podcast hosts sitting together in a news studio setting'
  };

  const description = descriptions[hostType] || descriptions.hostA;
  
  return generateSeedImageVariation(originalImageUrl, angle, description, channelId);
};
