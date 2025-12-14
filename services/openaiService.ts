/**
 * OpenAI Service
 * 
 * Provides GPT-4o for text generation and OpenAI TTS for audio.
 * Uses the /api/openai proxy for all requests.
 */

import { ScriptLine, NewsItem, ViralMetadata, ChannelConfig, ScriptWithScenes, NarrativeType, Scene } from "../types";
import { CostTracker } from "./CostTracker";

// Get proxy URL (auto-detect in production)
const getProxyUrl = (): string => {
  const explicitUrl = import.meta.env.VITE_BACKEND_URL || "";
  if (explicitUrl) return explicitUrl;
  
  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    if (origin.includes('vercel.app') || origin.includes('localhost')) {
      return origin;
    }
  }
  return "";
};

/**
 * Make a request to OpenAI via proxy with retry logic
 * Exported for use in geminiService.ts regenerateScene
 */
export const openaiRequest = async (
  endpoint: string,
  body: any,
  options: { retries?: number; timeout?: number } = {}
): Promise<any> => {
  const { retries = 2, timeout = 55000 } = options; // 55s to leave room before Vercel timeout
  const proxyUrl = getProxyUrl().replace(/\/$/, '');
  const url = `${proxyUrl}/api/openai?endpoint=${encodeURIComponent(endpoint)}`;
  
  console.log(`[OpenAI] 🔗 Calling: ${endpoint}`);
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || 'Unknown error';
        
        // If timeout or server error, allow retry
        if (response.status >= 500 && attempt < retries) {
          console.warn(`[OpenAI] ⚠️ Attempt ${attempt + 1} failed (${response.status}), retrying...`);
          lastError = new Error(`OpenAI API error: ${response.status} - ${errorMsg}`);
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
          continue;
        }
        
        throw new Error(`OpenAI API error: ${response.status} - ${errorMsg}`);
      }
      
      return response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`[OpenAI] ⏱️ Request timeout after ${timeout}ms`);
        lastError = new Error('Request timeout');
      } else {
        lastError = error;
      }
      
      if (attempt < retries) {
        console.warn(`[OpenAI] ⚠️ Attempt ${attempt + 1} failed, retrying...`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
  }
  
  throw lastError || new Error('OpenAI request failed after retries');
};

// =============================================================================================
// TEXT GENERATION (GPT-4o)
// =============================================================================================

/**
 * Generate a script from selected news with fallback to gpt-4o-mini
 */
