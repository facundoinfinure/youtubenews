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

/**
 * Make a request to SerpAPI via proxy
 */
const serpApiRequest = async (params: Record<string, string>): Promise<any> => {
  const proxyUrl = getProxyUrl().replace(/\/$/, '');
  const queryString = new URLSearchParams(params).toString();
  const url = `${proxyUrl}/api/serpapi?${queryString}`;
  
  console.log(`[SerpAPI] 🔍 Searching: ${params.q}`);
  
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
 */
const calculateViralScore = async (item: any): Promise<number> => {
  const headline = item.title || '';
  const summary = item.snippet || item.title || '';
  const source = item.source?.name || item.source || 'Unknown';
  const date = item.date;
  
  // Create cache key based on headline (first 100 chars)
  const cacheKey = `viral_score_${headline.substring(0, 100).toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  
  // Try to get from cache first
  const cached = await ContentCache.get(cacheKey);
  if (cached !== null && typeof cached === 'number') {
    return cached;
  }
  
  // Calculate using OpenAI
  try {
    const score = await calculateViralScoreWithGPT(headline, summary, source, date);
    // Cache for 24 hours
    await ContentCache.set(cacheKey, score, 86400000);
    return score;
  } catch (error) {
    console.warn(`[Viral Score] OpenAI failed, using basic calculation:`, (error as Error).message);
    // Fallback to basic calculation
    return calculateBasicViralScore(headline, summary, source, date);
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
 * Parse publication date from SerpAPI date string
 * Formats can be: "2 hours ago", "1 day ago", "April 3, 2025", "2025-04-03", etc.
 * Returns a Date object or null if parsing fails
 */
const parsePublicationDate = (dateStr: string | undefined, targetDate: Date): Date | null => {
  if (!dateStr) return null;
  
  try {
    // Try to parse as relative time (e.g., "2 hours ago", "1 day ago")
    const relativeMatch = dateStr.match(/(\d+)\s*(hour|hours|day|days|minute|minutes|week|weeks)\s*ago/i);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2].toLowerCase();
      const now = new Date();
      const parsed = new Date(now);
      
      if (unit.includes('hour') || unit.includes('minute')) {
        // For hours/minutes, use the target date as reference
        parsed.setTime(targetDate.getTime());
        if (unit.includes('hour')) {
          parsed.setHours(parsed.getHours() - amount);
        } else {
          parsed.setMinutes(parsed.getMinutes() - amount);
        }
        return parsed;
      } else if (unit.includes('day')) {
        parsed.setDate(parsed.getDate() - amount);
        return parsed;
      } else if (unit.includes('week')) {
        parsed.setDate(parsed.getDate() - (amount * 7));
        return parsed;
      }
    }
    
    // Try to parse as absolute date (e.g., "April 3, 2025", "2025-04-03")
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
    
    // Try common date formats
    const formats = [
      /(\w+)\s+(\d+),\s+(\d+)/, // "April 3, 2025"
      /(\d{4})-(\d{2})-(\d{2})/, // "2025-04-03"
      /(\d{2})\/(\d{2})\/(\d{4})/, // "04/03/2025"
    ];
    
    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          return parsed;
        }
      }
    }
    
    return null;
  } catch (e) {
    console.warn(`⚠️ Could not parse date: "${dateStr}"`, e);
    return null;
  }
};

/**
 * Fetch economic/political news for a specific date and country
 */
export const fetchNewsWithSerpAPI = async (
  targetDate: Date | undefined,
  config: ChannelConfig
): Promise<NewsItem[]> => {
  // Determine date to query
  let dateToQuery = new Date();
  if (targetDate) {
    dateToQuery = new Date(targetDate);
  } else {
    dateToQuery.setDate(dateToQuery.getDate() - 1);
  }

  const cacheKey = `serpapi_news_${dateToQuery.toISOString().split('T')[0]}_${config.country}_v1`;

  return ContentCache.getOrGenerate(
    cacheKey,
    async () => {
      // Get country config
      const countryConfig = COUNTRY_CONFIG[config.country] || { gl: 'us', hl: 'en' };
      
      // Build search query based on channel focus
      // Try to capture economic and political news
      const searchTerms = [
        'economy',
        'markets',
        'inflation',
        'stocks',
        'politics',
        'breaking news'
      ];
      
      // Use a broad query to get diverse results
      const query = `${config.country} news economy politics today`;
      
      console.log(`[SerpAPI] 📰 Fetching news for ${config.country} (${countryConfig.gl}/${countryConfig.hl})`);
      
      const data = await serpApiRequest({
        q: query,
        gl: countryConfig.gl,
        hl: countryConfig.hl,
        num: '20'  // Request more to filter
      });
      
      // Track cost (~$0.01 per search)
      CostTracker.track('news', 'serpapi', 0.01);
      
      // Combine news_results and top_stories
      const allNews: any[] = [];
      
      // Process news_results
      if (data.news_results && Array.isArray(data.news_results)) {
        data.news_results.forEach((item: any) => {
          allNews.push({
            headline: item.title,
            source: item.source?.name || item.source || 'Unknown',
            url: item.link || '#',
            summary: item.snippet || item.title,
            imageUrl: item.thumbnail,
            date: item.date
          });
        });
      }
      
      // Process top_stories
      if (data.top_stories && Array.isArray(data.top_stories)) {
        data.top_stories.forEach((item: any) => {
          allNews.push({
            headline: item.title,
            source: item.source?.name || item.source || 'Unknown',
            url: item.link || '#',
            summary: item.title, // Top stories usually don't have snippets
            imageUrl: item.thumbnail,
            date: item.date
          });
        });
      }
      
      // Deduplicate by headline
      const seen = new Set<string>();
      const uniqueNews = allNews.filter(item => {
        const key = item.headline.toLowerCase().substring(0, 50);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      
      // Process news items and calculate viral scores in batch
      console.log(`[SerpAPI] 🔥 Calculating viral scores for ${uniqueNews.length} news items...`);
      
      // Prepare items for batch scoring
      const itemsForScoring = uniqueNews.map(item => ({
        headline: item.headline,
        summary: item.summary,
        source: item.source,
        date: item.date
      }));
      
      // Calculate viral scores in batch (parallel processing)
      const viralScores = await calculateViralScoresBatch(itemsForScoring);
      
      // Process and enhance news items with calculated scores
      // Filter by publication date to ensure only news from the target date is included
      const targetDateStr = dateToQuery.toISOString().split('T')[0];
      const processedNews: NewsItem[] = uniqueNews
        .map((item, index) => {
          // Parse publication date
          const publicationDate = parsePublicationDate(item.date, dateToQuery);
          
          return {
            headline: item.headline,
            source: item.source,
            url: item.url,
            summary: item.summary,
            viralScore: viralScores[index] || 50, // Fallback to 50 if score calculation failed
            imageKeyword: extractImageKeyword(item.headline),
            imageUrl: item.imageUrl || undefined,
            publicationDate: publicationDate || undefined
          };
        })
        .filter((item) => {
          // Only include news items that have a publication date matching the target date
          if (!item.publicationDate) {
            // If we can't parse the date, include it (backward compatibility)
            // But log a warning
            console.warn(`⚠️ News item "${item.headline}" has no parseable publication date, including anyway`);
            return true;
          }
          
          const pubDate = typeof item.publicationDate === 'string' 
            ? new Date(item.publicationDate) 
            : item.publicationDate;
          const pubDateStr = pubDate.toISOString().split('T')[0];
          
          // Include if publication date matches target date
          const matches = pubDateStr === targetDateStr;
          if (!matches) {
            console.log(`⏭️ Filtering out "${item.headline}" - publication date: ${pubDateStr}, target: ${targetDateStr}`);
          }
          return matches;
        });
      
      // Sort by viral score and take top 15
      const sortedNews = processedNews
        .sort((a, b) => b.viralScore - a.viralScore)
        .slice(0, 15);
      
      // Log score distribution
      const scoreRange = sortedNews.length > 0 
        ? `${Math.min(...viralScores)}-${Math.max(...viralScores)}`
        : 'N/A';
      console.log(`[SerpAPI] 📊 Viral score range: ${scoreRange}`);
      
      console.log(`[SerpAPI] ✅ Processed ${sortedNews.length} news items`);
      
      // Validate we have enough news
      if (sortedNews.length === 0) {
        throw new Error('No news found for the specified date and country');
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
