
import { GoogleGenAI, Modality } from "@google/genai";
import { NewsItem, ScriptLine, BroadcastSegment, VideoAssets, ViralMetadata, ChannelConfig } from "../types";

const getApiKey = () => import.meta.env.VITE_GEMINI_API_KEY || window.env?.API_KEY || process.env.API_KEY || "";
const getAiClient = () => new GoogleGenAI({ apiKey: getApiKey() });

export const fetchEconomicNews = async (targetDate: Date | undefined, config: ChannelConfig): Promise<NewsItem[]> => {
  const ai = getAiClient();

  let dateToQuery = new Date();
  if (targetDate) {
    dateToQuery = new Date(targetDate);
  } else {
    dateToQuery.setDate(dateToQuery.getDate() - 1);
  }

  const dateString = dateToQuery.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const prompt = `Find 6 impactful economic or political news stories from ${dateString} relevant to ${config.country}. 
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
      return {
        ...item,
        url: finalUrl,
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

export const generateViralMetadata = async (news: NewsItem[], config: ChannelConfig): Promise<ViralMetadata> => {
  const ai = getAiClient();
  const newsContext = news.map(n => `- ${n.headline}`).join('\n');

  const prompt = `
  You are a YouTube Growth Hacker for the channel "${config.channelName}". 
  Generate the metadata for a video discussing these stories:
  ${newsContext}

  Language: ${config.language}.

  Return a JSON object with:
  1. "title": A CLICKBAIT, VIRAL style title (max 70 chars). Use CAPS for emphasis and maybe one emoji. 
  2. "description": A short, SEO-optimized description (max 300 chars) summarizing the video. Include the channel tagline "${config.tagline}".
  3. "tags": An array of 15 high-volume tags/keywords strings.

  Example JSON:
  {
    "title": "MARKET CRASH IMMINENT?! 📉 (${config.channelName} Explain)",
    "description": "We break down the latest numbers. Is your portfolio safe? ${config.tagline}.",
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
  const segments: BroadcastSegment[] = [];

  for (const line of script) {
    let voiceName = 'Kore'; // Default
    if (line.speaker === config.characters.hostA.name) {
      voiceName = config.characters.hostA.voiceName;
    } else if (line.speaker === config.characters.hostB.name) {
      voiceName = config.characters.hostB.voiceName;
    }

    try {
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
      if (base64Audio) {
        segments.push({
          speaker: line.speaker,
          text: line.text,
          audioBase64: base64Audio
        });
      }
    } catch (e) {
      console.error(`Audio gen failed for ${line.speaker}`, e);
    }
  }

  return segments;
};

// Helper for video polling
const pollForVideo = async (operation: any): Promise<string> => {
  const ai = getAiClient();
  let retries = 0;
  while (!operation.done && retries < 30) {
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

export const generateBroadcastVisuals = async (newsContext: string, config: ChannelConfig): Promise<VideoAssets> => {
  const ai = getAiClient();
  const model = 'veo-3.1-fast-generate-preview';
  // If format is Shorts (9:16), Veo supports it. 
  // However, fast-generate-preview might have limitations, but per docs it supports 9:16.
  const aspectRatio = config.format;
  const resolution = '720p';

  // 1. Wide Shot
  const promptWide = `Wide cinematic shot of a professional news studio. 
  Two news anchors sitting at a desk. 
  Left anchor: ${config.characters.hostA.visualPrompt}.
  Right anchor: ${config.characters.hostB.visualPrompt}.
  Background screens show economic graphs about ${newsContext}. 4k, photorealistic.`;

  // 2. Host A Close Up
  const promptHostA = `Close up shot of a news anchor. ${config.characters.hostA.visualPrompt}.
  Speaking seriously and gesturing. Professional news studio background. Photorealistic.`;

  // 3. Host B Close Up
  const promptHostB = `Close up shot of a news anchor. ${config.characters.hostB.visualPrompt}.
  Speaking wittily. Professional news studio background. Photorealistic.`;

  console.log("Starting video generation with aspect ratio:", aspectRatio);

  try {
    const promises = [
      ai.models.generateVideos({ model, prompt: promptWide, config: { numberOfVideos: 1, resolution, aspectRatio } }),

      ai.models.generateVideos({ model, prompt: promptHostA + " Variation 1.", config: { numberOfVideos: 1, resolution, aspectRatio } }),
      ai.models.generateVideos({ model, prompt: promptHostA + " Variation 2.", config: { numberOfVideos: 1, resolution, aspectRatio } }),

      ai.models.generateVideos({ model, prompt: promptHostB + " Variation 1.", config: { numberOfVideos: 1, resolution, aspectRatio } }),
      ai.models.generateVideos({ model, prompt: promptHostB + " Variation 2.", config: { numberOfVideos: 1, resolution, aspectRatio } })
    ];

    // Note: Reduced to 2 variations per host + 1 wide = 5 videos to save time/quota given the new complexity
    const operations = await Promise.all(promises);

    const results = await Promise.all(operations.map(op => pollForVideo(op).catch(e => { console.error("Vid failed", e); return null; })));

    const wide = results[0];
    const hostA = [results[1], results[2]].filter(v => v !== null) as string[];
    const hostB = [results[3], results[4]].filter(v => v !== null) as string[];

    return { wide, hostA, hostB };
  } catch (e) {
    console.error("Video generation critical failure", e);
    return { wide: null, hostA: [], hostB: [] };
  }
};