export const generateScriptWithGPT = async (
  news: NewsItem[], 
  config: ChannelConfig, 
  viralHook?: string,
  improvements?: { implement: string[]; maintain: string[] }
): Promise<ScriptWithScenes> => {
  // Limit news items to reduce context size and latency
  const limitedNews = news.slice(0, 5);
  const newsContext = limitedNews.map(n => `- ${n.headline} (${n.source}): ${n.summary?.substring(0, 160) || ''}`).join('\n');

  const hostA = config.characters.hostA;
  const hostB = config.characters.hostB;
  
  // Get available sound effects from storage
  const { listAvailableSoundEffects } = await import('./elevenlabsService');
  type SoundEffectType = 'transition' | 'emphasis' | 'notification' | 'ambient' | 'none';
  const availableSoundEffects = await listAvailableSoundEffects();

  /**
   * Build detailed character behavior prompt from behaviorInstructions
   * NEW: Advanced behavior configuration from Admin Dashboard
   */
  const buildCharacterBehaviorPrompt = (character: typeof hostA | typeof hostB, characterName: string): string => {
    const behavior = character.behaviorInstructions;
    if (!behavior) return ''; // No behavior instructions configured
    
    return `
=== ADVANCED BEHAVIOR INSTRUCTIONS FOR ${characterName.toUpperCase()} ===

SPEAKING STYLE:
- Sentence Length: ${behavior.speakingStyle.sentenceLength} (${behavior.speakingStyle.sentenceLength === 'short' ? '5-10 words' : behavior.speakingStyle.sentenceLength === 'medium' ? '10-15 words' : '15+ words'})
- Formality: ${behavior.speakingStyle.formality}
- Energy Level: ${behavior.speakingStyle.energy}
- Use Contractions: ${behavior.speakingStyle.useContractions ? 'YES' : 'NO'}
- Use Slang: ${behavior.speakingStyle.useSlang ? 'YES' : 'NO'}
- Use Numbers: ${behavior.speakingStyle.useNumbers}

TONE & ATTITUDE:
- Default Tone: ${behavior.tone.default}
- Tone for Good News: ${behavior.tone.variations.forGoodNews}
- Tone for Bad News: ${behavior.tone.variations.forBadNews}
- Tone for Controversial Topics: ${behavior.tone.variations.forControversial}

VIEWPOINTS & PERSPECTIVES:
- On Markets: ${behavior.viewpoints.onMarkets}
- On Companies: ${behavior.viewpoints.onCompanies}
- On Regulation: ${behavior.viewpoints.onRegulation}
- On Innovation: ${behavior.viewpoints.onInnovation}

CATCHPHRASES (Use these frequently):
${behavior.catchphrases.length > 0 ? behavior.catchphrases.map(cp => `- "${cp}"`).join('\n') : '- None configured'}

EXPRESSIONS:
- Agreement: ${behavior.expressions.agreement.join(', ')}
- Disagreement: ${behavior.expressions.disagreement.join(', ')}
- Surprise: ${behavior.expressions.surprise.join(', ')}
- Skepticism: ${behavior.expressions.skepticism.join(', ')}

ARGUMENTATION STYLE:
- Style: ${behavior.argumentation.style}
- Use Examples: ${behavior.argumentation.useExamples ? 'YES' : 'NO'}
- Use Analogies: ${behavior.argumentation.useAnalogies ? 'YES' : 'NO'}
- Use Data: ${behavior.argumentation.useData}
- Challenge Others: ${behavior.argumentation.challengeOthers ? 'YES' : 'NO'}

INTERACTION WITH OTHER HOST:
- Interrupt Frequency: ${behavior.interaction.interruptFrequency}
- Build on Others' Points: ${behavior.interaction.buildOnOthers ? 'YES' : 'NO'}
- Create Contrast: ${behavior.interaction.createContrast ? 'YES' : 'NO'}
- Agreement Level: ${behavior.interaction.agreementLevel}

${behavior.customInstructions ? `CUSTOM INSTRUCTIONS:\n${behavior.customInstructions}\n` : ''}

${behavior.dialogueExamples.good.length > 0 ? `GOOD DIALOGUE EXAMPLES:\n${behavior.dialogueExamples.good.map(ex => `- "${ex}"`).join('\n')}\n` : ''}
${behavior.dialogueExamples.bad.length > 0 ? `WHAT NOT TO DO:\n${behavior.dialogueExamples.bad.map(ex => `- "${ex}"`).join('\n')}\n` : ''}

CRITICAL: ${characterName}'s dialogue MUST follow ALL these behavior instructions precisely.
`.trim();
  };
  
  const hostABehaviorPrompt = buildCharacterBehaviorPrompt(hostA, hostA.name);
  const hostBBehaviorPrompt = buildCharacterBehaviorPrompt(hostB, hostB.name);

  const hostProfilePrompt = `
=== HOST PROFILES (CRITICAL: Each host MUST speak according to their personality) ===

HOST A (${hostA.name}):
- Gender: ${hostA.gender || 'male'}
- Outfit: ${hostA.outfit || 'dark hoodie'}
- PERSONALITY & IDEOLOGY: ${hostA.personality || hostA.bio}
- SPEAKING STYLE: ${hostA.name} MUST express opinions that align with their personality above. 
  If they are pro-market/libertarian: celebrate free enterprise, private investment, deregulation.
  If they are progressive: question environmental impact, corporate accountability, social costs.
${hostABehaviorPrompt ? `\n${hostABehaviorPrompt}\n` : ''}

HOST B (${hostB.name}):
- Gender: ${hostB.gender || 'female'}
- Outfit: ${hostB.outfit || 'teal blazer and white shirt'}
- PERSONALITY & IDEOLOGY: ${hostB.personality || hostB.bio}
- SPEAKING STYLE: ${hostB.name} MUST express opinions that align with their personality above.
  They should provide CONTRAST to Host A - challenging or supporting from their own ideological stance.
${hostBBehaviorPrompt ? `\n${hostBBehaviorPrompt}\n` : ''}

⚠️ CRITICAL RULE: Each host's dialogue MUST reflect their specific personality/ideology.
- If a host is described as "free-market, libertarian" → they should CELEBRATE private enterprise, be skeptical of regulations
- If a host is described as "progressive, social equity" → they should QUESTION corporate motives, environmental impact
- DO NOT MIX UP THE IDEOLOGIES - each host has a DISTINCT viewpoint that creates debate
${hostABehaviorPrompt || hostBBehaviorPrompt ? '\n⚠️ ADDITIONAL: Follow ALL advanced behavior instructions configured above for each host.' : ''}
`.trim();

  // CRITICAL FIX: Redesigned narrative structures optimized for 80%+ retention
  // ENHANCED: Ultra-viral prompts for maximum engagement
  const narrativeInstructions = `
🚨 CRITICAL VIRALITY RULES - MUST FOLLOW FOR 80%+ RETENTION:

1. HOOK (First 3-5 seconds) - ABSOLUTELY CRITICAL:
   - MUST start with a SHOCKING number, question, or statement
   - Examples: "$50 BILLION lost in one day", "Why is everyone selling?", "This just changed everything"
   - NEVER start with "Today we're talking about..." or "Let's discuss..."
   - First sentence MUST be under 15 words and create IMMEDIATE curiosity

2. RETENTION TECHNIQUES (Apply to EVERY scene):
   - End each scene with a "curiosity gap" - make viewer NEED to continue
   - Use "but wait, there's more..." patterns
   - Create "information debt" - promise answers later
   - Use cliffhangers between scenes: "Here's what they're not telling you..."
   - Numbers and statistics: "$2.3 billion", "47% drop", "3 reasons why"

3. PACING (CRITICAL):
   - First 10 seconds: HIGH ENERGY, fast-paced, no dead air
   - Middle: Steady information delivery with hooks
   - Last 10 seconds: Strong conclusion with call-to-action
   - NO slow moments, NO filler words, NO unnecessary explanations

4. LENGTH OPTIMIZATION (MANDATORY):
   - Target: 45-60 seconds total (NOT 90+ seconds)
   - Each scene: 6-10 seconds MAX (40-60 words)
   - Cut ruthlessly - one key point per scene
   - If script is longer than 60 seconds when read, it's TOO LONG

5. ENGAGEMENT HOOKS (Use throughout):
   - Numbers: "$2.3 billion", "47% drop", "3 reasons"
   - Contrast: "Everyone thinks X, but Y is happening"
   - Emotional triggers: "This is INSANE", "You won't believe this"
   - Urgency: "This is happening RIGHT NOW"
   - Questions: "What does this mean for you?"

6. DIALOGUE RULES (CRITICAL):
   - Short, punchy sentences (5-10 words max)
   - NO long explanations
   - Use contractions for natural flow
   - Alternate hosts every 1-2 sentences (NOT every paragraph)
   - One key point per sentence

Choose ONE narrative structure optimized for MAXIMUM RETENTION (target: 80%+):

1. VIRAL HOOK HEAVY (5 scenes) - RECOMMENDED FOR MAXIMUM RETENTION
   Structure: Hook (4s) → Context (8s) → Revelation (12s) → Impact (14s) → CTA (12s)
   Total: ~50 seconds
   Best for: Breaking news, dramatic stories, high-impact events
   Retention target: 85%+

2. Classic Arc (6 scenes) - Balanced structure
   Structure: Hook (5s) → Rising (8s) → Conflict (10s) → Comeback (10s) → Rising2 (10s) → Payoff (12s)
   Total: ~55 seconds
   Best for: Complex stories with multiple angles
   Retention target: 75%+

3. Hot Take Compressed (4 scenes) - Fast-paced
   Structure: Hook (4s) → Conflict (8s) → Comeback (10s) → Payoff (13s)
   Total: ~35 seconds
   Best for: Simple stories, meme-worthy content
   Retention target: 80%+

4. Double Conflict Arc (7 scenes) - For volatile news
   Structure: Hook (4s) → Rising (7s) → ConflictA (9s) → RisingA (8s) → ConflictB (9s) → RisingB (8s) → Payoff (10s)
   Total: ~55 seconds
   Best for: Multiple crises, volatile markets
   Retention target: 75%+

5. Perspective Clash (6 scenes) - For debates
   Structure: Hook (5s) → hostA POV (10s) → hostB POV (10s) → Clash (10s) → Synthesis (10s) → Payoff (10s)
   Total: ~55 seconds
   Best for: Controversial topics, two-sided stories
   Retention target: 75%+

6. Inverted Pyramid (5 scenes) - NEW: News-first structure
   Structure: News (4s) → Details (8s) → Context (10s) → Analysis (12s) → Takeaway (11s)
   Total: ~45 seconds
   Best for: Breaking news, factual reporting
   Retention target: 80%+

7. Question-Driven (6 scenes) - NEW: Curiosity-based
   Structure: Question (5s) → Answer1 (9s) → Answer2 (9s) → Debate (10s) → Synthesis (10s) → Conclusion (12s)
   Total: ~55 seconds
   Best for: Complex questions, multiple perspectives
   Retention target: 75%+

8. Timeline Arc (7 scenes) - NEW: Temporal progression
   Structure: Present (4s) → Past (8s) → Context (9s) → Development (9s) → Current (9s) → Future (10s) → Implications (11s)
   Total: ~60 seconds
   Best for: Evolving stories, historical context
   Retention target: 70%+

9. Contrast Arc (5 scenes) - NEW: Comparison structure
   Structure: Hook (4s) → Situation A (10s) → Situation B (10s) → Comparison (12s) → Verdict (14s)
   Total: ~50 seconds
   Best for: Comparing options, before/after stories
   Retention target: 75%+

SELECTION LOGIC (Prioritize retention):
- Use VIRAL HOOK HEAVY if story is breaking/urgent (highest retention)
- Use Hot Take if story is simple/meme-like (fast retention)
- Use Inverted Pyramid for breaking news/factual reporting
- Use Question-Driven for complex questions needing exploration
- Use Timeline Arc for evolving stories with history
- Use Contrast Arc for comparison/versus stories
- Use Double Conflict if multiple volatile drivers
- Use Perspective Clash if story has two clear opposing views
- Otherwise use Classic Arc

CRITICAL: Each scene MUST be 6-10 seconds when read at normal pace (40-60 words).
Total video MUST be 45-60 seconds. If longer, cut ruthlessly.
`.trim();

  // Language detection for transition phrases
  const isSpanish = (config.language || '').toLowerCase().includes('spanish') || 
                    (config.language || '').toLowerCase().includes('español');
  
  const transitionPhrases = isSpanish ? [
    'Siguiendo con otro tema',
    'Cambiando de tema',
    'Además',
    'Por otro lado',
    'Mientras tanto',
    'Ahora hablemos de',
    'Pasando a otro asunto',
    'En otro orden de cosas'
  ] : [
    'Moving on to another topic',
    'Switching gears',
    'Additionally',
    'On another note',
    'Meanwhile',
    'Let\'s talk about',
    'Shifting to another subject',
    'In other news'
  ];

  const dialogueRules = `
Dialogue Rules:
- Alternate dialogue strictly (${hostA.name} then ${hostB.name})
- No narration, stage directions, or camera cues
- Tone: conversational podcast banter (${config.tone})
- 80–130 words per scene (40–80 for Hot Take scenes)
- Reference news sources naturally in dialogue

🔗 SCENE TRANSITIONS (CRITICAL - READ CAREFULLY):
- **ONLY** add transition phrases when the scene changes to a COMPLETELY DIFFERENT news topic/story
- If the scene continues the SAME topic or a RELATED topic, DO NOT use any transition phrase
- Examples of DIFFERENT topics (need transition): "Apple earnings" → "Tesla stock crash" (different companies/stories)
- Examples of SAME/RELATED topics (NO transition): "Apple earnings" → "Apple stock reaction" (same company), "Market rally" → "Market analysis" (same topic)
- When you DO need a transition, use phrases like: ${isSpanish ? 
  '"Siguiendo con otro tema", "Cambiando de tema", "Por otro lado", "Ahora hablemos de", "Pasando a otro asunto"' :
  '"Moving on to another topic", "Switching gears", "On another note", "Let\'s talk about", "Shifting to another subject"'}
- **IMPORTANT**: Most consecutive scenes will be about the same or related topics - only use transitions for major topic shifts

⚠️ PERSONALITY ENFORCEMENT:
- ${hostA.name}'s lines MUST match their described personality/ideology
- ${hostB.name}'s lines MUST match their described personality/ideology  
- Create IDEOLOGICAL CONTRAST between hosts based on their personalities
- If host is libertarian/pro-market → pro-business, anti-regulation dialogue
- If host is progressive/social → pro-worker, pro-environment, critical of corporations
- DO NOT SWAP or INVERT their viewpoints!
`.trim();

  const metadataRules = `
For EACH scene provide:
- title: Short, catchy title (3-6 words, punchy and descriptive)
- video_mode: "hostA" | "hostB" (ALTERNATE between hosts for dynamic pacing - NEVER use "both")
- model: "infinite_talk" (always use this model)
- shot: default "medium", "closeup" for Hook/Conflict, "wide" for Payoff
- soundEffects (OPTIONAL): Suggest appropriate sound effects for this scene with PRECISE timing:
  * type: "transition" (for scene changes), "emphasis" (for key points), "notification" (for breaking news), "ambient" (for background atmosphere), or "none"
  * description: **CRITICAL - USE EXACT NAMES ONLY**: You MUST use the EXACT description name as listed below. Copy it exactly, character by character:
${availableSoundEffects.length > 0 
  ? availableSoundEffects.reduce((acc: Array<{ type: string; exactNames: Array<{ description: string; exactName: string }> }>, effect: { type: SoundEffectType; description: string; exactName: string }) => {
      const existing = acc.find((e: { type: string; exactNames: Array<{ description: string; exactName: string }> }) => e.type === effect.type);
      if (existing) {
        existing.exactNames.push({ description: effect.description, exactName: effect.exactName });
      } else {
        acc.push({ type: effect.type, exactNames: [{ description: effect.description, exactName: effect.exactName }] });
      }
      return acc;
    }, [] as Array<{ type: string; exactNames: Array<{ description: string; exactName: string }> }>).map((effect: { type: string; exactNames: Array<{ description: string; exactName: string }> }) => 
      `    - For "${effect.type}" type, use EXACTLY one of these descriptions: ${effect.exactNames.map((e: { description: string; exactName: string }) => `"${e.description}"`).join(', ')}`
    ).join('\n') + `\n  * Available exact names in storage: ${availableSoundEffects.map((e: { exactName: string }) => e.exactName).join(', ')}`
  : '    - No sound effects available. Use "none" for all scenes.'}
  * **CRITICAL RULE**: The "description" field MUST match EXACTLY one of the descriptions listed above. Do NOT modify, abbreviate, or change the description in any way. Copy it exactly as shown.
  * startTime: EXACT timing - "start" (0s into scene), "end" (at scene end), "middle" (middle of scene), or a NUMBER (seconds into scene, e.g., 2.5)
  * duration: EXACT duration in seconds (e.g., 0.5, 1.0, 1.5, 2.0) - keep short (0.3-2.0s for most effects)
  * endTime: OPTIONAL explicit end time in seconds (if not provided, calculated as startTime + duration)
  * volume: 0.3-0.5 (lower volume for background effects)

SOUND EFFECT GUIDELINES:
- Use "transition" type for scene changes (especially when topic changes) - duration: 0.5-1.5s, startTime: "start" or 0
- Use "emphasis" for dramatic moments, key revelations, or important statistics - duration: 0.3-1.0s, startTime: specific moment in dialogue
- Use "notification" for breaking news or urgent information - duration: 0.5-1.0s, startTime: "start" or when news is mentioned
- Use "ambient" sparingly for atmospheric scenes - duration: 2.0-5.0s, startTime: "start" or "middle"
- Use "none" for most scenes (don't overuse sound effects)
- Keep volume low (0.3-0.5) so effects enhance but don't distract from dialogue
- Be PRECISE with timing - specify exact seconds when the effect should start and how long it should last

CRITICAL RULES:
- ALWAYS alternate between hostA and hostB scenes for dynamic pacing
- NEVER create scenes with both hosts together - each scene focuses on ONE character
- Keep scenes SHORT (40-80 words) for fast-paced, dynamic delivery
- Use "text" field with that host's dialogue
- For soundEffects: ALWAYS specify startTime and duration when type is not "none"
`.trim();

  const outputFormat = `
Return STRICT JSON (no markdown) with this exact format:
{
  "title": "Episode title",
  "narrative_used": "classic | double_conflict | hot_take | perspective_clash | inverted_pyramid | question_driven | timeline_arc | contrast_arc",
  "scenes": {
    "1": {
      "title": "Scene Title Here",
      "text": "${hostA.name}'s dialogue (40-80 words)",
      "video_mode": "hostA",
      "model": "infinite_talk",
      "shot": "closeup",
      "soundEffects": {
        "type": "transition",
        "description": "whoosh",
        "startTime": "start",
        "duration": 1.0,
        "volume": 0.4
      }
    },
    "2": {
      "title": "Another Scene Title",
      "text": "${hostB.name}'s dialogue (40-80 words)",
      "video_mode": "hostB",
      "model": "infinite_talk",
      "shot": "medium",
      "soundEffects": {
        "type": "none"
      }
    },
    "3": {
      "title": "Third Scene Title",
      "text": "${hostA.name}'s dialogue (40-80 words)",
      "video_mode": "hostA",
      "model": "infinite_talk",
      "shot": "medium",
      "soundEffects": {
        "type": "emphasis",
        "description": "drum roll",
        "startTime": 3.5,
        "duration": 0.8,
        "volume": 0.3
      }
    }
  }
}

CRITICAL: 
- ALTERNATE between hostA and hostB for every scene (hostA → hostB → hostA → hostB...)
- NEVER use video_mode "both" - each scene features ONE host only
- Keep dialogue SHORT (40-80 words) for dynamic, fast-paced delivery
- Include soundEffects for scenes where it enhances the narrative (use "none" if not needed)
`.trim();

  // Build ethical guardrails prompt from config
  const ethicalGuardrails = config.ethicalGuardrails?.enabled !== false ? `
ETHICAL GUARDRAILS (CRITICAL):
${config.ethicalGuardrails?.sensitiveTopics?.deaths === 'empathetic' 
  ? '- When covering deaths/tragedies: Express genuine empathy for victims. Never make jokes about the deceased. Criticism is OK for negligent parties/companies.'
  : config.ethicalGuardrails?.sensitiveTopics?.deaths === 'factual'
  ? '- When covering deaths/tragedies: Report factually without emotional commentary or humor.'
  : '- Avoid covering deaths/tragedies unless essential to the story.'}
${config.ethicalGuardrails?.sensitiveTopics?.violence === 'critical'
  ? '- When covering violence: Critically analyze causes and responsible parties. No glorification.'
  : config.ethicalGuardrails?.sensitiveTopics?.violence === 'factual'
  ? '- When covering violence: Report factually without sensationalism.'
  : '- Minimize coverage of violent events.'}
${config.ethicalGuardrails?.sensitiveTopics?.politics === 'satirical'
  ? '- Politics: Satirical commentary is encouraged. Mock politicians and policies, not voters.'
  : config.ethicalGuardrails?.sensitiveTopics?.politics === 'neutral'
  ? '- Politics: Maintain balanced, neutral coverage without taking sides.'
  : '- Avoid political topics when possible.'}
${config.ethicalGuardrails?.humorRules?.targetCompanies ? '- OK to satirize/criticize companies and corporations.' : '- Be neutral when discussing companies.'}
${config.ethicalGuardrails?.humorRules?.targetPoliticians ? '- OK to satirize politicians and public figures.' : '- Be respectful of political figures.'}
${config.ethicalGuardrails?.humorRules?.targetInstitutions ? '- OK to criticize institutions and organizations.' : '- Be neutral about institutions.'}
- NEVER make jokes about individual victims, deceased persons, or their families. This is non-negotiable.
- Sarcasm about corporate negligence is ENCOURAGED when they harm people.
${config.ethicalGuardrails?.customInstructions ? `- Additional rules: ${config.ethicalGuardrails.customInstructions}` : ''}
`.trim() : '';

  // CRITICAL VIRALITY RULES - Must be at the top for maximum impact
  const viralityRules = `
🚨 CRITICAL VIRALITY RULES (MUST FOLLOW FOR 80%+ RETENTION):

1. HOOK (First Scene - 3-5 seconds):
   - MUST start with a shocking statement, question, or number
   - Examples: "This company just lost $50 BILLION in one day"
   - Examples: "Why is everyone selling? Here's what they're hiding"
   - Examples: "47% drop in 24 hours - here's why"
   - NEVER start with "Today we're talking about..." or "Let's discuss..."
   - Hook MUST be under 20 words and create immediate curiosity

2. RETENTION TECHNIQUES (Apply throughout):
   - End each scene with a "curiosity gap" that makes viewer want to continue
   - Use "but wait, there's more..." patterns
   - Create "information debt" - promise answers later
   - Use cliffhangers between scenes: "Here's the twist...", "But that's not all...", "Wait until you hear this..."

3. PACING (Critical for retention):
   - First 10 seconds: HIGH ENERGY, fast-paced (hook + quick context)
   - Middle: Steady information delivery with mini-hooks
   - Last 10 seconds: Strong conclusion with call-to-action
   - NO dead air, NO slow moments, NO filler words
   - Each scene: 6-10 seconds MAX when read at normal pace

4. LENGTH OPTIMIZATION (Target: 45-60 seconds total):
   - Target: 45-60 seconds total (NOT 90+ seconds)
   - Each scene: 6-10 seconds MAX (40-60 words)
   - Cut unnecessary words ruthlessly
   - One key point per scene
   - If script is longer than 60 seconds when read at normal pace, it's TOO LONG - cut it down immediately

5. ENGAGEMENT HOOKS (Use throughout):
   - Use numbers and statistics: "$2.3 billion", "47% drop", "3x increase"
   - Create contrast: "Everyone thinks X, but Y is happening"
   - Use emotional triggers: "This is INSANE", "You won't believe this", "This changes everything"
   - Add urgency: "This is happening RIGHT NOW", "Breaking:"
   - Use power words: SHOCKING, SECRET, INSANE, CRAZY, UNBELIEVABLE, HIDDEN

6. DIALOGUE OPTIMIZATION:
   - Short, punchy sentences (5-10 words max per sentence)
   - NO long explanations or complex sentences
   - Use contractions for natural flow
   - Alternate hosts every 1-2 sentences (NOT every paragraph)
   - Each host speaks 1-2 sentences max before switching

7. STRUCTURE FOR RETENTION:
   - Scene 1 (Hook): Shocking opening (3-5s, 15-25 words)
   - Scene 2: Quick context (4-6s, 20-30 words)
   - Scene 3: The twist/revelation (5-7s, 25-35 words)
   - Scene 4: Why it matters (4-6s, 20-30 words)
   - Scene 5: Implications (4-6s, 20-30 words)
   - Scene 6: Strong conclusion + CTA (5-7s, 25-35 words)

CRITICAL: If the script is longer than 60 seconds when read at normal pace, it's TOO LONG. Cut it down immediately.
`.trim();

  const systemPrompt = `
You are the head writer of "${config.channelName}", a daily business/markets podcast hosted by two animated chimpanzees.

${viralityRules}

${hostProfilePrompt}

${narrativeInstructions}

${dialogueRules}

${ethicalGuardrails ? ethicalGuardrails + '\n\n' : ''}${metadataRules}

${outputFormat}
`.trim();

  // Build improvements section if regenerating with feedback
  const improvementsSection = improvements ? `
IMPORTANT - REGENERATION WITH IMPROVEMENTS:
This is a script regeneration. You MUST implement these specific improvements:

${improvements.implement.length > 0 ? `IMPROVEMENTS TO IMPLEMENT (REQUIRED):
${improvements.implement.map((imp, i) => `${i + 1}. ${imp}`).join('\n')}` : ''}

${improvements.maintain.length > 0 ? `STRENGTHS TO MAINTAIN (Keep these in the new script):
${improvements.maintain.map((str, i) => `${i + 1}. ${str}`).join('\n')}` : ''}

Focus on implementing the requested improvements while preserving the strengths. The new script should be noticeably better than the previous version.
` : '';

  const userPrompt = `
Generate a complete narrative using the instructions above.
Language: ${config.language}
Tone: ${config.tone}
${viralHook ? `Hook reference: "${viralHook}"` : ''}
${improvementsSection}
Today's news:
${newsContext}
`.trim();

  const requestBody = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7
  };

  // Try GPT-4o first, fallback to gpt-4o-mini if it fails
  const models = ['gpt-4o', 'gpt-4o-mini'];
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      console.log(`[Script] 🎬 Trying ${model}...`);
      const response = await openaiRequest('chat/completions', {
        model,
        ...requestBody
      }, { timeout: model === 'gpt-4o' ? 45000 : 30000 }); // Shorter timeout for first try

      CostTracker.track('script', model, model === 'gpt-4o' ? 0.01 : 0.002);

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content) as ScriptWithScenes;
      validateScriptWithScenes(parsed);
      
      // Add scene transitions if missing
      addSceneTransitions(parsed, config);
      
      console.log(`[Script] ✅ Success with ${model}`);
      return parsed;
    } catch (error: any) {
      console.warn(`[Script] ⚠️ ${model} failed:`, error.message);
      lastError = error;
      // Continue to next model
    }
  }

  console.error("[Script] ❌ All models failed");
  throw lastError || new Error('Script generation failed');
};

