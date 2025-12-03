import { GoogleGenAI, Modality } from "@google/genai";
import { NewsItem, ScriptLine, BroadcastSegment, VideoAssets, ViralMetadata, ChannelConfig } from "../types";
import { ContentCache } from "./ContentCache";
import { retryWithBackoff } from "./retryUtils";
import { getModelForTask, getCostForTask, getWavespeedModel } from "./modelStrategy";
import { CostTracker } from "./CostTracker";

const getApiKey = () => import.meta.env.VITE_GEMINI_API_KEY || window.env?.API_KEY || process.env.API_KEY || "";
const getWavespeedApiKey = () => import.meta.env.VITE_WAVESPEED_API_KEY || window.env?.WAVESPEED_API_KEY || process.env.WAVESPEED_API_KEY || "";
const getAiClient = () => new GoogleGenAI({ apiKey: getApiKey() });

// Helper function to check if Wavespeed should be used
const shouldUseWavespeed = () => {
  return !!getWavespeedApiKey();
};

// Wavespeed API helper functions
const createWavespeedTask = async (prompt: string, aspectRatio: '16:9' | '9:16'): Promise<string> => {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) throw new Error("Wavespeed API key not configured");

  const model = getWavespeedModel();
  const wavespeedApiUrl = "https://api.wavespeed.ai/v1/tasks";

  const response = await fetch(wavespeedApiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model,
      prompt: prompt,
      aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9',
      // Add other Wavespeed-specific parameters as needed
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wavespeed API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.task_id; // Wavespeed returns a task ID
};

