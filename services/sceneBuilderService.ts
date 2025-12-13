import { ChannelConfig, Scene, ScriptWithScenes, ShotType, VideoMode, NarrativeType } from "../types";
import { getSeedImageForScene as getSeedImageVariation } from "./seedImageVariations";

export interface CameraMovement {
  type: 'push_in' | 'pull_out' | 'pan_left' | 'pan_right' | 'zoom' | 'static';
  intensity: 'subtle' | 'moderate' | 'pronounced';
  duration: number;
  startTime: number;
}

export interface ScenePrompt {
  sceneNumber: string;
  sceneIndex: number;
  prompt: string;
  scene: Scene;
  visualPrompt: string; // Optimized prompt for InfiniteTalk
  lightingMood: 'neutral' | 'dramatic' | 'warm' | 'cool';
  expressionHint: string;
  cameraMovement?: CameraMovement; // NEW: Camera movement for dynamic shots
}

// Fallback studio seed images (used only if channel config doesn't have them)
// These should match the values in system_defaults.default_channel_config in Supabase
const FALLBACK_SEED_IMAGES = {
  hostASolo: "Ultra-detailed 3D render of a male chimpanzee podcaster wearing a dark hoodie, at a modern podcast desk. Sarcastic expression, relaxed posture. Warm tungsten key light + purple/blue LED accents. Acoustic foam panels, Shure SM7B microphone. Medium shot, eye-level.",
  hostBSolo: "Ultra-detailed 3D render of a female chimpanzee podcaster wearing a teal blazer and white shirt. Playful, expressive look. Warm tungsten lighting + purple/blue LEDs. Acoustic foam panels. Medium shot, eye-level.",
  twoShot: "Ultra-detailed 3D render of hostA and hostB at a sleek podcast desk. hostA in dark hoodie, hostB in teal blazer. Warm tungsten key light, purple/blue LEDs, Shure SM7B mics. Medium two-shot, eye-level."
};

/**
 * NEW: Seed Image Variants System
 * Generates and rotates seed images based on scene type and emotion
 */
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

/**
 * Select appropriate seed image variant based on scene type and mood
 * NEW: Intelligent seed image selection for visual variety
 */
const selectSeedImageVariant = (
  character: 'hostA' | 'hostB',
  sceneType: SceneTypeInfo,
  config: ChannelConfig,
  sceneIndex: number
): string => {
  const seedImages = config.seedImages || {};
  const baseImage = character === 'hostA' 
    ? (config.format === '9:16' ? seedImages.hostASoloUrl_9_16 : seedImages.hostASoloUrl)
    : (config.format === '9:16' ? seedImages.hostBSoloUrl_9_16 : seedImages.hostBSoloUrl);
  
  // If no variants configured, use base image
  if (!baseImage) {
    return character === 'hostA' ? FALLBACK_SEED_IMAGES.hostASolo : FALLBACK_SEED_IMAGES.hostBSolo;
  }
  
  // NEW: Rotate seed images based on scene type for variety
  // For now, use base image but in future can implement variant rotation
  // TODO: Implement variant system when multiple seed images are stored
  
  // For hook scenes: Use more dramatic variant
  if (sceneType.type === 'hook' || sceneType.type === 'conflict') {
    // Could use a more intense expression variant here
    return baseImage;
  }
  
  // For payoff: Use warmer variant
  if (sceneType.type === 'payoff') {
    return baseImage; // Could use warmer lighting variant
  }
  
  // Default: Use base image
  return baseImage;
};

const FALLBACK_STUDIO = "modern podcast room, warm tungsten key light, purple/blue LED accents, acoustic foam panels, Shure SM7B microphones, camera: eye-level, shallow depth of field";