/**
 * Helper function to add transition phrases between scenes when topics change
 */
const addSceneTransitions = (script: ScriptWithScenes, config: ChannelConfig) => {
  const isSpanish = (config.language || '').toLowerCase().includes('spanish') || 
                    (config.language || '').toLowerCase().includes('español');
  
  const transitionPhrases = isSpanish ? [
    'Siguiendo con otro tema',
    'Cambiando de tema',
    'Además',
    'Por otro lado',
    'Mientras tanto',
    'Ahora hablemos de',
    'Pasando a otro asunto',
    'En otro orden de cosas'
  ] : [
    'Moving on to another topic',
    'Switching gears',
    'Additionally',
    'On another note',
    'Meanwhile',
    'Let\'s talk about',
    'Shifting to another subject',
    'In other news'
  ];
  
  // Helper to check if text already starts with a transition phrase
  const hasTransition = (text: string): boolean => {
    const lowerText = text.toLowerCase();
    return transitionPhrases.some(phrase => lowerText.startsWith(phrase.toLowerCase()));
  };
  
  // Helper to extract key topics/entities from text (simple heuristic)
  const extractTopics = (text: string): string[] => {
    // Extract capitalized words (likely company names, places, etc.)
    const words = text.split(/\s+/);
    const capitalized = words.filter(w => /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/.test(w));
    // Also extract quoted phrases
    const quoted = text.match(/"([^"]+)"/g) || [];
    return [...capitalized, ...quoted.map(q => q.replace(/"/g, ''))];
  };
  
  // Helper to check if two scenes are about different topics
  // IMPORTANT: Only returns true for MAJOR topic changes, not related topics
  const isDifferentTopic = (prevText: string, currentText: string): boolean => {
    const prevTopics = extractTopics(prevText);
    const currentTopics = extractTopics(currentText);
    
    // Normalize text for better comparison (remove transition phrases that might already exist)
    const normalizeText = (text: string) => {
      let normalized = text.toLowerCase();
      // Remove common transition phrases
      transitionPhrases.forEach(phrase => {
        normalized = normalized.replace(new RegExp(`^${phrase.toLowerCase()}[,\\s]*`, 'i'), '');
      });
      return normalized;
    };
    
    const prevNormalized = normalizeText(prevText);
    const currentNormalized = normalizeText(currentText);
    
    // Extract key entities (company names, proper nouns) - these are more reliable indicators
    const extractKeyEntities = (text: string): string[] => {
      const entities: string[] = [];
      // Extract capitalized words (potential company names, places, people)
      const words = text.split(/\s+/);
      words.forEach((w: string) => {
        // Match capitalized words that look like proper nouns (not at start of sentence)
        if (/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/.test(w)) {
          entities.push(w.toLowerCase());
        }
      });
      return entities;
    };
    
    const prevEntities = extractKeyEntities(prevNormalized);
    const currentEntities = extractKeyEntities(currentNormalized);
    
    // Check for common entities - if there are common entities, likely same/related topic
    const commonEntities = prevEntities.filter((e: string) => currentEntities.includes(e));
    
    // Also check for semantic similarity using keywords
    const extractKeywords = (text: string): string[] => {
      const keywords = isSpanish
        ? ['empresa', 'empresas', 'mercado', 'mercados', 'acciones', 'acciones', 'economía', 'banco', 'bancos', 'inflación', 'desempleo']
        : ['company', 'companies', 'market', 'markets', 'stock', 'stocks', 'economy', 'bank', 'banks', 'inflation', 'unemployment'];
      return keywords.filter(kw => text.includes(kw));
    };
    
    const prevKeywords = extractKeywords(prevNormalized);
    const currentKeywords = extractKeywords(currentNormalized);
    const commonKeywords = prevKeywords.filter(kw => currentKeywords.includes(kw));
    
    // Decision logic:
    // 1. If there are common entities (same companies/people), it's likely the same topic → NO transition
    if (commonEntities.length >= 2) {
      return false; // Same or related topic
    }
    
    // 2. If there are common keywords AND at least one common entity, same topic → NO transition
    if (commonKeywords.length > 0 && commonEntities.length >= 1) {
      return false; // Related topic
    }
    
    // 3. If both talk about completely different entities with different keywords → Different topic → NEED transition
    if (commonEntities.length === 0 && commonKeywords.length === 0 && 
        prevEntities.length > 0 && currentEntities.length > 0) {
      return true; // Different topic
    }
    
    // 4. Default: Be conservative - if unsure, assume same/related topic (NO transition)
    // This prevents over-adding transitions
    return false;
  };
  
  // First pass: Remove transitions that were incorrectly added (same topic)
  const sceneKeys = Object.keys(script.scenes).sort((a, b) => parseInt(a) - parseInt(b));
  
  for (let i = 1; i < sceneKeys.length; i++) {
    const prevKey = sceneKeys[i - 1];
    const currentKey = sceneKeys[i];
    const prevScene = script.scenes[prevKey];
    const currentScene = script.scenes[currentKey];
    
    if (!prevScene || !currentScene) continue;
    
    // If there's a transition but topics are the same, remove it
    if (hasTransition(currentScene.text) && !isDifferentTopic(prevScene.text, currentScene.text)) {
      // Remove the transition phrase
      let cleanedText = currentScene.text;
      for (const phrase of transitionPhrases) {
        const regex = new RegExp(`^${phrase}[,\\s]+`, 'i');
        if (regex.test(cleanedText)) {
          cleanedText = cleanedText.replace(regex, '').trim();
          currentScene.text = cleanedText;
          console.log(`[Script] 🧹 Removed unnecessary transition from scene ${currentKey}: "${phrase}" (same topic)`);
          break;
        }
      }
    }
  }
  
  // Second pass: Add transitions only when topic actually changed
  for (let i = 1; i < sceneKeys.length; i++) {
    const prevKey = sceneKeys[i - 1];
    const currentKey = sceneKeys[i];
    const prevScene = script.scenes[prevKey];
    const currentScene = script.scenes[currentKey];
    
    if (!prevScene || !currentScene) continue;
    
    // Only add transition if topic changed AND no transition exists
    if (isDifferentTopic(prevScene.text, currentScene.text) && !hasTransition(currentScene.text)) {
      const randomTransition = transitionPhrases[Math.floor(Math.random() * transitionPhrases.length)];
      currentScene.text = `${randomTransition}, ${currentScene.text}`;
      console.log(`[Script] 🔗 Added transition to scene ${currentKey}: "${randomTransition}" (topic changed)`);
    }
  }
};

const VALID_NARRATIVES: NarrativeType[] = ['classic', 'double_conflict', 'hot_take', 'perspective_clash'];
const VALID_VIDEO_MODES: Scene['video_mode'][] = ['hostA', 'hostB']; // Removed 'both' for dynamic single-character scenes
const VALID_SHOTS: Scene['shot'][] = ['medium', 'closeup', 'wide'];
const VALID_ORDERS: Scene['order'][] = ['left_first', 'right_first', 'meanwhile'];

const validateScriptWithScenes = (script: ScriptWithScenes) => {
  if (!script || typeof script !== 'object') {
    throw new Error('Invalid script payload (not an object)');
  }

  if (!script.title || typeof script.title !== 'string') {
    throw new Error('Script missing title');
  }

  if (!VALID_NARRATIVES.includes(script.narrative_used as NarrativeType)) {
    throw new Error(`Invalid narrative_used "${script.narrative_used}"`);
  }

  if (!script.scenes || typeof script.scenes !== 'object' || Object.keys(script.scenes).length === 0) {
    throw new Error('Script missing scenes');
  }

  for (const [sceneId, scene] of Object.entries(script.scenes)) {
    if (!scene || typeof scene !== 'object') {
      throw new Error(`Scene ${sceneId} is invalid`);
    }
    
    // Convert legacy "both" scenes to hostA (backwards compatibility)
    if ((scene.video_mode as string) === 'both') {
      console.warn(`Scene ${sceneId}: Converting legacy "both" video_mode to "hostA"`);
      scene.video_mode = 'hostA';
      scene.model = 'infinite_talk';
      // Use hostA_text if available, otherwise keep text
      if (scene.hostA_text && scene.hostA_text.trim().length > 0) {
        scene.text = scene.hostA_text;
      }
    }
    
    if (!VALID_VIDEO_MODES.includes(scene.video_mode)) {
      throw new Error(`Scene ${sceneId} has invalid video_mode "${scene.video_mode}"`);
    }
    
    // All scenes require text (single host only)
    if (!scene.text || typeof scene.text !== 'string') {
      throw new Error(`Scene ${sceneId} missing text`);
    }
    
    // Normalize model to infinite_talk (no multi model needed)
    if (scene.model === 'infinite_talk_multi') {
      scene.model = 'infinite_talk';
    }
    
    if (!scene.model || scene.model !== 'infinite_talk') {
      throw new Error(`Scene ${sceneId} has invalid model "${scene.model}"`);
    }
    if (!VALID_SHOTS.includes(scene.shot)) {
      throw new Error(`Scene ${sceneId} has invalid shot "${scene.shot}"`);
    }
  }
};

/**
 * Regenerate a single scene in the script
 * Keeps the scene structure but generates new dialogue
 */
export const regenerateScene = async (
  sceneNumber: number,
  currentScene: { title?: string; text: string; video_mode: string; shot?: string },
  allScenes: Record<string, { title?: string; text: string; video_mode: string }>,
  config: ChannelConfig,
  newsContext: string,
  instruction?: string // Optional instruction for how to regenerate (e.g., "make it funnier", "add more data")
): Promise<{ title: string; text: string; video_mode: string; model: string; shot: string }> => {
  const hostA = config.characters.hostA;
  const hostB = config.characters.hostB;
  const speaker = currentScene.video_mode === 'hostA' ? hostA.name : hostB.name;
  const character = currentScene.video_mode === 'hostA' ? hostA : hostB;
  
  // Get context from surrounding scenes
  const prevScene = allScenes[String(sceneNumber - 1)]?.text || '';
  const nextScene = allScenes[String(sceneNumber + 1)]?.text || '';
  
  // Language handling
  const isSpanish = (config.language || '').toLowerCase().includes('spanish') || 
                    (config.language || '').toLowerCase().includes('español');
  
  const languageInstruction = isSpanish
    ? `IMPORTANTE: Genera el contenido COMPLETAMENTE en ESPAÑOL.`
    : `Generate content in English.`;
  
  const transitionPhrases = isSpanish ? [
    'Siguiendo con otro tema',
    'Cambiando de tema',
    'Además',
    'Por otro lado',
    'Mientras tanto',
    'Ahora hablemos de',
    'Pasando a otro asunto',
    'En otro orden de cosas'
  ] : [
    'Moving on to another topic',
    'Switching gears',
    'Additionally',
    'On another note',
    'Meanwhile',
    'Let\'s talk about',
    'Shifting to another subject',
    'In other news'
  ];

  const systemPrompt = `You are a scriptwriter for a news podcast. You need to regenerate a single scene.

${languageInstruction}

SPEAKER: ${speaker}
SPEAKER PERSONALITY: ${character.personality}
TONE: ${config.tone || 'Conversational'}

The scene should:
- Be 40-80 words
- Match the speaker's personality and ideology
- Flow naturally from the previous scene and into the next
- Keep the podcast banter style

🔗 TRANSITION RULES:
${prevScene ? `- **ONLY** add a transition phrase if this scene changes to a COMPLETELY DIFFERENT topic from the previous scene
- If the scene continues the SAME topic or is RELATED to the previous scene, DO NOT use any transition phrase
- Examples that need transition: "Apple earnings" → "Tesla stock crash" (different companies)
- Examples that DON'T need transition: "Apple earnings" → "Apple stock reaction" (same company), "Market rally" → "Market analysis" (same topic)
- When you DO need a transition, use: ${isSpanish ? '"Siguiendo con otro tema", "Cambiando de tema", "Por otro lado", "Ahora hablemos de"' : '"Moving on to another topic", "Switching gears", "On another note", "Let\'s talk about"'}
- **IMPORTANT**: Most scenes will be related - only use transitions for major topic shifts` : '- This is the first scene, no transition needed'}

${instruction ? `\n\nSPECIAL INSTRUCTION: ${instruction}` : ''}

Return ONLY valid JSON:
{
  "title": "Short catchy scene title (3-6 words)",
  "text": "The regenerated dialogue (40-80 words)"
}`;

  const userPrompt = `NEWS CONTEXT:
${newsContext}

PREVIOUS SCENE:
${prevScene || '(This is the first scene)'}

CURRENT SCENE TO REGENERATE:
Title: ${currentScene.title || 'Scene ' + sceneNumber}
Original text: ${currentScene.text}

NEXT SCENE:
${nextScene || '(This is the last scene)'}

Please regenerate this scene with fresh dialogue.`;

  try {
    const response = await openaiRequest('chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.8
    }, { timeout: 20000 });

    CostTracker.track('scene_regenerate', 'gpt-4o-mini', 0.002);

    const result = JSON.parse(response.choices[0].message.content);
    
    let regeneratedText = result.text || currentScene.text;
    
    // Check if transition is needed (if previous scene exists and topic changed)
    // Use more conservative logic - only add if clearly different topic
    if (prevScene && sceneNumber > 1) {
      const hasTransition = transitionPhrases.some(phrase =>
        regeneratedText.toLowerCase().startsWith(phrase.toLowerCase())
      );

      // Remove transition if present but topic is the same
      if (hasTransition) {
        let cleanedText = regeneratedText;
        for (const phrase of transitionPhrases) {
          const regex = new RegExp(`^${phrase}[,\\s]+`, 'i');
          if (regex.test(cleanedText)) {
            cleanedText = cleanedText.replace(regex, '').trim();
            break;
          }
        }
        regeneratedText = cleanedText;
      }

      // Extract entities for better comparison
      const prevEntities = (prevScene.match(/\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/g) || []).map((e: string) => e.toLowerCase());
      const currentEntities = (regeneratedText.match(/\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/g) || []).map((e: string) => e.toLowerCase());
      const commonEntities = prevEntities.filter((e: string) => currentEntities.includes(e));

      // Only add transition if NO common entities (completely different topic)
      // Be conservative - if there's any overlap, assume same/related topic
      if (commonEntities.length === 0 && prevEntities.length > 0 && currentEntities.length > 0 && !hasTransition) {
        const randomTransition = transitionPhrases[Math.floor(Math.random() * transitionPhrases.length)];
        regeneratedText = `${randomTransition}, ${regeneratedText}`;
        console.log(`[Scene Regen] 🔗 Added transition to scene ${sceneNumber}: "${randomTransition}" (different topic)`);
      } else if (commonEntities.length > 0) {
        console.log(`[Scene Regen] ✓ Scene ${sceneNumber}: Same/related topic (${commonEntities.length} common entities), no transition needed`);
      }
    }
    
    return {
      title: result.title || currentScene.title || `Scene ${sceneNumber}`,
      text: regeneratedText,
      video_mode: currentScene.video_mode,
      model: 'infinite_talk',
      shot: currentScene.shot || 'medium'
    };
  } catch (error) {
    console.error(`[Scene Regen] Failed to regenerate scene ${sceneNumber}:`, error);
    throw error;
  }
};

/**
 * Generate viral metadata (title, description, tags) with fallback
 */
export const createTitleVariantFallback = (primary: string): string => {
  const base = primary?.trim() || "Breaking Market Shake-Up";
  const cleaned = base.replace(/^BREAKING[:\-–]\s*/i, '').trim();
  const emphasis = cleaned.length > 0 ? cleaned : base;
  const templates = [
    (copy: string) => `BREAKING UPDATE ⚡ ${copy}`,
    (copy: string) => `SHOCKING REVERSAL: ${copy}`,
    (copy: string) => `EXPLAINED 👉 ${copy}`
  ];
  const index = Math.abs(emphasis.length % templates.length);
  return templates[index](emphasis).substring(0, 100);
};

export const generateViralMetadataWithGPT = async (
  news: NewsItem[], 
  config: ChannelConfig, 
  date: Date,
  trendingTopics: string[] = []
): Promise<ViralMetadata> => {
  // Limit news to top 3 for faster processing
  const topNews = news.slice(0, 3);
  const newsContext = topNews.map(n => `- ${n.headline} (Score: ${n.viralScore})`).join('\n');
  const dateStr = date.toLocaleDateString();
  
  // Determine language and power words based on channel config
  const language = config.language || 'English';
  const isSpanish = language.toLowerCase().includes('spanish') || 
                    language.toLowerCase().includes('español') || 
                    language.toLowerCase().includes('argentina');
  
  const powerWordsGuide = isSpanish
    ? `- Usar PALABRAS DE PODER en español: ALERTA, URGENTE, EXCLUSIVO, REVELADO, ESCÁNDALO, BOMBA
- El título debe estar COMPLETAMENTE en español
- NO usar palabras en inglés como "Breaking", "Exposed", "Shocking", etc.`
    : `- Start with POWER WORDS: BREAKING, SHOCKING, EXPOSED, URGENT, REVEALED
- Title must be in English`;
  
  const languageInstruction = isSpanish
    ? `IMPORTANTE: TODO el contenido debe estar en ESPAÑOL. No usar palabras en inglés.`
    : `All content must be in English.`;
  
  const prompt = `You are a VIRAL YouTube SEO expert with 10+ years optimizing for maximum CTR and discoverability.

${languageInstruction}

Create HIGH-PERFORMANCE metadata for this news broadcast video:

NEWS STORIES:
${newsContext}

TRENDING TOPICS: ${trendingTopics.slice(0, 5).join(', ')}
DATE: ${dateStr}
CHANNEL: ${config.tagline}
LANGUAGE: ${language}

Generate metadata following YouTube SEO best practices:

TITLE (70-80 characters):
${powerWordsGuide}
- Include main keyword from top story
- Add 1-2 relevant emojis for visual appeal
- Create curiosity gap without clickbait

TITLE VARIANTS (provide two options for A/B testing):
- Output an array "title_variants" with TWO unique hooks
- Variation B must emphasize a different emotion or curiosity gap
- Keep both under 80 characters and punchy
- The first element MUST match the TITLE exactly

DESCRIPTION (500-700 characters):
- Line 1: Compelling hook summarizing the main story (this shows in search results)
- Line 2-3: Key details and context about the news
- Include date: ${dateStr}
- Include channel branding: "${config.tagline}"
- Add relevant keywords naturally
- End with call-to-action: subscribe, like, comment prompt

TAGS (20 tags):
- Mix of broad and specific keywords
- Include trending topics if relevant
- Must include: ${(config.defaultTags || []).slice(0, 5).join(', ')}

Return ONLY valid JSON: {"title": "...", "title_variants": ["...", "..."], "description": "...", "tags": [...]}`;

  const requestBody = {
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.8
  };

  // Try GPT-4o first, fallback to gpt-4o-mini
  const models = ['gpt-4o', 'gpt-4o-mini'];

  for (const model of models) {
    try {
      console.log(`[Metadata] 🏷️ Trying ${model}...`);
      const response = await openaiRequest('chat/completions', {
        model,
        ...requestBody
      }, { timeout: model === 'gpt-4o' ? 30000 : 20000 });

      CostTracker.track('metadata', model, model === 'gpt-4o' ? 0.015 : 0.003);

      const content = response.choices[0]?.message?.content || '{}';
      const metadata = JSON.parse(content);
      console.log(`[Metadata] ✅ Success with ${model}`);
      
      const rawTitle = metadata.title || metadata.title_primary || metadata.primaryTitle;
      const rawVariants: string[] = Array.isArray(metadata.title_variants) ? metadata.title_variants : [];
      const variantCandidates = [
        rawTitle,
        ...(rawVariants || []),
        metadata.variant_title,
        metadata.altTitle
      ].filter((value): value is string => Boolean(value)).map((value: string) => value.substring(0, 100));

      const uniqueVariants: string[] = [];
      for (const title of variantCandidates) {
        if (title && !uniqueVariants.some(existing => existing.toLowerCase() === title.toLowerCase())) {
          uniqueVariants.push(title);
        }
      }

      if (uniqueVariants.length === 0 && rawTitle) {
        uniqueVariants.push(rawTitle.substring(0, 100));
      }

      if (uniqueVariants.length < 2 && uniqueVariants[0]) {
        uniqueVariants.push(createTitleVariantFallback(uniqueVariants[0]));
      }

      return {
        title: uniqueVariants[0]?.substring(0, 100) || "Breaking News",
        titleVariants: uniqueVariants.slice(0, 2),
        description: metadata.description?.substring(0, 1000) || "",
        tags: Array.isArray(metadata.tags) ? metadata.tags.slice(0, 20) : []
      };
    } catch (error: any) {
      console.warn(`[Metadata] ⚠️ ${model} failed:`, error.message);
    }
  }

  console.error("[Metadata] ❌ All models failed, using defaults");
  // Fallback respects language (reuse isSpanish from outer scope)
  const fallbackTitle = isSpanish ? "Últimas Noticias" : "Breaking News";
  return { 
    title: fallbackTitle, 
    titleVariants: [fallbackTitle, createTitleVariantFallback(fallbackTitle)], 
    description: "", 
    tags: config.defaultTags || [] 
  };
};

/**
 * Viral Hook Analysis Interface
 */
export interface ViralHookAnalysis {
  hook: string;
  predictedCTR: number; // 0-100
  curiosityScore: number; // 0-100
  trendingRelevance: number; // 0-100
  emotionalImpact: 'high' | 'medium' | 'low';
  hasNumber: boolean;
  hasQuestion: boolean;
  hasShockWord: boolean;
  wordCount: number;
}

/**
 * Generate multiple viral hook variants with analysis
 * NEW: Hook Optimized with AI - generates 5-10 variants and analyzes them
 */
export const generateViralHookVariantsWithGPT = async (
  news: NewsItem[],
  config: ChannelConfig,
  trendingTopics: string[] = []
): Promise<ViralHookAnalysis[]> => {
  const topStory = news[0];
  const language = config.language || 'English';
  const isSpanish = language.toLowerCase().includes('spanish') || 
                    language.toLowerCase().includes('español');

  const powerWords = isSpanish
    ? 'ALERTA, URGENTE, EXCLUSIVO, REVELADO, ESCÁNDALO, BOMBA, IMPACTANTE'
    : 'YOU, THIS, NOW, SHOCKING, BREAKING, EXPOSED, REVEALED, INSANE';

  const prompt = `You are a VIRAL content scriptwriter specializing in YouTube hooks (100M+ views).

Generate 8-10 DIFFERENT opening hook variants (2-3 sentences, max 30 words each) for this news:
"${topStory.headline}"
${topStory.summary ? `Summary: ${topStory.summary.substring(0, 200)}` : ''}

TRENDING TOPICS: ${trendingTopics.slice(0, 5).join(', ')}

HOOK FORMULAS (use different approaches):
1. Shocking Statement: Start with a surprising fact or number
2. Urgent Question: Pose a compelling question that creates curiosity
3. Breaking News: Frame as urgent/breaking information
4. Contrast/Contradiction: "Everyone thinks X, but Y is happening"
5. Personal Connection: "This affects YOU because..."
6. Revelation: "Here's what they're hiding..."
7. Number Hook: Start with a specific statistic or amount
8. Emotional Trigger: Appeal to fear, excitement, or surprise

POWER WORDS: ${powerWords}

Channel tone: ${config.tone}
Language: ${language}

Return JSON array with this exact format:
[
  {
    "hook": "First hook variant text here",
    "approach": "shocking_statement" | "urgent_question" | "breaking_news" | "contrast" | "personal" | "revelation" | "number" | "emotional"
  },
  {
    "hook": "Second hook variant text here",
    "approach": "..."
  },
  ...
]

Generate 8-10 unique variants using different approaches.`;

  try {
    const response = await openaiRequest('chat/completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.9
    });

    CostTracker.track('viralHook', 'gpt-4o', 0.01);

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    
    // Handle both array and object with variants key
    const variants = Array.isArray(parsed) 
      ? parsed 
      : (parsed.variants || parsed.hooks || []);
    
    if (!Array.isArray(variants) || variants.length === 0) {
      throw new Error('No variants returned');
    }

    // Analyze each hook variant
    const analyzed: ViralHookAnalysis[] = variants.map((v: any) => {
      const hook = (v.hook || v.text || '').trim();
      const wordCount = hook.split(/\s+/).length;
      const hasNumber = /\d+/.test(hook);
      const hasQuestion = hook.includes('?');
      const hasShockWord = new RegExp(
        isSpanish 
          ? 'alerta|urgente|exclusivo|revelado|escándalo|bomba|impactante|increíble|insólito'
          : 'shocking|breaking|exposed|revealed|insane|crazy|unbelievable|secret|hidden',
        'i'
      ).test(hook);
      
      // Calculate curiosity score
      let curiosityScore = 0;
      if (hasQuestion) curiosityScore += 30;
      if (hasShockWord) curiosityScore += 25;
      if (hasNumber) curiosityScore += 20;
      if (hook.toLowerCase().includes('you') || hook.toLowerCase().includes('tu')) curiosityScore += 15;
      if (hook.toLowerCase().includes('this') || hook.toLowerCase().includes('esto')) curiosityScore += 10;
      curiosityScore = Math.min(100, curiosityScore);
      
      // Calculate trending relevance
      const trendingRelevance = trendingTopics.length > 0
        ? trendingTopics.reduce((score, topic) => {
            const topicLower = topic.toLowerCase();
            const hookLower = hook.toLowerCase();
            return score + (hookLower.includes(topicLower) ? 20 : 0);
          }, 0)
        : 50; // Default if no trending topics
      
      // Determine emotional impact
      const emotionalImpact: 'high' | 'medium' | 'low' = 
        (hasShockWord && hasNumber) ? 'high' :
        (hasShockWord || hasQuestion) ? 'medium' : 'low';
      
      // Predict CTR (0-100) based on multiple factors
      let predictedCTR = 50; // Base
      if (hasNumber) predictedCTR += 15;
      if (hasQuestion) predictedCTR += 12;
      if (hasShockWord) predictedCTR += 10;
      if (wordCount <= 20) predictedCTR += 8; // Shorter is better
      if (curiosityScore > 60) predictedCTR += 10;
      if (trendingRelevance > 60) predictedCTR += 5;
      predictedCTR = Math.min(100, Math.max(0, predictedCTR));
      
      return {
        hook,
        predictedCTR,
        curiosityScore,
        trendingRelevance,
        emotionalImpact,
        hasNumber,
        hasQuestion,
        hasShockWord,
        wordCount
      };
    });

    // Sort by predicted CTR (best first)
    analyzed.sort((a, b) => b.predictedCTR - a.predictedCTR);
    
    console.log(`[Hook] ✅ Generated ${analyzed.length} hook variants, best CTR: ${analyzed[0]?.predictedCTR}%`);
    
    return analyzed;
  } catch (error) {
    console.error('[Hook] ❌ Failed to generate variants:', error);
    // Fallback: return single hook
    const fallback = await generateViralHookWithGPT(news, config);
    return [{
      hook: fallback,
      predictedCTR: 50,
      curiosityScore: 40,
      trendingRelevance: 50,
      emotionalImpact: 'medium',
      hasNumber: false,
      hasQuestion: false,
      hasShockWord: false,
      wordCount: fallback.split(/\s+/).length
    }];
  }
};