const pollWavespeedTask = async (taskId: string): Promise<string> => {
  const apiKey = getWavespeedApiKey();
  if (!apiKey) throw new Error("Wavespeed API key not configured");

  const wavespeedApiUrl = `https://api.wavespeed.ai/v1/tasks/${taskId}`;
  let retries = 0;
  const maxRetries = 60; // 5 minutes max

  while (retries < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const response = await fetch(wavespeedApiUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      throw new Error(`Wavespeed polling error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.status === "completed" && data.result?.video_url) {
      return data.result.video_url;
    } else if (data.status === "failed") {
      throw new Error(`Wavespeed task failed: ${data.error || "Unknown error"}`);
    }

    retries++;
  }

  throw new Error("Wavespeed video generation timed out");
};

export const fetchEconomicNews = async (targetDate: Date | undefined, config: ChannelConfig): Promise<NewsItem[]> => {
  // Use caching for same-day news
  let dateToQuery = new Date();
  if (targetDate) {
    dateToQuery = new Date(targetDate);
  } else {
    dateToQuery.setDate(dateToQuery.getDate() - 1);
  }

  const cacheKey = `news_${dateToQuery.toISOString().split('T')[0]}_${config.country}_v2`;

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

  IMPORTANT: You MUST return 15 items. Do not return fewer.
  Do not include markdown formatting like \`\`\`json.`;

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
        const news: NewsItem[] = JSON.parse(jsonStr);

        // CRITICAL: Validate we got 15 items as requested
        if (news.length < 15) {
          console.warn(`⚠️ Only received ${news.length} news items, expected 15`);
          console.warn(`Response text (first 200 chars): ${text.substring(0, 200)}`);
          throw new Error(`Insufficient news items: got ${news.length}, expected 15. The API may not have enough data for this date.`);
        }

        const processedNews = news.map((item, index) => {
          // Prioritize grounding URL if available and missing in item
          let finalUrl = item.url;
          if ((!finalUrl || finalUrl === "#") && groundingChunks[index]?.web?.uri) {
            finalUrl = groundingChunks[index].web.uri;
          }

          // Extract image URL from grounding metadata
          let imageUrl = item.imageUrl;
          if (!imageUrl && groundingChunks[index]?.web) {
            // Try to get image from grounding chunk (using type assertion as structure may vary)
            const webChunk = groundingChunks[index].web as any;
            imageUrl = webChunk?.image || webChunk?.imageUrl || webChunk?.thumbnail;
          }

          return {
            ...item,
            url: finalUrl,
            imageUrl,
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

export const generateVideoSegments = async (
  script: ScriptLine[],
  config: ChannelConfig
): Promise<(string | null)[]> => {
  const ai = getAiClient();

  // IMPROVED: Generate videos for ALL segments (minimum 80%) to avoid repetition
  // Create multiple variations per character to ensure visual variety
  // Strategy: Generate for at least 80% of segments, with variations for each character

  // Track character variations to ensure variety
  const characterVariationCount: Record<string, number> = {
    [config.characters.hostA.name]: 0,
    [config.characters.hostB.name]: 0
  };

  const videoPromises = script.map(async (line, index) => {
    // Strategy: Generate for at least 80% of segments
    // Always generate for first and last, then generate for 80% of remaining
    const totalSegments = script.length;
    const minSegmentsToGenerate = Math.max(2, Math.ceil(totalSegments * 0.8));
    
    // Calculate which segments to generate - ensure we get at least 80%
    // Always generate first and last, then fill to reach 80%
    const shouldGenerate = index === 0 || 
                          index === script.length - 1 || 
                          index < minSegmentsToGenerate ||
                          (index < totalSegments && (index % 2 === 0 || Math.random() < 0.5));

    if (!shouldGenerate) return null;

    const character = line.speaker === config.characters.hostA.name
      ? config.characters.hostA
      : config.characters.hostB;

    // Track variation number for this character to create variety
    characterVariationCount[character.name] = (characterVariationCount[character.name] || 0) + 1;
    const variationNumber = characterVariationCount[character.name] % 5; // Cycle through 5 variations

    // Create variation in camera angle and action based on variation number
    const cameraAngles = ['front-facing', 'slight 3/4 angle left', 'slight 3/4 angle right', 'front with slight lean', 'front with hand gesture'];
    const actions = [
      'Speaking naturally to camera with confident expression',
      'Speaking to camera with subtle hand gestures emphasizing key points',
      'Speaking to camera with slight head movements for emphasis',
      'Speaking to camera with engaged, animated expression',
      'Speaking to camera with professional, authoritative presence'
    ];
    const cameraAngle = cameraAngles[variationNumber];
    const action = actions[variationNumber];

    // LIP-SYNC PROMPT: Explicitly include the text to be spoken
    const referenceImageContext = config.referenceImageUrl 
      ? `\nREFERENCE IMAGE: Match the exact visual style, setting, character appearance, and composition from the reference image. Maintain consistency with the reference scene.\n` 
      : '';

    // IMPROVED PROMPT: More specific with duration, actions, and lip-sync
    const prompt = `
  Professional news broadcast video segment of ${character.name} speaking.
  Visual Description: ${character.visualPrompt}
  Camera Angle: ${cameraAngle}
  Action: ${action}
  Dialogue for Lip-Sync: "${line.text}"
  Duration: 5-10 seconds of continuous speaking
  Emotion/Tone: ${config.tone}
  Setting: Professional news studio with consistent lighting, ${config.format} format.
  Lighting: Studio lighting, high quality, consistent with reference.
  Expression: Natural, engaging, appropriate for news content.
  ${referenceImageContext}
  IMPORTANT: The character must be speaking the exact dialogue provided for proper lip-sync. Maintain visual consistency with previous shots of this character.
    `.trim();

    return retryWithBackoff(async () => {
      try {
        // Use Wavespeed if API key is available, otherwise fallback to VEO
        if (shouldUseWavespeed()) {
          console.log(`[Wavespeed] Generating video for segment ${index} using model: ${getWavespeedModel()}`);
          const taskId = await createWavespeedTask(prompt, config.format);
          const videoUrl = await pollWavespeedTask(taskId);
          CostTracker.track('video', getWavespeedModel(), getCostForTask('video'));
          return videoUrl;
        } else {
          // Fallback to VEO
          const operation = await ai.models.generateVideos({
            model: getModelForTask('video'),
            prompt: prompt,
            config: {
              aspectRatio: config.format === '9:16' ? '9:16' : '16:9'
            }
          });

          CostTracker.track('video', getModelForTask('video'), getCostForTask('video'));

          // VEO returns an async operation that needs polling
          if (operation) {
            return await pollForVideo(operation);
          }
        }

        return null;
      } catch (e) {
        console.warn(`Failed to generate video for segment ${index}`, e);
        return null;
      }
    });
  });

  return Promise.all(videoPromises);
};
export const generateBroadcastVisuals = async (
  newsContext: string,
  config: ChannelConfig,
  script: ScriptLine[]
): Promise<VideoAssets> => {
  const ai = getAiClient();

  // Build prompt with script context for better lip-sync
  const scriptText = script
    .map(s => `${s.speaker}: ${s.text}`)
    .join('\n');

  // Build prompt with reference image context if available
  const referenceImageContext = config.referenceImageUrl 
    ? `\nREFERENCE IMAGE: Use the provided reference image to maintain visual consistency. Match the exact setting, character appearances, lighting, and composition from the reference image.\n` 
    : '';

  const prompt = `
Create a professional ${config.format} news broadcast video with branding.

CHANNEL: ${config.channelName}
TAGLINE: ${config.tagline}
BRANDING COLORS: ${config.logoColor1} and ${config.logoColor2}
TOPIC: ${newsContext}
${referenceImageContext}
CHARACTERS (maintain visual consistency):
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}
 
DIALOGUE FOR LIP-SYNC:
${scriptText}
 
STYLE: ${config.tone}, professional news studio setting
DURATION: 60 seconds
QUALITY: High definition, stable camera, good lighting
BRANDING: Include channel name "${config.channelName}" and tagline "${config.tagline}" visually in the scene. Use brand colors ${config.logoColor1} and ${config.logoColor2} in graphics, logos, or on-screen elements.
  `.trim();

  return retryWithBackoff(async () => {
    try {
      // Use Wavespeed if API key is available, otherwise fallback to VEO
      if (shouldUseWavespeed()) {
        console.log(`[Wavespeed] Generating broadcast video using model: ${getWavespeedModel()}`);
        const taskId = await createWavespeedTask(prompt, config.format);
        const videoUrl = await pollWavespeedTask(taskId);
        CostTracker.track('video', getWavespeedModel(), getCostForTask('video'));
        return {
          wide: videoUrl,
          hostA: [],
          hostB: []
        };
      } else {
        // Fallback to VEO
        const operation = await ai.models.generateVideos({
          model: getModelForTask('video'),
          prompt: prompt,
          config: {
            aspectRatio: config.format === '9:16' ? '9:16' : '16:9'
          }
        });

        CostTracker.track('video', getModelForTask('video'), getCostForTask('video'));

        // Poll for video completion
        if (operation) {
          const videoUri = await pollForVideo(operation);
          return {
            wide: videoUri,
            hostA: [],
            hostB: []
          };
        }

        throw new Error('No operation returned from VEO');
      }
    } catch (e) {
      console.error("Video generation failed", e);
      // Fallback to placeholder for now
      console.warn("Using placeholder video - video generation failed");
      return {
        wide: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
        hostA: [],
        hostB: []
      };
    }
  }, {
    maxRetries: 2,
    baseDelay: 5000,
    onRetry: (attempt) => console.log(`🎬 Retrying video generation (${attempt}/2)...`)
  });
};

export const generateReferenceImage = async (
  config: ChannelConfig,
  sceneDescription?: string
): Promise<string | null> => {
  const ai = getAiClient();

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
