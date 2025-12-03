import { GoogleGenAI, Modality } from "@google/genai";
import { NewsItem, ScriptLine, BroadcastSegment, VideoAssets, ViralMetadata, ChannelConfig } from "../types";
import { ContentCache } from "./ContentCache";
import { retryWithBackoff } from "./retryUtils";
import { getModelForTask, getCostForTask, getWavespeedModel } from "./modelStrategy";
import { CostTracker } from "./CostTracker";
import { getChannelIntroOutro, saveChannelIntroOutro } from "./supabaseService";

const getApiKey = () => import.meta.env.VITE_GEMINI_API_KEY || window.env?.API_KEY || process.env.API_KEY || "";
const getWavespeedApiKey = () => import.meta.env.VITE_WAVESPEED_API_KEY || window.env?.WAVESPEED_API_KEY || process.env.WAVESPEED_API_KEY || "";
const getAiClient = () => new GoogleGenAI({ apiKey: getApiKey() });

// Helper function to check if Wavespeed should be used
const shouldUseWavespeed = () => {
  return !!getWavespeedApiKey();
};

// Wavespeed API helper functions
const createWavespeedTask = async (prompt: string, aspectRatio: '16:9' | '9:16', referenceImageUrl?: string): Promise<string> => {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) throw new Error("Wavespeed API key not configured");

  const model = getWavespeedModel();
  const wavespeedApiUrl = "https://api.wavespeed.ai/v1/tasks";

  const requestBody: any = {
    model: model,
    prompt: prompt,
    aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9',
  };

  // Add reference image if available
  if (referenceImageUrl) {
    // Ensure the image URL is properly formatted
    let imageUrl = referenceImageUrl;
    // If it's a data URI, we might need to handle it differently
    if (imageUrl.startsWith('data:')) {
      console.log(`[Wavespeed] 📸 Reference image is a data URI (${imageUrl.length} chars)`);
      // Wavespeed might need the image uploaded first, but let's try sending it directly
      requestBody.images = [imageUrl];
    } else {
      console.log(`[Wavespeed] 📸 Using reference image URL: ${imageUrl.substring(0, 80)}...`);
      requestBody.images = [imageUrl];
    }
    console.log(`[Wavespeed] ✅ Reference image added to video generation request`);
  } else {
    console.warn(`[Wavespeed] ⚠️ No reference image provided - video may not match the intended podcast studio scene`);
  }

  console.log(`[Wavespeed] 🚀 Creating video generation task with model: ${model}`);
  console.log(`[Wavespeed] 📝 Prompt length: ${prompt.length} chars`);
  console.log(`[Wavespeed] 📐 Aspect ratio: ${aspectRatio}`);

  let response: Response;
  try {
    response = await fetch(wavespeedApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (fetchError: any) {
    // Handle CORS and network errors
    if (fetchError.message?.includes('CORS') || fetchError.message?.includes('Failed to fetch')) {
      console.error(`[Wavespeed] ❌ CORS error: API calls to Wavespeed must be made from a backend server or through a proxy.`);
      console.error(`[Wavespeed] Current origin: ${typeof window !== 'undefined' ? window.location.origin : 'unknown'}`);
      throw new Error(`CORS error: Wavespeed API cannot be called directly from the browser. Please configure a backend proxy or use server-side API calls.`);
    }
    throw fetchError;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Wavespeed] ❌ API error: ${response.status} - ${errorText}`);
    throw new Error(`Wavespeed API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log(`[Wavespeed] 📦 Response data:`, JSON.stringify(data, null, 2));
  
  // Try multiple possible response formats
  const taskId = data.task_id || data.id || data.data?.id || data.data?.task_id;
  
  if (!taskId) {
    console.error(`[Wavespeed] ❌ No task ID found in response:`, data);
    throw new Error(`Wavespeed API did not return a task ID. Response: ${JSON.stringify(data)}`);
  }
  
  console.log(`[Wavespeed] ✅ Task created with ID: ${taskId}`);
  return taskId;
};

const pollWavespeedTask = async (taskId: string): Promise<string> => {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) throw new Error("Wavespeed API key not configured");

  const wavespeedApiUrl = `https://api.wavespeed.ai/v1/tasks/${taskId}`;
  let retries = 0;
  const maxRetries = 60; // 5 minutes max

  console.log(`[Wavespeed] 🔄 Starting to poll task: ${taskId}`);

  while (retries < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    let response: Response;
    try {
      response = await fetch(wavespeedApiUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`
        }
      });
    } catch (fetchError: any) {
      // Handle CORS and network errors
      if (fetchError.message?.includes('CORS') || fetchError.message?.includes('Failed to fetch')) {
        console.error(`[Wavespeed] ❌ CORS error during polling: API calls to Wavespeed must be made from a backend server.`);
        throw new Error(`CORS error: Wavespeed API cannot be called directly from the browser. Please configure a backend proxy.`);
      }
      throw fetchError;
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Wavespeed] ❌ Polling error (${response.status}): ${errorText}`);
      throw new Error(`Wavespeed polling error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[Wavespeed] 📊 Poll attempt ${retries + 1}/${maxRetries} - Status: ${data.status || data.data?.status || 'unknown'}`);
    
    // Try multiple possible response formats
    const status = data.status || data.data?.status;
    const rawVideoUrl = 
      data.result?.video_url || 
      data.data?.result?.video_url ||
      data.video_url ||
      data.data?.video_url ||
      (data.outputs && data.outputs[0]) ||
      (data.data?.outputs && data.data.outputs[0]);
    
    // Bug 2 Fix: Ensure videoUrl is a string, extract URL if it's an object
    let videoUrl: string | null = null;
    if (rawVideoUrl) {
      if (typeof rawVideoUrl === 'string') {
        videoUrl = rawVideoUrl;
      } else if (typeof rawVideoUrl === 'object' && rawVideoUrl !== null) {
        // If it's an object, try to extract a URL property
        videoUrl = rawVideoUrl.url || rawVideoUrl.video_url || rawVideoUrl.href || null;
        if (!videoUrl && Array.isArray(rawVideoUrl)) {
          // If it's an array, get the first string element
          videoUrl = rawVideoUrl.find((item: any) => typeof item === 'string') || null;
        }
      }
    }
    
    // Bug 1 Fix: Handle completed status without valid video URL
    if (status === "completed") {
      if (videoUrl && typeof videoUrl === 'string') {
        console.log(`[Wavespeed] ✅ Video generation completed! URL: ${videoUrl.substring(0, 100)}...`);
        return videoUrl;
      } else {
        // Status is completed but no valid video URL found
        console.error(`[Wavespeed] ❌ Task completed but no valid video URL found. Response:`, JSON.stringify(data, null, 2));
        throw new Error(`Wavespeed task completed but no valid video URL was returned. Task ID: ${taskId}`);
      }
    } else if (status === "failed" || data.data?.status === "failed") {
      const errorMsg = data.error || data.data?.error || data.message || "Unknown error";
      console.error(`[Wavespeed] ❌ Task failed: ${errorMsg}`);
      throw new Error(`Wavespeed task failed: ${errorMsg}`);
    } else if (status === "processing" || status === "pending" || !status) {
      // Continue polling
      console.log(`[Wavespeed] ⏳ Task still processing... (${retries + 1}/${maxRetries})`);
    } else {
      console.warn(`[Wavespeed] ⚠️ Unknown status: ${status}, continuing to poll...`);
    }

    retries++;
  }

  console.error(`[Wavespeed] ❌ Video generation timed out after ${maxRetries} attempts`);
  throw new Error(`Wavespeed video generation timed out after ${maxRetries} attempts`);
};

// Helper function to create a simple placeholder image as data URI
// This creates a minimal image that Nano Banana Pro Edit can use as a starting point
const createPlaceholderImage = (width: number = 1024, height: number = 1024): string => {
  if (typeof document === 'undefined') {
    // Fallback for non-browser environments - return a minimal 1x1 PNG data URI
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Create a simple gradient background that represents a basic studio setting
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#1a1a1a');
    gradient.addColorStop(0.5, '#2a2a2a');
    gradient.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Add a subtle center area to suggest a studio space
    ctx.fillStyle = 'rgba(40, 40, 40, 0.3)';
    ctx.fillRect(width * 0.2, height * 0.2, width * 0.6, height * 0.6);
  }
  return canvas.toDataURL('image/png');
};

// Wavespeed image generation helper functions for Nano Banana Pro Edit
const createWavespeedImageTask = async (
  prompt: string, 
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9',
  inputImageUrl?: string
): Promise<string> => {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) throw new Error("Wavespeed API key not configured");

  // For Nano Banana Pro Edit, we need an input image
  // If no input image is provided, we'll create a placeholder and upload it
  let imageUrl = inputImageUrl;
  
  if (!imageUrl) {
    // Create a placeholder image and upload it to get a URL
    // For now, we'll use a simple approach: create placeholder and convert to data URL
    const placeholderDataUri = createPlaceholderImage(
      aspectRatio === '9:16' ? 576 : aspectRatio === '1:1' ? 1024 : 1024,
      aspectRatio === '9:16' ? 1024 : aspectRatio === '1:1' ? 1024 : 576
    );
    
    // Upload placeholder to a temporary service or use it directly
    // For WaveSpeed, we might need to upload to their service first
    // For now, let's try using the placeholder as base64 in the request
    imageUrl = placeholderDataUri;
  }

  const wavespeedApiUrl = "https://api.wavespeed.ai/api/v3/google/nano-banana-pro/edit";
  
  // Prepare the request body
  const requestBody: any = {
    prompt: prompt,
    aspect_ratio: aspectRatio,
    resolution: "2k", // Use 2k for good quality ($0.14 per image)
    output_format: "png",
    enable_sync_mode: false,
    enable_base64_output: false
  };

  // Nano Banana Pro Edit requires an input image
  // If imageUrl is a data URI, we need to upload it first or use it as base64
  // WaveSpeed API v3 might support base64 images directly in the images array
  if (imageUrl.startsWith('data:')) {
    // Try sending the data URI directly - WaveSpeed API may support base64
    // Format: data:image/png;base64,<base64data>
    requestBody.images = [imageUrl];
  } else {
    requestBody.images = [imageUrl];
  }

  let response: Response;
  try {
    response = await fetch(wavespeedApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (fetchError: any) {
    // Handle CORS and network errors
    if (fetchError.message?.includes('CORS') || fetchError.message?.includes('Failed to fetch')) {
      console.error(`[Wavespeed] ❌ CORS error: API calls to Wavespeed must be made from a backend server or through a proxy.`);
      throw new Error(`CORS error: Wavespeed API cannot be called directly from the browser. Please configure a backend proxy or use server-side API calls.`);
    }
    throw fetchError;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wavespeed image API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  // WaveSpeed API v3 returns data.id as the task ID
  if (data.data?.id) {
    return data.data.id;
  } else if (data.id) {
    return data.id;
  }
  
  throw new Error("Invalid response from Wavespeed image API");
};

const pollWavespeedImageTask = async (taskId: string): Promise<string> => {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) throw new Error("Wavespeed API key not configured");

  const wavespeedApiUrl = `https://api.wavespeed.ai/api/v3/predictions/${taskId}/result`;
  let retries = 0;
  const maxRetries = 60; // 5 minutes max

  while (retries < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 3000)); // Check every 3 seconds for images

    let response: Response;
    try {
      response = await fetch(wavespeedApiUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`
        }
      });
    } catch (fetchError: any) {
      // Handle CORS and network errors
      if (fetchError.message?.includes('CORS') || fetchError.message?.includes('Failed to fetch')) {
        console.error(`[Wavespeed] ❌ CORS error during image polling: API calls to Wavespeed must be made from a backend server.`);
        throw new Error(`CORS error: Wavespeed API cannot be called directly from the browser. Please configure a backend proxy.`);
      }
      throw fetchError;
    }

    if (!response.ok) {
      throw new Error(`Wavespeed image polling error: ${response.status}`);
    }

    const data = await response.json();
    
    // Check for completed status and image URL
    if (data.data?.status === "completed" && data.data?.outputs && data.data.outputs.length > 0) {
      return data.data.outputs[0]; // Return first image URL
    } else if (data.status === "completed" && data.outputs && data.outputs.length > 0) {
      return data.outputs[0];
    } else if (data.data?.status === "failed" || data.status === "failed") {
      throw new Error(`Wavespeed image task failed: ${data.error || data.data?.error || "Unknown error"}`);
    }

    retries++;
  }

  throw new Error("Wavespeed image generation timed out");
};

export const fetchEconomicNews = async (targetDate: Date | undefined, config: ChannelConfig): Promise<NewsItem[]> => {
  // Use caching for same-day news
  let dateToQuery = new Date();
  if (targetDate) {
    dateToQuery = new Date(targetDate);
  } else {
    dateToQuery.setDate(dateToQuery.getDate() - 1);
  }

  const cacheKey = `news_${dateToQuery.toISOString().split('T')[0]}_${config.country}_v3`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {
      const ai = getAiClient();

      // Fix Timezone Issue: Create date from input string but force it to be treated as local date
      // by appending time to middle of day to avoid UTC midnight shift
      let dateToQuery = new Date();
      if (targetDate) {
        const d = new Date(targetDate);
        // Create a new date using the local year, month, date to ensure it matches the user's intent
        // regardless of how the input date was parsed (UTC vs Local)
        // Actually, the safest way if targetDate is a Date object from an input type="date" (which is usually YYYY-MM-DD UTC)
        // is to just use the UTC components if we want that exact date, OR just add a buffer.
        // Let's try appending T12:00:00 if it's a string, but here it is a Date.
        // Let's just use the UTC date string which matches the input.
        dateToQuery = d;
      } else {
        dateToQuery.setDate(dateToQuery.getDate() - 1);
      }

      // Use UTC date string for the prompt to avoid "yesterday" shift in Western Hemisphere
      const dateString = dateToQuery.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });

      const prompt = `Find EXACTLY 15 impactful economic or political news stories from ${dateString} relevant to ${config.country}. 
  Focus on major market moves, inflation, politics, or social issues. 
  
  Return a strictly formatted JSON array of objects with these keys: 
  - "headline" (string, in ${config.language})
  - "source" (string)
  - "url" (string, use grounding or best guess)
  - "summary" (string, 1 short sentence in ${config.language})
  - "viralScore" (number, 1-100 based on controversy or impact)
  - "imageKeyword" (string, 2-3 words visual description of the topic for image generation, e.g. "bitcoin crash", "stock market bull")
  - "imageUrl" (string, optional - URL of the article's main image from Google News if available. Use the image URL from the Google News search results.)

  CRITICAL REQUIREMENTS:
  1. You MUST return EXACTLY 15 items in the JSON array. Count them carefully.
  2. If you cannot find 15 unique stories, find related stories, variations, or follow-up stories to reach 15.
  3. Include imageUrl from Google News search results when available - these images are important for display.
  4. Do not include markdown formatting like \`\`\`json - return pure JSON only.
  
  Example format: [{"headline":"...","source":"...","url":"...","summary":"...","viralScore":85,"imageKeyword":"...","imageUrl":"..."}, ...]`;

      const response = await ai.models.generateContent({
        model: getModelForTask('news'),
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      CostTracker.track('news', getModelForTask('news'), getCostForTask('news'));

      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const text = response.text || "";
      const jsonStr = text.replace(/```json\n|\n```/g, "").replace(/```/g, "");

      try {
        let news: NewsItem[] = JSON.parse(jsonStr);

        // CRITICAL: Validate we got 15 items as requested
        if (news.length < 15) {
          console.warn(`⚠️ Only received ${news.length} news items, expected 15`);
          console.warn(`Response text (first 500 chars): ${text.substring(0, 500)}`);
          
          // Log warning but continue with what we have - better than failing completely
          if (news.length === 0) {
            throw new Error(`No news items returned. The API may not have data for this date.`);
          }
          
          // If we have fewer than 15 but at least some items, log and continue
          // The UI will display whatever we have
          console.log(`📝 Continuing with ${news.length} news items (expected 15)`);
        }

        // Create a map of URLs to grounding chunks for better matching
        const urlToGroundingMap = new Map<string, any>();
        groundingChunks.forEach((chunk: any) => {
          if (chunk?.web?.uri) {
            urlToGroundingMap.set(chunk.web.uri, chunk);
          }
        });

        const processedNews = news.map((item, index) => {
          // Prioritize grounding URL if available and missing in item
          let finalUrl = item.url;
          let matchedGrounding: any = null;
          
          // Try to match by index first
          if (groundingChunks[index]?.web?.uri) {
            matchedGrounding = groundingChunks[index];
            if ((!finalUrl || finalUrl === "#")) {
              finalUrl = groundingChunks[index].web.uri;
            }
          } else if (finalUrl && urlToGroundingMap.has(finalUrl)) {
            // Try to match by URL
            matchedGrounding = urlToGroundingMap.get(finalUrl);
          } else if (groundingChunks.length > 0) {
            // Fallback: use first available grounding chunk
            matchedGrounding = groundingChunks[0];
            if ((!finalUrl || finalUrl === "#") && matchedGrounding?.web?.uri) {
              finalUrl = matchedGrounding.web.uri;
            }
          }

          // Extract image URL from grounding metadata - improved extraction
          let imageUrl = item.imageUrl;
          if (!imageUrl && matchedGrounding?.web) {
            const webChunk = matchedGrounding.web as any;
            // Try multiple possible image fields
            imageUrl = webChunk?.image || 
                      webChunk?.imageUrl || 
                      webChunk?.thumbnail || 
                      webChunk?.ogImage ||
                      webChunk?.metaImage ||
                      webChunk?.previewImage;
            
            if (imageUrl) {
              console.log(`✅ Found image for "${item.headline}": ${imageUrl}`);
            }
          }
          
          // Also check grounding metadata at root level
          if (!imageUrl && matchedGrounding) {
            const meta = matchedGrounding as any;
            imageUrl = meta?.image || meta?.imageUrl || meta?.thumbnail;
            if (imageUrl) {
              console.log(`✅ Found image (root level) for "${item.headline}": ${imageUrl}`);
            }
          }
          
          // Log if no image found for debugging
          if (!imageUrl) {
            console.log(`⚠️ No image found for "${item.headline}" - will use placeholder`);
          }

          return {
            ...item,
            url: finalUrl,
            imageUrl: imageUrl || undefined, // Ensure undefined instead of empty string
            // Fallbacks
            viralScore: item.viralScore || Math.floor(Math.random() * 40) + 60,
            summary: item.summary || item.headline,
            imageKeyword: item.imageKeyword || "breaking news"
          };
        });

        // Sort by viral score descending
        return processedNews.sort((a, b) => b.viralScore - a.viralScore);

      } catch (e) {
        console.error("Failed to parse news JSON", e);
        console.error("Response text (first 500 chars):", text.substring(0, 500));
        throw new Error(`Failed to parse news from Gemini: ${(e as Error).message}`);
      }
    },
    3600000, // 1 hour TTL
    0.05 // Estimated cost per call
  );
};

export const generateScript = async (news: NewsItem[], config: ChannelConfig, viralHook?: string): Promise<ScriptLine[]> => {
  const ai = getAiClient();

  const newsContext = news.map(n => `- ${n.headline} (Source: ${n.source}). Summary: ${n.summary}`).join('\n');

  const systemPrompt = `
  You are the showrunner for "${config.channelName}", a short 1-minute news segment hosted by: 
  1. "${config.characters.hostA.name}" (${config.characters.hostA.bio}).
  2. "${config.characters.hostB.name}" (${config.characters.hostB.bio}).
  
  Tone: ${config.tone}.
  Language: ${config.language}.
  
  They are discussing the selected news.
  
  SCRIPT STRUCTURE (60 seconds):
  - 0-10s: HOOK (grab attention)${viralHook ? ` Use this: "${viralHook}"` : ''}
  - 10-40s: CONTENT (deliver value, cite sources)
  - 40-50s: PAYOFF (answer the hook)
  - 50-60s: CTA (subscribe/like)
  
  Rules:
  - KEEP IT UNDER 150 WORDS TOTAL (approx 1 minute).
  - CITATION REQUIRED: You MUST explicitly mention the source of the news in the dialogue.
  - Structure the output as a JSON Array of objects: [{"speaker": "${config.characters.hostA.name}", "text": "..."}, {"speaker": "${config.characters.hostB.name}", "text": "..."}].
  - Use "Both" as speaker for the intro/outro if they speak together.
  - Be creative, use puns related to the characters (e.g. if one is a gorilla, use banana puns; if a penguin, ice puns).
  - Pattern interrupt every 15 seconds
  - Use "you" language
  - STRICT JSON OUTPUT. NO MARKDOWN.
  `;

  const response = await ai.models.generateContent({
    model: getModelForTask('script'),
    contents: `Here is the selected news for today's episode:\n${newsContext}\n\nWrite the script in JSON format.`,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json"
    }
  });

  CostTracker.track('script', getModelForTask('script'), getCostForTask('script'));

  try {
    const text = response.text || "[]";
    // Cleanup markdown code blocks and trim
    const cleanText = text.replace(/```json\n?/g, "").replace(/```/g, "").trim();

    return JSON.parse(cleanText) as ScriptLine[];
  } catch (e) {
    console.error("Script parsing error", e);
    const text = response.text || "[]";
    console.error("Response text (first 200 chars):", text.substring(0, 200));
    throw new Error(`Failed to parse script from Gemini: ${(e as Error).message}`);
  }
};

export const fetchTrendingTopics = async (country: string): Promise<string[]> => {
  const cacheKey = `trending_${country}_${new Date().toISOString().split('T')[0]}`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: getModelForTask('trending'),
        contents: `What are the top 10 trending topics on YouTube in ${country} today? Focus on news, finance, and current events. Return as JSON array of strings.`,
        config: {
          tools: [{ googleSearch: {} }]
          // responseMimeType: "application/json" // Conflict with tools in some models
        }
      });

      CostTracker.track('trending', getModelForTask('trending'), getCostForTask('trending'));

      try {
        const topics = JSON.parse(response.text || "[]");
        return Array.isArray(topics) ? topics : [];
      } catch {
        return [];
      }
    },
    7200000, // 2 hour TTL
    0.02
  );
};

