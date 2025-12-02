import { GoogleGenAI, Modality } from "@google/genai";
import { NewsItem, ScriptLine, BroadcastSegment, VideoAssets, ViralMetadata, ChannelConfig } from "../types";
import { ContentCache } from "./ContentCache";
import { retryWithBackoff } from "./retryUtils";

const getApiKey = () => import.meta.env.VITE_GEMINI_API_KEY || window.env?.API_KEY || process.env.API_KEY || "";
const getAiClient = () => new GoogleGenAI({ apiKey: getApiKey() });

export const fetchEconomicNews = async (targetDate: Date | undefined, config: ChannelConfig): Promise<NewsItem[]> => {
  // Use caching for same-day news
  let dateToQuery = new Date();
  if (targetDate) {
    dateToQuery = new Date(targetDate);
  } else {
    dateToQuery.setDate(dateToQuery.getDate() - 1);
  }

  const cacheKey = `news_${dateToQuery.toISOString().split('T')[0]}_${config.country}`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {
      const ai = getAiClient();

      // Use the selected date directly, don't subtract a day
      let dateToQuery = new Date();
      if (targetDate) {
        dateToQuery = new Date(targetDate);
      } else {
        // Only subtract a day if no date is provided (default behavior)
        dateToQuery.setDate(dateToQuery.getDate() - 1);
      }

      const dateString = dateToQuery.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      const prompt = `Find 15 impactful economic or political news stories from ${dateString} relevant to ${config.country}. 
  Focus on major market moves, inflation, politics, or social issues. 
  
  Return a strictly formatted JSON array of objects with these keys: 
  - "headline" (string, in ${config.language})
  - "source" (string)
  - "url" (string, use grounding or best guess)
  - "summary" (string, 1 short sentence in ${config.language})
  - "viralScore" (number, 1-100 based on controversy or impact)
  - "imageKeyword" (string, 2-3 words visual description of the topic for image generation, e.g. "bitcoin crash", "stock market bull")

  Do not include markdown formatting like \`\`\`json.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const text = response.text || "";
      const jsonStr = text.replace(/```json\n|\n```/g, "").replace(/```/g, "");

      try {
        const news: NewsItem[] = JSON.parse(jsonStr);
        return news.map((item, index) => {
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
      } catch (e) {
        console.warn("Failed to parse news JSON directly", e);
        throw new Error("Failed to parse news from Gemini");
      }
    },
    3600000, // 1 hour TTL
    0.05 // Estimated cost per call
  );
};

export const generateScript = async (news: NewsItem[], config: ChannelConfig): Promise<ScriptLine[]> => {
  const ai = getAiClient();

  const newsContext = news.map(n => `- ${n.headline} (Source: ${n.source}). Summary: ${n.summary}`).join('\n');

  const systemPrompt = `
  You are the showrunner for "${config.channelName}", a short 1-minute news segment hosted by: 
  1. "${config.characters.hostA.name}" (${config.characters.hostA.bio}).
  2. "${config.characters.hostB.name}" (${config.characters.hostB.bio}).
  
  Tone: ${config.tone}.
  Language: ${config.language}.
  
  They are discussing the selected news.
  
  Rules:
  - KEEP IT UNDER 150 WORDS TOTAL (approx 1 minute).
  - CITATION REQUIRED: You MUST explicitly mention the source of the news in the dialogue.
  - Structure the output as a JSON Array of objects: [{"speaker": "${config.characters.hostA.name}", "text": "..."}, {"speaker": "${config.characters.hostB.name}", "text": "..."}].
  - Use "Both" as speaker for the intro/outro if they speak together.
  - Be creative, use puns related to the characters (e.g. if one is a gorilla, use banana puns; if a penguin, ice puns).
  - STRICT JSON OUTPUT. NO MARKDOWN.
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Here is the selected news for today's episode:\n${newsContext}\n\nWrite the script in JSON format.`,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json"
    }
  });

  try {
    const text = response.text || "[]";
    // Cleanup just in case
    const cleanText = text.replace(/```json/g, "").replace(/```/g, "");
    return JSON.parse(cleanText) as ScriptLine[];
  } catch (e) {
    console.error("Script parsing error", e);
    throw new Error("Failed to parse script from Gemini");
  }
};

