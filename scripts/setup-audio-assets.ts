/**
 * Script para configurar archivos de audio en Supabase Storage
 * 
 * Este script ayuda a subir música de fondo y efectos de sonido a Supabase Storage.
 * 
 * IMPORTANTE: Antes de ejecutar este script, descarga los archivos de audio desde:
 * - Mixkit: https://mixkit.co/free-stock-music/ y https://mixkit.co/free-sound-effects/
 * - O coloca tus propios archivos en la carpeta scripts/audio-assets/
 * 
 * Uso:
 * 1. Coloca los archivos de audio en scripts/audio-assets/
 * 2. Ejecuta: npx tsx scripts/setup-audio-assets.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase
const getSupabaseUrl = () => process.env.VITE_SUPABASE_URL || '';
const getSupabaseKey = () => process.env.VITE_SUPABASE_ANON_KEY || '';

const supabaseUrl = getSupabaseUrl();
const supabaseKey = getSupabaseKey();

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY deben estar configurados');
  console.error('   Configúralos en tu archivo .env o variables de entorno');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Estructura esperada de archivos
const EXPECTED_FILES = {
  music: [
    'podcast.mp3',
    'energetic.mp3',
    'calm.mp3',
    'dramatic.mp3',
    'news.mp3',
    'corporate.mp3',
  ],
  soundEffects: [
    'transition-whoosh.mp3',
    'transition-swoosh.mp3',
    'transition-swish.mp3',
    'emphasis-drum-roll.mp3',
    'emphasis-pop.mp3',
    'emphasis-hit.mp3',
    'notification-news-alert.mp3',
    'notification-ding.mp3',
    'notification-bell.mp3',
  ]
};

/**
 * Verifica si un archivo existe en Supabase Storage
 */
async function fileExists(storagePath: string): Promise<boolean> {
  try {
    const pathParts = storagePath.split('/');
    const fileName = pathParts.pop()!;
    const folderPath = pathParts.join('/');
    
    const { data, error } = await supabase.storage
      .from('channel-assets')
      .list(folderPath);
    
    if (error) return false;
    return data?.some(f => f.name === fileName) || false;
  } catch {
    return false;
  }
}

/**
 * Sube un archivo local a Supabase Storage
 */
async function uploadFile(
  localPath: string,
  storagePath: string,
  contentType: string = 'audio/mpeg'
): Promise<string | null> {
  try {
    if (!fs.existsSync(localPath)) {
      console.warn(`⚠️  Archivo no encontrado: ${localPath}`);
      return null;
    }

    // Verificar si ya existe
    if (await fileExists(storagePath)) {
      console.log(`⏭️  Ya existe, omitiendo: ${storagePath}`);
      const { data: urlData } = supabase.storage
        .from('channel-assets')
        .getPublicUrl(storagePath);
      return urlData.publicUrl;
    }

    const fileBuffer = fs.readFileSync(localPath);
    const fileName = path.basename(localPath);
    
    console.log(`📤 Subiendo: ${fileName} -> ${storagePath}`);
    
    const { data, error } = await supabase.storage
      .from('channel-assets')
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert: true
      });
    
    if (error) {
      if (error.message.includes('Bucket not found')) {
        console.error(`❌ Error: El bucket 'channel-assets' no existe en Supabase Storage`);
        console.error(`   Por favor crea el bucket en Supabase Dashboard > Storage`);
        return null;
      }
      throw error;
    }
    
    const { data: urlData } = supabase.storage
      .from('channel-assets')
      .getPublicUrl(data.path);
    
    console.log(`✅ Subido: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (error) {
    console.error(`❌ Error subiendo ${localPath}:`, (error as Error).message);
    return null;
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('🎵 Configurando archivos de audio en Supabase Storage...\n');
  
  const audioAssetsDir = path.join(__dirname, 'audio-assets');
  const musicDir = path.join(audioAssetsDir, 'music');
  const effectsDir = path.join(audioAssetsDir, 'sound-effects');
  
  // Verificar que existe el directorio
  if (!fs.existsSync(audioAssetsDir)) {
    console.log('📁 Creando estructura de directorios...');
    fs.mkdirSync(musicDir, { recursive: true });
    fs.mkdirSync(effectsDir, { recursive: true });
    
    console.log('\n📋 Por favor, coloca los archivos de audio en:');
    console.log(`   Música: ${musicDir}`);
    console.log(`   Efectos: ${effectsDir}\n`);
    console.log('📥 Puedes descargar archivos gratuitos desde:');
    console.log('   - Mixkit: https://mixkit.co/free-stock-music/');
    console.log('   - Mixkit Effects: https://mixkit.co/free-sound-effects/');
    console.log('   - Pixabay: https://pixabay.com/music/');
    console.log('\n💡 Archivos esperados:');
    console.log('   Música:', EXPECTED_FILES.music.join(', '));
    console.log('   Efectos:', EXPECTED_FILES.soundEffects.join(', '));
    return;
  }
  
  const uploadedUrls: Record<string, string> = {};
  let uploadedCount = 0;
  let skippedCount = 0;
  
  // Subir música de fondo
  console.log('\n📀 Procesando música de fondo...\n');
  for (const fileName of EXPECTED_FILES.music) {
    const localPath = path.join(musicDir, fileName);
    const storagePath = `music/${fileName}`;
    
    const url = await uploadFile(localPath, storagePath);
    if (url) {
      uploadedUrls[`music-${fileName.replace('.mp3', '')}`] = url;
      uploadedCount++;
    } else {
      skippedCount++;
    }
  }
  
  // Subir efectos de sonido
  console.log('\n🔊 Procesando efectos de sonido...\n');
  for (const fileName of EXPECTED_FILES.soundEffects) {
    const localPath = path.join(effectsDir, fileName);
    const storagePath = `sound-effects/${fileName}`;
    
    const url = await uploadFile(localPath, storagePath);
    if (url) {
      uploadedUrls[`effect-${fileName.replace('.mp3', '')}`] = url;
      uploadedCount++;
    } else {
      skippedCount++;
    }
  }
  
  // Resumen
  console.log('\n' + '='.repeat(50));
  console.log('✅ Proceso completado!');
  console.log(`   Subidos: ${uploadedCount}`);
  console.log(`   Omitidos: ${skippedCount}`);
  console.log('='.repeat(50));
  
  if (Object.keys(uploadedUrls).length > 0) {
    console.log('\n📋 URLs disponibles:');
    console.log(JSON.stringify(uploadedUrls, null, 2));
  }
}

main().catch(console.error);
