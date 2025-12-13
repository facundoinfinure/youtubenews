# ChimpNews - Documentación Completa de la Aplicación

## 📋 Tabla de Contenidos

1. [Arquitectura General](#arquitectura-general)
2. [Estructura de Componentes](#estructura-de-componentes)
3. [Servicios y Funcionalidades](#servicios-y-funcionalidades)
4. [Sistema de Prompts y Motor Narrativo](#sistema-de-prompts-y-motor-narrativo)
5. [Flujo Completo de Producción](#flujo-completo-de-producción)
6. [Herramientas y APIs](#herramientas-y-apis)
7. [Base de Datos y Almacenamiento](#base-de-datos-y-almacenamiento)
8. [Configuración y Variables de Entorno](#configuración-y-variables-de-entorno)
9. [Integraciones Externas](#integraciones-externas)
10. [Sistema de Caché y Optimización](#sistema-de-caché-y-optimización)

---

## 🏗️ Arquitectura General

### Stack Tecnológico

- **Frontend**: React 18.2.0 con TypeScript
- **Build Tool**: Vite 4.4.5
- **Styling**: Tailwind CSS 3.3.3
- **Animaciones**: Framer Motion 10.18.0
- **Notificaciones**: React Hot Toast 2.6.0
- **Base de Datos**: Supabase (PostgreSQL)
- **Almacenamiento**: Supabase Storage
- **Deployment**: Vercel (Frontend + Serverless Functions)

### Arquitectura de Capas

```
┌─────────────────────────────────────────┐
│         Frontend (React/Vite)           │
│  ┌──────────┐  ┌──────────┐          │
│  │Components│  │  Services │          │
│  └──────────┘  └──────────┘          │
└─────────────────────────────────────────┘
           │              │
           ▼              ▼
┌─────────────────────────────────────────┐
│    Vercel Serverless Functions          │
│  ┌──────────┐  ┌──────────┐          │
│  │  OpenAI  │  │ Wavespeed │          │
│  │   Proxy  │  │   Proxy   │          │
│  └──────────┘  └──────────┘          │
└─────────────────────────────────────────┘
           │              │
           ▼              ▼
┌─────────────────────────────────────────┐
│      Supabase (PostgreSQL + Storage)    │
│  ┌──────────┐  ┌──────────┐          │
│  │ Database │  │  Storage  │          │
│  └──────────┘  └──────────┘          │
└─────────────────────────────────────────┘
```

---

## 🧩 Estructura de Componentes

### Componente Principal: `App.tsx`

El componente `App.tsx` es el núcleo de la aplicación y gestiona todo el estado y flujo de la aplicación.

#### Estados de la Aplicación (`AppState`)

```typescript
enum AppState {
  LOGIN = 'LOGIN',                    // Pantalla de inicio de sesión
  ADMIN_DASHBOARD = 'ADMIN_DASHBOARD', // Panel de administración
  IDLE = 'IDLE',                       // Estado inicial después del login
  FETCHING_NEWS = 'FETCHING_NEWS',     // Obteniendo noticias
  SELECTING_NEWS = 'SELECTING_NEWS',   // Seleccionando noticias
  GENERATING_SCRIPT = 'GENERATING_SCRIPT', // Generando guión
  PREVIEW = 'PREVIEW',                  // Vista previa del guión
  GENERATING_MEDIA = 'GENERATING_MEDIA', // Generando audio/video
  READY = 'READY',                      // Listo para reproducir
  ERROR = 'ERROR'                       // Estado de error
}
```

#### Estado Principal del Componente

```typescript
// Estado de autenticación
const [user, setUser] = useState<UserProfile | null>(null);
const [state, setState] = useState<AppState>(AppState.LOGIN);

// Estado de configuración
const [config, setConfig] = useState<ChannelConfig>(FALLBACK_DEFAULT_CONFIG);
const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
const [channels, setChannels] = useState<Channel[]>([]);

// Estado de noticias
const [allNews, setAllNews] = useState<NewsItem[]>([]);
const [selectedNews, setSelectedNews] = useState<NewsItem[]>([]);
const [usedNewsIds, setUsedNewsIds] = useState<Set<string>>(new Set());

// Estado de producción
const [segments, setSegments] = useState<BroadcastSegment[]>([]);
const [videos, setVideos] = useState<VideoAssets>(EMPTY_VIDEO_ASSETS);
const [viralMeta, setViralMeta] = useState<ViralMetadata | null>(null);
const [currentScriptWithScenes, setCurrentScriptWithScenes] = useState<ScriptWithScenes | null>(null);

// Estado del wizard de producción
const [showWizard, setShowWizard] = useState(false);
const [wizardProduction, setWizardProduction] = useState<Production | null>(null);
const [productionProgress, setProductionProgress] = useState({ current: 0, total: 0, step: '' });
```

### Componentes de UI

#### 1. `LoginScreen.tsx`
- Maneja la autenticación con Google OAuth
- Valida el email del administrador
- Inicializa la sesión de Supabase

#### 2. `Header.tsx`
- Barra de navegación superior
- Selector de canales
- Botones de acción (Dashboard, Logout)

#### 3. `IdleState.tsx`
- Pantalla inicial después del login
- Muestra producciones incompletas
- Botón para iniciar nueva producción

#### 4. `NewsSelector.tsx`
- Lista de noticias disponibles
- Selector de fecha para noticias
- Filtrado y búsqueda de noticias
- Visualización de viral score

#### 5. `ProductionWizard.tsx` ⭐ **Componente Principal del Flujo**

El wizard guía al usuario a través de 8 pasos:

```typescript
type ProductionStep = 
  | 'news_fetch'      // Paso 1: Buscar noticias
  | 'news_select'     // Paso 2: Seleccionar noticias
  | 'script_generate' // Paso 3: Generar guiones
  | 'script_review'   // Paso 4: Revisar/editar guiones
  | 'audio_generate'  // Paso 5: Generar audio
  | 'video_generate'  // Paso 6: Generar video
  | 'render_final'    // Paso 7: Renderizar composición final
  | 'publish'         // Paso 8: Publicar a YouTube
  | 'done';           // Completado
```

**Características del Wizard:**
- Navegación entre pasos con indicador visual
- Guardado automático del progreso
- Reanudación de producciones incompletas
- Regeneración de segmentos individuales
- Vista previa de escenas y guiones

#### 6. `BroadcastPlayer.tsx`
- Reproductor de video final
- Control de reproducción
- Visualización de segmentos
- Información de metadata viral

#### 7. `AdminDashboard.tsx`
- Gestión de canales
- Configuración de personajes
- Gestión de audio (upload/download)
- Configuración de TTS
- Análisis de costos
- Gestión de producciones

#### 8. `SceneCard.tsx` / `SceneList.tsx`
- Visualización de escenas generadas
- Edición de diálogos
- Regeneración de escenas individuales
- Vista previa de metadata de escena

#### 9. `ProductionStatus.tsx`
- Indicador de progreso
- Estado de cada paso
- Logs de generación
- Manejo de errores

#### 10. `ErrorBoundary.tsx`
- Captura de errores de React
- UI de error amigable
- Logging de errores

#### 11. `ToastProvider.tsx`
- Sistema de notificaciones
- Toast messages para feedback del usuario

---

## 🔧 Servicios y Funcionalidades

### 1. `supabaseService.ts` - Servicio de Base de Datos

**Funcionalidades principales:**

#### Autenticación
```typescript
signInWithGoogle()      // Login con Google OAuth
signOut()               // Cerrar sesión
getSession()            // Obtener sesión actual
connectYouTube()         // Conectar cuenta de YouTube
```

#### Gestión de Canales
```typescript
getAllChannels()        // Obtener todos los canales
getChannelById(id)      // Obtener canal por ID
saveChannel(channel)    // Guardar/actualizar canal
getDefaultChannelConfig() // Obtener configuración por defecto
```

#### Gestión de Noticias
```typescript
getNewsByDate(date)     // Obtener noticias por fecha
saveNewsToDB(news)      // Guardar noticias
markNewsAsSelected(id)  // Marcar noticia como seleccionada
getUsedNewsIdsForDate(date) // Obtener IDs de noticias usadas
```

#### Gestión de Producciones
```typescript
saveProduction(production)           // Guardar producción
getProductionById(id)                // Obtener producción
getIncompleteProductions(channelId)  // Obtener producciones incompletas
updateProductionStatus(id, status)   // Actualizar estado
getAllProductions(channelId)         // Obtener todas las producciones
createProductionVersion(parentId)     // Crear versión de producción
deleteProduction(id)                  // Eliminar producción
```

#### Gestión de Videos
```typescript
saveVideoToDB(metadata, channelId, youtubeId) // Guardar video
fetchVideosFromDB(channelId)                  // Obtener videos
deleteVideoFromDB(id)                          // Eliminar video
```

#### Almacenamiento (Storage)
```typescript
uploadAudioToStorage(audioBase64, productionId, segmentIndex)
uploadImageToStorage(imageBase64, path)
getAudioFromStorage(path)
verifyStorageBucket()  // Verificar que el bucket existe
```

#### Sistema de Caché
```typescript
findCachedScript(newsIds, channelId)        // Buscar guión en caché
findCachedScriptWithScenes(newsIds, channelId) // Buscar guión con escenas
findCachedAudio(text, voiceName, channelId)   // Buscar audio en caché
findCachedVideo(channelId, videoType, dialogue) // Buscar video en caché
saveCachedAudio(text, voiceName, audioBase64)   // Guardar audio en caché
```

#### Checkpoints y Recuperación
```typescript
saveCheckpoint(productionId, checkpointData) // Guardar checkpoint
getLastCheckpoint(productionId)              // Obtener último checkpoint
markStepFailed(productionId, step)          // Marcar paso como fallido
updateSegmentStatus(productionId, segmentIndex, status) // Actualizar estado de segmento
getSegmentsNeedingRegeneration(productionId) // Obtener segmentos que necesitan regeneración
```

### 2. `geminiService.ts` - Servicio Principal de Generación

**Funcionalidades principales:**

#### Generación de Noticias
```typescript
fetchEconomicNews(date, country, topicToken) // Obtener noticias económicas
```

#### Generación de Guiones
```typescript
generateScript(news, config, viralHook)                    // Generar guión (legacy)
generateScriptWithScenes(news, config, viralHook, improvements) // Generar guión con escenas (v2.0)
convertScenesToScriptLines(scriptWithScenes, config)        // Convertir escenas a líneas
```

#### Generación de Audio
```typescript
generateSegmentedAudio(script, config)              // Generar audio segmentado
generateSegmentedAudioWithCache(script, config, channelId) // Con caché
generateAudioFromScenes(scenes, config, channelId)  // Desde escenas
```

#### Generación de Video
```typescript
generateVideoSegmentsWithInfiniteTalk(segments, config, channelId, productionId, scenes)
// Genera videos usando WaveSpeed InfiniteTalk
```

#### Generación de Metadata Viral
```typescript
generateViralMetadata(news, config, date)    // Generar metadata viral
generateViralHook(news, config)               // Generar hook viral
generateThumbnail(title, description)         // Generar thumbnail
generateThumbnailVariants(title, description) // Generar variantes
```

#### Composición de Video
```typescript
composeVideoWithShotstack(segments, videoUrls, videoAssets, config, options)
isCompositionAvailable()                        // Verificar si Shotstack está disponible
getCompositionStatus(renderId)                 // Obtener estado de composición
```

### 3. `openaiService.ts` - Servicio de OpenAI

**Funcionalidades:**

#### Generación de Texto (GPT-4o)
```typescript
generateScriptWithGPT(news, config, viralHook, improvements)
// Genera guiones usando GPT-4o con el motor narrativo v2.0

generateViralMetadataWithGPT(news, config, date, trending)
// Genera metadata viral optimizada para YouTube

generateViralHookWithGPT(news, config)
// Genera hooks virales para títulos

analyzeScriptForShorts(scriptWithScenes)
// Analiza guión para optimización de YouTube Shorts

regenerateScene(scene, improvements, config)
// Regenera una escena específica con mejoras
```

#### Text-to-Speech (TTS)
```typescript
generateTTSAudio(text, voiceName, language?, ttsProvider?, elevenLabsVoiceId?)
// Genera audio usando OpenAI TTS o ElevenLabs
// Voces disponibles: 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'
```

#### Generación de Imágenes
```typescript
generateImageWithDALLE(prompt, size, quality)
// Genera imágenes usando DALL-E 3
```

### 4. `elevenlabsService.ts` - Servicio de ElevenLabs

**Funcionalidades:**

```typescript
generateElevenLabsTTS(text, voiceId, modelId, stability, similarityBoost)
// Genera audio usando ElevenLabs TTS
// Soporta voces en múltiples idiomas (español, inglés, etc.)

listAvailableSoundEffects()
// Lista efectos de sonido disponibles en Supabase Storage
```

### 5. `wavespeedProxy.ts` - Servicio de WaveSpeed (Video Generation)

**Funcionalidades:**

```typescript
createInfiniteTalkSingleTask(options)
// Crea tarea de InfiniteTalk para un solo personaje

createInfiniteTalkMultiTask(options)
// Crea tarea de InfiniteTalk para dos personajes

pollInfiniteTalkTask(taskId)
// Consulta el estado de una tarea de InfiniteTalk

createWavespeedImageTask(imageUrl, prompt)
// Crea tarea de generación de imagen

pollWavespeedImageTask(taskId)
// Consulta el estado de generación de imagen

checkWavespeedConfig()
// Verifica configuración de WaveSpeed
```

**Modelos disponibles:**
- `infinite_talk` - Para un solo personaje
- `infinite_talk_multi` - Para dos personajes (legacy, ahora usa single)

### 6. `shotstackService.ts` - Servicio de Composición de Video

**Funcionalidades:**

```typescript
renderPodcastVideo(scenes, config, channelId, productionId)
// Renderiza video estilo podcast usando Shotstack

createCompositionFromSegments(segments, config)
// Crea composición desde segmentos

checkShotstackConfig()
// Verifica configuración de Shotstack
```

**Características:**
- Transiciones: fade, wipe, slide, zoom
- Efectos: zoom in/out, filtros visuales
- Overlays: subtítulos, lower thirds, ticker
- Música de fondo opcional
- Efectos de sonido
- Watermark/logo

### 7. `sceneBuilderService.ts` - Constructor de Escenas Visuales

**Funcionalidades:**

```typescript
generateScenePrompts(scriptWithScenes, config)
// Genera prompts visuales optimizados para InfiniteTalk
```

**Características:**
- Validación automática de shot types según estructura narrativa
- Generación de hints de expresión facial
- Ajuste de iluminación según mood de escena
- Soporte para las 4 estructuras narrativas
- Continuidad visual entre escenas

### 8. `youtubeService.ts` - Servicio de YouTube

**Funcionalidades:**

```typescript
uploadVideoToYouTube(videoUrl, metadata, accessToken, isShort)
// Sube video a YouTube

deleteVideoFromYouTube(videoId, accessToken)
// Elimina video de YouTube
```

### 9. `serpApiService.ts` - Servicio de Noticias

**Funcionalidades:**

```typescript
fetchNewsWithSerpAPI(query, date, country, language)
// Obtiene noticias usando SerpAPI (Google News)

fetchTrendingWithSerpAPI(country)
// Obtiene temas trending
```

### 10. `ContentCache.ts` - Sistema de Caché

**Funcionalidades:**

```typescript
ContentCache.setContext(channelId)  // Establecer contexto
ContentCache.preload()              // Precargar caché
ContentCache.get(key)               // Obtener del caché
ContentCache.set(key, value)        // Guardar en caché
```

### 11. `CostTracker.ts` - Seguimiento de Costos

**Funcionalidades:**

```typescript
CostTracker.setContext(channelId, userId)
CostTracker.track(category, operation, cost)
CostTracker.getTotalCost()
CostTracker.getBreakdown()
```

### 12. `retryUtils.ts` - Utilidades de Reintento

**Funcionalidades:**

```typescript
retryWithBackoff(fn, maxRetries, baseDelay)
retryVideoGeneration(segment, config, channelId, productionId)
retryBatch(segments, config, channelId, productionId)
```

### 13. `storageManager.ts` - Gestión de Almacenamiento

**Funcionalidades:**

```typescript
analyzeSegmentResources(productionId, segmentIndex)
checkFileExists(bucket, path)
```

### 14. `logger.ts` - Sistema de Logging

**Funcionalidades:**

```typescript
logger.info(category, message, data?)
logger.warn(category, message, data?)
logger.error(category, message, data?)
```

---

## 📝 Sistema de Prompts y Motor Narrativo

### Motor Narrativo v2.0

El sistema utiliza **4 estructuras narrativas** oficiales:

#### 1. Classic Arc (6 escenas)
```
1. Hook - closeup, dramatic
2. Rising Action - medium, neutral
3. Conflict - closeup, dramatic
4. Comeback - medium, warm
5. Rising Action 2 - medium, neutral
6. Payoff - wide, warm
```

#### 2. Double Conflict Arc (7 escenas)
```
1. Hook - closeup, dramatic
2. Rising Action - medium, neutral
3. Conflict A - closeup, dramatic
4. Rising Back A - medium, warm
5. Conflict B - closeup, cool
6. Rising Back B - medium, warm
7. Payoff - wide, warm
```

#### 3. Hot Take Compressed (4 escenas)
```
1. Hook - closeup, dramatic
2. Conflict - closeup, dramatic
3. Comeback - medium, neutral
4. Payoff - wide, wide
```

#### 4. Perspective Clash (6 escenas)
```
1. Hook - closeup, dramatic
2. hostA POV - medium, cool
3. hostB POV - medium, warm
4. Clash - closeup, dramatic
5. Synthesis - medium, neutral
6. Payoff - wide, warm
```

### Prompt del Scriptwriter (GPT-4o)

El prompt principal para generar guiones incluye:

#### 1. Perfiles de Hosts
```text
HOST A (Rusty):
- Gender: male
- Outfit: dark hoodie
- Personality: sarcastic, dry humor, tired-finance-bro energy, skeptical
- Speaking Style: MUST express opinions aligned with personality

HOST B (Dani):
- Gender: female
- Outfit: teal blazer and white shirt
- Personality: playful, witty, energetic, optimistic but grounded
- Speaking Style: MUST express opinions aligned with personality, CONTRAST to Host A
```

#### 2. Reglas de Diálogo
```text
- Alternate dialogue strictly (hostA then hostB)
- No narration, stage directions, or camera cues
- Tone: conversational podcast banter
- 80–130 words per scene (40–80 for Hot Take)
- Reference news sources naturally
```

#### 3. Reglas de Transición
```text
- ONLY add transition phrases when scene changes to COMPLETELY DIFFERENT news topic
- If scene continues SAME or RELATED topic, DO NOT use transition phrase
- Examples of DIFFERENT topics (need transition): "Apple earnings" → "Tesla stock crash"
- Examples of SAME/RELATED topics (NO transition): "Apple earnings" → "Apple stock reaction"
```

#### 4. Metadata de Video
```text
For EACH scene provide:
- title: Short, catchy title (3-6 words)
- video_mode: "hostA" | "hostB" (ALTERNATE - NEVER use "both")
- model: "infinite_talk" (always)
- shot: "medium" (default), "closeup" (Hook/Conflict), "wide" (Payoff)
- soundEffects: Optional sound effects with precise timing
```

#### 5. Formato de Salida
```json
{
  "title": "Episode title",
  "narrative_used": "classic | double_conflict | hot_take | perspective_clash",
  "scenes": {
    "1": {
      "title": "Scene Title",
      "text": "Host dialogue (40-80 words)",
      "video_mode": "hostA",
      "model": "infinite_talk",
      "shot": "closeup",
      "soundEffects": {
        "type": "transition | emphasis | notification | ambient | none",
        "description": "exact name from available effects",
        "startTime": "start | end | middle | number",
        "duration": 0.5,
        "volume": 0.4
      }
    }
  }
}
```

### Prompt del Scene Builder

El Scene Builder genera prompts visuales optimizados:

```text
STRICT CHARACTER REQUIREMENTS:
- LEFT CHARACTER: hostA - [visual description]
- RIGHT CHARACTER: hostB - [visual description]

SCENE: Professional podcast news studio
SHOT: [closeup | medium | wide]
SPEAKING: [hostA | hostB] with lip-sync animation
STYLE: Maintain exact character appearances from reference image

CRITICAL: These are NOT human beings. They are animated/CGI characters.
Keep character consistency at all times.
```

### Seed Images (Imágenes Base)

Las seed images proporcionan consistencia visual:

#### hostA Solo
```
Ultra-detailed 3D render of a male chimpanzee podcaster wearing a dark hoodie, 
at a modern podcast desk. Sarcastic expression, relaxed posture. 
Warm tungsten key light + purple/blue LED accents. 
Acoustic foam panels, Shure SM7B microphone. Medium shot, eye-level.
```

#### hostB Solo
```
Ultra-detailed 3D render of a female chimpanzee podcaster wearing a teal blazer 
and white shirt. Playful, expressive look. 
Warm tungsten lighting + purple/blue LEDs. 
Acoustic foam panels. Medium shot, eye-level.
```

#### Two-shot
```
Ultra-detailed 3D render of hostA and hostB at a sleek podcast desk. 
hostA in dark hoodie, hostB in teal blazer. 
Warm tungsten key light, purple/blue LEDs, Shure SM7B mics. 
Medium two-shot, eye-level.
```

---

## 🎬 Flujo Completo de Producción

### Flujo del Production Wizard

```
┌─────────────────────────────────────────────────────────┐
│  PASO 1: NEWS_FETCH                                      │
│  - Usuario selecciona fecha                              │
│  - Sistema busca noticias (SerpAPI)                     │
│  - Noticias se guardan en DB                            │
│  - Se calcula viral score para cada noticia             │
└─────────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  PASO 2: NEWS_SELECT                                    │
│  - Usuario selecciona noticias (máx 15)                 │
│  - Sistema verifica noticias ya usadas                  │
│  - Se guarda selección en producción                    │
└─────────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  PASO 3: SCRIPT_GENERATE                                │
│  - Se genera viral hook (GPT-4o)                        │
│  - Se genera guión con escenas (GPT-4o + Narrative Engine)│
│  - Se selecciona estructura narrativa automáticamente   │
│  - Se genera metadata viral (título, descripción, tags) │
│  - Se guarda en producción                              │
└─────────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  PASO 4: SCRIPT_REVIEW                                  │
│  - Usuario revisa guión generado                        │
│  - Puede editar diálogos                                │
│  - Puede regenerar escenas individuales                 │
│  - Puede regenerar guión completo con mejoras           │
│  - Al aprobar, se guarda versión final                  │
└─────────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  PASO 5: AUDIO_GENERATE                                 │
│  Para cada escena:                                       │
│  - Se verifica caché de audio                           │
│  - Si no existe, se genera TTS (OpenAI/ElevenLabs)      │
│  - Se normaliza audio (opcional, -16 LUFS)              │
│  - Se sube a Supabase Storage                           │
│  - Se guarda URL y duración                             │
│  - Se actualiza estado del segmento                      │
└─────────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  PASO 6: VIDEO_GENERATE                                 │
│  Para cada escena:                                       │
│  - Se verifica caché de video                           │
│  - Se genera prompt visual (Scene Builder)              │
│  - Se obtiene seed image según video_mode               │
│  - Se crea tarea InfiniteTalk (WaveSpeed)               │
│  - Se consulta estado (polling cada 10s)                │
│  - Al completar, se guarda URL                          │
│  - Se actualiza estado del segmento                     │
└─────────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  PASO 7: RENDER_FINAL                                   │
│  - Se compone video final (Shotstack)                   │
│  - Se añaden transiciones                                │
│  - Se añaden overlays (subtítulos, lower thirds)        │
│  - Se añade música de fondo (opcional)                  │
│  - Se añaden efectos de sonido                          │
│  - Se renderiza en la nube                              │
│  - Se obtiene URL del video final                       │
│  - Se genera poster/thumbnail                            │
└─────────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  PASO 8: PUBLISH                                        │
│  - Se sube video a YouTube (YouTube Data API)          │
│  - Se configura como Short (si formato 9:16)            │
│  - Se añade metadata viral (título, descripción, tags) │
│  - Se añade thumbnail                                   │
│  - Se guarda YouTube ID en producción                   │
│  - Se marca producción como completada                  │
└─────────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────┐
│  DONE: Producción Completada                            │
│  - Video disponible en YouTube                          │
│  - Producción guardada en DB                            │
│  - Disponible para análisis y reutilización             │
└─────────────────────────────────────────────────────────┘
```

### Flujo de Generación de Audio

```
1. Verificar caché
   ├─ Si existe → Retornar audio desde caché
   └─ Si no existe → Continuar

2. Determinar proveedor TTS
   ├─ Si config.ttsProvider === 'elevenlabs' → Usar ElevenLabs
   └─ Si no → Usar OpenAI TTS

3. Generar audio
   ├─ OpenAI: generateTTSAudio(text, voiceName, language)
   └─ ElevenLabs: generateElevenLabsTTS(text, voiceId, ...)

4. Procesar audio (opcional)
   ├─ Normalizar a -16 LUFS
   ├─ Aplicar peak limiting (-1.5 dBTP)
   └─ Aplicar high-pass filter (80Hz)

5. Guardar en caché
   ├─ Subir a Supabase Storage
   └─ Guardar en audio_cache table

6. Retornar audioBase64 y duración
```

### Flujo de Generación de Video

```
1. Verificar caché
   ├─ Buscar por dialogue text y video_type
   └─ Si existe → Retornar URL desde caché

2. Verificar tarea pendiente
   ├─ Buscar pending_video_tasks
   └─ Si existe → Reanudar polling

3. Generar prompt visual
   ├─ Scene Builder genera prompt optimizado
   ├─ Se añaden hints de expresión
   └─ Se ajusta iluminación según mood

4. Obtener seed image
   ├─ Según video_mode (hostA/hostB)
   ├─ Según formato (16:9 o 9:16)
   └─ Desde config.seedImages

5. Crear tarea InfiniteTalk
   ├─ createInfiniteTalkSingleTask() o createInfiniteTalkMultiTask()
   ├─ Se pasa audio URL, image URL, prompt
   └─ Se guarda taskId en pending_video_tasks

6. Polling de estado
   ├─ pollInfiniteTalkTask(taskId) cada 10s
   ├─ Máximo 15 minutos de espera
   └─ Al completar → Obtener video URL

7. Guardar en caché
   ├─ Guardar URL en generated_videos table
   └─ Actualizar pending_video_tasks a completed

8. Retornar video URL
```

---

## 🛠️ Herramientas y APIs

### APIs Externas Utilizadas

#### 1. **OpenAI API** (via Proxy)
- **Uso**: Generación de texto (GPT-4o), TTS, imágenes (DALL-E)
- **Endpoints**: `/api/openai?endpoint=...`
- **Funciones**:
  - `chat/completions` - GPT-4o para guiones
  - `audio/speech` - Text-to-Speech
  - `images/generations` - DALL-E 3

#### 2. **WaveSpeed API** (via Proxy)
- **Uso**: Generación de video con lip-sync
- **Endpoints**: `/api/wavespeed?path=...`
- **Modelos**:
  - `infinite_talk` - Un personaje
  - `infinite_talk_multi` - Dos personajes (legacy)
- **Resoluciones**: 480p, 720p
- **Costos**: $0.15 (480p) / $0.30 (720p) por 5 segundos

#### 3. **Shotstack API**
- **Uso**: Composición y renderizado de video final
- **Funciones**:
  - Renderizado en la nube
  - Transiciones y efectos
  - Overlays y subtítulos
  - Música de fondo
- **Costo**: ~$0.05 por minuto de video

#### 4. **SerpAPI**
- **Uso**: Obtención de noticias desde Google News
- **Funciones**:
  - Búsqueda de noticias por fecha/país
  - Trending topics
- **Costo**: ~$0.01 por búsqueda

#### 5. **ElevenLabs API**
- **Uso**: Text-to-Speech de alta calidad (especialmente para español)
- **Funciones**:
  - Generación de audio con voces personalizadas
  - Control de estabilidad y similaridad
- **Costo**: Variable según plan

#### 6. **YouTube Data API v3**
- **Uso**: Subida de videos a YouTube
- **Funciones**:
  - Upload de videos
  - Configuración de metadata
  - Gestión de thumbnails
- **Autenticación**: OAuth 2.0 via Google

#### 7. **Supabase**
- **Uso**: Base de datos PostgreSQL + Storage
- **Funciones**:
  - Almacenamiento de datos estructurados
  - Almacenamiento de archivos (audio, video, imágenes)
  - Autenticación OAuth
  - Real-time subscriptions (opcional)

### Vercel Serverless Functions

Las funciones serverless actúan como proxies para evitar CORS:

#### `/api/openai`
```typescript
// Proxies requests to OpenAI API
// Handles API key securely
// Supports retries and error handling
```

#### `/api/wavespeed`
```typescript
// Proxies requests to WaveSpeed API
// Handles authentication
// Manages task polling
```

#### `/api/serpapi`
```typescript
// Proxies requests to SerpAPI
// Caches results
```

#### `/api/elevenlabs`
```typescript
// Proxies requests to ElevenLabs API
// Handles voice generation
```

---

## 💾 Base de Datos y Almacenamiento

### Esquema de Base de Datos (Supabase PostgreSQL)

#### Tabla: `channels`
```sql
- id (uuid, PK)
- name (text)
- config (jsonb) -- ChannelConfig completo
- active (boolean)
- created_at (timestamp)
- updated_at (timestamp)
```

#### Tabla: `news_items`
```sql
- id (uuid, PK)
- headline (text)
- source (text)
- url (text)
- summary (text)
- viral_score (numeric)
- viral_score_reasoning (text)
- image_keyword (text)
- image_url (text)
- publication_date (date)
- created_at (timestamp)
```

#### Tabla: `productions`
```sql
- id (uuid, PK)
- channel_id (uuid, FK)
- news_date (date)
- status (text) -- 'draft' | 'in_progress' | 'completed' | 'failed'
- selected_news_ids (uuid[])
- script (jsonb) -- ScriptLine[] (legacy)
- scenes (jsonb) -- ScriptWithScenes (v2.0)
- narrative_used (text) -- NarrativeType
- viral_metadata (jsonb) -- ViralMetadata
- segments (jsonb) -- BroadcastSegment[]
- video_assets (jsonb) -- VideoAssets
- wizard_state (jsonb) -- ProductionWizardState
- segment_status (jsonb) -- Record<number, SegmentStatus>
- final_video_url (text)
- final_video_poster (text)
- youtube_id (text)
- published_at (timestamp)
- user_id (text)
- version (integer)
- parent_production_id (uuid, FK)
- checkpoint_data (jsonb)
- last_checkpoint_at (timestamp)
- failed_steps (text[])
- estimated_cost (numeric)
- actual_cost (numeric)
- cost_breakdown (jsonb)
- created_at (timestamp)
- updated_at (timestamp)
- completed_at (timestamp)
```

#### Tabla: `videos`
```sql
- id (uuid, PK)
- channel_id (uuid, FK)
- title (text)
- description (text)
- tags (text[])
- youtube_id (text)
- viral_score (numeric)
- views (integer)
- ctr (numeric)
- avg_view_duration (text)
- retention_data (numeric[])
- thumbnail_url (text)
- is_posted (boolean)
- created_at (timestamp)
```

#### Tabla: `audio_cache`
```sql
- id (uuid, PK)
- channel_id (uuid, FK)
- text_hash (text) -- Hash del texto
- voice_key (text) -- "provider:voiceId"
- audio_url (text) -- URL en Supabase Storage
- duration_seconds (numeric)
- normalized (boolean)
- peak_db (numeric)
- rms_db (numeric)
- created_at (timestamp)
```

#### Tabla: `generated_videos`
```sql
- id (uuid, PK)
- channel_id (uuid, FK)
- production_id (uuid, FK)
- video_type (text) -- 'host_a' | 'host_b' | 'segment'
- dialogue_hash (text)
- video_url (text)
- scene_metadata (jsonb)
- lighting_mood (text)
- shot_type (text)
- format (text) -- '16:9' | '9:16'
- created_at (timestamp)
```

#### Tabla: `pending_video_tasks`
```sql
- id (uuid, PK)
- channel_id (uuid, FK)
- production_id (uuid, FK)
- segment_index (integer)
- task_id (text) -- WaveSpeed task ID
- dialogue_text (text)
- status (text) -- 'pending' | 'processing' | 'completed' | 'failed'
- created_at (timestamp)
- updated_at (timestamp)
```

#### Tabla: `system_defaults`
```sql
- id (integer, PK)
- default_channel_config (jsonb) -- ChannelConfig por defecto
- updated_at (timestamp)
```

### Supabase Storage

#### Bucket: `channel-assets`
Estructura de carpetas:
```
channel-assets/
├── productions/
│   └── {production_id}/
│       ├── audio/
│       │   └── segment_{index}.mp3
│       ├── videos/
│       │   └── segment_{index}.mp4
│       └── images/
│           └── thumbnail.png
├── channel-images/
│   └── {channel_id}/
│       ├── seed_hostA_16_9.png
│       ├── seed_hostB_16_9.png
│       └── seed_twoShot_16_9.png
└── sound-effects/
    ├── transition/
    ├── emphasis/
    ├── notification/
    └── ambient/
```

---

## ⚙️ Configuración y Variables de Entorno

### Variables de Entorno Requeridas

```env
# Autenticación
VITE_ADMIN_EMAIL=tu-email@ejemplo.com
VITE_GOOGLE_CLIENT_ID=tu-google-client-id

# Supabase
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-supabase-anon-key

# APIs (opcionales - pueden estar en Vercel)
VITE_GEMINI_API_KEY=tu-gemini-key (legacy, no se usa actualmente)
VITE_BACKEND_URL=https://tu-backend.com (opcional)

# WaveSpeed (en Vercel como variable de entorno)
WAVESPEED_API_KEY=tu-wavespeed-key

# OpenAI (en Vercel como variable de entorno)
OPENAI_API_KEY=tu-openai-key

# Shotstack (opcional)
VITE_SHOTSTACK_API_KEY=tu-shotstack-key
VITE_SHOTSTACK_ENV=stage (o 'v1' para producción)

# SerpAPI (opcional)
SERPAPI_API_KEY=tu-serpapi-key

# ElevenLabs (opcional)
ELEVENLABS_API_KEY=tu-elevenlabs-key
```

### Configuración de Canal (ChannelConfig)

```typescript
interface ChannelConfig {
  channelName: string;
  tagline: string;
  country: string; // "USA", "Argentina"
  language: string; // "English", "Spanish"
  format: '16:9' | '9:16'; // Landscape o Shorts
  tone: string; // "Sarcastic, Witty, Informative"
  logoColor1: string; // Hex color
  logoColor2: string; // Hex color
  captionsEnabled: boolean;
  defaultTags?: string[];
  topicToken?: string; // Google News topic token
  ttsProvider?: 'openai' | 'elevenlabs';
  
  characters: {
    hostA: CharacterProfile;
    hostB: CharacterProfile;
  };
  
  seedImages?: {
    hostASolo?: string; // Prompt
    hostBSolo?: string;
    twoShot?: string;
    hostASoloUrl?: string; // URL 16:9
    hostBSoloUrl?: string;
    twoShotUrl?: string;
    hostASoloUrl_9_16?: string; // URL 9:16
    hostBSoloUrl_9_16?: string;
    twoShotUrl_9_16?: string;
  };
  
  studioSetup?: string;
  preferredNarrative?: NarrativeType;
  
  renderConfig?: RenderConfig; // Configuración de Shotstack
  ethicalGuardrails?: EthicalGuardrails; // Reglas de contenido
}
```

---

## 🔗 Integraciones Externas

### Google OAuth
- **Propósito**: Autenticación y acceso a YouTube API
- **Scopes**: `youtube.upload`, `userinfo.email`, `userinfo.profile`
- **Configuración**: Google Cloud Console

### YouTube Data API
- **Propósito**: Subida de videos
- **Autenticación**: OAuth 2.0 token desde Supabase
- **Endpoints**: `videos.insert`, `thumbnails.set`

---

## 🚀 Sistema de Caché y Optimización

### Estrategia de Caché

#### 1. Caché de Audio
- **Clave**: `hash(text) + voice_key`
- **Almacenamiento**: Supabase Storage + `audio_cache` table
- **TTL**: Permanente (hasta eliminación manual)
- **Beneficio**: Evita regenerar audio idéntico

#### 2. Caché de Video
- **Clave**: `dialogue_hash + video_type + format`
- **Almacenamiento**: URLs en `generated_videos` table
- **TTL**: Permanente
- **Beneficio**: Reutiliza videos de diálogos similares

#### 3. Caché de Guiones
- **Clave**: `hash(news_ids) + channel_id`
- **Almacenamiento**: `script_cache` table
- **TTL**: 24 horas
- **Beneficio**: Reutiliza guiones para las mismas noticias

#### 4. Caché en Memoria (ContentCache)
- **Propósito**: Cache rápido para datos frecuentes
- **Almacenamiento**: Memoria del navegador
- **TTL**: 1 hora (default)
- **Beneficio**: Acceso instantáneo a datos recientes

### Optimizaciones

1. **Generación Paralela**: Audio y video se generan en paralelo cuando es posible
2. **Polling Inteligente**: Intervalos adaptativos según tipo de tarea
3. **Lazy Loading**: Componentes se cargan bajo demanda
4. **Checkpoint System**: Guardado automático del progreso
5. **Retry Logic**: Reintentos automáticos con backoff exponencial

---

## 📊 Flujo de Datos Completo

```
Usuario → App.tsx → ProductionWizard
                    ↓
            ┌───────┴───────┐
            │               │
    Services Layer    Supabase
            │               │
    ┌───────┴───────┐      │
    │               │      │
OpenAI API    WaveSpeed    Storage
    │               │      │
    └───────┬───────┘      │
            │               │
            └───────┬───────┘
                    ↓
            Production Complete
                    ↓
            YouTube Upload
```

---

## 🎯 Conclusión

Esta aplicación es un sistema complejo que integra múltiples servicios de IA para generar contenido de video automatizado. El flujo armónico se logra mediante:

1. **Separación de responsabilidades**: Cada servicio tiene un propósito específico
2. **Sistema de caché inteligente**: Reduce costos y mejora velocidad
3. **Motor narrativo estructurado**: Garantiza calidad y consistencia
4. **Wizard paso a paso**: Guía al usuario y permite recuperación
5. **Checkpoints y recuperación**: Permite reanudar producciones
6. **Configuración flexible**: Soporta múltiples canales y personalizaciones

El sistema está diseñado para ser escalable, mantenible y fácil de extender con nuevas funcionalidades.
