# Cómo Ejecutar el Script de Audio en Vercel

## Opción 1: Usar el Endpoint API (Recomendado)

He creado un endpoint API en Vercel que ejecuta el script usando las variables de entorno ya configuradas.

### Pasos:

1. **Despliega el código a Vercel** (si aún no lo has hecho):
   ```bash
   git push origin main
   ```
   Vercel desplegará automáticamente.

2. **Ejecuta el endpoint** usando curl o desde el navegador:

   ```bash
   # Desde tu terminal local
   curl -X POST https://tu-proyecto.vercel.app/api/upload-audio \
     -H "Content-Type: application/json" \
     -d '{"music": true, "soundEffects": true}'
   ```

   O visita en el navegador (aunque POST requiere curl o Postman):
   ```
   https://tu-proyecto.vercel.app/api/upload-audio
   ```

3. **O usa el script de PowerShell** (Windows):

   ```powershell
   # Reemplaza con tu URL de Vercel
   $vercelUrl = "https://tu-proyecto.vercel.app"
   
   Invoke-RestMethod -Uri "$vercelUrl/api/upload-audio" `
     -Method POST `
     -ContentType "application/json" `
     -Body '{"music": true, "soundEffects": true}'
   ```

## Opción 2: Configurar Variables Localmente

Si quieres ejecutar el script localmente, crea un archivo `.env` en la raíz del proyecto:

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key_aqui
```

Luego ejecuta:
```bash
npm run download-audio
```

## Opción 3: Usar Variables de Entorno en PowerShell

También puedes exportar las variables en PowerShell antes de ejecutar:

```powershell
$env:VITE_SUPABASE_URL = "https://tu-proyecto.supabase.co"
$env:VITE_SUPABASE_ANON_KEY = "tu_anon_key_aqui"
npm run download-audio
```

## Verificar que Funcionó

Después de ejecutar, verifica que los archivos están en Supabase Storage:
1. Ve a Supabase Dashboard > Storage > channel-assets
2. Deberías ver las carpetas `music/` y `sound-effects/` con los archivos

O verifica directamente:
```
https://tu-proyecto.supabase.co/storage/v1/object/public/channel-assets/music/podcast.mp3
```
