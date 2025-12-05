# ChimpNews Narrative Engine v2.0 - Mejoras Implementadas

Este documento detalla todas las mejoras implementadas para lograr videos de calidad de estudio profesional.

---

## 📋 Resumen de Cambios

### ✅ 1. Scene Builder Service Mejorado (`services/sceneBuilderService.ts`)

**Antes:** El servicio existía pero generaba prompts básicos y no se usaba en el pipeline.

**Después:** 
- Genera prompts visuales optimizados para InfiniteTalk
- Valida y corrige automáticamente los shot types según el spec:
  - **Hook** (escena 1) → `closeup`
  - **Conflict** → `closeup`  
  - **Payoff** (última escena) → `wide`
  - **Resto** → `medium`
- Detecta el tipo de escena basándose en la estructura narrativa
- Añade información de iluminación según el mood de cada escena
- Genera hints de expresión facial para cada personaje
- Soporta las 4 estructuras narrativas: `classic`, `double_conflict`, `hot_take`, `perspective_clash`

```typescript
// Ejemplo de uso
import { generateScenePrompts } from './services/sceneBuilderService';

const scenePrompts = generateScenePrompts(scriptWithScenes, config);
// Cada prompt incluye: visualPrompt, lightingMood, expressionHint, shot corregido
```

---

### ✅ 2. Mapeo de Voces Simplificado (`services/openaiService.ts`)

**Antes:** Mapeo complejo con muchas voces legacy que confundía.

**Después:**
- `echo` y `shimmer` se usan directamente (como dice el spec)
- Las voces legacy siguen funcionando por compatibilidad
- hostA → `echo` (male, warm)
- hostB → `shimmer` (female, expressive)

```typescript
// El spec dice:
// hostA (Rusty) → voice: "echo"
// hostB (Dani) → voice: "shimmer"

// Ahora funciona directamente sin mapeo
config.characters.hostA.voiceName = "echo";  // ✅ Funciona directo
config.characters.hostB.voiceName = "shimmer"; // ✅ Funciona directo
```

---

### ✅ 3. Integración de Scene Builder en InfiniteTalk (`services/geminiService.ts`)

**Antes:** Los prompts de video se generaban inline sin usar Scene Builder.

**Después:**
- `generateVideoSegmentsWithInfiniteTalk` ahora usa Scene Builder
- Los prompts visuales optimizados se pasan a cada generación de video
- Pre-validación de audio URLs antes de iniciar generación
- Mejor logging con detalles de correcciones de shots
- Soporte completo para metadatos de escena v2.0

```typescript
// El flujo ahora es:
// 1. Script LLM genera scenes con video_mode, model, shot
// 2. Scene Builder valida/corrige shots y genera visualPrompts
// 3. InfiniteTalk usa los prompts optimizados para cada segmento
```

---

### ✅ 4. Servicio de Composición de Video con Shotstack (`services/shotstackService.ts`) 🆕

Nuevo servicio para composición profesional de video **en la nube** - funciona con Vercel!

**¿Por qué Shotstack y no FFmpeg directo?**
- ⚠️ Vercel es serverless → no puede ejecutar FFmpeg
- ✅ Shotstack es un API de video en la nube ("FFmpeg as a Service")
- ✅ Funciona perfectamente con Vercel
- 💰 Costo: ~$0.05 por minuto de video renderizado

**Características:**
- Renderizado en la nube (1080p, HD, 4K)
- Transiciones: `fade`, `wipeLeft`, `slideLeft`, `slideRight`, `zoom` (+ variantes Slow/Fast)
- Intro/Outro automático
- Watermark opcional
- Genera poster/thumbnail del video
- Webhooks para notificación cuando termina

```typescript
import { composeVideoWithShotstack } from './services/geminiService';

// Después de generar todos los videos con InfiniteTalk:
const result = await composeVideoWithShotstack(
  segments,
  videoUrls,
  videos,
  config,
  {
    resolution: '1080',
    transition: 'fade',
    transitionDuration: 0.3
  }
);

if (result.success) {
  console.log('Video URL:', result.videoUrl);
  console.log('Poster URL:', result.posterUrl);
}
```

**Alternativa: `videoCompositor.ts`** (si tienes tu propio servidor con FFmpeg)

---

### ✅ 5. Utilidades de Audio Mejoradas (`services/audioUtils.ts`)

**Antes:** Solo decode básico.

**Después:**
- **Normalización de loudness** a -16 LUFS (estándar para podcast/streaming)
- **True peak limiting** a -1.5 dBTP
- **Compresión dinámica** opcional
- **Noise gate** para reducir ruido de fondo
- **High-pass filter** para eliminar rumble (80Hz default)
- **Análisis de audio**: RMS, Peak, LUFS aproximado
- **Export a WAV** base64

```typescript
import { processAudioSegment, normalizeAudio } from './services/audioUtils';

// Procesar un segmento completo
const result = await processAudioSegment(audioBase64, {
  normalize: true,
  targetLUFS: -16,
  applyHighPass: true,
  applyNoiseGate: false
});
// result.audioBase64 → Audio normalizado
// result.peakDb → Peak en dB
// result.rmsDb → RMS en dB
```