/**
 * Generate a viral hook for the intro (legacy function - now uses variants)
 */
export const generateViralHookWithGPT = async (
  news: NewsItem[],
  config: ChannelConfig
): Promise<string> => {
  const variants = await generateViralHookVariantsWithGPT(news, config);
  // Return the best hook (highest predicted CTR)
  return variants[0]?.hook || "You won't believe this news...";
};

// =============================================================================================
// TEXT-TO-SPEECH (OpenAI TTS)
// =============================================================================================

/**
 * OpenAI TTS Voices (as per ChimpNews Spec v2.0):
 * - hostA (Rusty) → echo (male, warm)
 * - hostB (Dani) → shimmer (female, expressive)
 * 
 * Available OpenAI voices: alloy, echo, fable, onyx, nova, shimmer
 */
type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';

// Direct OpenAI voices - no mapping needed
const DIRECT_OPENAI_VOICES: OpenAIVoice[] = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

// Legacy voice name mappings (for backwards compatibility)
const LEGACY_VOICE_MAP: Record<string, OpenAIVoice> = {
  // Legacy male voices → echo
  'Kore': 'echo',
  'Puck': 'onyx',
  'Charon': 'onyx',
  'Fenrir': 'echo',
  'Orus': 'fable',
  // Legacy female voices → shimmer  
  'Leda': 'shimmer',
  'Aoede': 'nova',
  'Zephyr': 'nova',
  'Elara': 'shimmer',
  'Hera': 'alloy',
};