// Scene type detection based on narrative structure and position
interface SceneTypeInfo {
  type: 'hook' | 'rising' | 'conflict' | 'comeback' | 'payoff' | 'perspective' | 'clash' | 'synthesis';
  recommendedShot: ShotType;
  lightingMood: 'neutral' | 'dramatic' | 'warm' | 'cool';
  emotionalTone: string;
  cameraAngle?: 'eye_level' | 'high_angle' | 'low_angle' | 'bird_eye' | 'worm_eye'; // NEW: Camera angles
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
  // NEW: Enhanced with advanced shot types and camera angles
  if (narrativeType === 'classic') {
    const mapping: Record<number, SceneTypeInfo> = {
      1: { 
        type: 'hook', 
        recommendedShot: 'extreme_closeup', // NEW: Extreme closeup for maximum impact
        lightingMood: 'dramatic', 
        emotionalTone: 'attention-grabbing, intriguing',
        cameraAngle: 'low_angle' // NEW: Low angle for power
      },
      2: { 
        type: 'rising', 
        recommendedShot: 'medium_closeup', // NEW: Medium closeup for intimacy
        lightingMood: 'neutral', 
        emotionalTone: 'building interest, informative',
        cameraAngle: 'eye_level'
      },
      3: { 
        type: 'conflict', 
        recommendedShot: 'dutch_angle', // NEW: Dutch angle for tension
        lightingMood: 'dramatic', 
        emotionalTone: 'tension, concern, disbelief',
        cameraAngle: 'low_angle'
      },
      4: { 
        type: 'comeback', 
        recommendedShot: 'medium', 
        lightingMood: 'warm', 
        emotionalTone: 'hopeful, analytical',
        cameraAngle: 'eye_level'
      },
      5: { 
        type: 'rising', 
        recommendedShot: 'medium_wide', // NEW: Medium wide for context
        lightingMood: 'neutral', 
        emotionalTone: 'elaborating, connecting dots',
        cameraAngle: 'eye_level'
      },
      6: { 
        type: 'payoff', 
        recommendedShot: 'wide', 
        lightingMood: 'warm', 
        emotionalTone: 'conclusive, satisfied, insightful',
        cameraAngle: 'high_angle' // NEW: High angle for conclusion
      }
    };
    return mapping[scenePosition] || mapping[6];
  }
  