---

### ✅ 6. Migración SQL (`supabase_narrative_engine_defaults_migration.sql`)

Nueva migración que añade:

**Campos en `productions`:**
- `narrative_used` - Tipo de narrativa usada
- `scenes` - JSONB con estructura completa de escenas
- `audio_normalized` - Flag de normalización
- `video_composition_url` - URL del video final compuesto
- `composition_status` - Estado del proceso de composición

**Campos en `generated_videos`:**
- `scene_metadata` - Metadatos del Scene Builder
- `lighting_mood` - Mood de iluminación
- `shot_type` - Tipo de shot para filtrado

**Campos en `audio_cache`:**
- `normalized` - Flag de normalización
- `peak_db` - Peak en dB
- `rms_db` - RMS en dB

**Índices y Vistas:**
- Índices para queries por narrative_used, composition_status, shot_type
- Vista `narrative_analytics` para estadísticas de uso
- Vista `shot_distribution` para análisis de shots

---

## 🎬 Pipeline de Producción Actualizado

```
1. News Ingestion (SerpAPI)
   ↓
2. Viral Hook (GPT-4o)
   ↓
3. Script Generation (GPT-4o + Narrative Engine v2.0)
   │  - Selección automática de narrativa
   │  - Generación de scenes con metadata
   ↓
4. Scene Builder (NUEVO)
   │  - Validación de shot types
   │  - Generación de prompts visuales
   │  - Hints de expresión y iluminación
   ↓
5. TTS Audio (OpenAI: echo/shimmer)
   │  - Normalización a -16 LUFS (opcional)
   │  - Upload a Supabase Storage
   ↓
6. InfiniteTalk Video Generation
   │  - Usa prompts del Scene Builder
   │  - Metadata de escena para consistencia
   ↓
7. Video Composition (NUEVO - requiere backend)
   │  - FFmpeg merge con transiciones
   │  - Normalización de audio
   │  - Output 1080p H.264
   ↓
8. YouTube Upload
```

---

## 🔧 Configuración Requerida

### Variables de Entorno (nuevas/actualizadas)

```env
# ============================================
# SHOTSTACK - Video Composition (RECOMENDADO)
# ============================================
# Signup: https://shotstack.io (tiene free tier para testing)
# Costo: ~$0.05 por minuto de video renderizado

VITE_SHOTSTACK_API_KEY=your_shotstack_api_key_here
VITE_SHOTSTACK_ENV=stage   # 'stage' para testing, 'v1' para producción

# ============================================
# ALTERNATIVA: Backend FFmpeg propio (opcional)
# ============================================
# Solo si tienes tu propio servidor con FFmpeg
VITE_COMPOSITION_BACKEND_URL=https://your-ffmpeg-backend.com

# ============================================
# VOCES (ya configurado por default)
# ============================================
# En channel config: hostA.voiceName = "echo", hostB.voiceName = "shimmer"
```

### Pasos para configurar Shotstack:

1. **Crear cuenta**: https://shotstack.io/register
2. **Obtener API Key**: Dashboard > API Keys
3. **Copiar la key** en tu archivo `.env.local`:
   ```env
   VITE_SHOTSTACK_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
   VITE_SHOTSTACK_ENV=stage
   ```
4. **Deploy en Vercel**: Las variables se agregan en Project Settings > Environment Variables

### Ejecutar Migración SQL

```bash
# En Supabase SQL Editor o CLI
psql -f supabase_narrative_engine_defaults_migration.sql
```

---

## 📊 Mejoras de Calidad

| Aspecto | Antes | Después |
|---------|-------|---------|
| Shot Types | Manual, sin validación | Auto-corregido según spec |
| Voces | Mapeo confuso | echo/shimmer directos |
| Prompts Visuales | Inline básicos | Scene Builder optimizados |
| Audio | Sin normalización | -16 LUFS, peak limited |
| Video Composition | Solo browser playback | FFmpeg backend ready |
| Iluminación | Estática | Dinámica por tipo de escena |
| Expresiones | No especificadas | Hints según mood |

---

## 🚀 Próximos Pasos Recomendados

1. **Implementar Backend FFmpeg**
   - Crear endpoint `/api/compose` en backend Python/Node.js
   - Usar los comandos generados por `videoCompositor.ts`

2. **Habilitar Normalización de Audio**
   - Descomentar llamadas a `processAudioSegment` en el flujo

3. **Configurar Seed Images Personalizadas**
   - En Admin Dashboard > Production Settings > Narrative Engine Settings
   - Personalizar prompts de seed images para cada canal

4. **Monitorear Analytics**
   - Usar vistas SQL `narrative_analytics` y `shot_distribution`
   - Ajustar preferencias de narrativa según performance

---

## 📝 Archivos Modificados

- `services/sceneBuilderService.ts` - Reescrito completamente
- `services/openaiService.ts` - Simplificado mapeo de voces
- `services/geminiService.ts` - Integración de Scene Builder
- `services/audioUtils.ts` - Añadida normalización y análisis
- `services/videoCompositor.ts` - **Nuevo archivo**
- `supabase_narrative_engine_defaults_migration.sql` - Migración SQL
