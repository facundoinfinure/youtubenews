# Scripts de Audio para Supabase Storage

Este directorio contiene scripts para configurar archivos de audio (música de fondo y efectos de sonido) en Supabase Storage.

## 📋 Requisitos Previos

1. **Bucket de Supabase Storage**: Asegúrate de que el bucket `channel-assets` existe en tu proyecto Supabase
2. **Variables de entorno**: Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en tu `.env`

## 🎵 Archivos Necesarios

### Música de Fondo (en `scripts/audio-assets/music/`)
- `podcast.mp3` - Música suave y profesional para podcasts
- `energetic.mp3` - Música enérgica y dinámica
- `calm.mp3` - Música tranquila y relajante
- `dramatic.mp3` - Música dramática y emocional
- `news.mp3` - Música estilo noticiero profesional
- `corporate.mp3` - Música corporativa y formal

### Efectos de Sonido (en `scripts/audio-assets/sound-effects/`)
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

## 🚀 Opción 1: Subir Archivos Manualmente (Recomendado)

1. **Descarga archivos gratuitos desde:**
   - [Mixkit Music](https://mixkit.co/free-stock-music/)
   - [Mixkit Sound Effects](https://mixkit.co/free-sound-effects/)
   - [Pixabay Music](https://pixabay.com/music/)
   - [Freesound](https://freesound.org/)

2. **Coloca los archivos en:**
   ```
   scripts/audio-assets/
     music/
       podcast.mp3
       energetic.mp3
       ...
     sound-effects/
       transition-whoosh.mp3
       ...
   ```

3. **Ejecuta el script:**
   ```bash
   npm run setup-audio
   # O
   npx tsx scripts/setup-audio-assets.ts
   ```

## 🚀 Opción 2: Descarga Automática (Experimental)

Este script intenta descargar archivos de ejemplo desde Mixkit:

```bash
npm run download-audio
# O
npx tsx scripts/download-and-upload-audio.ts
```

**Nota**: Las URLs pueden cambiar. Es mejor usar la Opción 1 con archivos descargados manualmente.

## 📁 Estructura en Supabase Storage

Después de ejecutar los scripts, los archivos estarán en:

```
channel-assets/
├── music/
│   ├── podcast.mp3
│   ├── energetic.mp3
│   ├── calm.mp3
│   ├── dramatic.mp3
│   ├── news.mp3
│   └── corporate.mp3
└── sound-effects/
    ├── transition-whoosh.mp3
    ├── transition-swoosh.mp3
    ├── transition-swish.mp3
    ├── emphasis-drum-roll.mp3
    ├── emphasis-pop.mp3
    ├── emphasis-hit.mp3
    ├── notification-news-alert.mp3
    ├── notification-ding.mp3
    ├── notification-bell.mp3
    └── ambient-newsroom.mp3
```

## ✅ Verificación

Después de subir, puedes verificar que los archivos están disponibles visitando:
```
https://tu-proyecto.supabase.co/storage/v1/object/public/channel-assets/music/podcast.mp3
```

## 🔧 Solución de Problemas

### Error: "Bucket not found"
- Ve a Supabase Dashboard > Storage
- Crea un bucket llamado `channel-assets`
- Configúralo como público o ajusta las políticas RLS

### Error: "VITE_SUPABASE_URL not configured"
- Asegúrate de tener un archivo `.env` con las variables configuradas
- O exporta las variables en tu terminal antes de ejecutar el script

### Archivos no se descargan
- Las URLs de ejemplo pueden haber cambiado
- Usa la Opción 1 para subir archivos manualmente descargados
