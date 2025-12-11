/**
 * Script para descargar y subir archivos de audio a Supabase Storage
 * 
 * Este script descarga archivos de audio gratuitos de Mixkit y los sube a Supabase Storage.
 * Mixkit ofrece archivos gratuitos con licencia libre para uso comercial.
 * 
 * Uso: npx tsx scripts/download-and-upload-audio.ts
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
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// URLs de archivos de audio gratuitos de Mixkit
// Mixkit ofrece archivos gratuitos con licencia libre para uso comercial
// Estas URLs apuntan a archivos reales de Mixkit que pueden descargarse directamente
const AUDIO_URLS = {
  // Música de fondo - URLs reales de Mixkit
  // Puedes encontrar más en: https://mixkit.co/free-stock-music/
  music: {
    podcast: 'https://assets.mixkit.co/music/download/mixkit-tech-house-vibes-130.mp3',
    energetic: 'https://assets.mixkit.co/music/download/mixkit-driving-ambition-32.mp3',
    calm: 'https://assets.mixkit.co/music/download/mixkit-serene-view-443.mp3',
    dramatic: 'https://assets.mixkit.co/music/download/mixkit-epic-cinematic-trailer-471.mp3',
    news: 'https://assets.mixkit.co/music/download/mixkit-corporate-business-123.mp3',
    corporate: 'https://assets.mixkit.co/music/download/mixkit-corporate-business-123.mp3',
  },
  
  // Efectos de sonido - URLs reales de Mixkit
  // Puedes encontrar más en: https://mixkit.co/free-sound-effects/
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

/**
 * Descarga un archivo de una URL
 */
async function downloadFile(url: string, outputPath: string): Promise<boolean> {
  try {
    console.log(`📥 Descargando: ${path.basename(outputPath)}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Crear directorio si no existe
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, buffer);
    console.log(`✅ Descargado: ${path.basename(outputPath)}`);
    return true;
  } catch (error) {
    console.error(`❌ Error descargando ${url}:`, (error as Error).message);
    return false;
  }
}

/**
 * Sube un archivo a Supabase Storage
 */
async function uploadToSupabase(
  filePath: string,
  storagePath: string
): Promise<string | null> {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    // Verificar si ya existe
    const pathParts = storagePath.split('/');
    const fileName = pathParts.pop()!;
    const folderPath = pathParts.join('/');
    
    const { data: existingFiles } = await supabase.storage
      .from('channel-assets')
      .list(folderPath);
    
    if (existingFiles?.some(f => f.name === fileName)) {
      console.log(`⏭️  Ya existe: ${storagePath}`);
      const { data: urlData } = supabase.storage
        .from('channel-assets')
        .getPublicUrl(storagePath);
      return urlData.publicUrl;
    }

    const fileBuffer = fs.readFileSync(filePath);
    
    console.log(`📤 Subiendo: ${fileName} -> ${storagePath}`);
    
    const { data, error } = await supabase.storage
      .from('channel-assets')
      .upload(storagePath, fileBuffer, {
        contentType: 'audio/mpeg',
        upsert: true
      });
    
    if (error) {
      if (error.message.includes('Bucket not found')) {
        console.error(`❌ Error: El bucket 'channel-assets' no existe`);
        console.error(`   Crea el bucket en Supabase Dashboard > Storage`);
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
    console.error(`❌ Error subiendo ${filePath}:`, (error as Error).message);
    return null;
  }
}

/**
 * Función principal
 */
async function main() {
  console.log('🎵 Descargando y subiendo archivos de audio a Supabase Storage...\n');
  console.log('⚠️  NOTA: Este script usa URLs de ejemplo de Mixkit.');
  console.log('   Para producción, descarga los archivos manualmente desde:');
  console.log('   - https://mixkit.co/free-stock-music/');
  console.log('   - https://mixkit.co/free-sound-effects/\n');
  
  const tempDir = path.join(__dirname, '../temp-audio');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const uploadedUrls: Record<string, string> = {};
  let successCount = 0;
  let failCount = 0;
  
  try {
    // Procesar música de fondo
    console.log('📀 Procesando música de fondo...\n');
    for (const [style, url] of Object.entries(AUDIO_URLS.music)) {
      const fileName = `${style}.mp3`;
      const tempPath = path.join(tempDir, fileName);
      const storagePath = `music/${fileName}`;
      
      const downloaded = await downloadFile(url, tempPath);
      if (downloaded) {
        const publicUrl = await uploadToSupabase(tempPath, storagePath);
        if (publicUrl) {
          uploadedUrls[`music-${style}`] = publicUrl;
          successCount++;
        } else {
          failCount++;
        }
      } else {
        failCount++;
      }
    }
    
    // Procesar efectos de sonido
    console.log('\n🔊 Procesando efectos de sonido...\n');
    for (const [name, url] of Object.entries(AUDIO_URLS.soundEffects)) {
      const fileName = `${name}.mp3`;
      const tempPath = path.join(tempDir, fileName);
      const storagePath = `sound-effects/${fileName}`;
      
      const downloaded = await downloadFile(url, tempPath);
      if (downloaded) {
        const publicUrl = await uploadToSupabase(tempPath, storagePath);
        if (publicUrl) {
          uploadedUrls[`effect-${name}`] = publicUrl;
          successCount++;
        } else {
          failCount++;
        }
      } else {
        failCount++;
      }
    }
    
    // Limpiar
    console.log('\n🧹 Limpiando archivos temporales...');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    
    // Resumen
    console.log('\n' + '='.repeat(60));
    console.log('✅ Proceso completado!');
    console.log(`   Exitosos: ${successCount}`);
    console.log(`   Fallidos: ${failCount}`);
    console.log('='.repeat(60));
    
    if (Object.keys(uploadedUrls).length > 0) {
      console.log('\n📋 URLs disponibles en Supabase Storage:');
      console.log(JSON.stringify(uploadedUrls, null, 2));
    }
    
  } catch (error) {
    console.error('\n❌ Error fatal:', (error as Error).message);
    process.exit(1);
  }
}

main().catch(console.error);