export const generateViralMetadata = async (news: NewsItem[], config: ChannelConfig, date: Date): Promise<ViralMetadata> => {
  const ai = getAiClient();

  // Get trending topics for SEO boost
  const trending = await fetchTrendingTopics(config.country);
  const newsContext = news.map(n => `- ${n.headline} (Viral Score: ${n.viralScore})`).join('\n');
  const dateStr = date.toLocaleDateString();

  const prompt = `
You are a VIRAL YouTube expert with 100M+ views across channels.

NEWS STORIES:
${newsContext}

TRENDING NOW IN ${config.country}:
${trending.join(', ')}

Create HIGH-CTR metadata:

TITLE RULES (max 60 chars):
- Use power words: SHOCKING, BREAKING, EXPOSED, WATCH, URGENT, REVEALED
- Include numbers/percentages if relevant
- Create curiosity gap (tease but don't reveal)
- Add ONE emoji that fits the tone
- Examples:
  * "MARKET CRASH: 40% Drop INCOMING?! 📉"
  * "They're HIDING This From You! 🚨"
  * "BREAKING: 5 Stocks to BUY NOW 💰"

DESCRIPTION RULES (max 250 chars):
- Hook in first 10 words
- Include keywords: ${news.map(n => n.imageKeyword).join(', ')}
- Add trending terms: ${trending.slice(0, 3).join(', ')}
- Include date: ${dateStr}
- Call to action
- Timestamp preview: "0:00 Intro | 0:15 Analysis | 0:45 Prediction"
- End with tagline: "${config.tagline}"

TAGS RULES (exactly 20 tags):
- Mix broad + specific
- Include: ${(config.defaultTags || []).join(', ')}
- Add trending: ${trending.slice(0, 5).join(', ')}
- Long-tail keywords
- Event-specific tags

Return JSON: { title, description, tags }
  `.trim();

  const cacheKey = `metadata_${news.map(n => n.headline).join('_').substring(0, 50)}_${dateStr}`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {

      const response = await ai.models.generateContent({
        model: getModelForTask('metadata'),
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      CostTracker.track('metadata', getModelForTask('metadata'), getCostForTask('metadata'));

      const metadata = JSON.parse(response.text || "{}");

      // Validate and ensure defaults
      return {
        title: metadata.title?.substring(0, 60) || "Breaking News",
        description: metadata.description?.substring(0, 250) || "",
        tags: Array.isArray(metadata.tags) ? metadata.tags.slice(0, 20) : []
      };
    },
    1800000, // 30 min TTL
    0.03
  );
};

// Helper function to import findCachedAudio dynamically to avoid circular dependency
let findCachedAudioFn: ((text: string, voiceName: string, channelId: string) => Promise<string | null>) | null = null;

export const setFindCachedAudioFunction = (fn: (text: string, voiceName: string, channelId: string) => Promise<string | null>) => {
  findCachedAudioFn = fn;
};

export const generateSegmentedAudio = async (script: ScriptLine[], config: ChannelConfig): Promise<BroadcastSegment[]> => {
  return generateSegmentedAudioWithCache(script, config, '');
};

export const generateSegmentedAudioWithCache = async (
  script: ScriptLine[], 
  config: ChannelConfig,
  channelId: string = ''
): Promise<BroadcastSegment[]> => {
  const ai = getAiClient();

  // PARALLEL PROCESSING with cache support - much faster
  const audioPromises = script.map(async (line) => {
    let character = config.characters.hostA; // Default
    if (line.speaker === config.characters.hostA.name) {
      character = config.characters.hostA;
    } else if (line.speaker === config.characters.hostB.name) {
      character = config.characters.hostB;
    }

    // Check cache first if function is available
    if (findCachedAudioFn && channelId) {
      const cachedAudio = await findCachedAudioFn(line.text, character.voiceName, channelId);
      if (cachedAudio) {
        console.log(`✅ Cache hit for audio: "${line.text.substring(0, 30)}..."`);
        return {
          speaker: line.speaker,
          text: line.text,
          audioBase64: cachedAudio,
          fromCache: true,
          audioUrl: undefined // Will be set later if needed
        } as any;
      }
    }

    // Generate new audio if not in cache
    return retryWithBackoff(async () => {
      const response = await ai.models.generateContent({
        model: getModelForTask('audio'),
        contents: line.text,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: character.voiceName,
                // Enhanced voice parameters
                ...(character.voiceStyle && { style: character.voiceStyle }),
                ...(character.speakingRate && { speakingRate: character.speakingRate }),
                ...(character.pitch && { pitch: character.pitch })
              }
            }
          }
        }
      });

      CostTracker.track('audio', getModelForTask('audio'), getCostForTask('audio'));

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error('No audio data received');

      return {
        speaker: line.speaker,
        text: line.text,
        audioBase64: base64Audio,
        fromCache: false
      };
    }, {
      maxRetries: 2,
      baseDelay: 1000,
      onRetry: (attempt) => console.log(`🎙️ Retrying audio for "${line.text.substring(0, 30)}..." (${attempt}/2)`)
    });
  });

  return Promise.all(audioPromises);
};

