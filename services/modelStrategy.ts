/**
 * Model Selection Strategy
 * 
 * NEW ARCHITECTURE (Dec 2024):
 * - News: SerpAPI (Google News search)
 * - Text (Script, Metadata, Hook): OpenAI GPT-4o
 * - Audio: OpenAI TTS
 * - Images: WaveSpeed Nano Banana Pro → DALL-E 3 (fallback)
 * - Video: WaveSpeed InfiniteTalk Multi
 */

export const MODEL_STRATEGY = {
    // News fetching - SerpAPI Google News
    news: "serpapi",
    
    // Text generation - OpenAI GPT-4o
    script: "gpt-4o",
    metadata: "gpt-4o",
    viralHook: "gpt-4o",
    trending: "serpapi",
    
    // Audio generation - OpenAI TTS
    audio: "openai-tts-1",
    
    // Image generation - WaveSpeed with DALL-E fallback
    thumbnail: "wavespeed/nano-banana-pro",  // Falls back to dall-e-3
    referenceImage: "wavespeed/nano-banana-pro",
    
    // Video generation - WaveSpeed InfiniteTalk
    video: "infinitetalk-multi"
} as const;

export type TaskType = keyof typeof MODEL_STRATEGY;

export function getModelForTask(task: TaskType): string {
    return MODEL_STRATEGY[task];
}

/**
 * Cost estimates per task (in USD)
 * 
 * SerpAPI: ~$0.01 per search
 * GPT-4o: ~$0.01 per 1K tokens (input + output)
 * OpenAI TTS: $0.015 per 1K characters
 * WaveSpeed Nano Banana: $0.14 per image
 * DALL-E 3: $0.04 per image (standard)
 * InfiniteTalk Multi 720p: $0.30 per 5 seconds
 */
export const COST_ESTIMATES = {
    news: 0.01,         // SerpAPI search
    script: 0.01,       // GPT-4o (~800 tokens)
    metadata: 0.015,    // GPT-4o (~1K tokens)
    viralHook: 0.005,   // GPT-4o (~200 tokens)
    trending: 0.01,     // SerpAPI search
    audio: 0.015,       // OpenAI TTS per segment (~1K chars)
    thumbnail: 0.14,    // WaveSpeed Nano Banana (or $0.04 DALL-E)
    referenceImage: 0.14,
    video: 0.30         // InfiniteTalk Multi 720p per 5 seconds
} as const;

export function getCostForTask(task: TaskType): number {
    return COST_ESTIMATES[task];
}

/**
 * Provider summary for debugging/logging
 */
export const PROVIDERS = {
    news: { primary: 'SerpAPI', fallback: null },
    script: { primary: 'OpenAI GPT-4o', fallback: null },
    metadata: { primary: 'OpenAI GPT-4o', fallback: null },
    viralHook: { primary: 'OpenAI GPT-4o', fallback: null },
    trending: { primary: 'SerpAPI', fallback: null },
    audio: { primary: 'OpenAI TTS', fallback: null },
    thumbnail: { primary: 'WaveSpeed Nano Banana', fallback: 'DALL-E 3' },
    referenceImage: { primary: 'WaveSpeed Nano Banana', fallback: 'DALL-E 3' },
    video: { primary: 'WaveSpeed InfiniteTalk Multi', fallback: null }
} as const;