/**
 * Get OpenAI voice from character voice name
 * Simplified: if voice is already an OpenAI voice, use it directly
 * Otherwise, check legacy mapping or default to alloy
 */
const getOpenAIVoice = (voiceName: string): OpenAIVoice => {
  const normalized = voiceName.toLowerCase().trim();
  
  // Check if it's already a direct OpenAI voice (spec compliant: echo/shimmer)
  if (DIRECT_OPENAI_VOICES.includes(normalized as OpenAIVoice)) {
    return normalized as OpenAIVoice;
  }
  
  // Check legacy mapping for backwards compatibility
  if (voiceName in LEGACY_VOICE_MAP) {
    return LEGACY_VOICE_MAP[voiceName];
  }
  
  // Default: echo for unrecognized male-sounding, shimmer for female-sounding
  if (normalized.includes('female') || normalized.includes('woman') || normalized.includes('girl')) {
    return 'shimmer';
  }
  if (normalized.includes('male') || normalized.includes('man') || normalized.includes('boy')) {
    return 'echo';
  }
  
  // Ultimate fallback
  return 'alloy';
};

/**
 * Sanitize text for TTS - remove problematic characters and validate
 */
const sanitizeTextForTTS = (text: string): string => {
  if (!text || typeof text !== 'string') {
    throw new Error('TTS input text is empty or invalid');
  }
  
  // Trim and normalize whitespace
  let sanitized = text.trim().replace(/\s+/g, ' ');
  
  // Remove or replace problematic characters
  sanitized = sanitized
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
    .replace(/[""]/g, '"') // Normalize smart quotes
    .replace(/['']/g, "'") // Normalize smart apostrophes
    .replace(/[–—]/g, '-') // Normalize dashes
    .replace(/…/g, '...') // Normalize ellipsis
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim();
  
  // Validate minimum content
  if (sanitized.length === 0) {
    throw new Error('TTS input text is empty after sanitization');
  }
  
  // OpenAI TTS has a character limit (4096 characters)
  if (sanitized.length > 4096) {
    console.warn(`[OpenAI TTS] ⚠️ Text truncated from ${sanitized.length} to 4096 characters`);
    sanitized = sanitized.substring(0, 4096);
  }
  
  return sanitized;
};