// Helper for video polling
const pollForVideo = async (operation: any): Promise<string> => {
  const ai = getAiClient();
  let retries = 0;
  while (!operation.done && retries < 60) { // Increased timeout for VEO
    await new Promise(resolve => setTimeout(resolve, 5000));
    operation = await ai.operations.getVideosOperation({ operation });
    retries++;
  }
  if (!operation.done) throw new Error("Video generation timed out");
  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) throw new Error("No video URI");
  // Append Key here using the getter helper logic, not process.env directly
  return `${videoUri}&key=${getApiKey()}`;
};

// =============================================================================================
// STRUCTURED VIDEO GENERATION FUNCTIONS
// =============================================================================================

/**
 * Generate intro video (generic, no dialogue) - reusable per channel
 */
export const generateIntroVideo = async (
  config: ChannelConfig,
  channelId: string
): Promise<string | null> => {
  const referenceImageContext = config.referenceImageUrl 
    ? `\nCRITICAL REFERENCE IMAGE: Use the provided reference image as the EXACT visual template. Match the exact podcast studio setting, character appearances, lighting, and composition from the reference image.\n` 
    : '';

  const prompt = `
Create a professional ${config.format} intro video for "${config.channelName}".

SCENE DESCRIPTION:
- Two chimpanzees (${config.characters.hostA.name} and ${config.characters.hostB.name}) in a modern podcast studio
- Both hosts visible in frame, sitting at a desk with microphones
- Professional studio environment with branding elements
- Camera: Wide shot showing both chimpanzees
- Setting: Indoor podcast studio (NOT outdoor or landscape)

CHARACTERS:
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}

CHANNEL: ${config.channelName}
TAGLINE: ${config.tagline}
BRANDING COLORS: ${config.logoColor1} and ${config.logoColor2}

STYLE: ${config.tone}, professional podcast-style news studio
DURATION: 5-6 seconds
ACTION: Both hosts looking at camera, welcoming gesture, no dialogue (intro music will play)
BRANDING: Include channel name "${config.channelName}" and tagline "${config.tagline}" visually in the scene. Use brand colors ${config.logoColor1} and ${config.logoColor2} in graphics, logos, or on-screen elements.
${referenceImageContext}

IMPORTANT: This is an intro video with NO dialogue. The hosts should be visible and welcoming, but not speaking. The scene must be an indoor podcast studio.
  `.trim();

  return retryWithBackoff(async () => {
    try {
      if (shouldUseWavespeed()) {
        console.log(`[Wavespeed] Generating intro video for channel ${channelId}`);
        const taskId = await createWavespeedTask(prompt, config.format, config.referenceImageUrl);
        const videoUrl = await pollWavespeedTask(taskId);
        CostTracker.track('video', getWavespeedModel(), getCostForTask('video'));
        
        // Save to channel cache
        const { outroUrl } = await getChannelIntroOutro(channelId);
        await saveChannelIntroOutro(channelId, videoUrl, outroUrl);
        
        return videoUrl;
      } else {
        // Fallback to VEO
        const ai = getAiClient();
        const operation = await ai.models.generateVideos({
          model: getModelForTask('video'),
          prompt: prompt,
          config: {
            aspectRatio: config.format === '9:16' ? '9:16' : '16:9',
            ...(config.referenceImageUrl ? { referenceImage: config.referenceImageUrl } : {})
          }
        });
        CostTracker.track('video', getModelForTask('video'), getCostForTask('video'));
        if (operation) {
          const videoUrl = await pollForVideo(operation);
          // Save to channel cache
          const { outroUrl } = await getChannelIntroOutro(channelId);
          await saveChannelIntroOutro(channelId, videoUrl, outroUrl);
          return videoUrl;
        }
      }
      return null;
    } catch (e) {
      console.error("Intro video generation failed", e);
      return null;
    }
  }, {
    maxRetries: 2,
    baseDelay: 5000,
    onRetry: (attempt) => console.log(`🎬 Retrying intro video generation (${attempt}/2)...`)
  });
};

