/**
 * SerpAPI Service
 * 
 * Fetches news from Google News using SerpAPI.
 * Uses the /api/serpapi proxy for all requests.
 * Country config loaded from Supabase (locale_config table)
 */

import { NewsItem, ChannelConfig } from "../types";
import { ContentCache } from "./ContentCache";
import { CostTracker } from "./CostTracker";
import { supabase } from "./supabaseService";
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

// Fallback country config (used if Supabase table doesn't exist)
// Note: Use es-419 for Latin American Spanish (Argentina, Mexico, etc.)
// This matches Google News format: hl=es-419&gl=AR&ceid=AR:es-419
// IMPORTANT: gl should be uppercase (AR, not ar) for proper country filtering
const FALLBACK_COUNTRY_CONFIG: Record<string, { gl: string; hl: string }> = {
  'Argentina': { gl: 'AR', hl: 'es-419' }, // Spanish (Latin America) for Argentina, gl in uppercase
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

// In-memory cache for locale config (loaded once from Supabase)
let localeConfigCache: Record<string, { gl: string; hl: string }> | null = null;
let localeConfigLoaded = false;

/**
 * Load locale configuration from Supabase
 */
const loadLocaleConfig = async (): Promise<Record<string, { gl: string; hl: string }>> => {
  if (localeConfigLoaded && localeConfigCache) {
    return localeConfigCache;
  }

  if (!supabase) {
    localeConfigLoaded = true;
    localeConfigCache = FALLBACK_COUNTRY_CONFIG;
    return FALLBACK_COUNTRY_CONFIG;
  }

  try {
    const { data, error } = await supabase
      .from('locale_config')
      .select('country, google_gl, google_hl');

    if (error) {
      // Table might not exist
      if (error.code === '42P01' || error.message?.includes('locale_config')) {
        console.warn('⚠️ locale_config table not found - using fallback config');
      } else {
        console.error('Error loading locale config:', error);
      }
      localeConfigLoaded = true;
      localeConfigCache = FALLBACK_COUNTRY_CONFIG;
      return FALLBACK_COUNTRY_CONFIG;
    }

    // Convert to expected format
    const config: Record<string, { gl: string; hl: string }> = {};
    for (const row of data || []) {
      config[row.country] = { gl: row.google_gl, hl: row.google_hl };
    }

    // Merge with fallback to ensure all countries are covered
    localeConfigCache = { ...FALLBACK_COUNTRY_CONFIG, ...config };
    localeConfigLoaded = true;
    console.log(`🌍 Loaded ${Object.keys(config).length} locale configs from Supabase`);
    return localeConfigCache;
  } catch (e) {
    console.warn('Failed to load locale config:', e);
    localeConfigLoaded = true;
    localeConfigCache = FALLBACK_COUNTRY_CONFIG;
    return FALLBACK_COUNTRY_CONFIG;
  }
};

/**
 * Get country config (sync version with fallback)
 * Case-insensitive lookup to handle variations like "ARGENTINA", "Argentina", "argentina"
 */
const getCountryConfig = (country: string): { gl: string; hl: string } => {
  // Use cache if available, otherwise fallback
  const config = localeConfigCache || FALLBACK_COUNTRY_CONFIG;
  
  // Direct lookup first
  if (config[country]) {
    return config[country];
  }
  
  // Case-insensitive lookup
  const countryLower = country.toLowerCase();
  for (const [key, value] of Object.entries(config)) {
    if (key.toLowerCase() === countryLower) {
      console.log(`🌍 [Locale] Matched "${country}" to "${key}" (case-insensitive)`);
      return value;
    }
  }
  
  // Fallback to US English if no match found
  console.warn(`⚠️ [Locale] No config found for country "${country}", using US/en fallback`);
  return { gl: 'us', hl: 'en' };
};

// Default topic token - loaded from system_defaults or fallback
const DEFAULT_TOPIC_TOKEN_FALLBACK = 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB';
let defaultTopicToken: string | null = null;

/**
 * Get default topic token (from Supabase or fallback)
 */
const getDefaultTopicToken = async (): Promise<string> => {
  if (defaultTopicToken) return defaultTopicToken;

  if (!supabase) {
    return DEFAULT_TOPIC_TOKEN_FALLBACK;
  }

  try {
    const { data, error } = await supabase
      .from('system_defaults')
      .select('value')
      .eq('key', 'default_topic_token')
      .maybeSingle();

    if (error || !data) {
      return DEFAULT_TOPIC_TOKEN_FALLBACK;
    }

    // Value is stored as JSON string
    defaultTopicToken = typeof data.value === 'string' 
      ? data.value.replace(/^"|"$/g, '') // Remove quotes if stored as JSON string
      : data.value;
    return defaultTopicToken || DEFAULT_TOPIC_TOKEN_FALLBACK;
  } catch (e) {
    console.warn('Failed to load default topic token:', e);
    return DEFAULT_TOPIC_TOKEN_FALLBACK;
  }
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
  // Load locale config from Supabase (or fallback)
  await loadLocaleConfig();
  
  // Get country config for language/region
  const countryConfig = getCountryConfig(config.country);
  
  // Use channel's topic token, or fall back to default from Supabase/fallback
  const defaultToken = await getDefaultTopicToken();
  const topicToken = config.topicToken || defaultToken;
  
  // Cache key based on channel name (each channel has its own topic)
  const cacheKey = `serpapi_topic_news_${config.channelName}_${new Date().toISOString().split('T')[0]}_v3`;

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
      // Load locale config if not already loaded
      await loadLocaleConfig();
      const countryConfig = getCountryConfig(country);
      
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
