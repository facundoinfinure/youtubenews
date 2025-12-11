/**
 * Vercel Serverless Function para generar y subir archivos de audio a Supabase Storage usando ElevenLabs
 * 
 * Este endpoint VERIFICA PRIMERO si los archivos ya existen en Supabase Storage.
 * Si existen, los usa directamente. Si no, los genera con ElevenLabs API y los sube.
 * 
 * Uso: POST /api/upload-audio
 * 
 * Body (opcional):
 * {
 *   "music": true,  // Generar música de fondo
 *   "soundEffects": true  // Generar efectos de sonido
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

// Configuración de música de fondo con prompts para ElevenLabs Music API
const MUSIC_CONFIG = {
  podcast: {
    prompt: 'Soft, professional background music for a podcast, instrumental, calm and subtle, 60 BPM',
    duration_ms: 120000, // 2 minutos
  },
  energetic: {
    prompt: 'Energetic, upbeat background music, modern electronic, driving rhythm, 120 BPM',
    duration_ms: 120000,
  },
  calm: {
    prompt: 'Calm, peaceful background music, ambient, soft piano and strings, relaxing, 70 BPM',
    duration_ms: 120000,
  },
  dramatic: {
    prompt: 'Dramatic, cinematic background music, orchestral, building tension, epic, 90 BPM',
    duration_ms: 120000,
  },
  news: {
    prompt: 'Professional news broadcast background music, corporate, clean, modern, subtle, 80 BPM',
    duration_ms: 120000,
  },
  corporate: {
    prompt: 'Corporate background music, professional, clean, modern, subtle, instrumental, 85 BPM',
    duration_ms: 120000,
  },
};

// Configuración de efectos de sonido con prompts para ElevenLabs Sound Effects API
const SOUND_EFFECTS_CONFIG = {
  'transition-whoosh': {
    text: 'Whoosh sound effect, fast movement, air swoosh, transition',
    duration_seconds: 1.5,
  },
  'transition-swoosh': {
    text: 'Swoosh sound effect, smooth movement, air flow, transition',
    duration_seconds: 1.2,
  },
  'transition-swish': {
    text: 'Swish sound effect, quick movement, air swish, transition',
    duration_seconds: 1.0,
  },
  'emphasis-drum-roll': {
    text: 'Drum roll sound effect, building anticipation, snare drum roll',
    duration_seconds: 2.0,
  },
  'emphasis-pop': {
    text: 'Pop sound effect, quick burst, emphasis, attention grabber',
    duration_seconds: 0.5,
  },
  'emphasis-hit': {
    text: 'Hit sound effect, impact, punch, emphasis, strong',
    duration_seconds: 0.8,
  },
  'notification-news-alert': {
    text: 'News alert sound effect, notification, attention, news broadcast alert',
    duration_seconds: 1.5,
  },
  'notification-ding': {
    text: 'Ding notification sound, clean, simple, alert',
    duration_seconds: 0.6,
  },
  'notification-bell': {
    text: 'Bell notification sound, clear bell ring, alert',
    duration_seconds: 0.8,
  },
  'ambient-newsroom': {
    text: 'Ambient newsroom sound, background chatter, office atmosphere, subtle',
    duration_seconds: 30.0,
    loop: true,
  },
};

/**
 * Verificar si un archivo existe en Supabase Storage y obtener su URL pública
 */
async function checkFileExistsInSupabase(
  supabase: any,
  storagePath: string
): Promise<string | null> {
  try {
    const pathParts = storagePath.split('/');
    const fileName = pathParts[pathParts.length - 1];
    const folderPath = pathParts.slice(0, -1).join('/');
    
    // Listar archivos en la carpeta
    const { data: files, error: listError } = await supabase.storage
      .from('channel-assets')
      .list(folderPath);
    
    if (listError) {
      // Si la carpeta no existe, el archivo tampoco existe
      if (listError.message.includes('not found') || listError.message.includes('Bucket not found')) {
        return null;
      }
      throw listError;
    }
    
    // Verificar si el archivo existe
    if (files && files.some((f: { name: string }) => f.name === fileName)) {
      // Obtener URL pública
      const { data: urlData } = supabase.storage
        .from('channel-assets')
        .getPublicUrl(storagePath);
      
      console.log(`[Supabase] ✅ File exists: ${fileName}`);
      return urlData.publicUrl;
    }
    
    return null;
  } catch (error: any) {
    console.error(`[Supabase] ❌ Error checking file existence:`, error.message);
    return null;
  }
}

/**
 * Generar música usando ElevenLabs Music API
 */