/**
 * TTS Model Selection
 * - tts-1: Fast, lower quality (good for English)
 * - tts-1-hd: Higher quality, better pronunciation for non-English languages
 */
type TTSModel = 'tts-1' | 'tts-1-hd';

/**
 * Determine which TTS model to use based on language
 * Non-English languages benefit from tts-1-hd for better pronunciation
 */
const getTTSModel = (language?: string): TTSModel => {
  if (!language) return 'tts-1';
  
  const lang = language.toLowerCase().trim();
  
  // Use HD model for non-English languages (better pronunciation)
  const nonEnglishLanguages = [
    'spanish', 'español', 'es',
    'portuguese', 'português', 'pt',
    'french', 'français', 'fr',
    'german', 'deutsch', 'de',
    'italian', 'italiano', 'it',
    'japanese', '日本語', 'ja',
    'chinese', '中文', 'zh',
    'korean', '한국어', 'ko',
    'russian', 'русский', 'ru',
    'arabic', 'العربية', 'ar',
    'hindi', 'हिंदी', 'hi',
    'dutch', 'nederlands', 'nl',
    'polish', 'polski', 'pl',
    'turkish', 'türkçe', 'tr',
  ];
  
  if (nonEnglishLanguages.some(l => lang.includes(l))) {
    return 'tts-1-hd';
  }
  
  return 'tts-1';
};

