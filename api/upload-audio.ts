/**
 * Vercel Serverless Function para subir archivos de audio a Supabase Storage
 * 
 * Este endpoint descarga archivos de audio de Mixkit y los sube a Supabase Storage.
 * 
 * Uso: POST /api/upload-audio
 * 
 * Body (opcional):
 * {
 *   "music": true,  // Subir música de fondo
 *   "soundEffects": true  // Subir efectos de sonido
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// URLs de archivos de audio gratuitos de Mixkit
const AUDIO_URLS = {
  music: {
    podcast: 'https://assets.mixkit.co/music/download/mixkit-tech-house-vibes-130.mp3',
    energetic: 'https://assets.mixkit.co/music/download/mixkit-driving-ambition-32.mp3',
    calm: 'https://assets.mixkit.co/music/download/mixkit-serene-view-443.mp3',
    dramatic: 'https://assets.mixkit.co/music/download/mixkit-epic-cinematic-trailer-471.mp3',
    news: 'https://assets.mixkit.co/music/download/mixkit-corporate-business-123.mp3',
    corporate: 'https://assets.mixkit.co/music/download/mixkit-corporate-business-123.mp3',
  },
  soundEffects: {
    'transition-whoosh': 'https://assets.mixkit.co/sfx/download/mixkit-whoosh-1129.mp3',
    'transition-swoosh': 'https://assets.mixkit.co/sfx/download/mixkit-swoosh-1128.mp3',
    'transition-swish': 'https://assets.mixkit.co/sfx/download/mixkit-swish-1127.mp3',
    'emphasis-drum-roll': 'https://assets.mixkit.co/sfx/download/mixkit-drum-roll-493.mp3',
    'emphasis-pop': 'https://assets.mixkit.co/sfx/download/mixkit-pop-478.mp3',
    'emphasis-hit': 'https://assets.mixkit.co/sfx/download/mixkit-hit-476.mp3',
    'notification-news-alert': 'https://assets.mixkit.co/sfx/download/mixkit-alert-493.mp3',
    'notification-ding': 'https://assets.mixkit.co/sfx/download/mixkit-notification-493.mp3',
    'notification-bell': 'https://assets.mixkit.co/sfx/download/mixkit-bell-493.mp3',
    'ambient-newsroom': 'https://assets.mixkit.co/sfx/download/mixkit-ambient-493.mp3',
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Solo permitir POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Obtener variables de entorno de Vercel
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

    // Función para descargar y subir un archivo
    const downloadAndUpload = async (
      url: string,
      storagePath: string,
      name: string
    ): Promise<string | null> => {
      try {
        // Verificar si ya existe
        const pathParts = storagePath.split('/');
        const fileName = pathParts.pop()!;
        const folderPath = pathParts.join('/');
        
        const { data: existingFiles } = await supabase.storage
          .from('channel-assets')
          .list(folderPath);
        
        if (existingFiles?.some(f => f.name === fileName)) {
          const { data: urlData } = supabase.storage
            .from('channel-assets')
            .getPublicUrl(storagePath);
          return urlData.publicUrl;
        }

        // Descargar archivo
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

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

        return urlData.publicUrl;
      } catch (error: any) {
        results.errors.push({ file: name, error: error.message });
        return null;
      }
    };

    // Procesar música de fondo
    if (music) {
      for (const [style, url] of Object.entries(AUDIO_URLS.music)) {
        const fileName = `${style}.mp3`;
        const storagePath = `music/${fileName}`;
        const publicUrl = await downloadAndUpload(url, storagePath, fileName);
        if (publicUrl) {
          results.music[style] = publicUrl;
        }
      }
    }

    // Procesar efectos de sonido
    if (soundEffects) {
      for (const [name, url] of Object.entries(AUDIO_URLS.soundEffects)) {
        const fileName = `${name}.mp3`;
        const storagePath = `sound-effects/${fileName}`;
        const publicUrl = await downloadAndUpload(url, storagePath, fileName);
        if (publicUrl) {
          results.soundEffects[name] = publicUrl;
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
