/**
 * Vercel Serverless Function para subir archivos de audio a Supabase Storage
 * 
 * SOLUCIÓN SIMPLE Y PRÁCTICA: Permite subir archivos de audio desde URLs públicas
 * o datos base64, sin depender de servicios externos costosos como ElevenLabs.
 * 
 * Uso: POST /api/upload-audio-simple
 * 
 * Body:
 * {
 *   "files": [
 *     {
 *       "name": "podcast.mp3",
 *       "url": "https://example.com/audio.mp3",  // URL pública del archivo
 *       "type": "music"  // o "sound-effect"
 *     }
 *   ]
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Solo permitir POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Obtener variables de entorno de Supabase
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ 
        error: 'Supabase credentials not configured. Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' 
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { files } = req.body || {};

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ 
        error: 'Missing "files" array in request body. Each file should have: name, url, type' 
      });
    }

    const results: Record<string, any> = {
      music: {},
      soundEffects: {},
      errors: []
    };

    // Procesar cada archivo
    for (const file of files) {
      const { name, url, type } = file;

      if (!name || !url || !type) {
        results.errors.push({ 
          file: name || 'unknown', 
          error: 'Missing required fields: name, url, and type are required' 
        });
        continue;
      }

      if (type !== 'music' && type !== 'sound-effect') {
        results.errors.push({ 
          file: name, 
          error: 'Type must be "music" or "sound-effect"' 
        });
        continue;
      }

      try {
        // Determinar ruta de storage
        const folder = type === 'music' ? 'music' : 'sound-effects';
        const storagePath = `${folder}/${name}`;

        // Verificar si ya existe
        const pathParts = storagePath.split('/');
        const fileName = pathParts[pathParts.length - 1];
        const folderPath = pathParts.slice(0, -1).join('/');
        
        const { data: existingFiles } = await supabase.storage
          .from('channel-assets')
          .list(folderPath);

        if (existingFiles && existingFiles.some((f: { name: string }) => f.name === fileName)) {
          // Ya existe, obtener URL
          const { data: urlData } = supabase.storage
            .from('channel-assets')
            .getPublicUrl(storagePath);
          
          if (type === 'music') {
            results.music[name.replace('.mp3', '')] = urlData.publicUrl;
          } else {
            results.soundEffects[name.replace('.mp3', '')] = urlData.publicUrl;
          }
          continue;
        }

        // Descargar archivo desde URL
        console.log(`[Upload Audio Simple] Downloading ${name} from ${url}...`);
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`Failed to download file: HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Subir a Supabase Storage
        console.log(`[Upload Audio Simple] Uploading ${name} to ${storagePath}...`);
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('channel-assets')
          .upload(storagePath, buffer, {
            contentType: 'audio/mpeg',
            upsert: true
          });

        if (uploadError) {
          throw uploadError;
        }

        // Obtener URL pública
        const { data: urlData } = supabase.storage
          .from('channel-assets')
          .getPublicUrl(uploadData.path);

        if (type === 'music') {
          results.music[name.replace('.mp3', '')] = urlData.publicUrl;
        } else {
          results.soundEffects[name.replace('.mp3', '')] = urlData.publicUrl;
        }

        console.log(`[Upload Audio Simple] ✅ Successfully uploaded ${name}`);
      } catch (error: any) {
        const errorMsg = error.message || String(error);
        console.error(`[Upload Audio Simple] ❌ Error processing ${name}:`, errorMsg);
        results.errors.push({ file: name, error: errorMsg });
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
    console.error('[Upload Audio Simple] ❌ Fatal error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message || String(error)
    });
  }
}
