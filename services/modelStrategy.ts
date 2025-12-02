// Model selection strategy for cost optimization
export const MODEL_STRATEGY = {
    // Critical tasks - need high quality
    news: "gemini-2.5-flash",           // Needs grounding
    audio: "gemini-2.5-flash-preview-tts", // Quality matters
    video: "veo-3.1-generate-preview",  // VEO 3.1 - official model name from docs
    thumbnail: "imagen-3.0-generate-001", // Quality matters

    // Simple tasks - can use cheaper models
    script: "gemini-2.0-flash-lite",    // Template-based, 40% cheaper
    metadata: "gemini-2.0-flash-lite",  // Predictable output, 35% cheaper
    viralHook: "gemini-2.0-flash-lite", // Short text, 40% cheaper

    // Medium tasks
    trending: "gemini-2.5-flash"        // Needs search grounding
} as const;

export type TaskType = keyof typeof MODEL_STRATEGY;

export function getModelForTask(task: TaskType): string {
    return MODEL_STRATEGY[task];
}

// Cost estimates per task (in USD)
export const COST_ESTIMATES = {
    news: 0.05,
    audio: 0.02,
    video: 0.30,
    thumbnail: 0.08,
    script: 0.01,      // Reduced from 0.025 with Flash Lite
    metadata: 0.015,   // Reduced from 0.025 with Flash Lite
    viralHook: 0.005,  // Reduced from 0.01 with Flash Lite
    trending: 0.02
} as const;

export function getCostForTask(task: TaskType): number {
    return COST_ESTIMATES[task];
}