export const generateViralMetadata = async (news: NewsItem[], config: ChannelConfig, date: Date): Promise<ViralMetadata> => {
  const ai = getAiClient();
  const newsContext = news.map(n => `- ${n.headline}`).join('\n');
  const dateStr = date.toLocaleDateString();

  const prompt = `
  You are a YouTube Growth Hacker for the channel "${config.channelName}". 
  Generate the metadata for a video discussing these stories:
  ${newsContext}

  Language: ${config.language}.

  Return a JSON object with:
  1. "title": A CLICKBAIT, VIRAL style title (max 70 chars). Use CAPS for emphasis and maybe one emoji. 
  2. "description": A short, SEO-optimized description (max 300 chars) summarizing the video. Include the channel tagline "${config.tagline}" and the date: ${dateStr}.
  3. "tags": An array of 15 high-volume tags/keywords strings. Include these default tags if relevant: ${config.defaultTags?.join(', ') || ''}.

  Example JSON:
  {
    "title": "MARKET CRASH IMMINENT?! 📉 (${config.channelName} Explain)",
    "description": "We break down the latest numbers. Is your portfolio safe? ${config.tagline}. News for ${dateStr}.",
    "tags": ["finance", "news"]
  }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });

  try {
    const text = response.text || "{}";
    return JSON.parse(text) as ViralMetadata;
  } catch (e) {
    throw new Error("Failed to parse viral metadata from Gemini");
  }
};

export const generateSegmentedAudio = async (script: ScriptLine[], config: ChannelConfig): Promise<BroadcastSegment[]> => {
  const ai = getAiClient();

  // PARALLEL PROCESSING - much faster
  const audioPromises = script.map(async (line) => {
    let voiceName = 'Kore'; // Default
    if (line.speaker === config.characters.hostA.name) {
      voiceName = config.characters.hostA.voiceName;
    } else if (line.speaker === config.characters.hostB.name) {
      voiceName = config.characters.hostB.voiceName;
    }

    return retryWithBackoff(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: line.text,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }
            }
          }
        }
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error('No audio data received');

      return {
        speaker: line.speaker,
        text: line.text,
        audioBase64: base64Audio
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

  const prompt = `
Create a professional ${config.format} news broadcast video.

CHANNEL: ${config.channelName}
TOPIC: ${newsContext}

CHARACTERS (maintain visual consistency):
- ${config.characters.hostA.name}: ${config.characters.hostA.visualPrompt}
- ${config.characters.hostB.name}: ${config.characters.hostB.visualPrompt}

DIALOGUE FOR LIP-SYNC:
${scriptText}

STYLE: ${config.tone}, professional news studio setting
DURATION: 60 seconds
QUALITY: High definition, stable camera, good lighting
  `.trim();

  return retryWithBackoff(async () => {
    try {
      const response = await ai.models.generateContent({
        model: "veo-3.1-generate-preview",
        contents: prompt,
        config: {
          // VEO3-specific config
        }
      });

      // Try to extract video URI from operation or direct response
      // Poll for completion if it's an async operation
      const operation = response as any; // Type assertion for flexibility

      // Check if we got a direct URI or need to poll
      if (operation.operation) {
        const videoUri = await pollForVideo(operation.operation);
        return {
          wide: videoUri,
          hostA: [],
          hostB: []
        };
      }

      // Check for direct video in response
      const videoPart = response.candidates?.[0]?.content?.parts?.find(
        (part: any) => part.videoMetadata || part.fileData
      );

      if (videoPart) {
        const uri = (videoPart as any).fileData?.fileUri || (videoPart as any).videoMetadata?.uri;
        if (uri) {
          return {
            wide: `${uri}&key=${getApiKey()}`,
            hostA: [],
            hostB: []
          };
        }
      }

      throw new Error('No video URI found in VEO3 response');

    } catch (e) {
      console.error("VEO3 generation failed", e);
      // Fallback to placeholder for now
      console.warn("Using placeholder video - VEO3 may not be available yet");
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
      model: "imagen-3.0-generate-001",
      contents: prompt,
      config: {
        responseModalities: ["IMAGE" as any],
      }
    });

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