/**
 * Generate TTS audio for a single line
 * Returns base64-encoded MP3
 * 
 * Per ChimpNews Spec v2.0:
 * - hostA uses "echo" voice
 * - hostB uses "shimmer" voice
 * 
 * @param text - The text to convert to speech
 * @param voiceName - The voice to use
 * @param language - Optional language hint (e.g., "Spanish") - uses tts-1-hd for non-English
 */
export const generateTTSAudio = async (
  text: string,
  voiceName: string,
  language?: string
): Promise<string> => {
  // Validate and sanitize input text
  let sanitizedText: string;
  try {
    sanitizedText = sanitizeTextForTTS(text);
  } catch (error) {
    console.error(`[OpenAI TTS] ❌ Invalid input text: "${text?.substring(0, 50)}..."`, (error as Error).message);
    throw new Error(`TTS failed: ${(error as Error).message}`);
  }
  
  const voice = getOpenAIVoice(voiceName);
  const model = getTTSModel(language);
  
  console.log(`[OpenAI TTS] 🎙️ Generating audio with voice: ${voice}, model: ${model}${language ? ` (language: ${language})` : ''}`);
  
  try {
    const response = await openaiRequest('audio/speech', {
      model: model,
      input: sanitizedText,
      voice: voice,
      response_format: 'mp3'
    });
    
    // Cost: tts-1 = $0.015/1000 chars, tts-1-hd = $0.030/1000 chars
    const charCount = sanitizedText.length;
    const costPer1000 = model === 'tts-1-hd' ? 0.030 : 0.015;
    const cost = (charCount / 1000) * costPer1000;
    CostTracker.track('audio', `openai-${model}`, cost);
    
    // The proxy returns { audio: base64, format: 'mp3' }
    if (!response.audio) {
      throw new Error('TTS response missing audio data');
    }
    
    return response.audio;
  } catch (error) {
    const errorMsg = (error as Error).message;
    // Provide more context for 400 errors
    if (errorMsg.includes('400')) {
      console.error(`[OpenAI TTS] ❌ 400 error - Input text (${sanitizedText.length} chars): "${sanitizedText.substring(0, 100)}..."`);
      throw new Error(`TTS API rejected the input (400). Text length: ${sanitizedText.length}. First 50 chars: "${sanitizedText.substring(0, 50)}"`);
    }
    throw error;
  }
};

/**
 * Generate TTS audio for multiple lines in parallel
 * @param lines - Array of text and voice configurations
 * @param language - Optional language hint for better pronunciation
 */
export const generateTTSBatch = async (
  lines: { text: string; voiceName: string }[],
  language?: string
): Promise<string[]> => {
  const model = getTTSModel(language);
  console.log(`[OpenAI TTS] 🎙️ Generating ${lines.length} audio segments in parallel (model: ${model})`);
  
  const promises = lines.map(line => generateTTSAudio(line.text, line.voiceName, language));
  return Promise.all(promises);
};

// =============================================================================================
// IMAGE GENERATION (DALL-E 3 - Fallback)
// =============================================================================================

/**
 * Generate an image using DALL-E 3
 * Used as fallback when WaveSpeed Nano Banana fails
 */
export const generateImageWithDALLE = async (
  prompt: string,
  size: '1024x1024' | '1792x1024' | '1024x1792' = '1792x1024'
): Promise<string | null> => {
  console.log(`[DALL-E 3] 🎨 Generating image...`);
  
  try {
    const response = await openaiRequest('images/generations', {
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: size,
      quality: 'standard',
      response_format: 'b64_json'
    });
    
    // Cost: $0.04 for standard, $0.08 for HD
    CostTracker.track('thumbnail', 'dall-e-3', 0.04);
    
    const imageData = response.data?.[0]?.b64_json;
    if (imageData) {
      return `data:image/png;base64,${imageData}`;
    }
    return null;
  } catch (error) {
    console.error("[DALL-E 3] ❌ Image generation failed:", error);
    return null;
  }
};

// =============================================================================================
// VIRAL SCORE ANALYSIS (GPT-4o)
// =============================================================================================

/**
 * Calculate viral score for a news item using GPT-4o analysis
 * Analyzes multiple factors: emotional impact, controversy, relevance, click-worthiness, etc.
 */
export const calculateViralScoreWithGPT = async (
  headline: string,
  summary: string,
  source: string,
  date?: string
): Promise<{ score: number; reasoning: string }> => {
  const prompt = `You are an expert at predicting viral content performance on social media and YouTube.

Analyze this news story and calculate a viral score from 0-100:

HEADLINE: "${headline}"
SUMMARY: "${summary}"
SOURCE: "${source}"
${date ? `DATE: ${date}` : ''}

Evaluate these factors (0-100 scale):
1. **Emotional Impact** (shock, anger, joy, fear) - How strong is the emotional reaction?
2. **Controversy/Polarization** - Will this divide opinions and generate debate?
3. **Relevance/Timeliness** - How current and relevant is this to today's audience?
4. **Click-worthiness** - How compelling is the headline? Does it create curiosity?
5. **Shareability** - Would people want to share this? Does it make them look informed/entertaining?
6. **Uniqueness** - Is this breaking news or a fresh angle on a story?
7. **Source Credibility** - Major trusted sources (CNN, BBC, NYT, Reuters) get bonus points

Return ONLY a JSON object with this exact format:
{
  "viral_score": <number 0-100>,
  "reasoning": "<brief explanation>",
  "factors": {
    "emotional_impact": <0-100>,
    "controversy": <0-100>,
    "relevance": <0-100>,
    "click_worthiness": <0-100>,
    "shareability": <0-100>,
    "uniqueness": <0-100>,
    "source_credibility": <0-100>
  }
}

Be strict: Average news = 40-60, Breaking/controversial = 70-85, Highly viral = 85-100.`;

  try {
    const response = await openaiRequest('chat/completions', {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3 // Lower temperature for more consistent scoring
    }, { timeout: 15000 }); // Shorter timeout for faster processing

    CostTracker.track('viralScore', 'gpt-4o', 0.002); // ~$0.002 per analysis

    const content = response.choices[0]?.message?.content || '{}';
    const analysis = JSON.parse(content);
    
    const score = Math.round(analysis.viral_score || 50);
    const reasoning = analysis.reasoning || 'No explanation provided';
    console.log(`[Viral Score] 📊 "${headline.substring(0, 50)}..." = ${score} (${reasoning.substring(0, 50)})`);
    
    // Ensure score is between 0-100
    return {
      score: Math.max(0, Math.min(100, score)),
      reasoning: reasoning
    };
  } catch (error: any) {
    console.error(`[Viral Score] ❌ GPT analysis failed:`, error.message);
    // Fallback to basic calculation
    const fallbackScore = calculateBasicViralScore(headline, summary, source, date);
    return {
      score: fallbackScore,
      reasoning: 'Score calculated using basic algorithm (GPT analysis unavailable)'
    };
  }
};

/**
 * Batch calculate viral scores for multiple news items
 * Processes in smaller batches (25 items each) to avoid timeouts
 * Uses parallel processing for speed while respecting API limits
 */
export const calculateViralScoresBatch = async (
  newsItems: Array<{ headline: string; summary: string; source: string; date?: string }>
): Promise<Array<{ score: number; reasoning: string }>> => {
  if (newsItems.length === 0) {
    return [];
  }

  const BATCH_SIZE = 25; // Process 25 items per API call to avoid timeouts
  const MAX_PARALLEL = 3; // Max parallel requests to avoid rate limits
  
  console.log(`[Viral Score] 🔥 Analyzing ${newsItems.length} news items in batches of ${BATCH_SIZE}...`);
  
  // Split into batches
  const batches: Array<Array<{ headline: string; summary: string; source: string; date?: string; originalIndex: number }>> = [];
  for (let i = 0; i < newsItems.length; i += BATCH_SIZE) {
    batches.push(
      newsItems.slice(i, i + BATCH_SIZE).map((item, idx) => ({
        ...item,
        originalIndex: i + idx
      }))
    );
  }
  
  console.log(`[Viral Score] 📦 Split into ${batches.length} batches`);
  
  // Process batches with controlled parallelism
  const allResults: Array<{ score: number; reasoning: string; originalIndex: number }> = [];
  
  for (let i = 0; i < batches.length; i += MAX_PARALLEL) {
    const batchGroup = batches.slice(i, i + MAX_PARALLEL);
    const batchPromises = batchGroup.map((batch, groupIdx) => 
      processSingleBatch(batch, i + groupIdx + 1, batches.length)
    );
    
    const groupResults = await Promise.all(batchPromises);
    groupResults.forEach(results => allResults.push(...results));
  }
  
  // Sort by original index and extract results
  allResults.sort((a, b) => a.originalIndex - b.originalIndex);
  const finalResults = allResults.map(r => ({ score: r.score, reasoning: r.reasoning }));
  
  const scores = finalResults.map(r => r.score);
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  console.log(`[Viral Score] ✅ Completed all ${finalResults.length} items. Score range: ${minScore}-${maxScore}`);
  
  return finalResults;
};