/**
 * Generate outro video (generic, no dialogue) - reusable per channel
 */
export const generateOutroVideo = async (
  config: ChannelConfig,
  channelId: string
): Promise<string | null> => {
  const referenceImageContext = config.referenceImageUrl 
    ? `\nCRITICAL REFERENCE IMAGE: Use the provided reference image as the EXACT visual template. Match the exact podcast studio setting, character appearances, lighting, and composition from the reference image.\n` 
    : '';

  const prompt = `
Create a professional ${config.format} outro video for "${config.channelName}".

SCENE DESCRIPTION:
- Two chimpanzees (${config.characters.hostA.name} and ${config.characters.hostB.name}) in a modern podcast studio
- Both hosts visible in frame, sitting at a desk with microphones
- Professional studio environment with branding elements
- Camera: Wide shot showing both chimpanzees
- Setting: Indoor podcast studio (NOT outdoor or landscape)

CHARACTERS:
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}

CHANNEL: ${config.channelName}
TAGLINE: ${config.tagline}
BRANDING COLORS: ${config.logoColor1} and ${config.logoColor2}

STYLE: ${config.tone}, professional podcast-style news studio
DURATION: 5-6 seconds
ACTION: Both hosts looking at camera, thanking gesture, no dialogue (outro music will play)
BRANDING: Include channel name "${config.channelName}" and tagline "${config.tagline}" visually in the scene. Use brand colors ${config.logoColor1} and ${config.logoColor2} in graphics, logos, or on-screen elements. Include "Subscribe" and "Like" call-to-action elements.
${referenceImageContext}

IMPORTANT: This is an outro video with NO dialogue. The hosts should be visible and thanking the audience, but not speaking. The scene must be an indoor podcast studio.
  `.trim();

  return retryWithBackoff(async () => {
    try {
      if (shouldUseWavespeed()) {
        console.log(`[Wavespeed] Generating outro video for channel ${channelId}`);
        const taskId = await createWavespeedTask(prompt, config.format, config.referenceImageUrl);
        const videoUrl = await pollWavespeedTask(taskId);
        CostTracker.track('video', getWavespeedModel(), getCostForTask('video'));
        
        // Save to channel cache
        const { introUrl } = await getChannelIntroOutro(channelId);
        await saveChannelIntroOutro(channelId, introUrl, videoUrl);
        
        return videoUrl;
      } else {
        // Fallback to VEO
        const ai = getAiClient();
        const operation = await ai.models.generateVideos({
          model: getModelForTask('video'),
          prompt: prompt,
          config: {
            aspectRatio: config.format === '9:16' ? '9:16' : '16:9',
            ...(config.referenceImageUrl ? { referenceImage: config.referenceImageUrl } : {})
          }
        });
        CostTracker.track('video', getModelForTask('video'), getCostForTask('video'));
        if (operation) {
          const videoUrl = await pollForVideo(operation);
          // Save to channel cache
          const { introUrl } = await getChannelIntroOutro(channelId);
          await saveChannelIntroOutro(channelId, introUrl, videoUrl);
          return videoUrl;
        }
      }
      return null;
    } catch (e) {
      console.error("Outro video generation failed", e);
      return null;
    }
  }, {
    maxRetries: 2,
    baseDelay: 5000,
    onRetry: (attempt) => console.log(`🎬 Retrying outro video generation (${attempt}/2)...`)
  });
};

