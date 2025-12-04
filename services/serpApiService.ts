/**
 * SerpAPI Service
 * 
 * Fetches news from Google News using SerpAPI.
 * Uses the /api/serpapi proxy for all requests.
 */

import { NewsItem, ChannelConfig } from "../types";
import { ContentCache } from "./ContentCache";
import { CostTracker } from "./CostTracker";
import { calculateViralScoresBatch, calculateViralScoreWithGPT } from "./openaiService";

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

// Country to language/region mapping
const COUNTRY_CONFIG: Record<string, { gl: string; hl: string }> = {
  'Argentina': { gl: 'ar', hl: 'es' },
  'México': { gl: 'mx', hl: 'es' },
  'Mexico': { gl: 'mx', hl: 'es' },
  'España': { gl: 'es', hl: 'es' },
  'Spain': { gl: 'es', hl: 'es' },
  'United States': { gl: 'us', hl: 'en' },
  'USA': { gl: 'us', hl: 'en' },
  'UK': { gl: 'uk', hl: 'en' },
  'United Kingdom': { gl: 'uk', hl: 'en' },
  'Brasil': { gl: 'br', hl: 'pt' },
  'Brazil': { gl: 'br', hl: 'pt' },
  'Colombia': { gl: 'co', hl: 'es' },
  'Chile': { gl: 'cl', hl: 'es' },
  'Peru': { gl: 'pe', hl: 'es' },
  'Perú': { gl: 'pe', hl: 'es' },
};

// Topic tokens for Google News topics (Business focus for economic/political news)
// These tokens are specific to language/region combinations
const TOPIC_TOKENS: Record<string, string> = {
  // Business topic tokens by language
  'en': 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB', // Business (US/en)
  'es': 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnpHZ0pGVXlnQVAB', // Negocios (ES/es)
  'pt': 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FuQjBHZ0pDVWlnQVAB', // Negócios (BR/pt)
};

/**
 * Make a request to SerpAPI via proxy
 */
const serpApiRequest = async (params: Record<string, string>): Promise<any> => {
  const proxyUrl = getProxyUrl().replace(/\/$/, '');
  const queryString = new URLSearchParams(params).toString();
  const url = `${proxyUrl}/api/serpapi?${queryString}`;
  
  const logMsg = params.topic_token ? `Topic: Business` : `Query: ${params.q}`;
  console.log(`[SerpAPI] 🔍 ${logMsg}`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`SerpAPI error: ${response.status} - ${errorData.error || 'Unknown error'}`);
  }
  
  return response.json();
};

/**
 * Calculate viral score using OpenAI analysis (with caching)
 * Falls back to basic calculation if OpenAI fails
 * NOTE: This function is currently unused but kept for potential future use
 */