  // Double Conflict Arc (7 scenes) - NEW: Enhanced with advanced shots
  if (narrativeType === 'double_conflict') {
    const mapping: Record<number, SceneTypeInfo> = {
      1: { type: 'hook', recommendedShot: 'extreme_closeup', lightingMood: 'dramatic', emotionalTone: 'urgent, breaking news energy', cameraAngle: 'low_angle' },
      2: { type: 'rising', recommendedShot: 'medium_closeup', lightingMood: 'neutral', emotionalTone: 'setting up the context', cameraAngle: 'eye_level' },
      3: { type: 'conflict', recommendedShot: 'dutch_angle', lightingMood: 'dramatic', emotionalTone: 'first major concern, skeptical', cameraAngle: 'low_angle' },
      4: { type: 'comeback', recommendedShot: 'medium', lightingMood: 'warm', emotionalTone: 'temporary relief, but...', cameraAngle: 'eye_level' },
      5: { type: 'conflict', recommendedShot: 'dutch_angle', lightingMood: 'cool', emotionalTone: 'second blow, compounding issues', cameraAngle: 'low_angle' },
      6: { type: 'comeback', recommendedShot: 'medium_wide', lightingMood: 'warm', emotionalTone: 'resolution path, optimistic', cameraAngle: 'eye_level' },
      7: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'final takeaway, call to action', cameraAngle: 'high_angle' }
    };
    return mapping[scenePosition] || mapping[7];
  }
  
  // Hot Take Compressed (4 scenes) - NEW: Enhanced with advanced shots
  if (narrativeType === 'hot_take') {
    const mapping: Record<number, SceneTypeInfo> = {
      1: { type: 'hook', recommendedShot: 'extreme_closeup', lightingMood: 'dramatic', emotionalTone: 'punchy, immediate impact', cameraAngle: 'low_angle' },
      2: { type: 'conflict', recommendedShot: 'dutch_angle', lightingMood: 'dramatic', emotionalTone: 'the problem, the drama', cameraAngle: 'low_angle' },
      3: { type: 'comeback', recommendedShot: 'medium_closeup', lightingMood: 'neutral', emotionalTone: 'quick analysis, hot take', cameraAngle: 'eye_level' },
      4: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'mic drop moment, conclusion', cameraAngle: 'high_angle' }
    };
    return mapping[scenePosition] || mapping[4];
  }
  
    // Perspective Clash (6 scenes) - NEW: Enhanced with over-shoulder shots
    if (narrativeType === 'perspective_clash') {
      const mapping: Record<number, SceneTypeInfo> = {
        1: { type: 'hook', recommendedShot: 'extreme_closeup', lightingMood: 'dramatic', emotionalTone: 'presenting the debate topic', cameraAngle: 'low_angle' },
        2: { type: 'perspective', recommendedShot: 'over_shoulder', lightingMood: 'cool', emotionalTone: 'hostA POV - skeptical, analytical', cameraAngle: 'eye_level' },
        3: { type: 'perspective', recommendedShot: 'over_shoulder', lightingMood: 'warm', emotionalTone: 'hostB POV - optimistic, contrarian', cameraAngle: 'eye_level' },
        4: { type: 'clash', recommendedShot: 'dutch_angle', lightingMood: 'dramatic', emotionalTone: 'debate peak, tension, back-and-forth', cameraAngle: 'low_angle' },
        5: { type: 'synthesis', recommendedShot: 'medium_wide', lightingMood: 'neutral', emotionalTone: 'finding middle ground', cameraAngle: 'eye_level' },
        6: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'unified conclusion, audience takeaway', cameraAngle: 'high_angle' }
      };
      return mapping[scenePosition] || mapping[6];
    }
    
    // NEW: Inverted Pyramid (5 scenes) - News → Details → Context → Analysis → Takeaway
    if (narrativeType === 'inverted_pyramid') {
      const mapping: Record<number, SceneTypeInfo> = {
        1: { type: 'hook', recommendedShot: 'extreme_closeup', lightingMood: 'dramatic', emotionalTone: 'breaking news headline, immediate impact', cameraAngle: 'low_angle' },
        2: { type: 'rising', recommendedShot: 'medium_closeup', lightingMood: 'neutral', emotionalTone: 'key details and facts, who/what/when/where', cameraAngle: 'eye_level' },
        3: { type: 'rising', recommendedShot: 'medium', lightingMood: 'neutral', emotionalTone: 'broader context and background, why it matters', cameraAngle: 'eye_level' },
        4: { type: 'rising', recommendedShot: 'medium_wide', lightingMood: 'warm', emotionalTone: 'deeper analysis and implications', cameraAngle: 'eye_level' },
        5: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'key takeaway and what to watch for', cameraAngle: 'high_angle' }
      };
      return mapping[scenePosition] || mapping[5];
    }
    
    // NEW: Question-Driven (6 scenes) - Question → Answer 1 → Answer 2 → Debate → Synthesis → Conclusion
    if (narrativeType === 'question_driven') {
      const mapping: Record<number, SceneTypeInfo> = {
        1: { type: 'hook', recommendedShot: 'extreme_closeup', lightingMood: 'dramatic', emotionalTone: 'provocative question that creates curiosity', cameraAngle: 'low_angle' },
        2: { type: 'rising', recommendedShot: 'medium_closeup', lightingMood: 'neutral', emotionalTone: 'first answer or perspective', cameraAngle: 'eye_level' },
        3: { type: 'rising', recommendedShot: 'medium_closeup', lightingMood: 'neutral', emotionalTone: 'second answer or alternative perspective', cameraAngle: 'eye_level' },
        4: { type: 'conflict', recommendedShot: 'dutch_angle', lightingMood: 'dramatic', emotionalTone: 'debate between perspectives, tension', cameraAngle: 'low_angle' },
        5: { type: 'synthesis', recommendedShot: 'medium_wide', lightingMood: 'warm', emotionalTone: 'synthesis of both perspectives, finding balance', cameraAngle: 'eye_level' },
        6: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'conclusion and final answer to the question', cameraAngle: 'high_angle' }
      };
      return mapping[scenePosition] || mapping[6];
    }
    
    // NEW: Timeline Arc (7 scenes) - Present → Past → Context → Development → Current → Future → Implications
    if (narrativeType === 'timeline_arc') {
      const mapping: Record<number, SceneTypeInfo> = {
        1: { type: 'hook', recommendedShot: 'extreme_closeup', lightingMood: 'dramatic', emotionalTone: 'current situation, what\'s happening now', cameraAngle: 'low_angle' },
        2: { type: 'rising', recommendedShot: 'medium', lightingMood: 'cool', emotionalTone: 'historical context, how we got here', cameraAngle: 'eye_level' },
        3: { type: 'rising', recommendedShot: 'medium_wide', lightingMood: 'neutral', emotionalTone: 'broader context and background', cameraAngle: 'eye_level' },
        4: { type: 'rising', recommendedShot: 'medium', lightingMood: 'neutral', emotionalTone: 'key developments that led to current state', cameraAngle: 'eye_level' },
        5: { type: 'rising', recommendedShot: 'medium_closeup', lightingMood: 'warm', emotionalTone: 'current state and immediate situation', cameraAngle: 'eye_level' },
        6: { type: 'rising', recommendedShot: 'medium_wide', lightingMood: 'warm', emotionalTone: 'future implications and what\'s next', cameraAngle: 'eye_level' },
        7: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'overall implications and takeaway', cameraAngle: 'high_angle' }
      };
      return mapping[scenePosition] || mapping[7];
    }
    
    // NEW: Contrast Arc (5 scenes) - Situation A → Situation B → Comparison → Analysis → Verdict
    if (narrativeType === 'contrast_arc') {
      const mapping: Record<number, SceneTypeInfo> = {
        1: { type: 'hook', recommendedShot: 'extreme_closeup', lightingMood: 'dramatic', emotionalTone: 'introducing the contrast or comparison', cameraAngle: 'low_angle' },
        2: { type: 'rising', recommendedShot: 'medium', lightingMood: 'cool', emotionalTone: 'situation A - first scenario or perspective', cameraAngle: 'eye_level' },
        3: { type: 'rising', recommendedShot: 'medium', lightingMood: 'warm', emotionalTone: 'situation B - second scenario or perspective', cameraAngle: 'eye_level' },
        4: { type: 'conflict', recommendedShot: 'dutch_angle', lightingMood: 'dramatic', emotionalTone: 'direct comparison and analysis of differences', cameraAngle: 'low_angle' },
        5: { type: 'payoff', recommendedShot: 'wide', lightingMood: 'warm', emotionalTone: 'verdict and conclusion on which is better/why', cameraAngle: 'high_angle' }
      };
      return mapping[scenePosition] || mapping[5];
    }
  
  // Default fallback
  return { type: 'rising', recommendedShot: 'medium', lightingMood: 'neutral', emotionalTone: 'informative' };
};

