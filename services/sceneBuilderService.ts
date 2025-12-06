import { ChannelConfig, Scene, ScriptWithScenes, ShotType, VideoMode, NarrativeType } from "../types";

export interface ScenePrompt {
  sceneNumber: string;
  sceneIndex: number;
  prompt: string;
  scene: Scene;
  visualPrompt: string; // Optimized prompt for InfiniteTalk
  lightingMood: 'neutral' | 'dramatic' | 'warm' | 'cool';
  expressionHint: string;
}

// Fallback studio seed images (used only if channel config doesn't have them)
// These should match the values in system_defaults.default_channel_config in Supabase
const FALLBACK_SEED_IMAGES = {
  hostASolo: "Ultra-detailed 3D render of a male chimpanzee podcaster wearing a dark hoodie, at a modern podcast desk. Sarcastic expression, relaxed posture. Warm tungsten key light + purple/blue LED accents. Acoustic foam panels, Shure SM7B microphone. Medium shot, eye-level.",
  hostBSolo: "Ultra-detailed 3D render of a female chimpanzee podcaster wearing a teal blazer and white shirt. Playful, expressive look. Warm tungsten lighting + purple/blue LEDs. Acoustic foam panels. Medium shot, eye-level.",
  twoShot: "Ultra-detailed 3D render of hostA and hostB at a sleek podcast desk. hostA in dark hoodie, hostB in teal blazer. Warm tungsten key light, purple/blue LEDs, Shure SM7B mics. Medium two-shot, eye-level."
};

const FALLBACK_STUDIO = "modern podcast room, warm tungsten key light, purple/blue LED accents, acoustic foam panels, Shure SM7B microphones, camera: eye-level, shallow depth of field";

// Scene type detection based on narrative structure and position
interface SceneTypeInfo {
  type: 'hook' | 'rising' | 'conflict' | 'comeback' | 'payoff' | 'perspective' | 'clash' | 'synthesis';
  recommendedShot: ShotType;
  lightingMood: 'neutral' | 'dramatic' | 'warm' | 'cool';
  emotionalTone: string;
}

/**
 * Determine scene type based on narrative structure and scene position
 */
