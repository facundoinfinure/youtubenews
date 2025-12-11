# 🎵 Instrucciones para Subir Audio a Supabase Storage

## 🚀 Opción 1: Ejecutar en Vercel (Recomendado - Usa Variables de Entorno)

He creado un endpoint API en Vercel que ejecuta el script automáticamente usando las variables de entorno ya configuradas.

### Pasos:

1. **Haz commit y push de los cambios:**
   ```bash
   git commit -m "feat: Endpoint API para subir audio a Supabase"
   git push origin main
   ```

2. **Espera a que Vercel despliegue** (1-2 minutos)

3. **Ejecuta el endpoint usando PowerShell:**

   ```powershell
   # Reemplaza con tu URL de Vercel (puedes encontrarla en Vercel Dashboard)
   $vercelUrl = "https://tu-proyecto.vercel.app"
   
   Invoke-RestMethod -Uri "$vercelUrl/api/upload-audio" `
     -Method POST `
     -ContentType "application/json" `
     -Body '{"music": true, "soundEffects": true}'
   ```

   **O usa el script de PowerShell incluido:**
   ```powershell
   # Configura tu URL de Vercel
   $env:VERCEL_URL = "https://tu-proyecto.vercel.app"
   
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

## 🖥️ Opción 2: Ejecutar Localmente

Si prefieres ejecutar el script localmente:

1. **Crea un archivo `.env` en la raíz del proyecto:**
   ```env
   VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
   VITE_SUPABASE_ANON_KEY=tu_anon_key_aqui
   ```

2. **Ejecuta el script:**
   ```bash
   npm run download-audio
   ```

   **O en PowerShell:**
   ```powershell
   $env:VITE_SUPABASE_URL = "https://tu-proyecto.supabase.co"
   $env:VITE_SUPABASE_ANON_KEY = "tu_anon_key_aqui"
   npm run download-audio
   ```

## 📋 Archivos que se Subirán

### Música de Fondo (6 archivos):
- `podcast.mp3` - Música suave y profesional
- `energetic.mp3` - Música enérgica
- `calm.mp3` - Música tranquila
- `dramatic.mp3` - Música dramática
- `news.mp3` - Música estilo noticiero
- `corporate.mp3` - Música corporativa

### Efectos de Sonido (10 archivos):
- `transition-whoosh.mp3`, `transition-swoosh.mp3`, `transition-swish.mp3`
- `emphasis-drum-roll.mp3`, `emphasis-pop.mp3`, `emphasis-hit.mp3`
- `notification-news-alert.mp3`, `notification-ding.mp3`, `notification-bell.mp3`
- `ambient-newsroom.mp3`

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

### Error: "Bucket not found"
- Ve a Supabase Dashboard > Storage
- Crea un bucket llamado `channel-assets`
- Configúralo como público o ajusta las políticas RLS

### Error: "Supabase credentials not configured"
- Verifica que las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` estén configuradas en Vercel
- Ve a Vercel Dashboard > Settings > Environment Variables

### Algunos archivos fallan al descargar
- Las URLs de Mixkit pueden haber cambiado
- El script continuará con los archivos que sí se descargaron
- Puedes subir manualmente los faltantes desde Supabase Dashboard

## 📝 Notas

- Los archivos se descargan desde Mixkit (gratuitos, licencia libre)
- Si un archivo ya existe en Supabase, se omite (no se sobrescribe)
- El proceso puede tardar 2-5 minutos dependiendo de la velocidad de descarga
