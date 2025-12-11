# 🎵 Instrucciones para Generar y Subir Audio a Supabase Storage

## 🚀 Opción 1: Ejecutar en Vercel (Recomendado - Usa Variables de Entorno)

He creado un endpoint API en Vercel que genera música y efectos de sonido usando **ElevenLabs API** y los sube automáticamente a Supabase Storage.

### Requisitos Previos

1. **Configurar variables de entorno en Vercel:**
   - `ELEVENLABS_API_KEY` - Tu API key de ElevenLabs (requerido)
   - `VITE_SUPABASE_URL` - URL de tu proyecto Supabase
   - `VITE_SUPABASE_ANON_KEY` - Anon key de Supabase

2. **Crear bucket en Supabase:**
   - Ve a Supabase Dashboard > Storage
   - Crea un bucket llamado `channel-assets`
   - Configúralo como público o ajusta las políticas RLS

### Pasos:

1. **Haz commit y push de los cambios:**
   ```bash
   git commit -m "feat: Generación de audio con ElevenLabs Music y Sound Effects API"
   git push origin main
   ```

2. **Espera a que Vercel despliegue** (1-2 minutos)

3. **Ejecuta el endpoint usando PowerShell:**

   ```powershell
   # Reemplaza con tu URL de Vercel (puedes encontrarla en Vercel Dashboard)
   $vercelUrl = "https://youtubenews-ashen.vercel.app"
   
   Invoke-RestMethod -Uri "$vercelUrl/api/upload-audio" `
     -Method POST `
     -ContentType "application/json" `
     -Body '{"music": true, "soundEffects": true}'
   ```

   **O usa el script de PowerShell incluido:**
   ```powershell
   # Configura tu URL de Vercel
   $env:VERCEL_URL = "https://youtubenews-ashen.vercel.app"
   
   # Ejecuta el script
   .\scripts\run-upload-audio.ps1
   ```

4. **O desde el navegador** (usa una extensión como Postman o curl):
   ```
   POST https://tu-proyecto.vercel.app/api/upload-audio
   Content-Type: application/json
   
   {
     "music": true,
     "soundEffects": true
   }
   ```

## 📋 Archivos que se Generarán

### Música de Fondo (6 archivos generados con ElevenLabs Music API):
- `podcast.mp3` - Música suave y profesional para podcast
- `energetic.mp3` - Música enérgica y moderna
- `calm.mp3` - Música tranquila y relajante
- `dramatic.mp3` - Música dramática y cinematográfica
- `news.mp3` - Música profesional estilo noticiero
- `corporate.mp3` - Música corporativa y profesional

**Duración:** Cada archivo de música tiene ~2 minutos (120 segundos)

### Efectos de Sonido (10 archivos generados con ElevenLabs Sound Effects API):
- `transition-whoosh.mp3` - Efecto whoosh para transiciones (1.5s)
- `transition-swoosh.mp3` - Efecto swoosh para transiciones (1.2s)
- `transition-swish.mp3` - Efecto swish para transiciones (1.0s)
- `emphasis-drum-roll.mp3` - Redoble de tambor para énfasis (2.0s)
- `emphasis-pop.mp3` - Pop para énfasis (0.5s)
- `emphasis-hit.mp3` - Hit para énfasis (0.8s)
- `notification-news-alert.mp3` - Alerta de noticias (1.5s)
- `notification-ding.mp3` - Notificación ding (0.6s)
- `notification-bell.mp3` - Notificación campana (0.8s)
- `ambient-newsroom.mp3` - Ambiente de sala de noticias (30s, loop)

## ✅ Verificar que Funcionó

1. Ve a **Supabase Dashboard > Storage > channel-assets**
2. Deberías ver las carpetas:
   - `music/` con 6 archivos MP3
   - `sound-effects/` con 10 archivos MP3

3. O verifica directamente visitando:
   ```
   https://tu-proyecto.supabase.co/storage/v1/object/public/channel-assets/music/podcast.mp3
   ```

## 🔧 Solución de Problemas

### Error: "ELEVENLABS_API_KEY not configured"
- Ve a Vercel Dashboard > Settings > Environment Variables
- Agrega `ELEVENLABS_API_KEY` con tu API key de ElevenLabs
- Asegúrate de que el plan de ElevenLabs incluya acceso a Music y Sound Effects API

### Error: "Bucket not found"
- Ve a Supabase Dashboard > Storage
- Crea un bucket llamado `channel-assets`
- Configúralo como público o ajusta las políticas RLS

### Error: "Supabase credentials not configured"
- Verifica que las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` estén configuradas en Vercel
- Ve a Vercel Dashboard > Settings > Environment Variables

### Error: "ElevenLabs Music API error" o "ElevenLabs Sound Effects API error"
- Verifica que tu plan de ElevenLabs incluya acceso a Music y Sound Effects API
- Algunos planes pueden tener límites de uso o requerir suscripción adicional
- Revisa tu saldo/créditos en ElevenLabs Dashboard

### Algunos archivos fallan al generar
- El script continuará con los archivos que sí se generaron
- Puedes ejecutar el endpoint nuevamente para reintentar los fallidos
- Verifica los logs en Vercel Dashboard > Functions para más detalles

## 📝 Notas

- **Generación con IA:** Los archivos se generan usando ElevenLabs Music y Sound Effects API
- **Deduplicación:** Si un archivo ya existe en Supabase, se omite (no se sobrescribe)
- **Tiempo de procesamiento:** El proceso puede tardar 5-15 minutos dependiendo de:
  - La velocidad de generación de ElevenLabs
  - El número de archivos a generar
  - La duración de cada archivo (música de 2 minutos toma más tiempo)
- **Costos:** La generación de audio con ElevenLabs consume créditos de tu plan. Revisa los precios en [ElevenLabs Pricing](https://elevenlabs.io/pricing)
- **Calidad:** Los archivos se generan en alta calidad (MP3 44100Hz 128kbps)

## 🎨 Personalización

Puedes modificar los prompts y configuraciones en `api/upload-audio.ts`:

- **Música:** Ajusta los prompts en `MUSIC_CONFIG` para cambiar el estilo
- **Efectos:** Modifica los prompts en `SOUND_EFFECTS_CONFIG` para cambiar los efectos
- **Duración:** Ajusta `duration_ms` para música y `duration_seconds` para efectos
