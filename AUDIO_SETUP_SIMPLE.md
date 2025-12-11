# 🎵 Configuración Simple de Archivos de Audio

## Solución Práctica y Funcional

Esta solución elimina la dependencia de ElevenLabs y usa archivos de audio gratuitos de fuentes públicas como Mixkit y Pixabay.

## ✅ Cómo Funciona

1. **Nuevo Endpoint Simple**: `/api/upload-audio-simple` 
   - Descarga archivos de audio desde URLs públicas
   - Los sube directamente a Supabase Storage
   - Sin dependencias de servicios costosos

2. **AudioManager Actualizado**:
   - Botón "Generar Archivos Iniciales" ahora usa el nuevo endpoint
   - Descarga archivos gratuitos automáticamente
   - Sin necesidad de API keys adicionales

## 📋 Pasos para Configurar

### 1. Configurar Variables de Entorno en Vercel

Agrega estas variables en **Vercel Dashboard → Settings → Environment Variables**:

```
SUPABASE_URL=tu_supabase_url
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
```

**Nota**: Las serverless functions usan variables SIN el prefijo `VITE_`.

### 2. Ejecutar Políticas SQL en Supabase

Ejecuta el archivo `supabase_storage_policies_fix.sql` en el SQL Editor de Supabase para permitir subidas.

### 3. Usar la Función en la UI

1. Ve al Dashboard de Administración
2. Navega a la sección de Gestión de Audio
3. Haz clic en "✨ Generar Archivos Iniciales"
4. El sistema descargará y subirá archivos gratuitos automáticamente

## 🎼 Fuentes de Audio Gratuitas

Los archivos vienen de:
- **Mixkit**: https://mixkit.co/free-stock-music/
- **Pixabay**: https://pixabay.com/music/

### Personalizar URLs de Audio

Puedes editar las URLs en `components/AudioManager.tsx` en la función `handleGenerateInitial`:

```typescript
const freeAudioFiles = [
  { name: 'podcast.mp3', url: 'TU_URL_AQUI', type: 'music' },
  // ... más archivos
];
```

## 🔧 Alternativa: Subir Archivos Manualmente

Si prefieres subir tus propios archivos:

1. Ve a Supabase Dashboard → Storage → channel-assets
2. Crea las carpetas: `music/` y `sound-effects/`
3. Sube tus archivos directamente desde la UI de Supabase

O usa el script local:
```bash
npx tsx scripts/setup-audio-assets.ts
```

## ❌ Archivo Anterior (Deprecado)

El endpoint `/api/upload-audio` que usa ElevenLabs está deprecado porque:
- Requiere plan de pago de ElevenLabs
- Tiene límites de quota
- Es costoso
- Aumenta la complejidad

Usa `/api/upload-audio-simple` en su lugar.