const getSceneTypeInfo = (
  sceneIndex: number,
  totalScenes: number,
  narrativeType: NarrativeType
): SceneTypeInfo => {
  const scenePosition = sceneIndex + 1;
  
  // Classic Arc (6 scenes): Hook, Rising, Conflict, Comeback, Rising2, Payoff
  if (narrativeType === 'classic') {
    const mapping: Record<number, SceneTypeInfo> = {
      1: { type: 'hook', recommendedShot: 'closeup', lightingMood: 'dramatic', emotionalTone: 'attention-grabbing, intriguing' },
      2: { type: 'rising', recommendedShot: 'medium', lightingMood: 'neutral', emotionalTone: 'building interest, informative' },
      3: { type: 'conflict', recommendedShot: 'closeup', lightingMood: 'dramatic', emotionalTone: 'tension, concern, disbelief' },
      4: { type: 'comeback', recommendedShot: 'medium', lightingMood: 'warm', emotionalTone: 'hopeful, analytical' },
      5: { type: 'rising', recommendedShot: 'medium', lightingMood: 'neutral', emotionalTone: 'elaborating, connecting dots' },
      6: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'conclusive, satisfied, insightful' }
    };
    return mapping[scenePosition] || mapping[6];
  }
  
  // Double Conflict Arc (7 scenes)
  if (narrativeType === 'double_conflict') {
    const mapping: Record<number, SceneTypeInfo> = {
      1: { type: 'hook', recommendedShot: 'closeup', lightingMood: 'dramatic', emotionalTone: 'urgent, breaking news energy' },
      2: { type: 'rising', recommendedShot: 'medium', lightingMood: 'neutral', emotionalTone: 'setting up the context' },
      3: { type: 'conflict', recommendedShot: 'closeup', lightingMood: 'dramatic', emotionalTone: 'first major concern, skeptical' },
      4: { type: 'comeback', recommendedShot: 'medium', lightingMood: 'warm', emotionalTone: 'temporary relief, but...' },
      5: { type: 'conflict', recommendedShot: 'closeup', lightingMood: 'cool', emotionalTone: 'second blow, compounding issues' },
      6: { type: 'comeback', recommendedShot: 'medium', lightingMood: 'warm', emotionalTone: 'resolution path, optimistic' },
      7: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'final takeaway, call to action' }
    };
    return mapping[scenePosition] || mapping[7];
  }
  
  // Hot Take Compressed (4 scenes)
  if (narrativeType === 'hot_take') {
    const mapping: Record<number, SceneTypeInfo> = {
      1: { type: 'hook', recommendedShot: 'closeup', lightingMood: 'dramatic', emotionalTone: 'punchy, immediate impact' },
      2: { type: 'conflict', recommendedShot: 'closeup', lightingMood: 'dramatic', emotionalTone: 'the problem, the drama' },
      3: { type: 'comeback', recommendedShot: 'medium', lightingMood: 'neutral', emotionalTone: 'quick analysis, hot take' },
      4: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'mic drop moment, conclusion' }
    };
    return mapping[scenePosition] || mapping[4];
  }
  
  // Perspective Clash (6 scenes)
  if (narrativeType === 'perspective_clash') {
    const mapping: Record<number, SceneTypeInfo> = {
      1: { type: 'hook', recommendedShot: 'closeup', lightingMood: 'dramatic', emotionalTone: 'presenting the debate topic' },
      2: { type: 'perspective', recommendedShot: 'medium', lightingMood: 'cool', emotionalTone: 'hostA POV - skeptical, analytical' },
      3: { type: 'perspective', recommendedShot: 'medium', lightingMood: 'warm', emotionalTone: 'hostB POV - optimistic, contrarian' },
      4: { type: 'clash', recommendedShot: 'closeup', lightingMood: 'dramatic', emotionalTone: 'debate peak, tension, back-and-forth' },
      5: { type: 'synthesis', recommendedShot: 'medium', lightingMood: 'neutral', emotionalTone: 'finding middle ground' },
      6: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'unified conclusion, audience takeaway' }
    };
    return mapping[scenePosition] || mapping[6];
  }
  
  // Default fallback
  return { type: 'rising', recommendedShot: 'medium', lightingMood: 'neutral', emotionalTone: 'informative' };
};

/**
 * Generate expression hints based on emotional tone
 */
const getExpressionHint = (
  videoMode: VideoMode | 'both', // Accept legacy 'both' for backwards compat
  emotionalTone: string,
  hostAPersonality: string,
  hostBPersonality: string
): string => {
  const toneKeywords = emotionalTone.toLowerCase();
  
  // Convert legacy "both" to hostA
  const effectiveMode = videoMode === 'both' ? 'hostA' : videoMode;
  
  if (effectiveMode === 'hostA') {
    if (toneKeywords.includes('skeptical') || toneKeywords.includes('concern')) {
      return 'raised eyebrow, slight smirk, leaning back skeptically';
    }
    if (toneKeywords.includes('dramatic') || toneKeywords.includes('breaking')) {
      return 'serious expression, direct eye contact, leaning forward';
    }
    if (toneKeywords.includes('conclusion') || toneKeywords.includes('satisfied')) {
      return 'subtle nod, knowing smile, relaxed posture';
    }
    return 'sarcastic half-smile, casual posture, dry humor expression';
  }
  
  // hostB
  if (toneKeywords.includes('optimistic') || toneKeywords.includes('hopeful')) {
    return 'bright eyes, animated hand gestures, leaning in enthusiastically';
  }
  if (toneKeywords.includes('dramatic') || toneKeywords.includes('tension')) {
    return 'wide eyes, expressive reactions, engaged posture';
  }
  if (toneKeywords.includes('conclusion') || toneKeywords.includes('warm')) {
    return 'warm smile, open body language, nodding affirmatively';
  }
  return 'playful expression, energetic gestures, witty smile';
};

