/**
 * Competition Analyzer Service
 * 
 * NEW: Análisis de Competencia
 * - Scraper de videos exitosos del nicho
 * - Análisis de títulos, thumbnails y descripciones
 * - Identificación de patrones de éxito
 * - Aplicación de insights a generación de contenido
 */

import { supabase } from './supabaseService';

export interface CompetitorVideo {
  title: string;
  thumbnailUrl?: string;
  description: string;
  tags: string[];
  views: number;
  likes: number;
  engagementRate: number;
  duration: number;
  publishedAt: string;
  channelName: string;
}

export interface SuccessPattern {
  pattern: string;
  description: string;
  frequency: number;
  avgPerformance: {
    views: number;
    engagementRate: number;
  };
  examples: CompetitorVideo[];
}

export interface CompetitionInsights {
  topTitles: string[];
  topThumbnailStyles: string[];
  topTags: string[];
  optimalDuration: number;
  bestPublishingTimes: string[];
  patterns: SuccessPattern[];
}

/**
 * NEW: Competition Analyzer Service
 * Analyzes successful videos in the niche to extract patterns
 */
export class CompetitionAnalyzer {
  /**
   * Analyze competitor videos and extract success patterns
   */
  static async analyzeCompetition(
    channelId: string,
    niche: string = 'news'
  ): Promise<CompetitionInsights> {
    // This would typically use YouTube Data API or SerpAPI to fetch competitor videos
    // For now, we'll analyze our own successful videos as a proxy
    
    if (!supabase) {
      return {
        topTitles: [],
        topThumbnailStyles: [],
        topTags: [],
        optimalDuration: 60,
        bestPublishingTimes: [],
        patterns: []
      };
    }

    try {
      // Get top performing videos from our channel
      const { data: productions, error } = await supabase
        .from('productions')
        .select(`
          id,
          viral_metadata,
          published_at,
          video_analytics (
            view_count,
            like_count,
            comment_count,
            engagement_rate
          )
        `)
        .eq('channel_id', channelId)
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(50);

      if (error || !productions) {
        return {
          topTitles: [],
          topThumbnailStyles: [],
          topTags: [],
          optimalDuration: 60,
          bestPublishingTimes: [],
          patterns: []
        };
      }

      // Analyze successful videos
      const successfulVideos = productions
        .filter((p: any) => {
          const analytics = p.video_analytics?.[0];
          return analytics && (analytics.view_count > 100 || analytics.engagement_rate > 3);
        })
        .map((p: any) => {
          const analytics = p.video_analytics?.[0];
          return {
            title: p.viral_metadata?.title || '',
            description: p.viral_metadata?.description || '',
            tags: p.viral_metadata?.tags || [],
            views: analytics?.view_count || 0,
            likes: analytics?.like_count || 0,
            engagementRate: analytics?.engagement_rate || 0,
            publishedAt: p.published_at || ''
          };
        });

      // Extract patterns
      const topTitles = successfulVideos
        .sort((a, b) => b.views - a.views)
        .slice(0, 10)
        .map(v => v.title);

      const allTags = successfulVideos.flatMap(v => v.tags);
      const tagFrequency = allTags.reduce((acc, tag) => {
        acc[tag] = (acc[tag] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const topTags = Object.entries(tagFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([tag]) => tag);

      // Pattern: Titles with numbers
      const titlesWithNumbers = successfulVideos.filter(v => /\d+/.test(v.title));
      const patterns: SuccessPattern[] = [];
      
      if (titlesWithNumbers.length > 0) {
        patterns.push({
          pattern: 'Titles with Numbers',
          description: `${titlesWithNumbers.length} successful videos use numbers in titles`,
          frequency: titlesWithNumbers.length,
          avgPerformance: {
            views: titlesWithNumbers.reduce((sum, v) => sum + v.views, 0) / titlesWithNumbers.length,
            engagementRate: titlesWithNumbers.reduce((sum, v) => sum + v.engagementRate, 0) / titlesWithNumbers.length
          },
          examples: titlesWithNumbers.slice(0, 5)
        });
      }

      // Pattern: Question titles
      const questionTitles = successfulVideos.filter(v => v.title.includes('?'));
      if (questionTitles.length > 0) {
        patterns.push({
          pattern: 'Question Titles',
          description: `${questionTitles.length} successful videos use questions in titles`,
          frequency: questionTitles.length,
          avgPerformance: {
            views: questionTitles.reduce((sum, v) => sum + v.views, 0) / questionTitles.length,
            engagementRate: questionTitles.reduce((sum, v) => sum + v.engagementRate, 0) / questionTitles.length
          },
          examples: questionTitles.slice(0, 5)
        });
      }

      // Optimal duration (from successful videos)
      const optimalDuration = 60; // Default, could be calculated from analytics

      // Best publishing times (analyze by hour)
      const publishingHours = successfulVideos.map(v => {
        const date = new Date(v.publishedAt);
        return date.getHours();
      });
      const hourFrequency = publishingHours.reduce((acc, hour) => {
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      const bestHours = Object.entries(hourFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hour]) => `${hour}:00`);

      return {
        topTitles,
        topThumbnailStyles: [], // Would need thumbnail analysis
        topTags,
        optimalDuration,
        bestPublishingTimes: bestHours,
        patterns
      };
    } catch (e) {
      console.warn('Competition analysis failed:', e);
      return {
        topTitles: [],
        topThumbnailStyles: [],
        topTags: [],
        optimalDuration: 60,
        bestPublishingTimes: [],
        patterns: []
      };
    }
  }

  /**
   * Get optimization suggestions based on competitor analysis
   */
  static async getOptimizationFromCompetition(
    channelId: string,
    currentTitle: string,
    currentTags: string[]
  ): Promise<{
    titleSuggestions: string[];
    tagSuggestions: string[];
    patterns: SuccessPattern[];
  }> {
    const insights = await this.analyzeCompetition(channelId);
    
    // Generate title suggestions based on successful patterns
    const titleSuggestions: string[] = [];
    
    // Suggestion 1: Add number if missing
    if (!/\d+/.test(currentTitle) && insights.patterns.find(p => p.pattern === 'Titles with Numbers')) {
      titleSuggestions.push(`${currentTitle} - Top 5 Facts`);
    }
    
    // Suggestion 2: Add question if missing
    if (!currentTitle.includes('?') && insights.patterns.find(p => p.pattern === 'Question Titles')) {
      titleSuggestions.push(`${currentTitle}? Here's What You Need to Know`);
    }
    
    // Suggestion 3: Use top performing title structure
    if (insights.topTitles.length > 0) {
      const topTitle = insights.topTitles[0];
      // Extract structure and suggest similar
      titleSuggestions.push(`[Based on top performer] ${topTitle.substring(0, 30)}...`);
    }
    
    // Tag suggestions: Add missing top tags
    const missingTags = insights.topTags.filter(tag => !currentTags.includes(tag));
    const tagSuggestions = missingTags.slice(0, 5);
    
    return {
      titleSuggestions,
      tagSuggestions,
      patterns: insights.patterns
    };
  }
}