/**
 * Generate video of a single host with lip-sync for specific dialogue
 */
const generateHostVideoWithLipSync = async (
  hostName: string,
  character: any,
  dialogueText: string,
  config: ChannelConfig,
  cameraAngle: string = 'front-facing',
  action: string = 'Speaking naturally to camera'
): Promise<string | null> => {
  const referenceImageContext = config.referenceImageUrl 
    ? `\nCRITICAL REFERENCE IMAGE: Use the provided reference image as the EXACT visual template. Match the exact podcast studio setting, character appearance, lighting, and composition from the reference image.\n` 
    : '';

  const prompt = `
Professional news broadcast video segment showing ${character.name} (a chimpanzee) in a podcast studio setting.

CHARACTER: ${character.name} - ${character.visualPrompt}
SCENE: Podcast-style news studio. Single character shot, close-up.
Camera Angle: ${cameraAngle}
Action: ${action}
Dialogue for Lip-Sync: "${dialogueText}"
Duration: 10-15 seconds of continuous speaking
Emotion/Tone: ${config.tone}
Setting: Professional podcast-style news studio (INDOOR, NOT outdoor or landscape). ${character.name} presenting news in a modern studio environment with microphone, desk, and professional lighting. ${config.format} format.
Lighting: Professional studio lighting, high quality, consistent with podcast aesthetic.
Expression: Natural, engaging, appropriate for news content.
${referenceImageContext}

CRITICAL REQUIREMENTS:
- MUST show a chimpanzee in a podcast studio setting (NOT a generic landscape or outdoor scene)
- The character must be speaking the exact dialogue provided for proper lip-sync
- Maintain visual consistency with the podcast studio setting and reference image
- Setting must be an indoor podcast studio, not an outdoor or generic scene
  `.trim();

  return retryWithBackoff(async () => {
    try {
      if (shouldUseWavespeed()) {
        console.log(`[Wavespeed] Generating video for ${hostName} with lip-sync`);
        const taskId = await createWavespeedTask(prompt, config.format, config.referenceImageUrl);
        const videoUrl = await pollWavespeedTask(taskId);
        CostTracker.track('video', getWavespeedModel(), getCostForTask('video'));
        return videoUrl;
      } else {
        // Fallback to VEO
        const ai = getAiClient();
        const operation = await ai.models.generateVideos({
          model: getModelForTask('video'),
          prompt: prompt,
          config: {
            aspectRatio: config.format === '9:16' ? '9:16' : '16:9',
            ...(config.referenceImageUrl ? { referenceImage: config.referenceImageUrl } : {})
          }
        });
        CostTracker.track('video', getModelForTask('video'), getCostForTask('video'));
        if (operation) {
          return await pollForVideo(operation);
        }
      }
      return null;
    } catch (e) {
      console.warn(`Failed to generate video for ${hostName}`, e);
      return null;
    }
  }, {
    maxRetries: 2,
    baseDelay: 5000,
    onRetry: (attempt) => console.log(`🎬 Retrying video generation for ${hostName} (${attempt}/2)...`)
  });
};