/**
 * Generate camera movements for dynamic shots
 * CRITICAL FIX: Adds camera movement to prevent static, boring shots
 */
const generateCameraMovement = (
  sceneIndex: number,
  totalScenes: number,
  sceneType: SceneTypeInfo,
  sceneDuration: number
): CameraMovement | undefined => {
  // Push in for hooks and conflicts (dramatic moments)
  if (sceneType.type === 'hook' || sceneType.type === 'conflict') {
    return {
      type: 'push_in',
      intensity: sceneType.type === 'hook' ? 'moderate' : 'subtle',
      duration: Math.min(sceneDuration, 2), // First 2 seconds
      startTime: 0
    };
  }
  
  // Pull out for payoffs (revealing conclusion)
  if (sceneType.type === 'payoff') {
    return {
      type: 'pull_out',
      intensity: 'moderate',
      duration: Math.min(sceneDuration, 2), // Last 2 seconds
      startTime: Math.max(0, sceneDuration - 2)
    };
  }
  
  // Subtle pan for variety in middle scenes
  if (sceneIndex % 2 === 0 && sceneType.type === 'rising') {
    return {
      type: 'pan_right',
      intensity: 'subtle',
      duration: sceneDuration,
      startTime: 0
    };
  }
  
  // Default: static (no movement)
  return undefined;
};

/**
 * Generate detailed expression and gesture hints based on emotional tone
 * NEW: Expresiones y Gestos Dinámicos - More detailed and dynamic expressions
 */
const getExpressionHint = (
  videoMode: VideoMode | 'both', // Accept legacy 'both' for backwards compat
  emotionalTone: string,
  hostAPersonality: string,
  hostBPersonality: string,
  sceneType?: SceneTypeInfo
): string => {
  const toneKeywords = emotionalTone.toLowerCase();
  
  // Convert legacy "both" to hostA
  const effectiveMode = (videoMode as string) === 'both' ? 'hostA' : videoMode;
  
  // NEW: Enhanced expression hints with gestures and dynamic movements
  if (effectiveMode === 'hostA') {
    if (toneKeywords.includes('skeptical') || toneKeywords.includes('concern')) {
      return 'raised eyebrow, slight smirk, leaning back skeptically, hand gesture pointing upward (questioning), subtle head shake, crossed arms posture';
    }
    if (toneKeywords.includes('dramatic') || toneKeywords.includes('breaking')) {
      return 'serious expression, direct eye contact, leaning forward intensely, hand gesture emphasizing point (pointing or open palm), intense facial expression, engaged body language';
    }
    if (toneKeywords.includes('conclusion') || toneKeywords.includes('satisfied')) {
      return 'subtle nod, knowing smile, relaxed posture, open hand gesture (welcoming), confident expression, slight lean back';
    }
    if (sceneType?.type === 'hook') {
      return 'intense expression, direct eye contact, forward lean, hand gesture creating emphasis, animated facial expression, high energy';
    }
    return 'sarcastic half-smile, casual posture, dry humor expression, subtle hand gestures, relaxed but engaged';
  }
  
  // hostB - Enhanced expressions
  if (toneKeywords.includes('optimistic') || toneKeywords.includes('hopeful')) {
    return 'bright eyes, animated hand gestures (open palms, pointing), leaning in enthusiastically, wide smile, nodding, energetic body movements';
  }
  if (toneKeywords.includes('dramatic') || toneKeywords.includes('tension')) {
    return 'wide eyes, expressive reactions, engaged posture, hand gestures emphasizing emotion (hands to chest, open gestures), animated facial expressions, forward lean';
  }
  if (toneKeywords.includes('conclusion') || toneKeywords.includes('warm')) {
    return 'warm smile, open body language, nodding affirmatively, welcoming hand gestures, relaxed but expressive, genuine expression';
  }
  if (sceneType?.type === 'hook') {
    return 'surprised expression, wide eyes, animated gestures, forward lean, high energy, engaging facial expression';
  }
  return 'playful expression, energetic gestures, witty smile, animated hand movements, expressive body language, engaging posture';
};

