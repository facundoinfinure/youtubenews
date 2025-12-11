/**
 * Script para descargar y subir música de fondo y efectos de sonido a Supabase Storage
 * 
 * Este script descarga archivos de audio gratuitos de fuentes públicas y los sube a Supabase Storage
 * para su uso en las producciones de video.
 * 
 * Uso: npx tsx scripts/upload-audio-assets.ts
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

// URLs de archivos de audio gratuitos (royalty-free)
// Estos son ejemplos - puedes reemplazarlos con tus propios archivos
const AUDIO_ASSETS = {
  // Música de fondo
  music: {
    podcast: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3', // Ejemplo - reemplazar con música real
    energetic: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    calm: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
    dramatic: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',
    news: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',
    corporate: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',
  },
  
  // Efectos de sonido - Transiciones
  soundEffects: {
    'transition-whoosh': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav', // Ejemplo - reemplazar
    'transition-swoosh': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav',
    'transition-swish': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav',
    
    // Énfasis
    'emphasis-drum-roll': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav',
    'emphasis-pop': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav',
    'emphasis-hit': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav',
    
    // Notificaciones
    'notification-news-alert': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav',
    'notification-ding': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav',
    'notification-bell': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav',
    
    // Ambiente
    'ambient-newsroom': 'https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav',
  }
};

/**
 * Descarga un archivo de una URL
 */
async function downloadFile(url: string, outputPath: string): Promise<void> {
  console.log(`📥 Descargando: ${url}`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Crear directorio si no existe
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, buffer);
    console.log(`✅ Descargado: ${outputPath}`);
  } catch (error) {
    console.error(`❌ Error descargando ${url}:`, (error as Error).message);
    throw error;
  }
}

/**
 * Sube un archivo a Supabase Storage
 */
async function uploadToSupabase(
  filePath: string,
  storagePath: string,
  contentType: string = 'audio/mpeg'
): Promise<string | null> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    
    console.log(`📤 Subiendo: ${fileName} -> ${storagePath}`);
    
    // Verificar si el archivo ya existe
    const { data: existingFiles } = await supabase.storage
      .from('channel-assets')
      .list(path.dirname(storagePath));
    
    if (existingFiles?.some(f => f.name === fileName)) {
      console.log(`⏭️  Archivo ya existe, omitiendo: ${storagePath}`);
      const { data: urlData } = supabase.storage
        .from('channel-assets')
        .getPublicUrl(storagePath);
      return urlData.publicUrl;
    }
    
    // Subir archivo
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
    
    // Obtener URL pública
    const { data: urlData } = supabase.storage
      .from('channel-assets')
      .getPublicUrl(data.path);
    
    console.log(`✅ Subido exitosamente: ${urlData.publicUrl}`);
    return urlData.publicUrl;
  } catch (error) {
    console.error(`❌ Error subiendo ${filePath}:`, (error as Error).message);
    return null;
  }
}

/**
 * Convierte WAV a MP3 (requiere ffmpeg)
 * Por ahora, solo subimos los archivos tal cual
 */
async function convertToMp3IfNeeded(inputPath: string): Promise<string> {
  // Por ahora, retornamos el mismo path
  // En producción, podrías usar ffmpeg para convertir WAV a MP3
  return inputPath;
}

/**
 * Función principal
 */
async function main() {
  console.log('🎵 Iniciando carga de archivos de audio a Supabase Storage...\n');
  
  // Crear directorio temporal
  const tempDir = path.join(__dirname, '../temp-audio');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const uploadedUrls: Record<string, string> = {};
  
  try {
    // Subir música de fondo
    console.log('\n📀 Subiendo música de fondo...\n');
    for (const [style, url] of Object.entries(AUDIO_ASSETS.music)) {
      try {
        const fileName = `${style}.mp3`;
        const tempPath = path.join(tempDir, fileName);
        const storagePath = `music/${fileName}`;
        
        await downloadFile(url, tempPath);
        const convertedPath = await convertToMp3IfNeeded(tempPath);
        const publicUrl = await uploadToSupabase(convertedPath, storagePath);
        
        if (publicUrl) {
          uploadedUrls[`music-${style}`] = publicUrl;
        }
      } catch (error) {
        console.error(`⚠️  Error procesando música ${style}:`, (error as Error).message);
      }
    }
    
    // Subir efectos de sonido
    console.log('\n🔊 Subiendo efectos de sonido...\n');
    for (const [name, url] of Object.entries(AUDIO_ASSETS.soundEffects)) {
      try {
        const fileName = `${name}.mp3`;
        const tempPath = path.join(tempDir, fileName);
        const storagePath = `sound-effects/${fileName}`;
        
        await downloadFile(url, tempPath);
        const convertedPath = await convertToMp3IfNeeded(tempPath);
        const publicUrl = await uploadToSupabase(convertedPath, storagePath);
        
        if (publicUrl) {
          uploadedUrls[`effect-${name}`] = publicUrl;
        }
      } catch (error) {
        console.error(`⚠️  Error procesando efecto ${name}:`, (error as Error).message);
      }
    }
    
    // Limpiar archivos temporales
    console.log('\n🧹 Limpiando archivos temporales...');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    
    // Resumen
    console.log('\n✅ Proceso completado!\n');
    console.log('📋 URLs subidas:');
    console.log(JSON.stringify(uploadedUrls, null, 2));
    
  } catch (error) {
    console.error('\n❌ Error fatal:', (error as Error).message);
    process.exit(1);
  }
}

// Ejecutar
main().catch(console.error);