/**
 * Generate video of both hosts together with lip-sync for dialogue
 */
const generateTwoHostsVideoWithLipSync = async (
  dialogueText: string,
  config: ChannelConfig
): Promise<string | null> => {
  const referenceImageContext = config.referenceImageUrl 
    ? `\nCRITICAL REFERENCE IMAGE: Use the provided reference image as the EXACT visual template. Match the exact podcast studio setting, character appearances (2 chimpanzees in podcast studio), lighting, and composition from the reference image.\n` 
    : '';

  const prompt = `
Professional news broadcast video segment showing TWO CHIMPANZEES in a PODCAST-STYLE STUDIO.

SCENE DESCRIPTION:
- Two chimpanzees (${config.characters.hostA.name} and ${config.characters.hostB.name}) in a modern podcast studio
- Both hosts visible in frame, sitting at a desk with microphones
- Camera: Wide shot showing both chimpanzees
- Setting: Indoor podcast studio (NOT outdoor or landscape)

CHARACTERS:
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}

Dialogue for Lip-Sync: "${dialogueText}"
Duration: 10-15 seconds
Emotion/Tone: ${config.tone}
Setting: Professional podcast-style news studio. ${config.format} format.
Lighting: Professional studio lighting, high quality.
${referenceImageContext}

CRITICAL REQUIREMENTS:
- MUST show two chimpanzees in a podcast studio setting (NOT a generic landscape or outdoor scene)
- Both characters must be speaking the exact dialogue provided for proper lip-sync
- Maintain visual consistency with the podcast studio setting and reference image
- Setting must be an indoor podcast studio, not an outdoor or generic scene
  `.trim();

  return retryWithBackoff(async () => {
    try {
      if (shouldUseWavespeed()) {
        console.log(`[Wavespeed] Generating video of both hosts with lip-sync`);
        const taskId = await createWavespeedTask(prompt, config.format, config.referenceImageUrl);
        const videoUrl = await pollWavespeedTask(taskId);
        CostTracker.track('video', getWavespeedModel(), getCostForTask('video'));
        return videoUrl;
      } else {
        // Fallback to VEO
        const ai = getAiClient();
        const operation = await ai.models.generateVideos({
          model: getModelForTask('video'),
          prompt: prompt,
          config: {
            aspectRatio: config.format === '9:16' ? '9:16' : '16:9',
            ...(config.referenceImageUrl ? { referenceImage: config.referenceImageUrl } : {})
          }
        });
        CostTracker.track('video', getModelForTask('video'), getCostForTask('video'));
        if (operation) {
          return await pollForVideo(operation);
        }
      }
      return null;
    } catch (e) {
      console.warn(`Failed to generate two hosts video`, e);
      return null;
    }
  }, {
    maxRetries: 2,
    baseDelay: 5000,
    onRetry: (attempt) => console.log(`🎬 Retrying two hosts video generation (${attempt}/2)...`)
  });
};