/**
 * Process a single batch of news items
 */
const processSingleBatch = async (
  batch: Array<{ headline: string; summary: string; source: string; date?: string; originalIndex: number }>,
  batchNum: number,
  totalBatches: number
): Promise<Array<{ score: number; reasoning: string; originalIndex: number }>> => {
  console.log(`[Viral Score] 📊 Processing batch ${batchNum}/${totalBatches} (${batch.length} items)...`);
  
  // Build prompt for this batch
  const newsListFormatted = batch.map((item, index) => 
    `[${index + 1}] "${item.headline}" - ${item.source}`
  ).join('\n');
  
  const prompt = `Analyze these ${batch.length} news headlines for viral potential (0-100 score).

Factors: emotional impact, controversy, timeliness, clickworthiness, shareability.
- 40-60 = average news
- 70-85 = breaking/controversial  
- 85-100 = highly viral

NEWS:
${newsListFormatted}

Return JSON: {"results":[{"i":1,"s":<score>,"r":"<10 word reason>"},...]}`; 

  try {
    const response = await openaiRequest('chat/completions', {
      model: 'gpt-4o-mini', // Use faster/cheaper model for batch scoring
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3
    }, { timeout: 30000 }); // 30 second timeout per batch

    CostTracker.track('viralScoreBatch', 'gpt-4o-mini', 0.005);

    const content = response.choices[0]?.message?.content || '{}';
    const analysis = JSON.parse(content);
    
    return batch.map((item, idx) => {
      const resultItem = analysis.results?.find((r: any) => r.i === idx + 1 || r.index === idx + 1);
      
      if (resultItem) {
        return {
          score: Math.max(0, Math.min(100, Math.round(resultItem.s || resultItem.viral_score || 50))),
          reasoning: resultItem.r || resultItem.reasoning || 'Analyzed by AI',
          originalIndex: item.originalIndex
        };
      }
      
      // Fallback for missing items
      return {
        score: calculateBasicViralScore(item.headline, item.summary, item.source, item.date),
        reasoning: 'Basic algorithm fallback',
        originalIndex: item.originalIndex
      };
    });
    
  } catch (error: any) {
    console.warn(`[Viral Score] ⚠️ Batch ${batchNum} failed: ${error.message}, using basic algorithm`);
    
    // Fallback to basic algorithm for this batch only
    return batch.map(item => ({
      score: calculateBasicViralScore(item.headline, item.summary, item.source, item.date),
      reasoning: 'Basic algorithm (API unavailable)',
      originalIndex: item.originalIndex
    }));
  }
};

/**
 * Fallback basic viral score calculation (used if GPT fails)
 */
const calculateBasicViralScore = (
  headline: string,
  summary: string,
  source: string,
  date?: string
): number => {
  let score = 50; // Base score
  
  const text = `${headline} ${summary}`.toLowerCase();
  
  // Viral keywords
  const viralKeywords = ['breaking', 'urgent', 'shocking', 'exclusive', 'just in', 'update', 'revealed', 'exposed'];
  viralKeywords.forEach(keyword => {
    if (text.includes(keyword)) score += 10;
  });
  
  // Major sources
  const majorSources = ['reuters', 'bloomberg', 'cnn', 'bbc', 'nytimes', 'wsj', 'ap news', 'associated press'];
  if (majorSources.some(s => source.toLowerCase().includes(s))) score += 15;
  
  // Recency
  if (date) {
    try {
      const newsDate = new Date(date);
      const hoursAgo = (Date.now() - newsDate.getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 6) score += 20;
      else if (hoursAgo < 12) score += 10;
    } catch {
      // Invalid date, skip
    }
  }
  
  return Math.min(score, 100);
};

/**
 * Check if OpenAI proxy is configured
 */
export const checkOpenAIConfig = (): { configured: boolean; message: string } => {
  const proxyUrl = getProxyUrl();
  
  if (proxyUrl) {
    return {
      configured: true,
      message: `✅ Using OpenAI proxy at ${proxyUrl}/api/openai`
    };
  }
  
  return {
    configured: false,
    message: `❌ No proxy URL configured. Set VITE_BACKEND_URL or deploy to Vercel.`
  };
};

// ====================
// Script Analysis for YouTube Shorts
// ====================

export interface ScriptAnalysis {
  hookScore: number;            // 0-100: How attention-grabbing is the opening?
  hookFeedback: string;
  retentionScore: number;       // 0-100: Will viewers watch the whole thing?
  retentionFeedback: string;
  pacingScore: number;          // 0-100: Is the rhythm dynamic enough?
  pacingFeedback: string;
  engagementScore: number;      // 0-100: Does it encourage interaction?
  engagementFeedback: string;
  overallScore: number;         // Weighted average
  suggestions: string[];        // Actionable improvements
  strengths: string[];          // What's working well
}

/**
 * Analyze a script for YouTube Shorts effectiveness
 * Uses AI to evaluate hook, retention, pacing, and engagement
 */
export const analyzeScriptForShorts = async (
  scenes: Record<string, { title?: string; text: string; video_mode: string }>,
  hostAName: string,
  hostBName: string,
  language?: string // Optional language parameter
): Promise<ScriptAnalysis> => {
  console.log(`📊 [Script Analysis] Analyzing script for YouTube Shorts effectiveness...`);
  
  // Determine language for analysis response
  const isSpanish = (language || '').toLowerCase().includes('spanish') || 
                    (language || '').toLowerCase().includes('español') ||
                    (language || '').toLowerCase().includes('argentina');
  
  // Prepare script text for analysis
  const sceneTexts = Object.entries(scenes).map(([key, scene]) => ({
    scene: parseInt(key),
    speaker: scene.video_mode === 'hostA' ? hostAName : hostBName,
    title: scene.title,
    text: scene.text
  }));
  
  const fullScript = sceneTexts.map(s => `[Scene ${s.scene} - ${s.speaker}]: ${s.text}`).join('\n\n');
  const firstScene = sceneTexts[0]?.text || '';
  const lastScene = sceneTexts[sceneTexts.length - 1]?.text || '';
  
  const languageInstruction = isSpanish 
    ? `IMPORTANTE: Responde TODO el análisis en ESPAÑOL. Las sugerencias, fortalezas y feedback deben estar en español.`
    : `Respond in English.`;
  
  const systemPrompt = `You are a YouTube Shorts expert analyzing scripts for viral potential.

${languageInstruction}

Analyze the following script and rate it on these criteria (0-100 scale):

1. HOOK SCORE (First 3 seconds)
   - Does it grab attention immediately?
   - Is there a question, shock value, or curiosity gap?
   - Would viewers stop scrolling?

2. RETENTION SCORE (Will they watch to the end?)
   - Is there momentum throughout?
   - Are there dead spots?
   - Does each scene add value?

3. PACING SCORE (Dynamic delivery)
   - Is there good alternation between speakers?
   - Are scenes the right length (40-80 words)?
   - Does the rhythm vary?

4. ENGAGEMENT SCORE (Will they interact?)
   - Is there a call to action?
   - Does it invite comments/opinions?
   - Is it shareable?

You should only analize script structure and not scene composition (like adding elements, sounds, etc.)
   
Return JSON (${isSpanish ? 'with feedback, suggestions, and strengths in SPANISH' : 'in English'}):
{
  "hookScore": number,
  "hookFeedback": "1 sentence explaining the hook effectiveness",
  "retentionScore": number,
  "retentionFeedback": "1 sentence about retention",
  "pacingScore": number,
  "pacingFeedback": "1 sentence about pacing",
  "engagementScore": number,
  "engagementFeedback": "1 sentence about engagement",
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"],
  "strengths": ["strength 1", "strength 2"]
}`;

  const userPrompt = `FULL SCRIPT:
${fullScript}

FIRST SCENE (The Hook - First 3 seconds):
${firstScene}

LAST SCENE (The Close):
${lastScene}

METADATA:
- Total scenes: ${sceneTexts.length}
- Speakers: ${hostAName}, ${hostBName}
- Approximate word count: ${fullScript.split(/\s+/).length}`;

  try {
    const response = await openaiRequest('chat/completions', {
      model: 'gpt-4o-mini', // Use mini for cost efficiency
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    }, { timeout: 20000 });

    CostTracker.track('script_analysis', 'gpt-4o-mini', 0.001);

    const result = JSON.parse(response.choices[0].message.content);
    
    // Calculate overall score (weighted average)
    const overallScore = Math.round(
      (result.hookScore * 0.35) +      // Hook is most important for Shorts
      (result.retentionScore * 0.30) +
      (result.pacingScore * 0.20) +
      (result.engagementScore * 0.15)
    );

    console.log(`✅ [Script Analysis] Analysis complete. Overall: ${overallScore}/100`);

    return {
      ...result,
      overallScore
    };
  } catch (error) {
    console.error(`❌ [Script Analysis] Failed:`, (error as Error).message);
    
    // Return basic analysis on failure
    return {
      hookScore: 70,
      hookFeedback: 'Analysis unavailable - check script manually',
      retentionScore: 70,
      retentionFeedback: 'Analysis unavailable',
      pacingScore: 70,
      pacingFeedback: 'Analysis unavailable',
      engagementScore: 70,
      engagementFeedback: 'Analysis unavailable',
      overallScore: 70,
      suggestions: ['Unable to analyze - review script manually'],
      strengths: ['Script generated successfully']
    };
  }
};