/**
 * Build a comprehensive visual prompt for InfiniteTalk
 */
const buildVisualPrompt = (
  scene: Scene,
  config: ChannelConfig,
  seedImages: Record<string, string>,
  studioSetup: string,
  sceneTypeInfo: SceneTypeInfo,
  expressionHint: string
): string => {
  const hostA = config.characters.hostA;
  const hostB = config.characters.hostB;
  
  // Shot framing instructions
  const shotFraming = {
    'closeup': 'Close-up shot, tight framing on face and upper torso, emphasizing facial expressions',
    'medium': 'Medium shot, standard podcast framing showing desk and microphone',
    'wide': 'Wide shot, showing full studio setup with both positions visible'
  };
  
  // Lighting adjustments based on mood
  const lightingAdjustments = {
    'neutral': 'balanced tungsten key light, subtle purple/blue fill',
    'dramatic': 'stronger contrast, deeper shadows, blue accent lights more prominent',
    'warm': 'warmer tungsten tones, soft orange accents, inviting atmosphere',
    'cool': 'cooler color temperature, more blue/purple accent emphasis'
  };
  
  // Convert legacy "both" to hostA for backwards compatibility
  const effectiveVideoMode = scene.video_mode === 'both' ? 'hostA' : scene.video_mode;
  
  const selectedSeedImage = effectiveVideoMode === 'hostA' 
    ? seedImages.hostASolo 
    : seedImages.hostBSolo;
  
  const speakingHost = effectiveVideoMode === 'hostA' 
    ? `${hostA.name} (${hostA.outfit || 'dark hoodie'})` 
    : `${hostB.name} (${hostB.outfit || 'teal blazer'})`;

  return `
INFINITETALK VISUAL PROMPT
===========================

SCENE TYPE: ${sceneTypeInfo.type.toUpperCase()}
SHOT: ${shotFraming[scene.shot]}
MODEL: ${scene.model}

STUDIO ENVIRONMENT:
${studioSetup}
Lighting: ${lightingAdjustments[sceneTypeInfo.lightingMood]}

CHARACTER(S) VISIBLE: ${speakingHost}
${effectiveVideoMode === 'hostA' ? `
HOST A (${hostA.name}):
- Appearance: ${hostA.visualPrompt}
- Outfit: ${hostA.outfit || 'dark hoodie'}
- Expression: ${expressionHint}
` : `
HOST B (${hostB.name}):
- Appearance: ${hostB.visualPrompt}  
- Outfit: ${hostB.outfit || 'teal blazer and white shirt'}
- Expression: ${expressionHint}
`}

EMOTIONAL TONE: ${sceneTypeInfo.emotionalTone}

SEED IMAGE REFERENCE:
${selectedSeedImage}

LIP-SYNC REQUIREMENTS:
- Accurate mouth movements matching audio
- Subtle head movements and gestures
- Natural blinking and micro-expressions
- Maintain character consistency with seed image

CRITICAL: Generate EXACTLY the characters described (animated chimpanzees), NOT humans.
`.trim();
};

/**
 * Generate scene prompts for all scenes in a script
 * Now integrated with narrative structure for optimal shots and moods
 */