/**
 * Group consecutive segments by the same speaker for efficient video generation
 */
const groupSegmentsBySpeaker = (script: ScriptLine[]): Array<{ speaker: string; text: string; startIndex: number; endIndex: number }> => {
  const groups: Array<{ speaker: string; text: string; startIndex: number; endIndex: number }> = [];
  
  if (script.length === 0) return groups;
  
  let currentGroup = {
    speaker: script[0].speaker,
    text: script[0].text,
    startIndex: 0,
    endIndex: 0
  };
  
  for (let i = 1; i < script.length; i++) {
    if (script[i].speaker === currentGroup.speaker) {
      // Same speaker, append text
      currentGroup.text += ' ' + script[i].text;
      currentGroup.endIndex = i;
    } else {
      // Different speaker, save current group and start new one
      groups.push(currentGroup);
      currentGroup = {
        speaker: script[i].speaker,
        text: script[i].text,
        startIndex: i,
        endIndex: i
      };
    }
  }
  
  // Don't forget the last group
  groups.push(currentGroup);
  
  return groups;
};

export const generateVideoSegments = async (
  script: ScriptLine[],
  config: ChannelConfig
): Promise<(string | null)[]> => {
  // Group consecutive segments by speaker to generate longer videos with lip-sync
  const groupedSegments = groupSegmentsBySpeaker(script);
  
  console.log(`[Video Generation] Grouped ${script.length} segments into ${groupedSegments.length} video groups`);
  
  // Track character variations for visual variety
  const characterVariationCount: Record<string, number> = {
    [config.characters.hostA.name]: 0,
    [config.characters.hostB.name]: 0,
    'Both': 0
  };
  
  // Camera angles and actions for variety
  const cameraAngles = ['front-facing', 'slight 3/4 angle left', 'slight 3/4 angle right', 'front with slight lean', 'front with hand gesture'];
  const actions = [
    'Speaking naturally to camera with confident expression',
    'Speaking to camera with subtle hand gestures emphasizing key points',
    'Speaking to camera with slight head movements for emphasis',
    'Speaking to camera with engaged, animated expression',
    'Speaking to camera with professional, authoritative presence'
  ];
  
  // Generate videos for each group
  const videoPromises = groupedSegments.map(async (group) => {
    const isWideShot = group.speaker === 'Both' || group.speaker.includes('Both');
    
    // Determine character
    let character = config.characters.hostA;
    if (group.speaker === config.characters.hostB.name) {
      character = config.characters.hostB;
    }
    
    // Track variation for visual variety
    const speakerKey = isWideShot ? 'Both' : character.name;
    characterVariationCount[speakerKey] = (characterVariationCount[speakerKey] || 0) + 1;
    const variationNumber = characterVariationCount[speakerKey] % 5;
    const cameraAngle = cameraAngles[variationNumber];
    const action = actions[variationNumber];
    
    // Generate video with lip-sync
    let videoUrl: string | null = null;
    
    if (isWideShot) {
      // Both hosts together
      videoUrl = await generateTwoHostsVideoWithLipSync(group.text, config);
    } else {
      // Single host
      videoUrl = await generateHostVideoWithLipSync(
        group.speaker,
        character,
        group.text,
        config,
        cameraAngle,
        action
      );
    }
    
    // Return video URL for all segments in this group
    return {
      videoUrl,
      startIndex: group.startIndex,
      endIndex: group.endIndex
    };
  });
  
  const videoResults = await Promise.all(videoPromises);
  
  // Map grouped videos back to individual segments
  const segmentVideos: (string | null)[] = new Array(script.length).fill(null);
  
  videoResults.forEach((result) => {
    // Assign the same video URL to all segments in this group
    for (let i = result.startIndex; i <= result.endIndex; i++) {
      segmentVideos[i] = result.videoUrl;
    }
  });
  
  console.log(`[Video Generation] Generated ${videoResults.filter(r => r.videoUrl).length} videos for ${script.length} segments`);
  
  return segmentVideos;
};
/**
 * Generate or retrieve intro/outro videos for a channel
 * This function now only handles intro/outro caching, not the main content videos
 */
export const generateBroadcastVisuals = async (
  newsContext: string,
  config: ChannelConfig,
  script: ScriptLine[],
  channelId: string
): Promise<VideoAssets> => {
  console.log(`[Broadcast Visuals] Getting intro/outro videos for channel ${channelId}`);
  
  // Get cached intro/outro from database
  const { introUrl, outroUrl } = await getChannelIntroOutro(channelId);
  
  let finalIntroUrl = introUrl;
  let finalOutroUrl = outroUrl;
  
  // Generate intro if not cached
  if (!finalIntroUrl) {
    console.log(`[Broadcast Visuals] No cached intro found, generating new intro...`);
    finalIntroUrl = await generateIntroVideo(config, channelId);
  } else {
    console.log(`[Broadcast Visuals] ✅ Using cached intro video`);
  }
  
  // Generate outro if not cached
  if (!finalOutroUrl) {
    console.log(`[Broadcast Visuals] No cached outro found, generating new outro...`);
    finalOutroUrl = await generateOutroVideo(config, channelId);
  } else {
    console.log(`[Broadcast Visuals] ✅ Using cached outro video`);
  }
  
  // Return VideoAssets structure
  // Note: hostA and hostB arrays will be populated by generateVideoSegments()
  return {
    wide: finalIntroUrl || finalOutroUrl || null, // Use intro/outro for wide shot (used during intro/outro phases)
    hostA: [], // Will be populated by generateVideoSegments
    hostB: []  // Will be populated by generateVideoSegments
  };
};

// Helper function to convert image URL to data URI
const imageUrlToDataUri = async (imageUrl: string): Promise<string> => {
  try {
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Failed to convert image URL to data URI:", error);
    throw error;
  }
};

