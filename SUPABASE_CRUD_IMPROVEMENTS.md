# Mejoras CRUD de Supabase - Gestión Completa de Assets

## Problema Identificado
Cuando se regeneraba un script, escena, audio o video, el sistema no estaba usando la nueva versión, sino que seguía usando la anterior. Esto causaba inconsistencias y problemas de persistencia.

## Soluciones Implementadas

### 1. Sistema de Gestión de Assets (`productionAssetManager.ts`)

**Nuevo servicio completo para:**
- Limpieza de assets antiguos al regenerar
- Actualización de tablas de cache (audio_cache, generated_videos)
- Gestión de relaciones entre tablas
- Limpieza de assets huérfanos

**Funciones principales:**
- `cleanupSegmentAssets()` - Limpia audio/video de un segmento específico
- `cleanupProductionAssetsOnRegenerate()` - Limpia todos los assets cuando se regenera el script completo
- `updateAudioCacheOnRegenerate()` - Actualiza audio_cache con nueva versión
- `updateVideoCacheOnRegenerate()` - Actualiza generated_videos con nueva versión
- `cleanupOrphanedAssets()` - Limpia assets huérfanos (no referenciados)

### 2. Recarga de Producción desde DB

**CRÍTICO:** Después de cada regeneración, se recarga la producción desde la DB para asegurar que se usa la versión más reciente:

```typescript
// Ejemplo en handleRegenerateAudio
const freshProduction = await getProductionById(production.id);
if (freshProduction) {
  setLocalProduction(freshProduction);
  onUpdateProduction(freshProduction);
}
```

**Implementado en:**
- `handleRegenerateAudio()` - Recarga antes y después de regenerar
- `handleRegenerateVideo()` - Recarga antes y después de regenerar
- `handleRegenerateScene()` - Recarga después de regenerar
- `handleGenerateScript()` - Recarga después de generar nuevo script
- `handleGenerateAudios()` - Recarga después de cada audio generado
- `handleGenerateVideos()` - Recarga después de cada video generado

### 3. Actualización Consistente de Segmentos

**Problema:** Los URLs se guardaban en `segment_status` pero no siempre en el array `segments`.

**Solución:** Ahora se actualizan AMBOS lugares:

```typescript
// Actualizar segment_status
await updateSegmentStatus(production.id, i, {
  audio: 'done',
  audioUrl: result.audioUrl
});

// CRITICAL: También actualizar segments array
const updatedSegments = [...liveSegments];
updatedSegments[i] = {
  ...updatedSegments[i],
  audioUrl: result.audioUrl
};

await saveProduction({
  ...productionRef.current,
  segments: updatedSegments,
  segment_status: { ...liveStatus } as any
});
```

### 4. Limpieza de URLs Antiguos

**Al regenerar, se limpian los URLs antiguos de:**
- `segment_status[index].audioUrl` → `undefined`
- `segment_status[index].videoUrl` → `undefined`
- `segments[index].audioUrl` → `undefined`
- `segments[index].videoUrl` → `undefined`

**Esto asegura que:**
- No se use la versión anterior por error
- El sistema detecte que necesita regenerar
- Los nuevos URLs se guarden correctamente

### 5. Sincronización Continua Mejorada

**El sistema ahora sincroniza:**
- `segment_status` (estado de audio/video)
- `segments` (array con URLs)
- `scenes` (escenas del script)
- `video_assets` (assets de video)
- `final_video_url` (video final)

**Cada 3 segundos:**
- Compara hash de todos los campos críticos
- Si hay diferencias, recarga desde DB
- Actualiza estado local y parent component

### 6. Guardado en DB Primero

**Orden correcto:**
1. Guardar en DB primero (`saveProduction()`)
2. Luego recargar desde DB (`getProductionById()`)
3. Finalmente actualizar estado local

**Esto asegura:**
- La DB siempre tiene la versión más reciente
- El estado local se sincroniza con la DB
- No hay desincronización entre DB y UI