async function generateMusicWithElevenLabs(
  style: string,
  config: { prompt: string; duration_ms: number }
): Promise<Buffer | null> {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  try {
    console.log(`[ElevenLabs Music] Generating ${style} music...`);
    
    const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/music/stream`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: config.prompt,
        music_length_ms: config.duration_ms,
        model_id: 'music_v1',
        force_instrumental: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `ElevenLabs Music API error: ${response.status} - ${errorText}`;
      
      if (response.status === 403) {
        errorMessage += ' (Forbidden - Verifica que tu API key tenga permisos para Music API y que tu plan incluya acceso)';
      } else if (response.status === 402) {
        errorMessage += ' (Payment Required - Music API requiere un plan de pago. Actualiza tu plan en ElevenLabs.)';
      }
      
      throw new Error(errorMessage);
    }

    // ElevenLabs Music API retorna audio como stream
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log(`[ElevenLabs Music] ✅ Generated ${style} music (${buffer.length} bytes)`);
    return buffer;
  } catch (error: any) {
    console.error(`[ElevenLabs Music] ❌ Error generating ${style}:`, error.message);
    throw error;
  }
}

/**
 * Generar efecto de sonido usando ElevenLabs Sound Effects API
 */
async function generateSoundEffectWithElevenLabs(
  name: string,
  config: { text: string; duration_seconds: number; loop?: boolean }
): Promise<Buffer | null> {
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  try {
    console.log(`[ElevenLabs Sound Effects] Generating ${name}...`);
    
    const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/sound-generation`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: config.text,
        duration_seconds: config.duration_seconds,
        loop: config.loop || false,
        prompt_influence: 0.7,
        output_format: 'mp3_44100_128',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `ElevenLabs Sound Effects API error: ${response.status} - ${errorText}`;
      
      if (response.status === 403) {
        errorMessage += ' (Forbidden - Verifica que tu API key tenga permisos para Sound Effects API y que tu plan incluya acceso)';
      } else if (response.status === 402) {
        errorMessage += ' (Payment Required - Sound Effects API requiere un plan de pago. Actualiza tu plan en ElevenLabs.)';
      }
      
      throw new Error(errorMessage);
    }

    // ElevenLabs Sound Effects API retorna audio como stream
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    console.log(`[ElevenLabs Sound Effects] ✅ Generated ${name} (${buffer.length} bytes)`);
    return buffer;
  } catch (error: any) {
    console.error(`[ElevenLabs Sound Effects] ❌ Error generating ${name}:`, error.message);
    throw error;
  }
}

/**
 * Subir buffer de audio a Supabase Storage (sin verificar existencia)
 */