export const generateReferenceImage = async (
  config: ChannelConfig,
  sceneDescription?: string
): Promise<string | null> => {
  // Build comprehensive prompt based on channel config and optional scene description
  const defaultScene = sceneDescription || `Professional news studio setting with ${config.tone} atmosphere`;
  
  const prompt = `
Create a high-quality reference image for a news broadcast studio.

CHANNEL: ${config.channelName}
TAGLINE: ${config.tagline}
STYLE: ${config.tone}

CHARACTERS TO INCLUDE:
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}

SCENE DESCRIPTION: ${defaultScene}
- Both characters should be visible in the scene
- Professional news studio setting
- ${config.format} aspect ratio
- Studio lighting, high quality
- Show the complete setting including background, furniture, equipment
- Maintain visual consistency for future video generation

IMPORTANT: This image will be used as a reference for maintaining visual consistency across all video generations. Ensure both characters are clearly visible and the scene is well-composed.
`.trim();

  try {
    // Use WaveSpeed Nano Banana Pro Edit if API key is available
    if (shouldUseWavespeed()) {
      console.log(`[Wavespeed] Generating reference image using Nano Banana Pro Edit`);
      
      const aspectRatio = config.format === '9:16' ? '9:16' : '16:9';
      const taskId = await createWavespeedImageTask(prompt, aspectRatio);
      const imageUrl = await pollWavespeedImageTask(taskId);
      
      // Convert image URL to data URI for consistency with the rest of the app
      const dataUri = await imageUrlToDataUri(imageUrl);
      
      // Track cost (Nano Banana Pro Edit 2k resolution is $0.14)
      CostTracker.track('thumbnail', 'google/nano-banana-pro/edit', 0.14);
      
      return dataUri;
    } else {
      // Fallback to Google Gemini API
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: getModelForTask('thumbnail'),
        contents: prompt,
        config: {
          responseModalities: ["IMAGE" as any],
        }
      });

      CostTracker.track('thumbnail', getModelForTask('thumbnail'), getCostForTask('thumbnail'));

      const imageBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (imageBase64) {
        return `data:image/png;base64,${imageBase64}`;
      }
      return null;
    }
  } catch (e) {
    console.error("Reference image generation failed", e);
    return null;
  }
};

export const generateThumbnail = async (newsContext: string, config: ChannelConfig): Promise<string | null> => {
  const ai = getAiClient();

  const prompt = `
  Create a high-impact YouTube thumbnail for a news video about: ${newsContext}.
  Channel Style: ${config.channelName} (${config.tone}).
  Visuals: Bold, high contrast, breaking news style. 
  Include text overlay if possible or just striking imagery.
  Aspect Ratio: 16:9.
  No photorealistic faces of real politicians if restricted, use stylized or symbolic representations.
`;

  try {
    const response = await ai.models.generateContent({
      model: getModelForTask('thumbnail'),
      contents: prompt,
      config: {
        responseModalities: ["IMAGE" as any],
      }
    });

    CostTracker.track('thumbnail', getModelForTask('thumbnail'), getCostForTask('thumbnail'));

    const imageBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (imageBase64) {
      return `data:image/png;base64,${imageBase64}`;
    }
    return null;
  } catch (e) {
    console.error("Thumbnail generation failed", e);
    return null;
  }
};

export const generateThumbnailVariants = async (
  newsContext: string,
  config: ChannelConfig,
  viralMeta: ViralMetadata
): Promise<{ primary: string | null; variant: string | null }> => {
  const ai = getAiClient();

  // Define 3 proven thumbnail styles
  const styles = [
    {
      name: "Shocked Face + Bold Text",
      prompt: "Close-up shocked/surprised expression with mouth open, bold oversized text overlay with the headline, high contrast bright colors, dramatic lighting from one side"
    },
    {
      name: "Split Screen Comparison",
      prompt: "Split-screen vertical composition showing before/after or two contrasting elements, bold arrows pointing between them, numbers/percentages overlaid, contrasting color schemes on each side"
    },
    {
      name: "Symbolic + Urgency",
      prompt: "Symbolic representation of the topic (money, charts, danger symbols), urgent red/yellow color scheme, text with exclamation marks, clock or fire emoji elements"
    }
  ];

  // Rotate style based on date (simple A/B pattern)
  const styleIndex = new Date().getDate() % styles.length;
  const primaryStyle = styles[styleIndex];
  const variantStyle = styles[(styleIndex + 1) % styles.length];

  const basePrompt = (style: typeof styles[0]) => `
Create a VIRAL YouTube thumbnail for: "${viralMeta.title}"

Topic: ${newsContext}
Channel: ${config.channelName}

STYLE: ${style.name}
${style.prompt}

REQUIREMENTS:
- 16:9 ratio (1280x720)
- Bold readable text: "${viralMeta.title.substring(0, 30)}"
- Brand colors: ${config.logoColor1}, ${config.logoColor2}
- High contrast (mobile-friendly)
- Evoke emotion: shock, curiosity, urgency
- NO photorealistic politicians (use icons/symbols)
- Professional news aesthetic

Make it CLICK-WORTHY!
`.trim();

  try {
    const [primary, variant] = await Promise.all([
      retryWithBackoff(async () => {
        const response = await ai.models.generateContent({
          model: getModelForTask('thumbnail'),
          contents: basePrompt(primaryStyle),
          config: { responseModalities: ["IMAGE" as any] }
        });

        CostTracker.track('thumbnail', getModelForTask('thumbnail'), getCostForTask('thumbnail'));

        const imageBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!imageBase64) throw new Error('No image data');
        return `data:image/png;base64,${imageBase64}`;
      }, { maxRetries: 2, baseDelay: 2000 }),

      retryWithBackoff(async () => {
        const response = await ai.models.generateContent({
          model: getModelForTask('thumbnail'),
          contents: basePrompt(variantStyle),
          config: { responseModalities: ["IMAGE" as any] }
        });

        CostTracker.track('thumbnail', getModelForTask('thumbnail'), getCostForTask('thumbnail'));

        const imageBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!imageBase64) throw new Error('No image data');
        return `data:image/png;base64,${imageBase64}`;
      }, { maxRetries: 2, baseDelay: 2000 })
    ]);

    return { primary, variant };
  } catch (e) {
    console.error("Thumbnail variants generation failed", e);
    // Fallback to single thumbnail
    const fallback = await generateThumbnail(newsContext, config);
    return { primary: fallback, variant: null };
  }
};

export const generateViralHook = async (
  news: NewsItem[],
  config: ChannelConfig
): Promise<string> => {
  const ai = getAiClient();

  const topStory = news[0];

  const prompt = `
You are a VIRAL content scriptwriter (100M+ views).

Create an ATTENTION-GRABBING opening hook (2-3 sentences, max 30 words) for this news:
"${topStory.headline}"

HOOK FORMULA:
1. Shocking statement OR urgent question
2. Promise immediate value
3. Create curiosity gap

POWER WORDS: YOU, THIS, NOW, SHOCKING, BREAKING, EXPOSED, REVEALED

EXAMPLES:
- "You WON'T believe what just happened to the stock market. In 60 seconds, I'll show you how this affects YOUR money."
- "BREAKING: This could change EVERYTHING. Here's what the news won't tell you."
- "They tried to hide THIS from you. Watch before it's deleted."

Channel tone: ${config.tone}
Return ONLY the hook text, no explanation.
`.trim();

  try {
    const response = await ai.models.generateContent({
      model: getModelForTask('viralHook'),
      contents: prompt
    });

    CostTracker.track('viralHook', getModelForTask('viralHook'), getCostForTask('viralHook'));

    return response.text?.trim() || "You won't believe this news...";
  } catch (e) {
    console.error("Viral hook generation failed", e);
    return `Breaking news about ${topStory.headline.substring(0, 30)}...`;
  }
};
