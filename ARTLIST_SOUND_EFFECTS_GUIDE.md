# 🎵 Guía: Efectos de Sonido desde Artlist.io

## 📋 Efectos que Necesitas Descargar

### 🎬 Transiciones (Transitions)
Busca en Artlist → Sound Effects → **Transitions**:

1. **`transition-whoosh.mp3`**
   - Busca: "Short Whoosh" o "Whoosh"
   - Duración: ~1-2 segundos
   - Debe ser corto y rápido

2. **`transition-swoosh.mp3`**
   - Busca: "Swoosh" o "Air Swish"
   - Duración: ~1-2 segundos
   - Más suave que el whoosh

3. **`transition-swish.mp3`**
   - Busca: "Swish" o "Quick Movement"
   - Duración: ~0.5-1.5 segundos
   - Rápido y sutil

### 💥 Énfasis (Cinematic Impacts)
Busca en Artlist → Sound Effects → **Transitions** → "Cinematic Impacts":

4. **`emphasis-drum-roll.mp3`**
   - Busca: "Drum Roll" o "Build Up"
   - Duración: ~2-3 segundos
   - Debe generar anticipación

5. **`emphasis-pop.mp3`**
   - Busca: "Pop" o "Quick Burst"
   - Duración: ~0.3-0.6 segundos
   - Corto y agudo

6. **`emphasis-hit.mp3`**
   - Busca: "Hit" o "Impact" o "Punch"
   - Duración: ~0.5-1 segundo
   - Sonido de impacto fuerte

### 🔔 Notificaciones
Busca en Artlist → Sound Effects → **Realistic** → "Business & Office" o usa la búsqueda:

7. **`notification-news-alert.mp3`**
   - Busca: "News Alert" o "Alert Sound" o "Broadcast Alert"
   - Duración: ~1-2 segundos
   - Debe sonar profesional y noticiero

8. **`notification-ding.mp3`**
   - Busca: "Ding" o "Notification" o "Alert Ding"
   - Duración: ~0.5-0.8 segundos
   - Simple y limpio

9. **`notification-bell.mp3`**
   - Busca: "Bell" o "Bell Ring"
   - Duración: ~0.5-1 segundo
   - Timbre claro

## 📥 Cómo Descargar

1. Ve a https://artlist.io/sfx
2. Inicia sesión con tu cuenta (debe incluir sound effects en tu plan)
3. Usa la barra de búsqueda o navega por categorías
4. Para cada efecto:
   - Haz clic en el efecto
   - Click en el ícono de descarga
   - Elige formato **WAV** (mejor calidad) o **AAC/MP3**
   - Descarga el archivo

## 📂 Cómo Subir los Archivos

### Opción 1: Desde Supabase Dashboard (Recomendado)

1. Ve a tu **Supabase Dashboard**
2. Navega a **Storage** → **channel-assets**
3. Si no existe, crea la carpeta **`sound-effects`**
4. Sube cada archivo con estos nombres exactos:
   - `transition-whoosh.mp3`
   - `transition-swoosh.mp3`
   - `transition-swish.mp3`
   - `emphasis-drum-roll.mp3`
   - `emphasis-pop.mp3`
   - `emphasis-hit.mp3`
   - `notification-news-alert.mp3`
   - `notification-ding.mp3`
   - `notification-bell.mp3`

### Opción 2: Desde la UI de la Aplicación

Una vez que tengas los archivos descargados localmente:

1. Si quieres usar el script, reemplaza las URLs en `components/AudioManager.tsx`
2. O crea un archivo temporal con las URLs de Artlist (si las proporcionan) y actualiza el código

### Opción 3: Convertir a URLs y Usar el Endpoint Simple

Si Artlist te da URLs públicas (poco común), puedes actualizar `components/AudioManager.tsx`:

```typescript
const freeAudioFiles = [
  // ... música ...
  // Efectos de sonido desde Artlist
  { name: 'transition-whoosh.mp3', url: 'URL_DE_ARTLIST', type: 'sound-effect' },
  // ... más efectos ...
];
```

## ✅ Checklist

- [ ] Descargar `transition-whoosh.mp3`
- [ ] Descargar `transition-swoosh.mp3`
- [ ] Descargar `transition-swish.mp3`
- [ ] Descargar `emphasis-drum-roll.mp3`
- [ ] Descargar `emphasis-pop.mp3`
- [ ] Descargar `emphasis-hit.mp3`
- [ ] Descargar `notification-news-alert.mp3`
- [ ] Descargar `notification-ding.mp3`
- [ ] Descargar `notification-bell.mp3`
- [ ] Subir todos a Supabase Storage → channel-assets → sound-effects/

## 💡 Tips

- Los nombres deben ser **exactamente** como se muestran arriba (con guiones)
- Formato recomendado: **MP3** para menor tamaño, o **WAV** para mejor calidad
- Los efectos de transición deben ser cortos (1-2 segundos máximo)
- El ambiente puede ser más largo y se hará loop automáticamente
