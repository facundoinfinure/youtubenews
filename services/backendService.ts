/**
 * Backend API service for video generation and YouTube uploads.
 */
import { VideoAssets, ChannelConfig } from "../types";

const getBackendUrl = () => {
  return (
    import.meta.env.VITE_BACKEND_URL ||
    window.env?.BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:8080"
  );
};

export interface VideoGenerationRequest {
  prompt: string;
  aspect_ratio: "16:9" | "9:16";
  resolution?: string;
  negative_prompt?: string;
}

export interface VideoGenerationResponse {
  video_url?: string;
  video_base64?: string;
  provider: "ovi" | "gemini";
  error?: string;
}

export interface BatchVideoGenerationRequest {
  prompts: string[];
  aspect_ratio: "16:9" | "9:16";
  resolution?: string;
  negative_prompt?: string;
}

export interface BatchVideoGenerationResponse {
  videos: VideoGenerationResponse[];
  errors?: string[];
}

/**
 * Generate a single video using backend API (Ovi or Gemini fallback).
 */
export const generateVideo = async (
  request: VideoGenerationRequest
): Promise<VideoGenerationResponse> => {
  const backendUrl = getBackendUrl();
  
  try {
    const response = await fetch(`${backendUrl}/api/v1/generate-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: request.prompt,
        aspect_ratio: request.aspect_ratio,
        resolution: request.resolution || "720p",
        negative_prompt: request.negative_prompt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Video generation failed: ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Backend video generation error:", error);
    throw error;
  }
};

/**
 * Generate multiple videos in parallel (multi-GPU support).
 */
export const generateVideosBatch = async (
  request: BatchVideoGenerationRequest
): Promise<BatchVideoGenerationResponse> => {
  const backendUrl = getBackendUrl();
  
  try {
    const response = await fetch(`${backendUrl}/api/v1/generate-videos-batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompts: request.prompts,
        aspect_ratio: request.aspect_ratio,
        resolution: request.resolution || "720p",
        negative_prompt: request.negative_prompt,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Batch video generation failed: ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Backend batch video generation error:", error);
    throw error;
  }
};

/**
 * Generate broadcast visuals using backend API.
 * This replaces the direct Gemini VEO calls.
 */
export const generateBroadcastVisuals = async (
  newsContext: string,
  config: ChannelConfig
): Promise<VideoAssets> => {
  const aspectRatio = config.format;
  const resolution = "720p";

  // Negative prompt to prevent unwanted content
  const negativePrompt =
    "NO humans, NO human faces, NO human bodies, NO people, NO persons, NO unspecified animals, realistic human skin, human hands, human features";

  // 1. Wide Shot
  const promptWide = `Wide cinematic shot of a professional news studio. 
  Two news anchors sitting at a desk. 
  IMPORTANT: Left anchor MUST be EXACTLY: ${config.characters.hostA.visualPrompt}. NOT a human.
  IMPORTANT: Right anchor MUST be EXACTLY: ${config.characters.hostB.visualPrompt}. NOT a human.
  Background screens show economic graphs about ${newsContext}. 
  Professional lighting, 4k, photorealistic.
  NEGATIVE: ${negativePrompt}`;

  // 2. Host A Close Up
  const promptHostA = `Close up shot of a news anchor. 
  IMPORTANT: The anchor MUST be EXACTLY: ${config.characters.hostA.visualPrompt}. 
  NOT a human, NOT any other animal.
  The character is speaking seriously and gesturing with their hands/paws. 
  Professional news studio background with soft lighting. Photorealistic, 4k quality.
  NEGATIVE: ${negativePrompt}`;

  // 3. Host B Close Up
  const promptHostB = `Close up shot of a news anchor. 
  IMPORTANT: The anchor MUST be EXACTLY: ${config.characters.hostB.visualPrompt}. 
  NOT a human, NOT any other animal.
  The character is speaking expressively with wit and charm. 
  Professional news studio background with soft lighting. Photorealistic, 4k quality.
  NEGATIVE: ${negativePrompt}`;

  console.log("Starting video generation with aspect ratio:", aspectRatio);
  console.log("Host A prompt:", config.characters.hostA.visualPrompt);
  console.log("Host B prompt:", config.characters.hostB.visualPrompt);

  try {
    // Prepare all prompts
    const prompts = [
      promptWide,
      promptHostA + " Camera angle: slightly from the side. Variation 1.",
      promptHostA + " Camera angle: direct frontal. Variation 2.",
      promptHostB + " Camera angle: slightly from the side. Variation 1.",
      promptHostB + " Camera angle: direct frontal. Variation 2.",
    ];

    // Generate all videos in batch (parallel processing)
    const batchResponse = await generateVideosBatch({
      prompts,
      aspect_ratio: aspectRatio,
      resolution,
      negative_prompt: negativePrompt,
    });

    // Process results
    const results = batchResponse.videos.map((video) => {
      if (video.video_url) {
        return video.video_url;
      } else if (video.video_base64) {
        // Convert base64 to data URL
        return `data:video/mp4;base64,${video.video_base64}`;
      }
      return null;
    });

    const wide = results[0];
    const hostA = [results[1], results[2]].filter((v) => v !== null) as string[];
    const hostB = [results[3], results[4]].filter((v) => v !== null) as string[];

    return { wide, hostA, hostB };
  } catch (e) {
    console.error("Video generation critical failure", e);
    return { wide: null, hostA: [], hostB: [] };
  }
};

/**
 * Check backend health.
 */
export const checkBackendHealth = async (): Promise<boolean> => {
  const backendUrl = getBackendUrl();
  
  try {
    const response = await fetch(`${backendUrl}/health`, {
      method: "GET",
    });
    return response.ok;
  } catch (error) {
    console.error("Backend health check failed:", error);
    return false;
  }
};

