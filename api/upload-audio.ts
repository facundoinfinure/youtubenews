/**
 * Vercel Serverless Function para generar y subir archivos de audio a Supabase Storage usando ElevenLabs
 * 
 * Este endpoint genera música de fondo y efectos de sonido usando ElevenLabs API
 * y los sube a Supabase Storage.
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
      throw new Error(`ElevenLabs Music API error: ${response.status} - ${errorText}`);
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
      throw new Error(`ElevenLabs Sound Effects API error: ${response.status} - ${errorText}`);
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
 * Subir buffer de audio a Supabase Storage
 */
async function uploadAudioToSupabase(
  supabase: any,
  buffer: Buffer,
  storagePath: string,
  fileName: string
): Promise<string | null> {
  try {
    // Verificar si ya existe
    const pathParts = storagePath.split('/');
    const folderPath = pathParts.slice(0, -1).join('/');
    
    const { data: existingFiles } = await supabase.storage
      .from('channel-assets')
      .list(folderPath);
    
    if (existingFiles?.some(f => f.name === fileName)) {
      const { data: urlData } = supabase.storage
        .from('channel-assets')
        .getPublicUrl(storagePath);
      console.log(`[Supabase] ✅ File already exists: ${fileName}`);
      return urlData.publicUrl;
    }

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
    // Verificar ElevenLabs API Key
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ 
        error: 'ELEVENLABS_API_KEY not configured in Vercel environment variables',
        message: 'Please configure ELEVENLABS_API_KEY in Vercel Dashboard > Settings > Environment Variables'
      });
    }

    // Obtener variables de entorno de Supabase
    const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ 
        error: 'Supabase credentials not configured in Vercel environment variables' 
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { music = true, soundEffects = true } = req.body || {};

    const results: Record<string, any> = {
      music: {},
      soundEffects: {},
      errors: []
    };

    // Procesar música de fondo
    if (music) {
      for (const [style, config] of Object.entries(MUSIC_CONFIG)) {
        try {
          const fileName = `${style}.mp3`;
          const storagePath = `music/${fileName}`;
          
          // Generar música con ElevenLabs
          const audioBuffer = await generateMusicWithElevenLabs(style, config);
          
          if (audioBuffer) {
            // Subir a Supabase
            const publicUrl = await uploadAudioToSupabase(supabase, audioBuffer, storagePath, fileName);
            if (publicUrl) {
              results.music[style] = publicUrl;
            }
          }
        } catch (error: any) {
          results.errors.push({ file: `${style}.mp3`, error: error.message });
        }
      }
    }

    // Procesar efectos de sonido
    if (soundEffects) {
      for (const [name, config] of Object.entries(SOUND_EFFECTS_CONFIG)) {
        try {
          const fileName = `${name}.mp3`;
          const storagePath = `sound-effects/${fileName}`;
          
          // Generar efecto de sonido con ElevenLabs
          const audioBuffer = await generateSoundEffectWithElevenLabs(name, config);
          
          if (audioBuffer) {
            // Subir a Supabase
            const publicUrl = await uploadAudioToSupabase(supabase, audioBuffer, storagePath, fileName);
            if (publicUrl) {
              results.soundEffects[name] = publicUrl;
            }
          }
        } catch (error: any) {
          results.errors.push({ file: `${name}.mp3`, error: error.message });
        }
      }
    }

    const successCount = Object.keys(results.music).length + Object.keys(results.soundEffects).length;
    const failCount = results.errors.length;

    return res.status(200).json({
      success: true,
      message: `Proceso completado: ${successCount} exitosos, ${failCount} fallidos`,
      results,
      summary: {
        musicUploaded: Object.keys(results.music).length,
        soundEffectsUploaded: Object.keys(results.soundEffects).length,
        errors: failCount
      }
    });

  } catch (error: any) {
    console.error('Error en upload-audio:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
