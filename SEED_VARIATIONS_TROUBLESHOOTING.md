# Troubleshooting: Variaciones de Imágenes Semilla

## Problemas Identificados

### 1. Error 404 en WaveSpeed Backend
**Síntoma:** `Failed to load resource: the server responded with a status of 404 ()`

**Causa:** El endpoint `/api/wavespeed/api/v3/google/nano-banana-pro/edit` no está disponible porque:
- El backend no está corriendo
- `VITE_BACKEND_URL` no está configurado correctamente
- El endpoint no existe en el backend

**Solución Implementada:**
- ✅ Fallback automático a DALL-E cuando WaveSpeed falla
- ✅ Mejores mensajes de error que indican el problema
- ✅ El sistema ahora usa DALL-E directamente si el backend no está disponible

### 2. Error 400 al Guardar en Supabase
**Síntoma:** `Failed to load resource: the server responded with a status of 400 ()`

**Causa:** El campo `seed_image_variations` se está intentando guardar directamente en la tabla `channels`, pero debe guardarse dentro del JSONB `config`.

**Solución Implementada:**
- ✅ Ahora se guarda correctamente dentro de `config.seed_image_variations`
- ✅ Se obtiene el config actual, se actualiza, y se guarda de vuelta
- ✅ Manejo de errores mejorado con mensajes descriptivos

### 3. Variaciones No Visibles en UI
**Síntoma:** El usuario ve "14 variaciones generadas" pero no ve cambios

**Causa:** Las variaciones se están generando pero todas fallan y usan la imagen original como fallback.

**Solución Implementada:**
- ✅ Indicadores visuales (✅/⚠️) que muestran qué variaciones son nuevas vs. fallback
- ✅ Mensajes de advertencia cuando el backend no está disponible
- ✅ Contador de variaciones exitosas vs. fallbacks

## Cómo Funciona Ahora

### Flujo de Generación:

1. **Intenta WaveSpeed** (si `VITE_BACKEND_URL` está configurado)
   - Si falla → continúa con DALL-E

2. **Usa DALL-E como Fallback**
   - Genera la imagen con el prompt mejorado
   - Sube a Supabase Storage
   - Retorna la URL pública

3. **Si Todo Falla**
   - Usa la imagen original como fallback
   - Muestra advertencia en la UI

### Guardado en Supabase:

```typescript
// Antes (❌ Error 400):
await supabase.from('channels').update({
  seed_image_variations: variations  // Campo no existe
})

// Ahora (✅ Correcto):
const { data: channel } = await supabase
  .from('channels')
  .select('config')
  .eq('id', channelId)
  .single();

const updatedConfig = {
  ...channel.config,
  seed_image_variations: variations  // Dentro de config JSONB
};

await supabase.from('channels').update({
  config: updatedConfig
});
```

## Configuración Requerida

### Para Usar WaveSpeed (Opcional):
```env
VITE_BACKEND_URL=https://tu-backend.railway.app
```

### Para Usar Solo DALL-E (Recomendado si no tienes backend):
- No necesitas configurar nada
- El sistema usará DALL-E automáticamente
- Costo: $0.04 por variación (más barato que WaveSpeed)

## Mejoras en la UI

### Indicadores Visuales:
- ✅ **Verde**: Variación nueva generada exitosamente
- ⚠️ **Amarillo**: Usando imagen original (fallback)

### Mensajes Informativos:
- Muestra cuántas variaciones son nuevas vs. fallbacks
- Advertencia clara cuando el backend no está disponible
- Instrucciones sobre cómo configurar `VITE_BACKEND_URL`

## Próximos Pasos

1. **Configurar Backend (Opcional):**
   - Desplegar backend en Railway/Heroku
   - Configurar `VITE_BACKEND_URL` en Vercel

2. **O Usar Solo DALL-E:**
   - El sistema funciona perfectamente sin backend
   - Solo usa DALL-E directamente
   - Más económico ($0.04 vs $0.14 por variación)

3. **Verificar Variaciones:**
   - Revisar la lista de "Variaciones Disponibles"
   - Las marcadas con ✅ son nuevas
   - Las marcadas con ⚠️ son fallbacks

## Notas Técnicas

- Las variaciones se guardan en `config.seed_image_variations` (JSONB)
- Se usan automáticamente en `sceneBuilderService.ts`
- El sistema selecciona la variación según el ángulo de cámara de la escena
- Si no hay variaciones, usa las imágenes semilla originales
