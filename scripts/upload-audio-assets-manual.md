# Guía para Subir Archivos de Audio a Supabase Storage

## Opción 1: Usar el Dashboard de Supabase (Recomendado)

1. Ve a tu proyecto en [Supabase Dashboard](https://supabase.com/dashboard)
2. Navega a **Storage** en el menú lateral
3. Asegúrate de que el bucket `channel-assets` existe (si no, créalo)
4. Sube los archivos manualmente:

### Música de Fondo
- Crea la carpeta `music/` dentro de `channel-assets`
- Sube estos archivos:
  - `podcast.mp3` - Música suave y profesional para podcasts
  - `energetic.mp3` - Música enérgica y dinámica
  - `calm.mp3` - Música tranquila y relajante
  - `dramatic.mp3` - Música dramática y emocional
  - `news.mp3` - Música estilo noticiero profesional
  - `corporate.mp3` - Música corporativa y formal

### Efectos de Sonido
- Crea la carpeta `sound-effects/` dentro de `channel-assets`
- Sube estos archivos:
  - `transition-whoosh.mp3` - Sonido de transición whoosh
  - `transition-swoosh.mp3` - Sonido de transición swoosh
  - `transition-swish.mp3` - Sonido de transición swish
  - `emphasis-drum-roll.mp3` - Redoble de tambor para énfasis
  - `emphasis-pop.mp3` - Sonido pop para énfasis
  - `emphasis-hit.mp3` - Sonido de impacto para énfasis
  - `notification-news-alert.mp3` - Alerta de noticias
  - `notification-ding.mp3` - Sonido ding de notificación
  - `notification-bell.mp3` - Campana de notificación
  - `ambient-newsroom.mp3` - Ambiente de sala de noticias

## Opción 2: Usar el Script Automático

1. **Instalar dependencias** (si no están instaladas):
   ```bash
   npm install
   ```

2. **Configurar variables de entorno**:
   Asegúrate de tener estas variables en tu `.env`:
   ```
   VITE_SUPABASE_URL=tu_url_de_supabase
   VITE_SUPABASE_ANON_KEY=tu_anon_key
   ```

3. **Ejecutar el script**:
   ```bash
   npx tsx scripts/upload-audio-assets.ts
   ```

## Fuentes Recomendadas para Descargar Audio Gratuito

### Música de Fondo:
- **Mixkit**: https://mixkit.co/free-stock-music/
- **Pixabay Music**: https://pixabay.com/music/
- **Free Music Archive**: https://freemusicarchive.org/
- **Incompetech**: https://incompetech.com/music/royalty-free/

### Efectos de Sonido:
- **Mixkit**: https://mixkit.co/free-sound-effects/
- **Freesound**: https://freesound.org/
- **Zapsplat**: https://www.zapsplat.com/
- **BBC Sound Effects**: https://sound-effects.bbcrewind.co.uk/

## Notas Importantes

1. **Licencias**: Asegúrate de que los archivos que subas tengan licencia libre o royalty-free
2. **Formato**: Los archivos deben estar en formato MP3
3. **Duración**: 
   - Música de fondo: 30-60 segundos (se loopeará)
   - Efectos de sonido: 0.5-2 segundos
4. **Calidad**: Usa archivos de buena calidad (128kbps o superior para MP3)

## Verificar que los archivos están disponibles

Después de subir, puedes verificar que los archivos están accesibles visitando:
```
https://tu-proyecto.supabase.co/storage/v1/object/public/channel-assets/music/podcast.mp3
```
