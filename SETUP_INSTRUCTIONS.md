# Setup Instructions - Fixing Common Errors

Este documento contiene instrucciones para resolver los errores más comunes que pueden ocurrir durante la generación de producciones.

## 1. Error: "Bucket not found" (channel-assets)

### Problema
Los archivos de audio y video no se pueden subir porque el bucket de Supabase Storage no existe.

### Solución

**Opción 1: Via Supabase Dashboard (Recomendado)**

1. Ve a tu proyecto en [Supabase Dashboard](https://app.supabase.com)
2. Navega a **Storage** en el menú lateral
3. Haz clic en **"New bucket"**
4. Configuración:
   - **Name**: `channel-assets`
   - **Public bucket**: ✅ Activado (o configura políticas RLS según necesites)
5. Haz clic en **"Create bucket"**

**Opción 2: Via Supabase CLI**

```bash
supabase storage create channel-assets --public
```

**Opción 3: Via API**

```bash
curl -X POST 'https://<tu-project-ref>.supabase.co/storage/v1/bucket' \
  -H "Authorization: Bearer <tu-service-role-key>" \
  -H "apikey: <tu-service-role-key>" \
  -H "Content-Type: application/json" \
  -d '{"name": "channel-assets", "public": true}'
```

### Verificación

Después de crear el bucket, verifica que existe:

1. En el Dashboard de Supabase, ve a Storage
2. Deberías ver el bucket `channel-assets` en la lista
3. O ejecuta en la consola del navegador: `supabase.storage.listBuckets()`

## 2. Error: CORS con Wavespeed API

### Problema
Las llamadas a la API de Wavespeed desde el navegador fallan con errores de CORS.

### Solución

**Opción 1: Usar Backend Proxy (Recomendado para Producción)**

1. Configura un backend que actúe como proxy para las llamadas a Wavespeed
2. El backend debe tener la variable de entorno `WAVESPEED_API_KEY`
3. Crea endpoints en tu backend que proxy las requests a Wavespeed
4. Configura `VITE_BACKEND_URL` en tu frontend para apuntar a tu backend

Ejemplo de endpoint en backend (FastAPI):

```python
from fastapi import FastAPI, HTTPException
import httpx
import os

app = FastAPI()
WAVESPEED_API_KEY = os.getenv("WAVESPEED_API_KEY")

@app.post("/api/wavespeed/v1/tasks")
async def create_wavespeed_task(request: dict):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.wavespeed.ai/v1/tasks",
            json=request,
            headers={"Authorization": f"Bearer {WAVESPEED_API_KEY}"}
        )
        return response.json()
```

**Opción 2: Deshabilitar Wavespeed Temporalmente**

Si no necesitas Wavespeed inmediatamente, puedes comentar las llamadas a Wavespeed en el código hasta que configures el proxy.

### Verificación

Verifica la configuración ejecutando en la consola:

```javascript
import { checkWavespeedConfig } from './services/wavespeedProxy';
console.log(checkWavespeedConfig());
```

## 3. Error: Columnas intro_video_url/outro_video_url no existen

### Problema
El código intenta leer columnas que no existen en la tabla `channels`.

### Solución

✅ **Ya corregido automáticamente**

El código ahora usa el campo `config` JSONB de la tabla `channels` para almacenar los URLs de intro/outro. No se requieren cambios en la base de datos.

Los URLs se guardan en:
- `config.intro_video_url`
- `config.outro_video_url`

## 4. Error: Modelo de imagen no encontrado (imagen-3.0-generate-001)

### Problema
El modelo de imagen especificado no existe en la API de Gemini.

### Solución

✅ **Ya corregido automáticamente**

El modelo se cambió a `gemini-2.5-flash-image` que es el modelo correcto para generación de imágenes con Gemini API.

## Checklist de Configuración

Antes de generar una producción, verifica:

- [ ] Bucket `channel-assets` creado en Supabase Storage
- [ ] Variables de entorno configuradas:
  - [ ] `VITE_SUPABASE_URL`
  - [ ] `VITE_SUPABASE_ANON_KEY`
  - [ ] `VITE_GEMINI_API_KEY`
  - [ ] `VITE_WAVESPEED_API_KEY` (opcional, solo si usas Wavespeed)
  - [ ] `VITE_BACKEND_URL` (opcional, solo si usas proxy para Wavespeed)
- [ ] Tablas de base de datos creadas (ejecutar scripts SQL en Supabase)
- [ ] Políticas RLS configuradas correctamente

## Scripts SQL a Ejecutar

Ejecuta estos scripts en orden en el SQL Editor de Supabase:

1. `supabase_setup.sql` - Configuración inicial
2. `supabase_news_schema.sql` - Esquema de noticias
3. `supabase_multichannel_schema.sql` - Soporte multi-canal
4. `supabase_productions_schema.sql` - Esquema de producciones
5. `supabase_productions_versioning_migration.sql` - Versionado (opcional)

## Verificación Post-Setup

Después de completar el setup, verifica que todo funciona:

1. **Storage Bucket**: 
   ```javascript
   // En la consola del navegador
   const { verifyStorageBucket } = await import('./services/supabaseService');
   await verifyStorageBucket();
   ```

2. **Wavespeed Config**:
   ```javascript
   // En la consola del navegador
   const { checkWavespeedConfig } = await import('./services/wavespeedProxy');
   console.log(checkWavespeedConfig());
   ```

3. **Conexión a Supabase**:
   ```javascript
   // En la consola del navegador
   const { supabase } = await import('./services/supabaseService');
   const { data, error } = await supabase.from('channels').select('count');
   console.log('Supabase connection:', error ? '❌ Error' : '✅ OK');
   ```

## Soporte

Si encuentras otros errores:

1. Revisa la consola del navegador para mensajes de error detallados
2. Verifica los logs en Supabase Dashboard > Logs
3. Asegúrate de que todas las variables de entorno estén configuradas correctamente
4. Revisa que los scripts SQL se hayan ejecutado correctamente