/**
 * Build a comprehensive visual prompt for InfiniteTalk
 * Now includes camera movement instructions for dynamic shots
 */
const buildVisualPrompt = (
  scene: Scene,
  config: ChannelConfig,
  seedImages: Record<string, string>,
  studioSetup: string,
  sceneTypeInfo: SceneTypeInfo,
  expressionHint: string,
  cameraMovement?: CameraMovement
): string => {
  const hostA = config.characters.hostA;
  const hostB = config.characters.hostB;
  
  // Shot framing instructions - NEW: Extended with advanced shot types
  const shotFraming: Record<string, string> = {
    'extreme_closeup': 'Extreme close-up shot, very tight framing on face only, eyes and mouth prominent, maximum emotional impact',
    'closeup': 'Close-up shot, tight framing on face and upper torso, emphasizing facial expressions',
    'medium_closeup': 'Medium close-up shot, framing from chest to head, intimate dialogue framing, showing subtle expressions',
    'medium': 'Medium shot, standard podcast framing showing desk and microphone, professional news aesthetic',
    'medium_wide': 'Medium wide shot, showing more context including desk setup and background, establishing scene',
    'wide': 'Wide shot, showing full studio setup with both positions visible, establishing full environment',
    'dutch_angle': 'Dutch angle shot (tilted camera), creating tension and unease, dramatic framing, off-kilter composition',
    'over_shoulder': 'Over-the-shoulder shot, showing one character from behind the other, conversation framing, dynamic perspective'
  };
  
  // Lighting adjustments based on mood
  const lightingAdjustments = {
    'neutral': 'balanced tungsten key light, subtle purple/blue fill',
    'dramatic': 'stronger contrast, deeper shadows, blue accent lights more prominent',
    'warm': 'warmer tungsten tones, soft orange accents, inviting atmosphere',
    'cool': 'cooler color temperature, more blue/purple accent emphasis'
  };
  
  // Convert legacy "both" to hostA for backwards compatibility
  const effectiveVideoMode = (scene.video_mode as string) === 'both' ? 'hostA' : scene.video_mode;
  
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
SHOT: ${shotFraming[scene.shot] || shotFraming['medium']}
CAMERA ANGLE: ${sceneTypeInfo.cameraAngle ? 
  (sceneTypeInfo.cameraAngle === 'low_angle' ? 'Low angle shot, camera looking up, creates power and intensity' :
   sceneTypeInfo.cameraAngle === 'high_angle' ? 'High angle shot, camera looking down, creates conclusion and overview' :
   sceneTypeInfo.cameraAngle === 'bird_eye' ? 'Bird\'s eye view, top-down perspective, wide context' :
   sceneTypeInfo.cameraAngle === 'worm_eye' ? 'Worm\'s eye view, extreme low angle, dramatic perspective' :
   'Eye-level shot, standard perspective') : 'Eye-level shot, standard perspective'}
MODEL: ${scene.model}

STUDIO ENVIRONMENT:
${studioSetup}
Lighting: ${lightingAdjustments[sceneTypeInfo.lightingMood]}

${sceneTypeInfo.type === 'hook' || sceneTypeInfo.type === 'conflict' ? `
BACKGROUND CONTEXT (NEW: Dynamic Backgrounds):
- For financial news: Subtle stock market charts or financial data visualization in background
- For breaking news: Newsroom environment with screens showing headlines
- For analysis: Clean professional studio with data displays
- Background should be subtle, not distracting from characters
` : ''}

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
- Natural blinking and micro-expressions
- Maintain character consistency with seed image

DYNAMIC EXPRESSIONS & GESTURES (CRITICAL FOR ENGAGEMENT):
- ${expressionHint}
- Hand gestures should be natural and match the dialogue emphasis
- Head movements (nodding, shaking, tilting) should reflect agreement/disagreement
- Posture changes (leaning forward/back) should match emotional intensity
- Facial expressions should be pronounced and clear (not subtle)
- Body language should be animated and engaging, not static
- Gestures should occur at key moments: when emphasizing numbers, asking questions, making points

${cameraMovement ? `
CAMERA MOVEMENT (CRITICAL FOR DYNAMIC SHOTS):
- Movement Type: ${cameraMovement.type}
- Intensity: ${cameraMovement.intensity}
- Duration: ${cameraMovement.duration.toFixed(1)}s
- Start Time: ${cameraMovement.startTime.toFixed(1)}s into scene
- ${cameraMovement.type === 'push_in' ? 'Slowly push camera closer to subject for emphasis' : ''}
- ${cameraMovement.type === 'pull_out' ? 'Slowly pull camera back to reveal more context' : ''}
- ${cameraMovement.type === 'pan_right' || cameraMovement.type === 'pan_left' ? `Smooth ${cameraMovement.type === 'pan_right' ? 'right' : 'left'} pan for visual interest` : ''}
- Movement should be ${cameraMovement.intensity} and natural, not jarring
` : 'CAMERA: Static, eye-level position (no movement)'}

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
  // NEW: Select seed image variants based on scene type
  const seedImages = {
    ...FALLBACK_SEED_IMAGES,
    ...(config.seedImages || {})
  };
  
  // Helper to get seed image with variant selection
  const getSeedImageForScene = (character: 'hostA' | 'hostB', sceneType: SceneTypeInfo, index: number): string => {
    return selectSeedImageVariant(character, sceneType, config, index);
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
        config.characters.hostB.personality || config.characters.hostB.bio,
        sceneTypeInfo // NEW: Pass scene type for more contextual expressions
      );
      
      // CRITICAL FIX: Generate camera movement for dynamic shots
      // Estimate scene duration from text (words / 2.5 words per second)
      const sceneWordCount = scene.text.split(/\s+/).length;
      const sceneEstimatedDuration = Math.max(3, sceneWordCount / 2.5);
      const sceneCameraMovement = generateCameraMovement(index, totalScenes, sceneTypeInfo, sceneEstimatedDuration);
      
      // NEW: Select seed image variant based on scene type and camera angle
      // Use seed image variations service for dynamic angles
      let selectedSeedImage: string;
      if (scene.video_mode === 'hostA') {
        selectedSeedImage = getSeedImageVariation(config, 'hostA', sceneTypeInfo.cameraAngle || 'eye_level');
      } else if (scene.video_mode === 'hostB') {
        selectedSeedImage = getSeedImageVariation(config, 'hostB', sceneTypeInfo.cameraAngle || 'eye_level');
      } else {
        selectedSeedImage = getSeedImageVariation(config, 'twoShot', sceneTypeInfo.cameraAngle || 'eye_level');
      }
      
      // Update seedImages with selected variant for this scene
      const sceneSeedImages = {
        ...seedImages,
        hostASolo: scene.video_mode === 'hostA' ? selectedSeedImage : seedImages.hostASolo,
        hostBSolo: scene.video_mode === 'hostB' ? selectedSeedImage : seedImages.hostBSolo
      };
      
      const visualPrompt = buildVisualPrompt(
        correctedScene,
        config,
        sceneSeedImages,
        studioSetup,
        sceneTypeInfo,
        expressionHint,
        sceneCameraMovement
      );

      return {
        sceneNumber,
        sceneIndex: index,
        prompt: buildLegacyPrompt(correctedScene, config, seedImages, studioSetup),
        scene: correctedScene,
        visualPrompt,
        lightingMood: sceneTypeInfo.lightingMood,
        expressionHint,
        cameraMovement: sceneCameraMovement // NEW: Include camera movement
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
  const effectiveMode = (scene.video_mode as string) === 'both' ? 'hostA' : scene.video_mode;
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