### 7. Limpieza al Regenerar Script Completo

**Cuando se regenera el script completo:**
- Se limpian TODOS los segmentos antiguos
- Se resetea `segment_status` a 'pending'
- Se limpian `video_assets` y `final_video_url`
- Se guarda en DB
- Se recarga para tener estado limpio

### 8. Actualización de Tablas de Cache

**audio_cache:**
- Cuando se regenera audio, se crea nueva entrada si el texto cambió
- La entrada antigua se mantiene (puede ser reutilizada por otras producciones)
- Se actualiza `use_count` y `last_used_at`

**generated_videos:**
- Cuando se regenera video, se marca el antiguo como 'failed' con mensaje "Regenerated"
- Se crea nueva entrada con el nuevo video
- Los videos marcados como regenerados se pueden limpiar después

## Flujo Completo de Regeneración

### Regenerar Audio:
1. Recargar producción desde DB (obtener estado actual)
2. Limpiar audio antiguo de storage
3. Limpiar `audioUrl` de `segment_status` y `segments`
4. Guardar en DB
5. Generar nuevo audio
6. Guardar nuevo `audioUrl` en DB
7. Actualizar `audio_cache` si texto cambió
8. Recargar producción desde DB (usar nueva versión)

### Regenerar Video:
1. Recargar producción desde DB
2. Limpiar video antiguo (marcar como obsolete en generated_videos)
3. Limpiar `videoUrl` de `segment_status` y `segments`
4. Guardar en DB
5. Generar nuevo video
6. Guardar nuevo `videoUrl` en DB
7. Actualizar `generated_videos` table
8. Recargar producción desde DB (usar nueva versión)

### Regenerar Script Completo:
1. Limpiar TODOS los assets antiguos
2. Resetear `segment_status` a 'pending'
3. Limpiar `segments`, `video_assets`, `final_video_url`
4. Guardar en DB
5. Generar nuevo script
6. Guardar nuevo script en DB
7. Recargar producción desde DB (usar nueva versión)

## Verificación de Uso de Nueva Versión

**El sistema ahora verifica:**
- ✅ URLs se guardan en DB inmediatamente
- ✅ Producción se recarga desde DB después de cada operación
- ✅ Estado local se actualiza con datos de DB (no de props)
- ✅ Sincronización continua detecta cambios y recarga
- ✅ URLs antiguos se limpian antes de generar nuevos
- ✅ Tablas de cache se actualizan correctamente

## Tablas de Supabase Utilizadas

1. **productions** - Estado completo de producción
   - `segments` - Array de segmentos con URLs
   - `segment_status` - Estado granular de cada segmento
   - `scenes` - Escenas del script
   - `video_assets` - Assets de video
   - `wizard_state` - Estado del wizard

2. **audio_cache** - Cache de audios generados
   - `audio_url` - URL del audio
   - `text_hash` - Hash del texto
   - `use_count` - Veces reutilizado

3. **generated_videos** - Cache de videos generados
   - `video_url` - URL del video
   - `dialogue_text` - Texto del diálogo
   - `status` - Estado (completed, failed, etc.)

4. **content_cache** - Cache general de contenido
   - Usado para scripts, metadata, etc.

## Mejoras de Rendimiento

- **Batch updates:** Se actualizan múltiples segmentos en paralelo
- **Sincronización inteligente:** Solo recarga si hay cambios reales
- **Cache warming:** Pre-carga datos comunes
- **Fuzzy matching:** Reutiliza assets similares

## Próximos Pasos Recomendados

1. ✅ Implementado: Limpieza de assets al regenerar
2. ✅ Implementado: Recarga desde DB después de operaciones
3. ✅ Implementado: Actualización consistente de segmentos
4. ✅ Implementado: Sincronización continua mejorada
5. ⚠️ Pendiente: Tests automatizados de flujos de regeneración
6. ⚠️ Pendiente: Monitoreo de assets huérfanos
7. ⚠️ Pendiente: Dashboard de gestión de assets
