# ChimpNews - Propuesta de Mejoras para Calidad, Viralidad y Eficiencia

## 📋 Índice de Mejoras

0. [🚨 FASE 0: Problemas Críticos Actuales](#-fase-0-problemas-críticos-actuales)
1. [Mejoras de Calidad Visual](#mejoras-de-calidad-visual)
2. [Mejoras de Edición y Post-Producción](#mejoras-de-edición-y-post-producción)
3. [Mejoras de Dinamismo](#mejoras-de-dinamismo)
4. [Mejoras de Viralidad](#mejoras-de-viralidad)
5. [Mejoras de Velocidad y Performance](#mejoras-de-velocidad-y-performance)
6. [Optimización de Recursos](#optimización-de-recursos)
7. [Variaciones Narrativas](#variaciones-narrativas)
8. [Variaciones de Cámara y Visuales](#variaciones-de-cámara-y-visuales)
9. [Mejoras de Audio](#mejoras-de-audio)
10. [Mejoras de UX/UI](#mejoras-de-uxui)
   - [10.5 Configuración Avanzada de Comportamiento de Personajes](#105-configuración-avanzada-de-comportamiento-de-personajes) ⭐ **NUEVO**

---

## 🚨 FASE 0: Problemas Críticos Actuales

**ESTOS PROBLEMAS DEBEN RESOLVERSE INMEDIATAMENTE - BLOQUEAN FUNCIONALIDAD BÁSICA**

### 🔴 CRÍTICO 1: Wizard No Carga Datos Entre Pasos
**Prioridad**: URGENTE | **Impacto**: CRÍTICO | **Esfuerzo**: Medio | **Estado**: BLOQUEANTE

#### Problema
Cada vez que un paso se completa, el wizard pasa al siguiente pero **no levanta lo generado en el paso anterior**. El usuario tiene que cerrar el wizard y volver a abrirlo para ver los datos.

#### Causa Raíz Probable
- El estado del wizard no se está persistiendo correctamente en Supabase
- Los datos generados no se están guardando en `production.wizard_state`
- El componente `ProductionWizard` no está cargando el estado guardado al montar
- Falta de sincronización entre el estado local y el estado en DB

#### Solución Detallada

**1. Verificar Persistencia de Estado**
```typescript
// En ProductionWizard.tsx - Asegurar que se guarda después de cada paso
const handleStepComplete = async (step: ProductionStep, data: any) => {
  // Guardar inmediatamente en Supabase
  await saveProduction({
    ...wizardProduction,
    wizard_state: {
      ...wizardProduction.wizard_state,
      [step]: {
        status: 'completed',
        completedAt: new Date().toISOString(),
        data: data
      },
      currentStep: getNextProductionStep(step) || 'done'
    },
    // Guardar también los datos generados directamente
    scenes: step === 'script_generate' ? data.scenes : wizardProduction.scenes,
    viral_metadata: step === 'script_generate' ? data.metadata : wizardProduction.viral_metadata,
    segments: step === 'audio_generate' ? data.segments : wizardProduction.segments,
    // etc.
  }, user.email);
  
  // Actualizar estado local
  setWizardProduction(updatedProduction);
};
```

**2. Cargar Estado al Montar Wizard**
```typescript
// En ProductionWizard.tsx - useEffect al montar
useEffect(() => {
  const loadProductionState = async () => {
    if (production.id) {
      // Cargar producción fresca desde DB
      const freshProduction = await getProductionById(production.id);
      
      if (freshProduction) {
        // Restaurar wizard_state
        if (freshProduction.wizard_state) {
          setWizardState(freshProduction.wizard_state);
        }
        
        // Restaurar datos generados
        if (freshProduction.scenes) {
          setCurrentScenes(freshProduction.scenes);
        }
        if (freshProduction.segments) {
          setSegments(freshProduction.segments);
        }
        // etc. para todos los datos generados
      }
    }
  };
  
  loadProductionState();
}, [production.id]);
```

**3. Sincronización Continua**
```typescript
// Polling cada 2 segundos para detectar cambios externos
useEffect(() => {
  const syncInterval = setInterval(async () => {
    if (production.id) {
      const fresh = await getProductionById(production.id);
      if (fresh && JSON.stringify(fresh) !== JSON.stringify(wizardProduction)) {
        // Hay cambios, actualizar
        setWizardProduction(fresh);
        // Actualizar UI según el paso actual
        if (fresh.wizard_state?.currentStep) {
          // Verificar si hay datos nuevos para mostrar
          checkAndDisplayNewData(fresh);
        }
      }
    }
  }, 2000);
  
  return () => clearInterval(syncInterval);
}, [production.id]);
```

**4. Debugging y Logging**
```typescript
// Añadir logging detallado
logger.info('wizard', 'Step completed', {
  step,
  productionId: production.id,
  dataKeys: Object.keys(data),
  wizardState: wizardProduction.wizard_state
});

// Verificar que se guardó correctamente
const verifySave = async () => {
  const saved = await getProductionById(production.id);
  if (!saved.wizard_state?.[step]?.status === 'completed') {
    logger.error('wizard', 'State not saved correctly', { step });
    // Retry save
  }
};
```

**Archivos a Modificar:**
- `components/ProductionWizard.tsx` - Añadir carga de estado al montar
- `services/supabaseService.ts` - Verificar que `saveProduction` guarda wizard_state correctamente
- Añadir función `syncProductionState()` para sincronización continua

---

### 🔴 CRÍTICO 2: Inconsistencia en TTS (ElevenLabs vs OpenAI)
**Prioridad**: URGENTE | **Impacto**: CRÍTICO | **Esfuerzo**: Bajo | **Estado**: BLOQUEANTE

#### Problema
Para ArgenNews, el audio no está funcionando bien. A veces algunas escenas salen con ElevenLabs TTS y otras con OpenAI, causando inconsistencia de voces.

#### Causa Raíz Probable
- La configuración de `ttsProvider` no se está respetando consistentemente
- El código está usando fallback a OpenAI cuando ElevenLabs falla sin notificar
- No se está cargando la configuración fresca antes de generar audio
- El caché de audio puede estar mezclando providers

#### Solución Detallada

**1. Forzar Carga de Configuración Fresca**
```typescript
// En geminiService.ts - generateSingleAudio
const generateSingleAudio = async (
  text: string,
  voiceName: string,
  channelId: string,
  label: string,
  language?: string,
  ttsProvider?: 'openai' | 'elevenlabs',
  elevenLabsVoiceId?: string
) => {
  // CRÍTICO: Cargar configuración fresca desde DB
  const channel = await getChannelById(channelId);
  const freshConfig = channel?.config;
  
  if (!freshConfig) {
    throw new Error('Channel config not found');
  }
  
  // Usar provider de la configuración, no del parámetro
  const effectiveProvider = freshConfig.ttsProvider || ttsProvider || 'openai';
  
  // Validar que ElevenLabs está configurado si se requiere
  if (effectiveProvider === 'elevenlabs') {
    const character = determineCharacter(voiceName, freshConfig);
    if (!character.elevenLabsVoiceId) {
      logger.error('audio', 'ElevenLabs voiceId missing', {
        character: character.name,
        channelId
      });
      throw new Error(`ElevenLabs voiceId not configured for ${character.name}`);
    }
  }
  
  // Continuar con generación...
};
```

**2. Validación Estricta de Provider**
```typescript
// Añadir validación antes de generar
const validateTTSProvider = (config: ChannelConfig, characterKey: 'hostA' | 'hostB') => {
  const character = config.characters[characterKey];
  const provider = config.ttsProvider || 'openai';
  
  if (provider === 'elevenlabs') {
    if (!character.elevenLabsVoiceId) {
      throw new Error(
        `ElevenLabs voiceId required for ${character.name} but not configured. ` +
        `Please configure in Admin Dashboard > Channel Settings.`
      );
    }
    
    // Verificar que la API key está disponible
    if (!checkElevenLabsConfig().configured) {
      throw new Error('ElevenLabs API key not configured');
    }
  }
  
  return provider;
};
```

**3. Caché Separado por Provider**
```typescript
// En supabaseService.ts - findCachedAudio
export const findCachedAudio = async (
  text: string,
  voiceKey: string, // Debe incluir provider: "elevenlabs:voiceId" o "openai:voiceName"
  channelId: string
): Promise<CachedAudioResult | null> => {
  // CRÍTICO: El voiceKey ya debe incluir el provider
  // Si no lo incluye, añadirlo basado en la configuración
  const channel = await getChannelById(channelId);
  const config = channel?.config;
  
  if (!config) return null;
  
  // Asegurar que voiceKey incluye provider
  let effectiveVoiceKey = voiceKey;
  if (!voiceKey.includes(':')) {
    // No tiene provider, añadirlo
    const provider = config.ttsProvider || 'openai';
    if (provider === 'elevenlabs') {
      const character = determineCharacterFromVoice(voiceKey, config);
      effectiveVoiceKey = `elevenlabs:${character.elevenLabsVoiceId || voiceKey}`;
    } else {
      effectiveVoiceKey = `openai:${voiceKey}`;
    }
  }
  
  // Buscar en caché con el voiceKey correcto
  const textHash = createTextHash(text);
  const { data } = await supabase
    .from('audio_cache')
    .select('*')
    .eq('channel_id', channelId)
    .eq('text_hash', textHash)
    .eq('voice_key', effectiveVoiceKey) // CRÍTICO: Incluir provider
    .single();
  
  // ... resto del código
};
```

**4. Logging Detallado para Debug**
```typescript
// Añadir logging en cada punto de decisión
logger.info('audio', 'TTS Provider Decision', {
  channelId,
  requestedProvider: ttsProvider,
  configProvider: freshConfig.ttsProvider,
  effectiveProvider,
  character: characterKey,
  voiceId: character.elevenLabsVoiceId,
  voiceName: character.voiceName
});
```

**5. UI de Advertencia**
```typescript
// En ProductionWizard - Mostrar advertencia si hay inconsistencia
const checkTTSConsistency = (segments: BroadcastSegment[], config: ChannelConfig) => {
  const issues = [];
  
  segments.forEach((segment, index) => {
    const character = segment.speaker === config.characters.hostA.name ? 'hostA' : 'hostB';
    const expectedProvider = config.ttsProvider || 'openai';
    
    // Verificar que el audio generado usa el provider correcto
    // (esto requiere tracking del provider usado en segment)
    if (segment.audioProvider && segment.audioProvider !== expectedProvider) {
      issues.push({
        segmentIndex: index,
        expected: expectedProvider,
        actual: segment.audioProvider,
        character
      });
    }
  });
  
  if (issues.length > 0) {
    toast.error(
      `⚠️ Inconsistencia de TTS detectada en ${issues.length} segmento(s). ` +
      `Algunos usan ${issues[0].actual} en lugar de ${issues[0].expected}.`
    );
  }
};
```

**Archivos a Modificar:**
- `services/geminiService.ts` - `generateSingleAudio()` - Forzar carga de config fresca
- `services/supabaseService.ts` - `findCachedAudio()` - Separar caché por provider
- `components/ProductionWizard.tsx` - Validar consistencia y mostrar advertencias
- Añadir campo `audioProvider` a `BroadcastSegment` para tracking

---

### 🔴 CRÍTICO 3: Scripts Largos y Poco Virales
**Prioridad**: URGENTE | **Impacto**: CRÍTICO | **Esfuerzo**: Medio | **Estado**: BLOQUEANTE

#### Problema
Los scripts generados suelen ser largos y poco virales. Hay que pasarlos bastantes veces por el mejorador para que mejore. El average watch time es MUY BAJO (14-19%) cuando debería estar en 80%.

#### Causa Raíz Probable
- El prompt del scriptwriter no está optimizado para viralidad
- Las estructuras narrativas no están diseñadas para retención
- Falta de análisis de scripts exitosos
- No se está aplicando el mejorador automáticamente
- Los hooks no son suficientemente atractivos

#### Solución Detallada

**1. Mejorar Prompt del Scriptwriter con Enfoque en Viralidad**
```typescript
// En openaiService.ts - generateScriptWithGPT
const VIRAL_SCRIPT_PROMPT = `
CRITICAL VIRALITY RULES (MUST FOLLOW):

1. HOOK (First 3 seconds):
   - MUST start with a shocking statement, question, or number
   - Example: "This company just lost $50 BILLION in one day"
   - Example: "Why is everyone selling? Here's what they're hiding"
   - NEVER start with "Today we're talking about..." or "Let's discuss..."

2. RETENTION TECHNIQUES:
   - End each scene with a "curiosity gap" that makes viewer want to continue
   - Use "but wait, there's more..." patterns
   - Create "information debt" - promise answers later
   - Use cliffhangers between scenes

3. PACING:
   - First 10 seconds: HIGH ENERGY, fast-paced
   - Middle: Steady information delivery
   - Last 10 seconds: Strong conclusion with call-to-action
   - NO dead air, NO slow moments

4. LENGTH OPTIMIZATION:
   - Target: 45-60 seconds total (NOT 90+ seconds)
   - Each scene: 6-10 seconds MAX
   - Cut unnecessary words ruthlessly
   - One key point per scene

5. ENGAGEMENT HOOKS:
   - Use numbers and statistics: "$2.3 billion", "47% drop"
   - Create contrast: "Everyone thinks X, but Y is happening"
   - Use emotional triggers: "This is INSANE", "You won't believe this"
   - Add urgency: "This is happening RIGHT NOW"

6. STRUCTURE FOR RETENTION:
   - Scene 1 (Hook): Shocking opening (3-5s)
   - Scene 2: Quick context (4-6s)
   - Scene 3: The twist/revelation (5-7s)
   - Scene 4: Why it matters (4-6s)
   - Scene 5: Implications (4-6s)
   - Scene 6: Strong conclusion + CTA (5-7s)

7. DIALOGUE RULES:
   - Short, punchy sentences (5-10 words max)
   - NO long explanations
   - Use contractions for natural flow
   - Alternate hosts every 1-2 sentences (NOT every paragraph)

CRITICAL: If the script is longer than 60 seconds when read at normal pace, 
it's TOO LONG. Cut it down immediately.
`;
```

**2. Análisis Automático de Retención**
```typescript
// Nuevo servicio: scriptRetentionAnalyzer.ts
export const analyzeScriptRetention = async (
  scriptWithScenes: ScriptWithScenes
): Promise<RetentionAnalysis> => {
  const analysis = {
    estimatedDuration: 0,
    hookStrength: 0,
    retentionScore: 0,
    issues: [] as string[],
    suggestions: [] as string[]
  };
  
  // Calcular duración estimada
  Object.values(scriptWithScenes.scenes).forEach(scene => {
    const wordCount = scene.text.split(' ').length;
    const estimatedSeconds = wordCount / 2.5; // ~150 palabras por minuto
    analysis.estimatedDuration += estimatedSeconds;
  });
  
  // Analizar hook
  const firstScene = scriptWithScenes.scenes['1'];
  if (firstScene) {
    const hookText = firstScene.text.toLowerCase();
    
    // Verificar elementos virales en hook
    const hasNumber = /\d+/.test(hookText);
    const hasShockWord = /shocking|insane|crazy|unbelievable|secret|hidden/.test(hookText);
    const hasQuestion = hookText.includes('?');
    const isShort = firstScene.text.split(' ').length < 20;
    
    analysis.hookStrength = (hasNumber ? 25 : 0) + 
                           (hasShockWord ? 25 : 0) + 
                           (hasQuestion ? 25 : 0) + 
                           (isShort ? 25 : 0);
    
    if (analysis.hookStrength < 50) {
      analysis.issues.push('Hook is weak - needs more viral elements');
      analysis.suggestions.push('Add a number, shocking word, or question to hook');
    }
  }
  
  // Verificar duración
  if (analysis.estimatedDuration > 60) {
    analysis.issues.push(`Script too long: ${analysis.estimatedDuration.toFixed(1)}s (target: 45-60s)`);
    analysis.suggestions.push('Cut scenes or reduce dialogue length');
  }
  
  // Calcular retention score
  analysis.retentionScore = calculateRetentionScore(scriptWithScenes, analysis);
  
  return analysis;
};
```

**3. Mejorador Automático con Múltiples Iteraciones**
```typescript
// En openaiService.ts - Mejorador automático
export const autoImproveScript = async (
  scriptWithScenes: ScriptWithScenes,
  news: NewsItem[],
  config: ChannelConfig,
  maxIterations: number = 3
): Promise<ScriptWithScenes> => {
  let currentScript = scriptWithScenes;
  let iteration = 0;
  let retentionScore = 0;
  
  while (iteration < maxIterations) {
    // Analizar script actual
    const analysis = await analyzeScriptRetention(currentScript);
    retentionScore = analysis.retentionScore;
    
    // Si ya es bueno, parar
    if (retentionScore >= 80) {
      logger.info('script', `Script optimized in ${iteration} iterations`, {
        finalScore: retentionScore
      });
      break;
    }
    
    // Generar mejoras
    const improvements = {
      implement: [
        ...analysis.suggestions,
        `Increase retention score from ${retentionScore}% to 80%+`,
        `Reduce total duration to 45-60 seconds`,
        `Strengthen hook with viral elements`,
        `Add more curiosity gaps between scenes`
      ],
      maintain: [
        'Keep the core message',
        'Maintain character personalities',
        'Keep factual accuracy'
      ]
    };
    
    // Regenerar con mejoras
    currentScript = await generateScriptWithGPT(
      news,
      config,
      undefined,
      improvements
    );
    
    iteration++;
  }
  
  return currentScript;
};
```

**4. Estructuras Narrativas Optimizadas para Retención**
```typescript
// Nuevas estructuras optimizadas
const RETENTION_OPTIMIZED_STRUCTURES = {
  // Estructura ultra-compacta para máximo engagement
  viral_compact: {
    scenes: 4,
    targetDuration: 45,
    structure: [
      { type: 'hook', duration: 5, shot: 'closeup', energy: 'high' },
      { type: 'revelation', duration: 12, shot: 'closeup', energy: 'high' },
      { type: 'impact', duration: 15, shot: 'medium', energy: 'medium' },
      { type: 'cta', duration: 13, shot: 'wide', energy: 'high' }
    ]
  },
  
  // Estructura con múltiples hooks
  multi_hook: {
    scenes: 5,
    targetDuration: 55,
    structure: [
      { type: 'hook1', duration: 6, shot: 'closeup' },
      { type: 'context', duration: 10, shot: 'medium' },
      { type: 'hook2', duration: 8, shot: 'closeup' }, // Segundo hook
      { type: 'analysis', duration: 18, shot: 'medium' },
      { type: 'cta', duration: 13, shot: 'wide' }
    ]
  }
};
```

**5. Validación Pre-Generación**
```typescript
// Validar antes de aceptar script
const validateScriptForVirality = (script: ScriptWithScenes): ValidationResult => {
  const issues: string[] = [];
  const warnings: string[] = [];
  
  // Verificar duración
  const totalWords = Object.values(script.scenes).reduce(
    (sum, scene) => sum + scene.text.split(' ').length, 0
  );
  const estimatedSeconds = totalWords / 2.5;
  
  if (estimatedSeconds > 60) {
    issues.push(`TOO LONG: ${estimatedSeconds.toFixed(1)}s (max 60s)`);
  }
  
  // Verificar hook
  const hook = script.scenes['1'];
  if (hook) {
    const hookWords = hook.text.split(' ').length;
    if (hookWords > 20) {
      issues.push(`Hook too long: ${hookWords} words (max 20)`);
    }
    
    if (!/\d+/.test(hook.text) && !/[?!]/.test(hook.text)) {
      warnings.push('Hook missing numbers or questions - may reduce CTR');
    }
  }
  
  // Verificar pacing
  Object.entries(script.scenes).forEach(([num, scene]) => {
    const words = scene.text.split(' ').length;
    if (words > 40) {
      warnings.push(`Scene ${num} is long: ${words} words`);
    }
  });
  
  return {
    valid: issues.length === 0,
    issues,
    warnings,
    estimatedDuration: estimatedSeconds
  };
};
```

**Archivos a Modificar:**
- `services/openaiService.ts` - Mejorar prompt con reglas de viralidad
- `services/geminiService.ts` - Añadir `autoImproveScript()`
- Crear `services/scriptRetentionAnalyzer.ts` - Análisis de retención
- `components/ProductionWizard.tsx` - Aplicar mejorador automático
- Añadir validación antes de aceptar script

---

### 🔴 CRÍTICO 4: Edición de Video Final Deficiente
**Prioridad**: URGENTE | **Impacto**: CRÍTICO | **Esfuerzo**: Alto | **Estado**: BLOQUEANTE

#### Problema
La edición de los videos finales es bastante mala:
- Faltan sonidos
- Falta música
- Los subtítulos son chicos
- Los textos son chicos y feos
- Espacios vacíos de video sin audio
- Escenas pisadas (overlapping)

#### Causa Raíz Probable
- El servicio de composición (Shotstack) no está configurado correctamente
- Los segmentos de audio/video no están sincronizados
- Los overlays (subtítulos, textos) no están bien configurados
- Falta validación de duraciones antes de componer
- No se están añadiendo efectos de sonido y música correctamente

#### Solución Detallada

**1. Validación de Sincronización Audio-Video**
```typescript
// En shotstackService.ts - Validar antes de renderizar
const validateSegmentsForComposition = (
  segments: BroadcastSegment[],
  videoUrls: string[]
): ValidationResult => {
  const issues: string[] = [];
  
  segments.forEach((segment, index) => {
    const videoUrl = videoUrls[index];
    
    // Verificar que existe video
    if (!videoUrl) {
      issues.push(`Segment ${index + 1}: Missing video URL`);
    }
    
    // Verificar que existe audio
    if (!segment.audioUrl && !segment.audioBase64) {
      issues.push(`Segment ${index + 1}: Missing audio`);
    }
    
    // Verificar duraciones coinciden
    if (segment.audioDuration && videoUrl) {
      // Obtener duración del video (requiere API call o metadata)
      // Si no coinciden, es un problema
      const durationDiff = Math.abs(segment.audioDuration - expectedVideoDuration);
      if (durationDiff > 0.5) {
        issues.push(
          `Segment ${index + 1}: Audio (${segment.audioDuration}s) and video durations don't match`
        );
      }
    }
  });
  
  return {
    valid: issues.length === 0,
    issues
  };
};
```

**2. Composición Mejorada con Audio Continuo**
```typescript
// En shotstackService.ts - renderPodcastVideo mejorado
export const renderPodcastVideo = async (
  scenes: PodcastScene[],
  config: ChannelConfig,
  channelId: string,
  productionId: string
): Promise<RenderResult> => {
  // 1. Validar todos los segmentos
  const validation = validateSegmentsForComposition(scenes, scenes.map(s => s.videoUrl));
  if (!validation.valid) {
    throw new Error(`Composition validation failed: ${validation.issues.join(', ')}`);
  }
  
  // 2. Construir timeline preciso
  let currentTime = 0;
  const clips: VideoClip[] = [];
  const audioTracks: AudioClip[] = [];
  
  scenes.forEach((scene, index) => {
    const audioDuration = scene.audioDuration || 5; // Fallback
    
    // Video clip
    clips.push({
      url: scene.videoUrl,
      start: currentTime,
      length: audioDuration, // Usar duración de audio como referencia
      fit: 'cover',
      volume: 1.0,
      effect: getTransitionEffect(index, scenes.length),
      filter: 'none'
    });
    
    // Audio clip (CRÍTICO: Asegurar que hay audio)
    if (scene.audioUrl) {
      audioTracks.push({
        url: scene.audioUrl,
        start: currentTime,
        length: audioDuration,
        volume: 1.0
      });
    } else {
      logger.error('composition', `Scene ${index + 1} missing audio URL`);
      throw new Error(`Scene ${index + 1} is missing audio - cannot compose`);
    }
    
    // Añadir efecto de sonido si está configurado
    if (scene.soundEffect && scene.soundEffect.url) {
      audioTracks.push({
        url: scene.soundEffect.url,
        start: currentTime + (scene.soundEffect.startTime === 'start' ? 0 : 
              scene.soundEffect.startTime === 'end' ? audioDuration - (scene.soundEffect.duration || 0.5) :
              typeof scene.soundEffect.startTime === 'number' ? scene.soundEffect.startTime : 0),
        length: scene.soundEffect.duration || 0.5,
        volume: (scene.soundEffect.volume || 0.4) * 1.0 // Ajustar volumen
      });
    }
    
    currentTime += audioDuration;
    
    // Añadir transición (si no es la última)
    if (index < scenes.length - 1) {
      const transitionDuration = 0.3;
      currentTime -= transitionDuration; // Overlap para transición suave
    }
  });
  
  // 3. Añadir música de fondo si está configurada
  if (config.renderConfig?.backgroundMusic?.enabled && 
      config.renderConfig.backgroundMusic.url) {
    const totalDuration = currentTime;
    audioTracks.push({
      url: config.renderConfig.backgroundMusic.url,
      start: 0,
      length: totalDuration,
      volume: config.renderConfig.backgroundMusic.volume || 0.1
    });
  }
  
  // 4. Configurar subtítulos mejorados
  const textOverlays: TextOverlay[] = scenes.map((scene, index) => {
    const audioDuration = scene.audioDuration || 5;
    const startTime = clips.slice(0, index).reduce((sum, clip) => sum + (clip.length || 0), 0);
    
    return {
      text: scene.dialogue, // O scene.title para lower third
      start: startTime,
      length: audioDuration,
      style: config.renderConfig?.overlays?.subtitleStyle || 'boxed',
      position: config.renderConfig?.overlays?.subtitlePosition || 'bottom',
      size: 'large', // CRÍTICO: Cambiar a 'large' en lugar de 'small'
      color: '#FFFFFF',
      // Añadir stroke para legibilidad
      stroke: {
        color: '#000000',
        width: 2
      },
      // Añadir background semi-transparente
      background: {
        color: 'rgba(0, 0, 0, 0.7)',
        padding: 8
      }
    };
  });
  
  // 5. Añadir lower thirds mejorados
  const lowerThirds: TextOverlay[] = scenes
    .filter(scene => scene.title)
    .map((scene, index) => {
      const startTime = clips.slice(0, index).reduce((sum, clip) => sum + (clip.length || 0), 0);
      const audioDuration = scene.audioDuration || 5;
      
      return {
        text: scene.title!,
        start: startTime,
        length: Math.min(audioDuration, 3), // Mostrar solo primeros 3 segundos
        style: 'blockbuster', // Estilo más llamativo
        position: 'bottom',
        size: 'large', // CRÍTICO: Grande y legible
        color: config.renderConfig?.newsStyle?.lowerThird?.textColor || '#FFFFFF',
        background: {
          color: config.renderConfig?.newsStyle?.lowerThird?.primaryColor || '#FF0000',
          padding: 12
        }
      };
    });
  
  // 6. Crear composición
  const composition: CompositionConfig = {
    clips,
    audioTrack: audioTracks.length === 1 ? audioTracks[0] : undefined, // Si solo uno, usar audioTrack
    // Si múltiples, combinar en post o usar audio mixing
    textOverlays: [...textOverlays, ...lowerThirds],
    resolution: config.renderConfig?.output?.resolution || '1080',
    aspectRatio: config.format,
    fps: config.renderConfig?.output?.fps || 30,
    transition: {
      type: config.renderConfig?.transition?.type || 'fade',
      duration: config.renderConfig?.transition?.duration || 0.3
    }
  };
  
  // Si hay múltiples audio tracks, necesitamos combinarlos primero
  // (Shotstack puede manejar múltiples tracks, verificar documentación)
  
  return await createComposition(composition);
};
```

**3. Detección y Corrección de Espacios Vacíos**
```typescript
// Detectar gaps en timeline
const detectAudioGaps = (scenes: PodcastScene[]): Gap[] => {
  const gaps: Gap[] = [];
  let currentTime = 0;
  
  scenes.forEach((scene, index) => {
    const audioDuration = scene.audioDuration || 0;
    const videoDuration = scene.videoDuration || 0;
    
    // Si el video es más largo que el audio, hay gap
    if (videoDuration > audioDuration + 0.5) {
      gaps.push({
        sceneIndex: index,
        start: currentTime + audioDuration,
        end: currentTime + videoDuration,
        duration: videoDuration - audioDuration
      });
    }
    
    currentTime += Math.max(audioDuration, videoDuration);
  });
  
  return gaps;
};

// Rellenar gaps con música o silencio procesado
const fillAudioGaps = (gaps: Gap[], config: ChannelConfig): AudioClip[] => {
  return gaps.map(gap => {
    if (config.renderConfig?.backgroundMusic?.enabled) {
      // Usar música de fondo para rellenar
      return {
        url: config.renderConfig.backgroundMusic.url!,
        start: gap.start,
        length: gap.duration,
        volume: (config.renderConfig.backgroundMusic.volume || 0.1) * 1.5 // Aumentar en gaps
      };
    } else {
      // Generar silencio procesado (no completamente mudo)
      // O mejor: extender audio anterior con fade
      return null; // Skip - mejor cortar video
    }
  }).filter(Boolean) as AudioClip[];
};
```

**4. Configuración de Subtítulos Mejorada**
```typescript
// Configuración por defecto mejorada
const DEFAULT_SUBTITLE_CONFIG = {
  style: 'boxed' as const,
  position: 'bottom' as const,
  size: 'large' as const, // CRÍTICO: Cambiar de 'small' a 'large'
  color: '#FFFFFF',
  fontSize: 48, // Añadir tamaño explícito en píxeles
  fontFamily: 'Arial Black', // Fuente más legible
  stroke: {
    color: '#000000',
    width: 3 // Stroke más grueso para legibilidad
  },
  background: {
    color: 'rgba(0, 0, 0, 0.8)', // Fondo más opaco
    padding: 16 // Más padding
  },
  animation: 'fadeInOut' // Animación suave
};
```

**5. Validación Pre-Render**
```typescript
// Validar antes de renderizar
const validateComposition = (composition: CompositionConfig): ValidationResult => {
  const issues: string[] = [];
  
  // Verificar que todos los clips tienen audio
  composition.clips.forEach((clip, index) => {
    const hasAudio = composition.audioTrack || 
                     composition.clips.some(c => c.volume && c.volume > 0);
    
    if (!hasAudio) {
      issues.push(`Clip ${index + 1} has no audio`);
    }
  });
  
  // Verificar que no hay overlaps problemáticos
  let currentEnd = 0;
  composition.clips.forEach((clip, index) => {
    if (clip.start < currentEnd - 0.1) { // Permitir pequeño overlap para transiciones
      issues.push(`Clip ${index + 1} overlaps significantly with previous clip`);
    }
    currentEnd = clip.start + (clip.length || 0);
  });
  
  // Verificar subtítulos
  if (composition.textOverlays) {
    composition.textOverlays.forEach((overlay, index) => {
      if (overlay.size === 'small') {
        issues.push(`Text overlay ${index + 1} is too small - use 'large'`);
      }
    });
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
};
```

**Archivos a Modificar:**
- `services/shotstackService.ts` - Mejorar `renderPodcastVideo()` completamente
- Añadir `validateSegmentsForComposition()`
- Añadir `detectAudioGaps()` y `fillAudioGaps()`
- Añadir `validateComposition()`
- Actualizar configuración de subtítulos por defecto

---

### 🔴 CRÍTICO 5: Falta Dinamismo en Cámaras
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

#### Problema
Falta dinamismo en las cámaras para hacerlo bien dinámico. Las escenas se ven estáticas.

#### Solución Detallada

**1. Sistema de Movimiento de Cámara Automático**
```typescript
// En sceneBuilderService.ts - Añadir movimiento de cámara
interface CameraMovement {
  type: 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'zoom' | 'static';
  intensity: 'subtle' | 'moderate' | 'pronounced';
  duration: number;
  startTime: number;
}

const generateCameraMovements = (
  scene: Scene,
  sceneIndex: number,
  totalScenes: number
): CameraMovement[] => {
  const movements: CameraMovement[] = [];
  
  // Push in para momentos importantes
  if (sceneIndex === 0 || scene.shot === 'closeup') {
    movements.push({
      type: 'push_in',
      intensity: 'subtle',
      duration: scene.audioDuration || 5,
      startTime: 0
    });
  }
  
  // Pull out para payoffs
  if (sceneIndex === totalScenes - 1) {
    movements.push({
      type: 'pull_out',
      intensity: 'moderate',
      duration: 2,
      startTime: (scene.audioDuration || 5) - 2
    });
  }
  
  // Pan sutil para dinamismo
  if (sceneIndex % 2 === 0) {
    movements.push({
      type: 'pan_right',
      intensity: 'subtle',
      duration: scene.audioDuration || 5,
      startTime: 0
    });
  }
  
  return movements;
};
```

**2. Aplicar Movimientos en Shotstack**
```typescript
// Añadir transformaciones de cámara a clips
clips.push({
  url: scene.videoUrl,
  start: currentTime,
  length: audioDuration,
  fit: 'cover',
  // Añadir transformaciones para movimiento
  transform: {
    scale: cameraMovement.type === 'zoom' ? 1.1 : 1.0,
    // Shotstack puede tener soporte para keyframes de transform
  },
  // Añadir motion effects
  motion: cameraMovement.type === 'push_in' ? 'zoomInSlow' : 
          cameraMovement.type === 'pull_out' ? 'zoomOutSlow' : undefined
});
```

**Archivos a Modificar:**
- `services/sceneBuilderService.ts` - Añadir generación de movimientos
- `services/shotstackService.ts` - Aplicar movimientos a clips

---

### 🔴 CRÍTICO 6: Estructuras Narrativas con Baja Retención
**Prioridad**: URGENTE | **Impacto**: CRÍTICO | **Esfuerzo**: Alto | **Estado**: BLOQUEANTE

#### Problema
Las estructuras narrativas no están funcionando bien. El average watch time es MUY BAJO (14-19%) cuando debería estar en 80%.

#### Solución Detallada

**1. Rediseñar Estructuras para Máxima Retención**
```typescript
// Nuevas estructuras optimizadas para retención
const RETENTION_OPTIMIZED_STRUCTURES = {
  viral_hook_heavy: {
    name: 'Viral Hook Heavy',
    scenes: 5,
    targetDuration: 50,
    retentionTarget: 85,
    structure: [
      {
        number: 1,
        type: 'hook',
        duration: 4,
        shot: 'extreme_closeup',
        energy: 'very_high',
        technique: 'shocking_statement',
        retentionHook: 'curiosity_gap'
      },
      {
        number: 2,
        type: 'context',
        duration: 8,
        shot: 'closeup',
        energy: 'high',
        technique: 'quick_setup',
        retentionHook: 'promise_of_revelation'
      },
      {
        number: 3,
        type: 'revelation',
        duration: 12,
        shot: 'medium',
        energy: 'high',
        technique: 'the_twist',
        retentionHook: 'implications_teaser'
      },
      {
        number: 4,
        type: 'impact',
        duration: 14,
        shot: 'medium',
        energy: 'medium',
        technique: 'why_it_matters',
        retentionHook: 'what_happens_next'
      },
      {
        number: 5,
        type: 'cta',
        duration: 12,
        shot: 'wide',
        energy: 'high',
        technique: 'strong_conclusion',
        retentionHook: 'call_to_action'
      }
    ]
  },
  
  question_driven: {
    name: 'Question Driven',
    scenes: 4,
    targetDuration: 45,
    retentionTarget: 80,
    structure: [
      { number: 1, type: 'provocative_question', duration: 5, retentionHook: 'answer_coming' },
      { number: 2, type: 'unexpected_answer', duration: 12, retentionHook: 'but_wait' },
      { number: 3, type: 'deeper_truth', duration: 16, retentionHook: 'full_picture' },
      { number: 4, type: 'implications', duration: 12, retentionHook: 'what_you_should_do' }
    ]
  }
};
```

**2. Análisis de Retención por Estructura**
```typescript
// Analizar qué estructuras funcionan mejor
const analyzeNarrativeRetention = async (): Promise<NarrativeRetentionData> => {
  // Obtener datos de producciones completadas
  const productions = await getAllProductions(channelId);
  
  const byNarrative: Record<string, RetentionStats> = {};
  
  productions.forEach(prod => {
    if (prod.narrative_used && prod.youtube_id) {
      // Obtener analytics de YouTube
      const analytics = await getYouTubeAnalytics(prod.youtube_id);
      
      if (!byNarrative[prod.narrative_used]) {
        byNarrative[prod.narrative_used] = {
          count: 0,
          avgRetention: 0,
          avgViews: 0,
          totalRetention: 0
        };
      }
      
      byNarrative[prod.narrative_used].count++;
      byNarrative[prod.narrative_used].totalRetention += analytics.avgViewPercentage || 0;
      byNarrative[prod.narrative_used].avgViews += analytics.views || 0;
    }
  });
  
  // Calcular promedios
  Object.keys(byNarrative).forEach(narrative => {
    const stats = byNarrative[narrative];
    stats.avgRetention = stats.totalRetention / stats.count;
    stats.avgViews = stats.avgViews / stats.count;
  });
  
  return byNarrative;
};
```

**3. Selección Inteligente de Estructura**
```typescript
// Seleccionar estructura basada en datos de retención
const selectOptimalNarrative = async (
  news: NewsItem[],
  channelId: string
): Promise<NarrativeType> => {
  // Obtener datos de retención
  const retentionData = await analyzeNarrativeRetention();
  
  // Analizar tipo de noticia
  const newsType = analyzeNewsType(news);
  
  // Seleccionar estructura con mejor retención para tipo similar
  const bestNarrative = Object.entries(retentionData)
    .sort((a, b) => b[1].avgRetention - a[1].avgRetention)[0][0] as NarrativeType;
  
  // Si ninguna estructura tiene >70% retención, usar nueva optimizada
  if (retentionData[bestNarrative].avgRetention < 70) {
    return 'viral_hook_heavy'; // Nueva estructura optimizada
  }
  
  return bestNarrative;
};
```

**4. Ajuste Dinámico de Escenas Durante Generación**
```typescript
// Ajustar estructura según feedback en tiempo real
const generateScriptWithRetentionOptimization = async (
  news: NewsItem[],
  config: ChannelConfig
): Promise<ScriptWithScenes> => {
  // Generar script inicial
  let script = await generateScriptWithGPT(news, config);
  
  // Analizar retención estimada
  let analysis = await analyzeScriptRetention(script);
  let iterations = 0;
  
  // Iterar hasta alcanzar 80%+ retención estimada
  while (analysis.retentionScore < 80 && iterations < 5) {
    const improvements = {
      implement: [
        `Increase retention from ${analysis.retentionScore}% to 80%+`,
        ...analysis.suggestions,
        'Add more hooks throughout the script',
        'Create stronger curiosity gaps',
        'Reduce scene length for faster pacing'
      ],
      maintain: ['Core message', 'Character personalities']
    };
    
    script = await generateScriptWithGPT(news, config, undefined, improvements);
    analysis = await analyzeScriptRetention(script);
    iterations++;
  }
  
  return script;
};
```

**Archivos a Modificar:**
- `services/openaiService.ts` - Rediseñar estructuras narrativas
- Crear `services/narrativeRetentionAnalyzer.ts`
- `services/geminiService.ts` - Añadir selección inteligente de estructura
- `components/ProductionWizard.tsx` - Mostrar retención estimada

---

## 📊 Resumen de Problemas Críticos

| # | Problema | Prioridad | Impacto | Esfuerzo | Estado |
|---|----------|-----------|---------|----------|--------|
| 1 | Wizard no carga datos entre pasos | URGENTE | CRÍTICO | Medio | 🔴 BLOQUEANTE |
| 2 | Inconsistencia TTS (ElevenLabs/OpenAI) | URGENTE | CRÍTICO | Bajo | 🔴 BLOQUEANTE |
| 3 | Scripts largos y poco virales | URGENTE | CRÍTICO | Medio | 🔴 BLOQUEANTE |
| 4 | Edición de video deficiente | URGENTE | CRÍTICO | Alto | 🔴 BLOQUEANTE |
| 5 | Falta dinamismo en cámaras | Alta | Alto | Medio | 🟡 IMPORTANTE |
| 6 | Baja retención (14-19% vs 80%) | URGENTE | CRÍTICO | Alto | 🔴 BLOQUEANTE |

---

## 🎯 Plan de Acción Inmediato

### Semana 1 (Críticos 1-2)
- ✅ Arreglar wizard state persistence
- ✅ Arreglar inconsistencia de TTS
- ✅ Testing exhaustivo

### Semana 2 (Críticos 3-4)
- ✅ Mejorar prompts para viralidad
- ✅ Implementar mejorador automático
- ✅ Arreglar composición de video
- ✅ Añadir validaciones

### Semana 3 (Críticos 5-6)
- ✅ Añadir movimiento de cámara
- ✅ Rediseñar estructuras narrativas
- ✅ Implementar análisis de retención

### Semana 4 (Testing y Optimización)
- ✅ Testing completo end-to-end
- ✅ Ajustes basados en resultados
- ✅ Documentación de cambios

---

**NOTA CRÍTICA**: Estos problemas deben resolverse ANTES de implementar mejoras adicionales. Son bloqueantes para la funcionalidad básica de la aplicación.


## 🎨 Mejoras de Calidad Visual

### 1.1 Sistema de Seed Images Mejorado
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: Seed images estáticas pueden resultar repetitivas
- **Solución**:
  - Generar múltiples variantes de seed images (3-5 por personaje)
  - Rotar seed images según el tipo de escena (hook, conflict, payoff)
  - Crear seed images específicas para diferentes emociones
  - Implementar seed images dinámicas basadas en el contexto de la noticia

**Implementación**:
```typescript
interface SeedImageVariants {
  hostA: {
    neutral: string[];
    dramatic: string[];
    comedic: string[];
    serious: string[];
  };
  hostB: {
    energetic: string[];
    analytical: string[];
    empathetic: string[];
    playful: string[];
  };
}
```

### 1.2 Mejora de Consistencia Visual
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Bajo

- **Problema**: Inconsistencias visuales entre escenas
- **Solución**:
  - Implementar sistema de "visual continuity tracking"
  - Guardar referencia visual de cada escena generada
  - Usar referencia visual previa como base para siguiente escena
  - Añadir campo `previous_scene_reference` en metadata

### 1.3 Calidad de Renderizado Mejorada
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Videos pueden verse pixelados o con baja calidad
- **Solución**:
  - Aumentar resolución a 1080p por defecto (actualmente 720p)
  - Implementar upscaling con IA (Real-ESRGAN o similar) para videos finales
  - Añadir opción de 4K para producciones premium
  - Mejorar bitrate en composición final

### 1.4 Iluminación Dinámica
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Medio

- **Problema**: Iluminación estática puede ser aburrida
- **Solución**:
  - Variar iluminación según el mood de la escena
  - Implementar "lighting transitions" entre escenas
  - Añadir efectos de luz dinámicos (pulsos, cambios de color)
  - Crear sistema de "lighting presets" por tipo de narrativa

---

## ✂️ Mejoras de Edición y Post-Producción

### 2.1 Transiciones Avanzadas
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: Transiciones básicas (fade) son repetitivas
- **Solución**:
  - Implementar transiciones contextuales:
    - **Whip pan** para cambios de tema dramáticos
    - **Zoom transition** para énfasis
    - **Split screen** para comparaciones
    - **Match cut** para continuidad visual
  - Añadir transiciones personalizadas por tipo de escena
  - Crear "transition library" con 10+ opciones

**Implementación**:
```typescript
type AdvancedTransition = 
  | 'whip_pan_left' | 'whip_pan_right'
  | 'zoom_in_transition' | 'zoom_out_transition'
  | 'split_screen' | 'match_cut'
  | 'glitch' | 'shutter' | 'morph'
  | 'time_remap' | 'speed_ramp';
```

### 2.2 Efectos Visuales Avanzados
**Prioridad**: Media | **Impacto**: Alto | **Esfuerzo**: Alto

- **Problema**: Falta de efectos visuales que capturen atención
- **Solución**:
  - Añadir efectos de texto animados (kinetic typography)
  - Implementar gráficos animados (charts, estadísticas)
  - Añadir efectos de partículas para momentos clave
  - Crear "lower thirds" animados con información contextual
  - Implementar "picture-in-picture" para mostrar noticias relacionadas

### 2.3 Color Grading Inteligente
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Medio

- **Problema**: Colores planos sin personalidad
- **Solución**:
  - Implementar LUTs (Look-Up Tables) por tipo de contenido
  - Añadir color grading automático según mood:
    - **Dramático**: Alto contraste, saturación reducida
    - **Optimista**: Colores cálidos, saturación aumentada
    - **Serio**: Tonos neutros, contraste moderado
  - Crear "color themes" por canal

### 2.4 Motion Graphics
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Alto

- **Problema**: Falta de elementos gráficos que mejoren comprensión
- **Solución**:
  - Añadir gráficos de datos animados
  - Implementar iconos y símbolos animados
  - Crear "info cards" flotantes con datos clave
  - Añadir "progress bars" para narrativas con múltiples puntos
  - Implementar "callouts" animados para estadísticas

---

## ⚡ Mejoras de Dinamismo

### 3.1 Variación de Ritmo
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Bajo

- **Problema**: Ritmo constante puede ser monótono
- **Solución**:
  - Implementar "pacing analysis" del guión
  - Variar velocidad de escenas según contenido:
    - **Hook**: Rápido (0.9x speed)
    - **Conflict**: Normal (1.0x speed)
    - **Payoff**: Lento (1.1x speed) para énfasis
  - Añadir "speed ramps" en momentos clave
  - Crear sistema de "rhythm detection" automático

### 3.2 Movimiento de Cámara Dinámico
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: Cámara estática es aburrida
- **Solución**:
  - Implementar movimientos de cámara sutiles:
    - **Slow push in** para momentos importantes
    - **Slow pull out** para revelaciones
    - **Slight pan** para dinamismo
    - **Parallax effect** con elementos de fondo
  - Añadir "camera shake" sutil para energía
  - Crear "camera movement presets" por tipo de escena

### 3.3 Variación de Longitud de Escenas
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Todas las escenas tienen duración similar
- **Solución**:
  - Implementar "scene length variation":
    - Escenas cortas (3-5s) para hooks y transiciones
    - Escenas medias (5-8s) para desarrollo
    - Escenas largas (8-12s) para payoffs importantes
  - Añadir "micro-cuts" (1-2s) para dinamismo
  - Crear algoritmo que optimice duración según contenido

### 3.4 Expresiones y Gestos Dinámicos
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Alto

- **Problema**: Personajes pueden verse estáticos
- **Solución**:
  - Mejorar prompts para incluir gestos específicos:
    - Manos gesticulando en puntos clave
    - Cambios de expresión facial más pronunciados
    - Movimientos de cabeza (asentir, negar)
    - Cambios de postura según el mood
  - Añadir "gesture library" por tipo de diálogo
  - Implementar "expression mapping" por emoción

---

## 🚀 Mejoras de Viralidad

### 4.1 Hook Optimizado con IA
**Prioridad**: Alta | **Impacto**: Muy Alto | **Esfuerzo**: Medio

- **Problema**: Hooks pueden no ser suficientemente atractivos
- **Solución**:
  - Implementar análisis de hooks virales de YouTube
  - Generar múltiples variantes de hook (5-10 opciones)
  - Añadir "hook testing" con predicción de CTR
  - Crear sistema de "hook optimization" basado en trending topics
  - Implementar "curiosity gap" automático

**Implementación**:
```typescript
interface ViralHook {
  variants: string[];
  predictedCTR: number;
  curiosityScore: number;
  trendingRelevance: number;
  emotionalImpact: 'high' | 'medium' | 'low';
}
```

### 4.2 Thumbnails A/B Testing
**Prioridad**: Alta | **Impacto**: Muy Alto | **Esfuerzo**: Medio

- **Problema**: Thumbnails generados pueden no ser óptimos
- **Solución**:
  - Generar 5-10 variantes de thumbnail por video
  - Implementar análisis de "thumbnail effectiveness"
  - Añadir elementos que aumenten CTR:
    - Caras grandes y expresivas
    - Texto llamativo
    - Colores contrastantes
    - Elementos de "curiosity"
  - Crear sistema de "thumbnail optimization" basado en datos

### 4.3 Títulos Optimizados para SEO
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Bajo

- **Problema**: Títulos pueden no ser optimizados para búsqueda
- **Solución**:
  - Implementar análisis de keywords trending
  - Añadir números y estadísticas en títulos
  - Crear títulos con "power words" (SHOCKING, SECRET, INSANE)
  - Optimizar longitud (50-60 caracteres ideal)
  - Añadir emojis estratégicos (opcional)

### 4.4 Descripción Optimizada
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Descripciones genéricas no ayudan al SEO
- **Solución**:
  - Añadir timestamps de secciones clave
  - Incluir keywords relevantes naturalmente
  - Añadir llamadas a la acción (CTA)
  - Incluir links a recursos relacionados
  - Optimizar primeros 125 caracteres (preview en búsqueda)

### 4.5 Tags Inteligentes
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Tags pueden no ser relevantes o suficientes
- **Solución**:
  - Generar tags basados en trending topics
  - Añadir tags de competidores exitosos
  - Incluir tags de nicho específico
  - Optimizar cantidad (8-12 tags ideal)
  - Añadir tags de "long-tail keywords"

### 4.6 Análisis de Competencia
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Alto

- **Problema**: No se analiza qué funciona en el nicho
- **Solución**:
  - Implementar scraper de videos exitosos del nicho
  - Analizar títulos, thumbnails y descripciones de top videos
  - Identificar patrones de éxito
  - Aplicar insights a generación de contenido

---

## ⚡ Mejoras de Velocidad y Performance

### 5.1 Generación Paralela Mejorada
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: Generación secuencial es lenta
- **Solución**:
  - Generar audio y video en paralelo (no secuencial)
  - Implementar "batch processing" para múltiples segmentos
  - Añadir "pre-generation" de recursos comunes
  - Crear "generation queue" inteligente

**Implementación**:
```typescript
// Generar múltiples segmentos en paralelo
const generateBatch = async (segments: Segment[]) => {
  const batches = chunk(segments, 3); // 3 a la vez
  for (const batch of batches) {
    await Promise.all(batch.map(segment => generateSegment(segment)));
  }
};
```

### 5.2 Caché Inteligente Mejorado
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: Caché actual puede no cubrir todos los casos
- **Solución**:
  - Implementar "fuzzy matching" para diálogos similares
  - Añadir caché de "partial matches" (reutilizar partes)
  - Crear "cache warming" para recursos comunes
  - Implementar "predictive caching" basado en patrones

### 5.3 Optimización de Polling
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Polling cada 10s puede ser ineficiente
- **Solución**:
  - Implementar "adaptive polling":
    - Inicio: cada 5s
    - Medio: cada 10s
    - Final: cada 15s
  - Añadir "exponential backoff" para polling
  - Implementar "webhook support" cuando esté disponible

### 5.4 Pre-generación de Recursos
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Medio

- **Problema**: Esperar por recursos durante producción
- **Solución**:
  - Pre-generar seed images comunes
  - Pre-generar efectos de sonido procesados
  - Crear "resource pool" de assets reutilizables
  - Implementar "background generation" de recursos probables

### 5.5 Compresión y Optimización
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Archivos grandes ralentizan uploads
- **Solución**:
  - Implementar compresión de audio (MP3 128kbps)
  - Optimizar videos antes de upload (H.264, CRF 23)
  - Añadir "progressive upload" para archivos grandes
  - Implementar "chunked upload" para mejor resiliencia

---

## 💰 Optimización de Recursos

### 6.1 Cost Tracking Mejorado
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Bajo

- **Problema**: No se optimiza según costos
- **Solución**:
  - Implementar "cost prediction" antes de generar
  - Añadir "budget limits" por producción
  - Crear "cost optimization suggestions"
  - Mostrar "cost breakdown" en tiempo real
  - Implementar "cost alerts" cuando se exceda presupuesto

### 6.2 Selección Inteligente de Resolución
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Siempre se usa 720p (más caro)
- **Solución**:
  - Usar 480p para escenas simples (ahorro 50%)
  - Usar 720p para escenas importantes
  - Implementar "quality tiers" configurables
  - Añadir "auto-downgrade" si se excede presupuesto

### 6.3 Reutilización de Assets
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: Se regeneran assets que podrían reutilizarse
- **Solución**:
  - Crear "asset library" compartida entre producciones
  - Implementar "asset similarity matching"
  - Añadir "asset versioning" para variaciones
  - Crear "asset marketplace" interno

### 6.4 Batch Processing Optimizado
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Medio

- **Problema**: Procesamiento individual es ineficiente
- **Solución**:
  - Agrupar requests similares
  - Implementar "batch discounts" cuando sea posible
  - Crear "processing windows" para mejor pricing
  - Añadir "queue optimization" para minimizar costos

---

## 📖 Variaciones Narrativas

### 7.1 Nuevas Estructuras Narrativas
**Prioridad**: Media | **Impacto**: Alto | **Esfuerzo**: Alto

- **Problema**: Solo 4 estructuras pueden ser limitantes
- **Solución**:
  - Añadir nuevas estructuras:
    - **Inverted Pyramid** (5 escenas): Noticia → Detalles → Contexto → Análisis → Takeaway
    - **Question-Driven** (6 escenas): Pregunta → Respuesta 1 → Respuesta 2 → Debate → Síntesis → Conclusión
    - **Timeline Arc** (7 escenas): Presente → Pasado → Contexto → Desarrollo → Actualidad → Futuro → Implicaciones
    - **Contrast Arc** (5 escenas): Situación A → Situación B → Comparación → Análisis → Veredicto
  - Crear "narrative selector" inteligente basado en tipo de noticia

### 7.2 Variación de Longitud
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Todos los videos tienen duración similar
- **Solución**:
  - Implementar "length presets":
    - **Quick Take** (30-45s): Hot take comprimido
    - **Standard** (60-90s): Estructura clásica
    - **Deep Dive** (90-120s): Análisis profundo
  - Añadir selector de duración en wizard
  - Ajustar narrativa según duración seleccionada

### 7.3 Tono Adaptativo
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Medio

- **Problema**: Tono fijo puede no funcionar para todas las noticias
- **Solución**:
  - Implementar "tone detection" automático
  - Ajustar tono según tipo de noticia:
    - **Serias**: Tono más profesional
    - **Divertidas**: Tono más ligero
    - **Urgentes**: Tono más dramático
  - Crear "tone presets" configurables

### 7.4 Multi-Perspectiva Avanzada
**Prioridad**: Baja | **Impacto**: Medio | **Esfuerzo**: Alto

- **Problema**: Perspective Clash puede ser más rico
- **Solución**:
  - Añadir más perspectivas (3-4 hosts)
  - Implementar "debate format" estructurado
  - Crear "roundtable" style para temas complejos
  - Añadir "expert commentary" virtual

---

## 📹 Variaciones de Cámara y Visuales

### 8.1 Sistema de Shots Avanzado
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: Solo 3 tipos de shot (closeup, medium, wide)
- **Solución**:
  - Añadir más tipos de shot:
    - **Extreme Closeup**: Para momentos dramáticos
    - **Medium Closeup**: Para diálogo íntimo
    - **Medium Wide**: Para contexto
    - **Wide**: Para payoffs
    - **Dutch Angle**: Para tensión
    - **Over-the-Shoulder**: Para conversaciones
  - Crear "shot progression" automático
  - Implementar "shot library" por tipo de escena

### 8.2 Ángulos de Cámara Variados
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Medio

- **Problema**: Siempre eye-level puede ser monótono
- **Solución**:
  - Añadir variación de ángulos:
    - **High angle**: Para momentos de vulnerabilidad
    - **Low angle**: Para momentos de poder
    - **Bird's eye**: Para contexto amplio
    - **Worm's eye**: Para dramatismo
  - Crear "angle mapping" por tipo de escena

### 8.3 Profundidad de Campo Dinámica
**Prioridad**: Baja | **Impacto**: Bajo | **Esfuerzo**: Alto

- **Problema**: Profundidad de campo estática
- **Solución**:
  - Implementar "focus pulls" en momentos clave
  - Añadir "rack focus" para cambiar atención
  - Crear "bokeh effects" para fondos
  - Variar profundidad según importancia del momento

### 8.4 Composición Visual Mejorada
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Medio

- **Problema**: Composición puede ser mejorada
- **Solución**:
  - Implementar "rule of thirds" automático
  - Añadir "leading lines" en composición
  - Crear "negative space" estratégico
  - Implementar "symmetry" para balance

### 8.5 Backgrounds Dinámicos
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Alto

- **Problema**: Background estático puede ser aburrido
- **Solución**:
  - Añadir backgrounds contextuales:
    - **Stock market**: Para noticias financieras
    - **Cityscape**: Para noticias urbanas
    - **Nature**: Para noticias ambientales
  - Implementar "background transitions" sutiles
  - Crear "background library" por tipo de noticia

---

## 🎵 Mejoras de Audio

### 9.1 Mezcla de Audio Profesional
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: Audio puede sonar plano
- **Solución**:
  - Implementar "audio mixing" automático:
    - Balance de voces
    - EQ por frecuencia
    - Compresión dinámica
    - Reverb sutil para ambiente
  - Añadir "audio presets" por tipo de contenido
  - Crear "mastering" automático

### 9.2 Efectos de Sonido Mejorados
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Bajo

- **Problema**: Efectos de sonido pueden ser limitados
- **Solución**:
  - Expandir librería de efectos de sonido
  - Añadir "sound design" contextual
  - Implementar "audio stings" para transiciones
  - Crear "sound effects automation" inteligente

### 9.3 Música de Fondo Inteligente
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Alto

- **Problema**: Música puede no encajar con el mood
- **Solución**:
  - Implementar "mood-based music selection"
  - Añadir "music library" por tipo de contenido
  - Crear "music transitions" suaves
  - Implementar "dynamic music" que cambia según escena

### 9.4 Normalización Avanzada
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Normalización básica puede no ser suficiente
- **Solución**:
  - Implementar "loudness normalization" (EBU R128)
  - Añadir "peak limiting" más sofisticado
  - Crear "audio analysis" pre-normalización
  - Implementar "multi-band compression"

---

## 🎨 Mejoras de UX/UI

### 10.1 Preview en Tiempo Real
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Alto

- **Problema**: No se puede ver resultado hasta el final
- **Solución**:
  - Implementar "live preview" de escenas generadas
  - Añadir "preview mode" en wizard
  - Crear "scrubber" para navegar entre escenas
  - Implementar "side-by-side comparison" de versiones

### 10.2 Editor Visual de Guiones
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Alto

- **Problema**: Edición de guiones es básica
- **Solución**:
  - Crear editor visual tipo "timeline"
  - Añadir drag-and-drop para reordenar escenas
  - Implementar "split/merge" de escenas
  - Añadir "undo/redo" completo

### 10.3 Analytics Dashboard
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: No hay análisis de performance
- **Solución**:
  - Implementar dashboard de analytics:
    - Views, CTR, engagement rate
    - Retention curves
    - Comparación entre videos
    - Identificación de patrones exitosos
  - Añadir "performance predictions"
  - Crear "optimization suggestions"

### 10.4 Templates y Presets
**Prioridad**: Media | **Impacto**: Medio | **Esfuerzo**: Bajo

- **Problema**: Configuración desde cero cada vez
- **Solución**:
  - Crear "production templates":
    - Quick News (rápido, básico)
    - Deep Analysis (largo, detallado)
    - Viral Hook (optimizado para viralidad)
  - Añadir "preset library" de configuraciones
  - Implementar "save as template"

### 10.5 Configuración Avanzada de Comportamiento de Personajes
**Prioridad**: Alta | **Impacto**: Alto | **Esfuerzo**: Medio

- **Problema**: Las instrucciones de comportamiento de personajes son limitadas y no se pueden personalizar fácilmente desde el Admin
- **Solución**: Sistema completo de configuración de comportamiento de personajes con editor en Admin Dashboard

#### Funcionalidades Requeridas

**1. Estructura de Datos para Comportamiento**

```typescript
// En types.ts - Extender CharacterProfile
interface CharacterBehavior {
  // Personalidad base (ya existe)
  personality: string;
  
  // NUEVO: Instrucciones de comportamiento detalladas
  behaviorInstructions: {
    // Estilo de habla
    speakingStyle: {
      sentenceLength: 'short' | 'medium' | 'long'; // Preferencia de longitud
      formality: 'casual' | 'professional' | 'mixed';
      energy: 'low' | 'medium' | 'high';
      useContractions: boolean;
      useSlang: boolean;
      useNumbers: 'always' | 'often' | 'sometimes' | 'rarely';
    };
    
    // Tono y actitud
    tone: {
      default: 'sarcastic' | 'serious' | 'playful' | 'analytical' | 'empathetic';
      variations: {
        forGoodNews: 'sarcastic' | 'serious' | 'playful' | 'analytical' | 'empathetic';
        forBadNews: 'sarcastic' | 'serious' | 'playful' | 'analytical' | 'empathetic';
        forControversial: 'sarcastic' | 'serious' | 'playful' | 'analytical' | 'empathetic';
      };
    };
    
    // Opiniones y perspectiva
    viewpoints: {
      onMarkets: 'bullish' | 'bearish' | 'neutral' | 'skeptical' | 'optimistic';
      onCompanies: 'pro-business' | 'critical' | 'neutral' | 'skeptical';
      onRegulation: 'pro-regulation' | 'anti-regulation' | 'neutral' | 'pragmatic';
      onInnovation: 'enthusiastic' | 'cautious' | 'neutral' | 'skeptical';
    };
    
    // Frases y expresiones características
    catchphrases: string[]; // Frases que el personaje usa frecuentemente
    expressions: {
      agreement: string[]; // "Exactly!", "Totally", "I agree"
      disagreement: string[]; // "Wait, hold on", "I'm not so sure", "Actually..."
      surprise: string[]; // "Wow", "No way", "That's insane"
      skepticism: string[]; // "Really?", "I doubt it", "That seems fishy"
    };
    
    // Estilo de argumentación
    argumentation: {
      style: 'direct' | 'indirect' | 'questioning' | 'assertive' | 'diplomatic';
      useExamples: boolean;
      useAnalogies: boolean;
      useData: 'always' | 'often' | 'sometimes' | 'rarely';
      challengeOthers: boolean; // Si desafía al otro host
    };
    
    // Interacción con el otro host
    interaction: {
      interruptFrequency: 'never' | 'rarely' | 'sometimes' | 'often';
      buildOnOthers: boolean; // Si construye sobre lo que dice el otro
      createContrast: boolean; // Si busca crear contraste
      agreementLevel: 'always' | 'often' | 'sometimes' | 'rarely' | 'never';
    };
    
    // Instrucciones personalizadas (texto libre)
    customInstructions: string; // Instrucciones adicionales en texto libre
  };
  
  // NUEVO: Ejemplos de diálogo
  dialogueExamples: {
    good: string[]; // Ejemplos de buenos diálogos de este personaje
    bad: string[]; // Ejemplos de qué NO hacer
  };
}
```

**2. UI en Admin Dashboard**

```typescript
// Componente: AdminDashboard.tsx - Nueva sección
const CharacterBehaviorEditor: React.FC<{
  character: CharacterProfile;
  onSave: (behavior: CharacterBehavior) => void;
}> = ({ character, onSave }) => {
  const [behavior, setBehavior] = useState<CharacterBehavior>(
    character.behaviorInstructions || getDefaultBehavior()
  );
  
  return (
    <div className="character-behavior-editor">
      <h3>Comportamiento de {character.name}</h3>
      
      {/* Estilo de Habla */}
      <Section title="Estilo de Habla">
        <Select
          label="Longitud de Oraciones"
          value={behavior.speakingStyle.sentenceLength}
          onChange={(v) => setBehavior({
            ...behavior,
            speakingStyle: { ...behavior.speakingStyle, sentenceLength: v }
          })}
          options={[
            { value: 'short', label: 'Cortas (5-10 palabras)' },
            { value: 'medium', label: 'Medianas (10-15 palabras)' },
            { value: 'long', label: 'Largas (15+ palabras)' }
          ]}
        />
        
        <Select
          label="Formalidad"
          value={behavior.speakingStyle.formality}
          onChange={(v) => setBehavior({
            ...behavior,
            speakingStyle: { ...behavior.speakingStyle, formality: v }
          })}
        />
        
        <Toggle
          label="Usar Contracciones"
          value={behavior.speakingStyle.useContractions}
          onChange={(v) => setBehavior({
            ...behavior,
            speakingStyle: { ...behavior.speakingStyle, useContractions: v }
          })}
        />
        
        <Toggle
          label="Usar Jerga/Slang"
          value={behavior.speakingStyle.useSlang}
          onChange={(v) => setBehavior({
            ...behavior,
            speakingStyle: { ...behavior.speakingStyle, useSlang: v }
          })}
        />
      </Section>
      
      {/* Tono */}
      <Section title="Tono y Actitud">
        <Select
          label="Tono por Defecto"
          value={behavior.tone.default}
          onChange={(v) => setBehavior({
            ...behavior,
            tone: { ...behavior.tone, default: v }
          })}
        />
        
        <Select
          label="Tono para Buenas Noticias"
          value={behavior.tone.variations.forGoodNews}
          onChange={(v) => setBehavior({
            ...behavior,
            tone: {
              ...behavior.tone,
              variations: { ...behavior.tone.variations, forGoodNews: v }
            }
          })}
        />
        
        <Select
          label="Tono para Malas Noticias"
          value={behavior.tone.variations.forBadNews}
          onChange={(v) => setBehavior({
            ...behavior,
            tone: {
              ...behavior.tone,
              variations: { ...behavior.tone.variations, forBadNews: v }
            }
          })}
        />
      </Section>
      
      {/* Opiniones y Perspectiva */}
      <Section title="Opiniones y Perspectiva">
        <Select
          label="Perspectiva sobre Mercados"
          value={behavior.viewpoints.onMarkets}
          onChange={(v) => setBehavior({
            ...behavior,
            viewpoints: { ...behavior.viewpoints, onMarkets: v }
          })}
          options={[
            { value: 'bullish', label: 'Alcista (Optimista)' },
            { value: 'bearish', label: 'Bajista (Pesimista)' },
            { value: 'neutral', label: 'Neutral' },
            { value: 'skeptical', label: 'Escéptico' },
            { value: 'optimistic', label: 'Optimista' }
          ]}
        />
        
        <Select
          label="Perspectiva sobre Empresas"
          value={behavior.viewpoints.onCompanies}
          onChange={(v) => setBehavior({
            ...behavior,
            viewpoints: { ...behavior.viewpoints, onCompanies: v }
          })}
        />
        
        <Select
          label="Perspectiva sobre Regulación"
          value={behavior.viewpoints.onRegulation}
          onChange={(v) => setBehavior({
            ...behavior,
            viewpoints: { ...behavior.viewpoints, onRegulation: v }
          })}
        />
      </Section>
      
      {/* Frases Características */}
      <Section title="Frases y Expresiones">
        <TextArrayInput
          label="Catchphrases (Frases Características)"
          value={behavior.catchphrases}
          onChange={(v) => setBehavior({
            ...behavior,
            catchphrases: v
          })}
          placeholder="Ej: 'That's bananas!', 'No way!'"
          helpText="Frases que el personaje usa frecuentemente"
        />
        
        <TextArrayInput
          label="Expresiones de Acuerdo"
          value={behavior.expressions.agreement}
          onChange={(v) => setBehavior({
            ...behavior,
            expressions: { ...behavior.expressions, agreement: v }
          })}
          placeholder="Ej: 'Exactly!', 'Totally', 'I agree'"
        />
        
        <TextArrayInput
          label="Expresiones de Desacuerdo"
          value={behavior.expressions.disagreement}
          onChange={(v) => setBehavior({
            ...behavior,
            expressions: { ...behavior.expressions, disagreement: v }
          })}
          placeholder="Ej: 'Wait, hold on', 'I'm not so sure'"
        />
        
        <TextArrayInput
          label="Expresiones de Sorpresa"
          value={behavior.expressions.surprise}
          onChange={(v) => setBehavior({
            ...behavior,
            expressions: { ...behavior.expressions, surprise: v }
          })}
          placeholder="Ej: 'Wow', 'No way', 'That's insane'"
        />
      </Section>
      
      {/* Estilo de Argumentación */}
      <Section title="Estilo de Argumentación">
        <Select
          label="Estilo"
          value={behavior.argumentation.style}
          onChange={(v) => setBehavior({
            ...behavior,
            argumentation: { ...behavior.argumentation, style: v }
          })}
          options={[
            { value: 'direct', label: 'Directo' },
            { value: 'indirect', label: 'Indirecto' },
            { value: 'questioning', label: 'Hace Preguntas' },
            { value: 'assertive', label: 'Asertivo' },
            { value: 'diplomatic', label: 'Diplomático' }
          ]}
        />
        
        <Toggle
          label="Usar Ejemplos"
          value={behavior.argumentation.useExamples}
          onChange={(v) => setBehavior({
            ...behavior,
            argumentation: { ...behavior.argumentation, useExamples: v }
          })}
        />
        
        <Toggle
          label="Usar Analogías"
          value={behavior.argumentation.useAnalogies}
          onChange={(v) => setBehavior({
            ...behavior,
            argumentation: { ...behavior.argumentation, useAnalogies: v }
          })}
        />
        
        <Select
          label="Uso de Datos"
          value={behavior.argumentation.useData}
          onChange={(v) => setBehavior({
            ...behavior,
            argumentation: { ...behavior.argumentation, useData: v }
          })}
        />
      </Section>
      
      {/* Interacción con Otro Host */}
      <Section title="Interacción con el Otro Host">
        <Select
          label="Frecuencia de Interrupciones"
          value={behavior.interaction.interruptFrequency}
          onChange={(v) => setBehavior({
            ...behavior,
            interaction: { ...behavior.interaction, interruptFrequency: v }
          })}
        />
        
        <Toggle
          label="Construye sobre lo que dice el otro"
          value={behavior.interaction.buildOnOthers}
          onChange={(v) => setBehavior({
            ...behavior,
            interaction: { ...behavior.interaction, buildOnOthers: v }
          })}
        />
        
        <Toggle
          label="Busca crear contraste"
          value={behavior.interaction.createContrast}
          onChange={(v) => setBehavior({
            ...behavior,
            interaction: { ...behavior.interaction, createContrast: v }
          })}
        />
        
        <Select
          label="Nivel de Acuerdo"
          value={behavior.interaction.agreementLevel}
          onChange={(v) => setBehavior({
            ...behavior,
            interaction: { ...behavior.interaction, agreementLevel: v }
          })}
        />
      </Section>
      
      {/* Instrucciones Personalizadas */}
      <Section title="Instrucciones Personalizadas">
        <Textarea
          label="Instrucciones Adicionales (Texto Libre)"
          value={behavior.customInstructions}
          onChange={(v) => setBehavior({
            ...behavior,
            customInstructions: v
          })}
          placeholder="Ej: 'Siempre menciona el contexto histórico cuando habla de mercados', 'Nunca usa jerga técnica sin explicarla'"
          rows={6}
          helpText="Instrucciones específicas que no están cubiertas por los campos anteriores"
        />
      </Section>
      
      {/* Ejemplos de Diálogo */}
      <Section title="Ejemplos de Diálogo">
        <TextArrayInput
          label="Buenos Ejemplos"
          value={behavior.dialogueExamples.good}
          onChange={(v) => setBehavior({
            ...behavior,
            dialogueExamples: { ...behavior.dialogueExamples, good: v }
          })}
          placeholder="Ejemplos de diálogos que reflejan bien el personaje"
          rows={3}
        />
        
        <TextArrayInput
          label="Malos Ejemplos (Qué NO hacer)"
          value={behavior.dialogueExamples.bad}
          onChange={(v) => setBehavior({
            ...behavior,
            dialogueExamples: { ...behavior.dialogueExamples, bad: v }
          })}
          placeholder="Ejemplos de lo que el personaje NO debería decir"
          rows={3}
        />
      </Section>
      
      <Button onClick={() => onSave(behavior)}>
        Guardar Comportamiento
      </Button>
    </div>
  );
};
```

**3. Integración en Prompt del Scriptwriter**

```typescript
// En openaiService.ts - generateScriptWithGPT
const buildCharacterBehaviorPrompt = (config: ChannelConfig): string => {
  const hostA = config.characters.hostA;
  const hostB = config.characters.hostB;
  
  const behaviorA = hostA.behaviorInstructions;
  const behaviorB = hostB.behaviorInstructions;
  
  return `
=== DETALLED CHARACTER BEHAVIOR INSTRUCTIONS ===

HOST A (${hostA.name}) - BEHAVIOR PROFILE:

Speaking Style:
- Sentence Length: ${behaviorA.speakingStyle.sentenceLength}
- Formality: ${behaviorA.speakingStyle.formality}
- Energy Level: ${behaviorA.speakingStyle.energy}
- Use Contractions: ${behaviorA.speakingStyle.useContractions ? 'YES' : 'NO'}
- Use Slang: ${behaviorA.speakingStyle.useSlang ? 'YES' : 'NO'}
- Use Numbers: ${behaviorA.speakingStyle.useNumbers}

Tone:
- Default: ${behaviorA.tone.default}
- For Good News: ${behaviorA.tone.variations.forGoodNews}
- For Bad News: ${behaviorA.tone.variations.forBadNews}
- For Controversial: ${behaviorA.tone.variations.forControversial}

Viewpoints:
- On Markets: ${behaviorA.viewpoints.onMarkets}
- On Companies: ${behaviorA.viewpoints.onCompanies}
- On Regulation: ${behaviorA.viewpoints.onRegulation}
- On Innovation: ${behaviorA.viewpoints.onInnovation}

Characteristic Phrases:
${behaviorA.catchphrases.map(p => `- "${p}"`).join('\n')}

Expressions:
- Agreement: ${behaviorA.expressions.agreement.join(', ')}
- Disagreement: ${behaviorA.expressions.disagreement.join(', ')}
- Surprise: ${behaviorA.expressions.surprise.join(', ')}
- Skepticism: ${behaviorA.expressions.skepticism.join(', ')}

Argumentation Style:
- Style: ${behaviorA.argumentation.style}
- Use Examples: ${behaviorA.argumentation.useExamples ? 'YES' : 'NO'}
- Use Analogies: ${behaviorA.argumentation.useAnalogies ? 'YES' : 'NO'}
- Use Data: ${behaviorA.argumentation.useData}
- Challenge Others: ${behaviorA.argumentation.challengeOthers ? 'YES' : 'NO'}

Interaction with ${hostB.name}:
- Interrupt Frequency: ${behaviorA.interaction.interruptFrequency}
- Build on Others: ${behaviorA.interaction.buildOnOthers ? 'YES' : 'NO'}
- Create Contrast: ${behaviorA.interaction.createContrast ? 'YES' : 'NO'}
- Agreement Level: ${behaviorA.interaction.agreementLevel}

Custom Instructions:
${behaviorA.customInstructions}

Good Dialogue Examples:
${behaviorA.dialogueExamples.good.map(e => `- "${e}"`).join('\n')}

Bad Dialogue Examples (AVOID):
${behaviorA.dialogueExamples.bad.map(e => `- "${e}"`).join('\n')}

---

HOST B (${hostB.name}) - BEHAVIOR PROFILE:
[Similar structure for hostB]

CRITICAL: ${hostA.name}'s dialogue MUST follow ALL these behavior instructions.
${hostB.name}'s dialogue MUST follow ALL these behavior instructions.
DO NOT deviate from these instructions.
`;
};
```

**4. Guardado en Configuración de Canal**

```typescript
// En supabaseService.ts - saveChannel
export const saveChannel = async (
  channel: Channel,
  userId: string
): Promise<Channel> => {
  // Asegurar que behaviorInstructions se guarda correctamente
  const channelToSave = {
    ...channel,
    config: {
      ...channel.config,
      characters: {
        hostA: {
          ...channel.config.characters.hostA,
          behaviorInstructions: channel.config.characters.hostA.behaviorInstructions || getDefaultBehavior()
        },
        hostB: {
          ...channel.config.characters.hostB,
          behaviorInstructions: channel.config.characters.hostB.behaviorInstructions || getDefaultBehavior()
        }
      }
    }
  };
  
  const { data, error } = await supabase
    .from('channels')
    .upsert(channelToSave)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};
```

**5. Valores por Defecto**

```typescript
// En types.ts o constants.ts
export const getDefaultBehavior = (): CharacterBehavior => ({
  speakingStyle: {
    sentenceLength: 'medium',
    formality: 'casual',
    energy: 'medium',
    useContractions: true,
    useSlang: false,
    useNumbers: 'often'
  },
  tone: {
    default: 'sarcastic',
    variations: {
      forGoodNews: 'playful',
      forBadNews: 'sarcastic',
      forControversial: 'analytical'
    }
  },
  viewpoints: {
    onMarkets: 'skeptical',
    onCompanies: 'critical',
    onRegulation: 'neutral',
    onInnovation: 'cautious'
  },
  catchphrases: [],
  expressions: {
    agreement: ['Exactly!', 'Totally'],
    disagreement: ['Wait, hold on', "I'm not so sure"],
    surprise: ['Wow', 'No way'],
    skepticism: ['Really?', 'I doubt it']
  },
  argumentation: {
    style: 'direct',
    useExamples: true,
    useAnalogies: false,
    useData: 'often',
    challengeOthers: true
  },
  interaction: {
    interruptFrequency: 'sometimes',
    buildOnOthers: true,
    createContrast: true,
    agreementLevel: 'sometimes'
  },
  customInstructions: '',
  dialogueExamples: {
    good: [],
    bad: []
  }
});
```

**6. Preview de Comportamiento**

```typescript
// Componente para preview en Admin
const BehaviorPreview: React.FC<{
  behavior: CharacterBehavior;
  characterName: string;
}> = ({ behavior, characterName }) => {
  // Generar ejemplo de diálogo usando el comportamiento
  const generatePreview = async () => {
    const exampleNews: NewsItem = {
      headline: "Tesla stock drops 10%",
      summary: "Tesla stock fell 10% after earnings report",
      source: "Example",
      url: "",
      viralScore: 7
    };
    
    // Generar diálogo de ejemplo usando el comportamiento
    const preview = await generateExampleDialogue(
      characterName,
      behavior,
      exampleNews
    );
    
    return preview;
  };
  
  return (
    <div className="behavior-preview">
      <Button onClick={generatePreview}>
        Generar Preview de Diálogo
      </Button>
      {/* Mostrar preview generado */}
    </div>
  );
};
```

**Archivos a Modificar/Crear:**
- `types.ts` - Añadir `CharacterBehavior` interface
- `components/AdminDashboard.tsx` - Añadir `CharacterBehaviorEditor`
- `services/openaiService.ts` - Integrar `buildCharacterBehaviorPrompt()`
- `services/supabaseService.ts` - Asegurar guardado de `behaviorInstructions`
- `constants.ts` - Añadir `getDefaultBehavior()`
- Crear `components/CharacterBehaviorEditor.tsx` (componente reutilizable)

**Beneficios:**
- ✅ Control total sobre comportamiento de personajes
- ✅ Personalización sin tocar código
- ✅ Consistencia en diálogos generados
- ✅ Fácil ajuste según feedback
- ✅ Preview antes de aplicar cambios

---

## 🎯 Priorización de Implementación

### Fase 0 (Críticos - 1-2 semanas) 🚨
0.1. ✅ Arreglar Wizard State Persistence
0.2. ✅ Arreglar Inconsistencia TTS
0.3. ✅ Mejorar Prompts para Viralidad
0.4. ✅ Arreglar Composición de Video
0.5. ✅ Rediseñar Estructuras Narrativas

### Fase 1 (Impacto Inmediato - 2-4 semanas)
1. ✅ Configuración Avanzada de Comportamiento de Personajes ⭐ **NUEVO**
2. ✅ Hook Optimizado con IA
3. ✅ Thumbnails A/B Testing
4. ✅ Transiciones Avanzadas
5. ✅ Variación de Ritmo
6. ✅ Generación Paralela Mejorada

### Fase 2 (Mejoras de Calidad - 4-6 semanas)
7. ✅ Sistema de Seed Images Mejorado
8. ✅ Movimiento de Cámara Dinámico
9. ✅ Expresiones y Gestos Dinámicos
10. ✅ Mezcla de Audio Profesional
11. ✅ Sistema de Shots Avanzado

### Fase 3 (Optimización - 6-8 semanas)
11. ✅ Caché Inteligente Mejorado
12. ✅ Cost Tracking Mejorado
13. ✅ Reutilización de Assets
14. ✅ Analytics Dashboard
15. ✅ Preview en Tiempo Real

### Fase 4 (Innovación - 8+ semanas)
16. ✅ Nuevas Estructuras Narrativas
17. ✅ Motion Graphics
18. ✅ Backgrounds Dinámicos
19. ✅ Editor Visual de Guiones
20. ✅ Análisis de Competencia

---

## 📊 Métricas de Éxito

### KPIs a Monitorear

1. **Calidad Visual**
   - Consistencia score (0-100)
   - Variación visual entre escenas
   - Resolución promedio

2. **Viralidad**
   - CTR promedio
   - Views en primeras 24h
   - Engagement rate
   - Retention promedio

3. **Velocidad**
   - Tiempo total de producción
   - Tiempo por paso
   - Tasa de caché hit

4. **Costos**
   - Costo por video
   - Costo por minuto
   - ROI por video

5. **Satisfacción**
   - Tasa de aprobación sin ediciones
   - Tiempo de edición manual
   - Reutilización de producciones

---

## 🔄 Proceso de Implementación

### 1. Análisis y Planificación
- Revisar cada mejora propuesta
- Estimar esfuerzo y recursos
- Priorizar según impacto/effort ratio
- Crear roadmap detallado

### 2. Desarrollo Incremental
- Implementar mejoras en sprints de 2 semanas
- Testing continuo
- Feedback loop con usuarios
- Iteración rápida

### 3. Medición y Optimización
- Monitorear métricas después de cada mejora
- A/B testing cuando sea posible
- Ajustar según resultados
- Documentar learnings

### 4. Escalamiento
- Rollout gradual de mejoras
- Monitoreo de performance
- Optimización continua
- Expansión de features exitosas

---

## 💡 Ideas Adicionales (Futuro)

### Inteligencia Artificial Avanzada
- **GPT-4o Vision**: Análisis de thumbnails y videos exitosos
- **Claude Sonnet**: Análisis de guiones y optimización
- **Multi-Agent System**: Múltiples AIs trabajando en paralelo

### Personalización
- **User Preferences**: Aprender de preferencias del usuario
- **Style Transfer**: Aplicar estilos de videos exitosos
- **Adaptive Learning**: Mejorar basado en feedback

### Integraciones
- **TikTok API**: Publicación directa
- **Instagram Reels**: Formato optimizado
- **Twitter/X**: Clips cortos
- **LinkedIn**: Versión profesional

### Automatización
- **Scheduled Productions**: Producciones automáticas diarias
- **Auto-Publishing**: Publicación automática en horarios óptimos
- **Content Calendar**: Planificación automática

---

**Nota**: Este documento es un plan vivo que debe actualizarse según resultados, feedback y nuevas oportunidades. Priorizar siempre según impacto real medido, no solo estimaciones.