async function uploadAudioToSupabase(
  supabase: any,
  buffer: Buffer,
  storagePath: string,
  fileName: string
): Promise<string | null> {
  try {
    // Subir a Supabase
    const { data, error } = await supabase.storage
      .from('channel-assets')
      .upload(storagePath, buffer, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (error) {
      if (error.message.includes('Bucket not found')) {
        throw new Error('Bucket "channel-assets" not found. Create it in Supabase Dashboard > Storage');
      }
      throw error;
    }

    const { data: urlData } = supabase.storage
      .from('channel-assets')
      .getPublicUrl(data.path);

    console.log(`[Supabase] ✅ Uploaded: ${fileName}`);
    return urlData.publicUrl;
  } catch (error: any) {
    throw error;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Solo permitir POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verificar ElevenLabs API Key (solo necesario si vamos a generar)
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    
    console.log('[Upload Audio] Starting process...');
    console.log('[Upload Audio] ELEVENLABS_API_KEY configured:', !!ELEVENLABS_API_KEY);

    // Obtener variables de entorno de Supabase
    // Use Service Role Key for serverless functions (bypasses RLS)
    // For Storage operations, we need full permissions
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ 
        error: 'Supabase credentials not configured in Vercel environment variables. Need SUPABASE_SERVICE_ROLE_KEY for Storage uploads.' 
      });
    }

    // Use service role key if available (for server-side operations)
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const { music = true, soundEffects = true, regenerate = [], batch, musicBatch } = req.body || {};
    
    // regenerate is an array of file names to force regenerate (e.g., ['podcast', 'transition-whoosh'])
    // batch can be 'transitions-emphasis' or 'notifications-ambient' to split sound effects generation
    // musicBatch can be 'first-half' or 'second-half' to split music generation

    const results: Record<string, any> = {
      music: {},
      soundEffects: {},
      errors: [],
      stats: {
        fromCache: 0,
        generated: 0,
      }
    };

    // Procesar música de fondo
    if (music) {
      // Filter by musicBatch if specified
      const musicToProcess = musicBatch 
        ? Object.entries(MUSIC_CONFIG).filter(([style], index) => {
            const allStyles = Object.keys(MUSIC_CONFIG);
            if (musicBatch === 'first-half') {
              return index < Math.ceil(allStyles.length / 2);
            } else if (musicBatch === 'second-half') {
              return index >= Math.ceil(allStyles.length / 2);
            }
            return true;
          })
        : Object.entries(MUSIC_CONFIG);
      
      for (const [style, config] of musicToProcess) {
        try {
          const fileName = `${style}.mp3`;
          const storagePath = `music/${fileName}`;
          
          // 1. PRIMERO: Verificar si ya existe en Supabase (a menos que se fuerce regeneración)
          const shouldRegenerate = regenerate.includes(style) || regenerate.includes(fileName);
          if (!shouldRegenerate) {
            const existingUrl = await checkFileExistsInSupabase(supabase, storagePath);
            if (existingUrl) {
              results.music[style] = existingUrl;
              results.stats.fromCache++;
              continue; // Saltar generación
            }
          } else {
            console.log(`[Process] Forcing regeneration of ${fileName}...`);
          }
          
          // 2. Si no existe, verificar que tenemos API key y generar con ElevenLabs
          if (!ELEVENLABS_API_KEY) {
            results.errors.push({ 
              file: `${style}.mp3`, 
              error: 'File not found and ELEVENLABS_API_KEY not configured to generate it' 
            });
            continue;
          }
          
          console.log(`[Process] File not found, generating ${fileName} with ElevenLabs...`);
          const audioBuffer = await generateMusicWithElevenLabs(style, config);
          
          if (audioBuffer) {
            // 3. Subir a Supabase
            const publicUrl = await uploadAudioToSupabase(supabase, audioBuffer, storagePath, fileName);
            if (publicUrl) {
              results.music[style] = publicUrl;
              results.stats.generated++;
            }
          }
        } catch (error: any) {
          const errorMsg = error.message || String(error);
          console.error(`[Error] Failed to process ${style}.mp3:`, errorMsg);
          results.errors.push({ file: `${style}.mp3`, error: errorMsg });
        }
      }
    }

    // Procesar efectos de sonido
    if (soundEffects) {
      // Filter by batch if specified
      const soundEffectsToProcess = batch 
        ? Object.entries(SOUND_EFFECTS_CONFIG).filter(([name]) => {
            if (batch === 'transitions-emphasis') {
              return name.startsWith('transition-') || name.startsWith('emphasis-');
            } else if (batch === 'notifications-ambient') {
              return name.startsWith('notification-') || name.startsWith('ambient-');
            }
            return true;
          })
        : Object.entries(SOUND_EFFECTS_CONFIG);
      
      for (const [name, config] of soundEffectsToProcess) {
        try {
          const fileName = `${name}.mp3`;
          const storagePath = `sound-effects/${fileName}`;
          
          // 1. PRIMERO: Verificar si ya existe en Supabase (a menos que se fuerce regeneración)
          const shouldRegenerate = regenerate.includes(name) || regenerate.includes(fileName);
          if (!shouldRegenerate) {
            const existingUrl = await checkFileExistsInSupabase(supabase, storagePath);
            if (existingUrl) {
              results.soundEffects[name] = existingUrl;
              results.stats.fromCache++;
              continue; // Saltar generación
            }
          } else {
            console.log(`[Process] Forcing regeneration of ${fileName}...`);
          }
          
          // 2. Si no existe, verificar que tenemos API key y generar con ElevenLabs
          if (!ELEVENLABS_API_KEY) {
            results.errors.push({ 
              file: `${name}.mp3`, 
              error: 'File not found and ELEVENLABS_API_KEY not configured to generate it' 
            });
            continue;
          }
          
          console.log(`[Process] File not found, generating ${fileName} with ElevenLabs...`);
          const audioBuffer = await generateSoundEffectWithElevenLabs(name, config);
          
          if (audioBuffer) {
            // 3. Subir a Supabase
            const publicUrl = await uploadAudioToSupabase(supabase, audioBuffer, storagePath, fileName);
            if (publicUrl) {
              results.soundEffects[name] = publicUrl;
              results.stats.generated++;
            }
          }
        } catch (error: any) {
          const errorMsg = error.message || String(error);
          console.error(`[Error] Failed to process ${name}.mp3:`, errorMsg);
          results.errors.push({ file: `${name}.mp3`, error: errorMsg });
        }
      }
    }

    const successCount = Object.keys(results.music).length + Object.keys(results.soundEffects).length;
    const failCount = results.errors.length;

    return res.status(200).json({
      success: true,
      message: `Proceso completado: ${successCount} exitosos (${results.stats.fromCache} desde cache, ${results.stats.generated} generados), ${failCount} fallidos`,
      results,
      summary: {
        musicUploaded: Object.keys(results.music).length,
        soundEffectsUploaded: Object.keys(results.soundEffects).length,
        fromCache: results.stats.fromCache,
        generated: results.stats.generated,
        errors: failCount
      }
    });

  } catch (error: any) {
    console.error('[Upload Audio] ❌ Fatal error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message || String(error),
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