const calculateViralScore = async (item: any): Promise<{ score: number; reasoning: string }> => {
  const headline = item.title || '';
  const summary = item.snippet || item.title || '';
  const source = item.source?.name || item.source || 'Unknown';
  const date = item.date;
  
  // Create cache key based on headline (first 100 chars)
  const cacheKey = `viral_score_${headline.substring(0, 100).toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  
  // Try to get from cache first
  const cached = await ContentCache.get(cacheKey);
  if (cached !== null) {
    // Handle both old format (number) and new format (object)
    if (typeof cached === 'number') {
      return { score: cached, reasoning: 'Cached score (legacy format)' };
    }
    if (typeof cached === 'object' && 'score' in cached) {
      return cached as { score: number; reasoning: string };
    }
  }
  
  // Calculate using OpenAI
  try {
    const result = await calculateViralScoreWithGPT(headline, summary, source, date);
    // Cache for 24 hours
    await ContentCache.set(cacheKey, result, 86400000);
    return result;
  } catch (error) {
    console.warn(`[Viral Score] OpenAI failed, using basic calculation:`, (error as Error).message);
    // Fallback to basic calculation
    const fallbackScore = calculateBasicViralScore(headline, summary, source, date);
    return {
      score: fallbackScore,
      reasoning: 'Score calculated using basic algorithm (GPT analysis unavailable)'
    };
  }
};

/**
 * Basic viral score calculation (fallback)
 */
const calculateBasicViralScore = (
  headline: string,
  summary: string,
  source: string,
  date?: string
): number => {
  let score = 50; // Base score
  
  const text = `${headline} ${summary}`.toLowerCase();
  
  // Boost for certain keywords
  const viralKeywords = ['breaking', 'urgent', 'shocking', 'exclusive', 'just in', 'update'];
  viralKeywords.forEach(keyword => {
    if (text.includes(keyword)) score += 10;
  });
  
  // Boost for major sources
  const sourceLower = source.toLowerCase();
  const majorSources = ['reuters', 'bloomberg', 'cnn', 'bbc', 'nytimes', 'wsj', 'ap news'];
  if (majorSources.some(s => sourceLower.includes(s))) score += 15;
  
  // Boost for recent news (within last 6 hours)
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
  
  // Cap at 100
  return Math.min(score, 100);
};

/**
 * Extract image keyword from headline
 */
const extractImageKeyword = (headline: string): string => {
  // Remove common words and extract key terms
  const stopWords = ['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'were'];
  const words = headline.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(' ')
    .filter(w => w.length > 3 && !stopWords.includes(w));
  
  // Return first 2-3 meaningful words
  return words.slice(0, 3).join(' ') || 'breaking news';
};

/**
 * Parse publication date from SerpAPI iso_date field
 * iso_date format: "2024-11-20T07:48:00Z" (ISO 8601)
 * Returns a Date object or null if parsing fails
 */
const parseIsoDate = (isoDate: string | undefined): Date | null => {
  if (!isoDate) return null;
  
  try {
    const parsed = new Date(isoDate);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    return null;
  } catch (e) {
    console.warn(`⚠️ Could not parse iso_date: "${isoDate}"`, e);
    return null;
  }
};

/**
 * Fetch news from Google News using topic_token (Business topic)
 * This fetches the latest business news with REAL publication dates (iso_date)
 * News is saved to DB with real dates, then filtered by user-selected date in DB
 */
export const fetchNewsWithSerpAPI = async (
  targetDate: Date | undefined,
  config: ChannelConfig
): Promise<NewsItem[]> => {
  // Get country config
  const countryConfig = COUNTRY_CONFIG[config.country] || { gl: 'us', hl: 'en' };
  
  // Get topic token for the language (Business topic)
  const topicToken = TOPIC_TOKENS[countryConfig.hl] || TOPIC_TOKENS['en'];
  
  // Cache key based on country (not date, since we fetch latest and filter in DB)
  const cacheKey = `serpapi_topic_news_${config.country}_${new Date().toISOString().split('T')[0]}_v2`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {
      console.log(`[SerpAPI] 📰 Fetching Business news for ${config.country} (${countryConfig.gl}/${countryConfig.hl})`);
      console.log(`[SerpAPI] 🏷️ Using topic_token: ${topicToken.substring(0, 20)}...`);
      
      // Use Google News API with topic_token for Business news
      const data = await serpApiRequest({
        engine: 'google_news',
        topic_token: topicToken,
        gl: countryConfig.gl,
        hl: countryConfig.hl,
      });
      
      // Track cost (~$0.01 per search)
      CostTracker.track('news', 'serpapi', 0.01);
      
      // Collect all news items from different sections
      const allNews: any[] = [];
      
      // Helper to process a news item
      const processNewsItem = (item: any) => {
        if (!item.title || !item.link) return null;
        
        // Use iso_date for accurate publication date
        const isoDate = item.iso_date;
        const publicationDate = parseIsoDate(isoDate);
        
        return {
          headline: item.title,
          source: item.source?.name || 'Unknown',
          url: item.link,
          summary: item.snippet || item.title,
          imageUrl: item.thumbnail || item.thumbnail_small,
          isoDate: isoDate,
          publicationDate: publicationDate
        };
      };
      
      // Process news_results (main results)
      if (data.news_results && Array.isArray(data.news_results)) {
        data.news_results.forEach((item: any) => {
          // Check if this is a grouped story (has highlight and stories)
          if (item.highlight) {
            const processed = processNewsItem(item.highlight);
            if (processed) allNews.push(processed);
          }
          
          // Process stories within grouped items
          if (item.stories && Array.isArray(item.stories)) {
            item.stories.forEach((story: any) => {
              const processed = processNewsItem(story);
              if (processed) allNews.push(processed);
            });
          }
          
          // Process regular news item (not grouped)
          if (!item.highlight && !item.stories) {
            const processed = processNewsItem(item);
            if (processed) allNews.push(processed);
          }
        });
      }
      
      console.log(`[SerpAPI] 📥 Received ${allNews.length} news items from Google News`);
      
      // Deduplicate by URL (more reliable than headline)
      const seen = new Set<string>();
      const uniqueNews = allNews.filter(item => {
        // Create key from URL (remove query params for deduplication)
        const urlKey = item.url.split('?')[0].toLowerCase();
        if (seen.has(urlKey)) return false;
        seen.add(urlKey);
        return true;
      });
      
      console.log(`[SerpAPI] 🔄 ${uniqueNews.length} unique news items after deduplication`);
      
      // Log date distribution
      const dateCounts: Record<string, number> = {};
      uniqueNews.forEach(item => {
        if (item.publicationDate) {
          const dateStr = item.publicationDate.toISOString().split('T')[0];
          dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
        }
      });
      console.log(`[SerpAPI] 📅 News by date:`, dateCounts);
      
      // Process news items and calculate viral scores in batch
      console.log(`[SerpAPI] 🔥 Calculating viral scores for ${uniqueNews.length} news items...`);
      
      // Prepare items for batch scoring
      const itemsForScoring = uniqueNews.map(item => ({
        headline: item.headline,
        summary: item.summary,
        source: item.source,
        date: item.isoDate
      }));
      
      // Calculate viral scores in batch (parallel processing)
      const viralScoreResults = await calculateViralScoresBatch(itemsForScoring);
      
      // Process and enhance news items with calculated scores
      const processedNews: NewsItem[] = uniqueNews
        .map((item, index) => {
          const scoreResult = viralScoreResults[index] || { score: 50, reasoning: 'Score calculation unavailable' };
          
          return {
            headline: item.headline,
            source: item.source,
            url: item.url,
            summary: item.summary,
            viralScore: scoreResult.score,
            viralScoreReasoning: scoreResult.reasoning,
            imageKeyword: extractImageKeyword(item.headline),
            imageUrl: item.imageUrl || undefined,
            publicationDate: item.publicationDate || undefined
          };
        });
      
      // Sort by viral score
      const sortedNews = processedNews.sort((a, b) => b.viralScore - a.viralScore);
      
      // Log score distribution
      const scores = sortedNews.map(n => n.viralScore);
      const scoreRange = sortedNews.length > 0 
        ? `${Math.min(...scores)}-${Math.max(...scores)}`
        : 'N/A';
      console.log(`[SerpAPI] 📊 Viral score range: ${scoreRange}`);
      
      console.log(`[SerpAPI] ✅ Processed ${sortedNews.length} news items with REAL publication dates`);
      
      // Validate we have news
      if (sortedNews.length === 0) {
        throw new Error('No news found from Google News Business topic');
      }
      
      return sortedNews;
    },
    3600000, // 1 hour TTL
    0.01 // Cost per call
  );
};

/**
 * Fetch trending topics for a country
 */
export const fetchTrendingWithSerpAPI = async (country: string): Promise<string[]> => {
  const cacheKey = `serpapi_trending_${country}_${new Date().toISOString().split('T')[0]}`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {
      const countryConfig = COUNTRY_CONFIG[country] || { gl: 'us', hl: 'en' };
      
      // Search for trending topics
      const data = await serpApiRequest({
        q: `trending topics ${country} today`,
        gl: countryConfig.gl,
        hl: countryConfig.hl,
        num: '10'
      });
      
      CostTracker.track('trending', 'serpapi', 0.01);
      
      // Extract topics from headlines
      const topics: string[] = [];
      
      if (data.news_results) {
        data.news_results.forEach((item: any) => {
          // Extract key phrases from headlines
          const headline = item.title || '';
          const words = headline.split(' ').slice(0, 3).join(' ');
          if (words && !topics.includes(words)) {
            topics.push(words);
          }
        });
      }
      
      return topics.slice(0, 10);
    },
    7200000, // 2 hour TTL
    0.01
  );
};

/**
 * Check if SerpAPI proxy is configured
 */
export const checkSerpAPIConfig = (): { configured: boolean; message: string } => {
  const proxyUrl = getProxyUrl();
  
  if (proxyUrl) {
    return {
      configured: true,
      message: `✅ Using SerpAPI proxy at ${proxyUrl}/api/serpapi`
    };
  }
  
  return {
    configured: false,
    message: `❌ No proxy URL configured. Set VITE_BACKEND_URL or deploy to Vercel.`
  };
};