export const generateScenePrompts = (
  script: ScriptWithScenes,
  config: ChannelConfig
): ScenePrompt[] => {
  // Use channel config seed images, fall back to defaults if not configured
  const seedImages = {
    ...FALLBACK_SEED_IMAGES,
    ...(config.seedImages || {})
  };

  // Use channel config studio setup, fall back to default if not configured
  const studioSetup = config.studioSetup || FALLBACK_STUDIO;
  const totalScenes = Object.keys(script.scenes).length;
  const narrativeType = script.narrative_used;

  return Object.entries(script.scenes)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([sceneNumber, scene], index) => {
      const sceneTypeInfo = getSceneTypeInfo(index, totalScenes, narrativeType);
      
      // Validate and potentially correct shot type based on scene position
      const correctedShot = validateShotType(scene.shot, sceneTypeInfo.recommendedShot, index, totalScenes);
      const correctedScene = { ...scene, shot: correctedShot };
      
      const expressionHint = getExpressionHint(
        scene.video_mode,
        sceneTypeInfo.emotionalTone,
        config.characters.hostA.personality || config.characters.hostA.bio,
        config.characters.hostB.personality || config.characters.hostB.bio
      );
      
      const visualPrompt = buildVisualPrompt(
        correctedScene,
        config,
        seedImages,
        studioSetup,
        sceneTypeInfo,
        expressionHint
      );

      return {
        sceneNumber,
        sceneIndex: index,
        prompt: buildLegacyPrompt(correctedScene, config, seedImages, studioSetup),
        scene: correctedScene,
        visualPrompt,
        lightingMood: sceneTypeInfo.lightingMood,
        expressionHint
      };
    });
};

/**
 * Validate and correct shot type based on spec rules:
 * - Hook/Conflict → closeup
 * - Payoff → wide  
 * - Default → medium
 */
const validateShotType = (
  currentShot: ShotType,
  recommendedShot: ShotType,
  sceneIndex: number,
  totalScenes: number
): ShotType => {
  // First scene (Hook) should be closeup
  if (sceneIndex === 0 && currentShot !== 'closeup') {
    console.log(`🎬 [SceneBuilder] Correcting scene 1 shot from ${currentShot} to closeup (Hook)`);
    return 'closeup';
  }
  
  // Last scene (Payoff) should be wide
  if (sceneIndex === totalScenes - 1 && currentShot !== 'wide') {
    console.log(`🎬 [SceneBuilder] Correcting scene ${sceneIndex + 1} shot from ${currentShot} to wide (Payoff)`);
    return 'wide';
  }
  
  // For other scenes, use the recommended shot if current doesn't match spec
  // But allow GPT's choice if it's reasonable
  return currentShot;
};

/**
 * Build legacy prompt format for backwards compatibility
 */
const buildLegacyPrompt = (
  scene: Scene,
  config: ChannelConfig,
  seedImages: Record<string, string>,
  studioSetup: string
): string => {
  const hostA = config.characters.hostA;
  const hostB = config.characters.hostB;

  const appearanceA = `${hostA.name} in ${hostA.outfit || "dark hoodie"} (${hostA.personality || hostA.bio})`;
  const appearanceB = `${hostB.name} in ${hostB.outfit || "teal blazer and white shirt"} (${hostB.personality || hostB.bio})`;

  const basePrompt = `You are a visual scene director generating prompts for InfiniteTalk.

Studio continuity:
- ${studioSetup}
- Camera: eye-level, shallow depth of field
- Shot: ${scene.shot}

Characters:
- ${appearanceA}
- ${appearanceB}`;

  // Convert legacy "both" to hostA for backwards compatibility
  const effectiveMode = scene.video_mode === 'both' ? 'hostA' : scene.video_mode;
  const whoAppears = effectiveMode === "hostA"
    ? "Only hostA appears in this scene."
    : "Only hostB appears in this scene.";

  const seedImage = effectiveMode === "hostA"
    ? seedImages.hostASolo
    : seedImages.hostBSolo;

  return `${basePrompt}

${whoAppears}
Model: ${scene.model}
Reference seed image: ${seedImage}
Scene dialogue summary: ${scene.text}`.trim();
};

/**
 * Get a single scene prompt by index
 */
export const getScenePromptByIndex = (
  script: ScriptWithScenes,
  config: ChannelConfig,
  sceneIndex: number
): ScenePrompt | null => {
  const allPrompts = generateScenePrompts(script, config);
  return allPrompts[sceneIndex] || null;
};

/**
 * Export fallback defaults for use in other services
 * Note: These are fallbacks only. The actual defaults should come from 
 * channel config which is loaded from Supabase channels table.
 */
export const SCENE_BUILDER_DEFAULTS = {
  seedImages: FALLBACK_SEED_IMAGES,
  studioSetup: FALLBACK_STUDIO
};
