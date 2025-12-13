/**
 * Analytics Service
 * 
 * NEW: Enhanced analytics with pattern detection, predictions, and optimization suggestions
 */

import { Production, VideoAnalyticsRecord } from '../types';
import { supabase } from './supabaseService';

export interface VideoPerformance {
  productionId: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  engagementRate: number;
  estimatedCTR: number;
  retentionScore?: number;
  narrativeType?: string;
  publishedAt: string;
  analytics?: VideoAnalyticsRecord;
}

export interface PerformancePattern {
  pattern: string;
  description: string;
  videos: VideoPerformance[];
  avgPerformance: {
    views: number;
    engagementRate: number;
    estimatedCTR: number;
  };
}

export interface PerformancePrediction {
  productionId: string;
  predictedViews: number;
  predictedEngagement: number;
  confidence: number;
  factors: string[];
}

export interface OptimizationSuggestion {
  type: 'narrative' | 'hook' | 'thumbnail' | 'title' | 'timing';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action: string;
  expectedImpact: string;
}

/**
 * NEW: Enhanced Analytics Service
 */
export class AnalyticsService {
  /**
   * Analyze video performance and identify patterns
   */
  static async analyzePerformancePatterns(
    channelId: string,
    period: '7days' | '28days' | '90days' = '28days'
  ): Promise<PerformancePattern[]> {
    if (!supabase) return [];

    try {
      // Get productions with analytics
      const { data: productions, error } = await supabase
        .from('productions')
        .select(`
          id,
          viral_metadata,
          narrative_used,
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
        .limit(100);

      if (error || !productions) return [];

      // Convert to performance data
      const performances: VideoPerformance[] = productions
        .filter((p: any) => p.video_analytics && p.video_analytics.length > 0)
        .map((p: any) => {
          const analytics = p.video_analytics[0];
          const views = analytics.view_count || 0;
          const likes = analytics.like_count || 0;
          const comments = analytics.comment_count || 0;
          const engagementRate = analytics.engagement_rate || 0;

          return {
            productionId: p.id,
            title: p.viral_metadata?.title || 'Untitled',
            views,
            likes,
            comments,
            engagementRate,
            estimatedCTR: this.estimateCTR(p.viral_metadata),
            narrativeType: p.narrative_used,
            publishedAt: p.published_at,
            analytics: analytics
          };
        });

      // Identify patterns
      const patterns: PerformancePattern[] = [];

      // Pattern 1: High-performing narrative types
      const byNarrative = this.groupBy(performances, 'narrativeType');
      Object.entries(byNarrative).forEach(([narrative, videos]) => {
        if (videos.length >= 2) {
          const avgViews = videos.reduce((sum, v) => sum + v.views, 0) / videos.length;
          const avgEngagement = videos.reduce((sum, v) => sum + v.engagementRate, 0) / videos.length;
          const avgCTR = videos.reduce((sum, v) => sum + v.estimatedCTR, 0) / videos.length;

          patterns.push({
            pattern: `Narrative: ${narrative || 'Unknown'}`,
            description: `${videos.length} videos using this narrative structure`,
            videos,
            avgPerformance: {
              views: avgViews,
              engagementRate: avgEngagement,
              estimatedCTR: avgCTR
            }
          });
        }
      });

      // Pattern 2: High engagement videos
      const highEngagement = performances.filter(v => v.engagementRate > 5);
      if (highEngagement.length >= 2) {
        patterns.push({
          pattern: 'High Engagement',
          description: `${highEngagement.length} videos with >5% engagement rate`,
          videos: highEngagement,
          avgPerformance: {
            views: highEngagement.reduce((sum, v) => sum + v.views, 0) / highEngagement.length,
            engagementRate: highEngagement.reduce((sum, v) => sum + v.engagementRate, 0) / highEngagement.length,
            estimatedCTR: highEngagement.reduce((sum, v) => sum + v.estimatedCTR, 0) / highEngagement.length
          }
        });
      }

      // Pattern 3: Viral videos (high views)
      const viral = performances.filter(v => v.views > 1000);
      if (viral.length >= 2) {
        patterns.push({
          pattern: 'Viral Content',
          description: `${viral.length} videos with >1000 views`,
          videos: viral,
          avgPerformance: {
            views: viral.reduce((sum, v) => sum + v.views, 0) / viral.length,
            engagementRate: viral.reduce((sum, v) => sum + v.engagementRate, 0) / viral.length,
            estimatedCTR: viral.reduce((sum, v) => sum + v.estimatedCTR, 0) / viral.length
          }
        });
      }

      // Sort by average performance
      patterns.sort((a, b) => b.avgPerformance.views - a.avgPerformance.views);

      return patterns;
    } catch (e) {
      console.warn('Performance pattern analysis failed:', e);
      return [];
    }
  }

  /**
   * Predict performance for a new production
   */
  static async predictPerformance(
    channelId: string,
    production: Partial<Production>
  ): Promise<PerformancePrediction> {
    // Get historical data
    const patterns = await this.analyzePerformancePatterns(channelId, '28days');

    let predictedViews = 100; // Base prediction
    let predictedEngagement = 2.0; // Base engagement
    const factors: string[] = [];
    let confidence = 0.5;

    // Factor 1: Narrative type performance
    if (production.narrative_used && patterns.length > 0) {
      const narrativePattern = patterns.find(p => 
        p.pattern.includes(production.narrative_used || '')
      );
      if (narrativePattern) {
        predictedViews = narrativePattern.avgPerformance.views * 0.8; // Conservative
        predictedEngagement = narrativePattern.avgPerformance.engagementRate;
        factors.push(`Narrative "${production.narrative_used}" has avg ${narrativePattern.avgPerformance.views.toFixed(0)} views`);
        confidence += 0.2;
      }
    }

    // Factor 2: Hook quality (from viral metadata)
    if (production.viral_metadata?.title) {
      const ctr = this.estimateCTR(production.viral_metadata);
      if (ctr > 70) {
        predictedViews *= 1.3;
        factors.push('Strong hook (high predicted CTR)');
        confidence += 0.1;
      }
    }

    // Factor 3: Historical average
    if (patterns.length > 0) {
      const overallAvg = patterns.reduce((sum, p) => sum + p.avgPerformance.views, 0) / patterns.length;
      predictedViews = (predictedViews + overallAvg) / 2;
      factors.push(`Based on ${patterns.length} performance patterns`);
      confidence += 0.1;
    }

    confidence = Math.min(1.0, confidence);

    return {
      productionId: production.id || '',
      predictedViews: Math.round(predictedViews),
      predictedEngagement: predictedEngagement,
      confidence,
      factors
    };
  }

  /**
   * Generate optimization suggestions
   */
  static async getOptimizationSuggestions(
    channelId: string,
    production?: Partial<Production>
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];
    const patterns = await this.analyzePerformancePatterns(channelId, '28days');

    // Suggestion 1: Best performing narrative
    if (patterns.length > 0) {
      const bestNarrative = patterns[0];
      if (bestNarrative.pattern.startsWith('Narrative:')) {
        const narrativeName = bestNarrative.pattern.replace('Narrative: ', '');
        suggestions.push({
          type: 'narrative',
          priority: 'high',
          title: `Use "${narrativeName}" Narrative`,
          description: `This narrative structure has ${bestNarrative.avgPerformance.views.toFixed(0)} avg views`,
          action: `Switch to "${narrativeName}" narrative structure`,
          expectedImpact: `+${((bestNarrative.avgPerformance.views / 100) * 100).toFixed(0)}% views`
        });
      }
    }

    // Suggestion 2: Hook optimization
    if (production?.viral_metadata) {
      const ctr = this.estimateCTR(production.viral_metadata);
      if (ctr < 60) {
        suggestions.push({
          type: 'hook',
          priority: 'high',
          title: 'Improve Hook Quality',
          description: `Current predicted CTR: ${ctr.toFixed(0)}% (target: 70%+)`,
          action: 'Regenerate hook with more viral elements (numbers, questions, shock words)',
          expectedImpact: '+15-25% CTR improvement'
        });
      }
    }

    // Suggestion 3: Thumbnail optimization
    if (patterns.length > 0) {
      const highCTR = patterns.filter(p => p.avgPerformance.estimatedCTR > 70);
      if (highCTR.length > 0) {
        suggestions.push({
          type: 'thumbnail',
          priority: 'medium',
          title: 'Optimize Thumbnails',
          description: `${highCTR.length} videos with high CTR - analyze their thumbnails`,
          action: 'Use A/B testing for thumbnails, focus on faces and high contrast',
          expectedImpact: '+10-20% CTR'
        });
      }
    }

    // Suggestion 4: Title optimization
    if (production?.viral_metadata?.title) {
      const title = production.viral_metadata.title;
      if (title.length > 80 || !/\d+/.test(title)) {
        suggestions.push({
          type: 'title',
          priority: 'medium',
          title: 'Optimize Title',
          description: title.length > 80 ? 'Title too long' : 'Title missing numbers',
          action: title.length > 80 
            ? 'Shorten title to 50-60 characters'
            : 'Add numbers or statistics to title',
          expectedImpact: '+5-10% CTR'
        });
      }
    }

    // Suggestion 5: Timing optimization
    suggestions.push({
      type: 'timing',
      priority: 'low',
      title: 'Optimize Publishing Time',
      description: 'Publish during peak hours (9-11 AM, 5-7 PM)',
      action: 'Schedule videos for optimal engagement times',
      expectedImpact: '+5-10% initial views'
    });

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Compare videos side by side
   */
  static async compareVideos(
    videoIds: string[]
  ): Promise<{
    videos: VideoPerformance[];
    comparison: {
      bestViews: string;
      bestEngagement: string;
      bestCTR: string;
      avgViews: number;
      avgEngagement: number;
    };
  }> {
    if (!supabase || videoIds.length === 0) {
      return { videos: [], comparison: { bestViews: '', bestEngagement: '', bestCTR: '', avgViews: 0, avgEngagement: 0 } };
    }

    try {
      const { data, error } = await supabase
        .from('productions')
        .select(`
          id,
          viral_metadata,
          video_analytics (
            view_count,
            like_count,
            comment_count,
            engagement_rate
          )
        `)
        .in('id', videoIds);

      if (error || !data) return { videos: [], comparison: { bestViews: '', bestEngagement: '', bestCTR: '', avgViews: 0, avgEngagement: 0 } };

      const videos: VideoPerformance[] = data
        .filter((p: any) => p.video_analytics && p.video_analytics.length > 0)
        .map((p: any) => {
          const analytics = p.video_analytics[0];
          return {
            productionId: p.id,
            title: p.viral_metadata?.title || 'Untitled',
            views: analytics.view_count || 0,
            likes: analytics.like_count || 0,
            comments: analytics.comment_count || 0,
            engagementRate: analytics.engagement_rate || 0,
            estimatedCTR: this.estimateCTR(p.viral_metadata),
            publishedAt: p.published_at || '',
            analytics: analytics
          };
        });

      if (videos.length === 0) {
        return { videos: [], comparison: { bestViews: '', bestEngagement: '', bestCTR: '', avgViews: 0, avgEngagement: 0 } };
      }

      const bestViews = videos.reduce((best, v) => v.views > best.views ? v : best, videos[0]);
      const bestEngagement = videos.reduce((best, v) => v.engagementRate > best.engagementRate ? v : best, videos[0]);
      const bestCTR = videos.reduce((best, v) => v.estimatedCTR > best.estimatedCTR ? v : best, videos[0]);

      return {
        videos,
        comparison: {
          bestViews: bestViews.productionId,
          bestEngagement: bestEngagement.productionId,
          bestCTR: bestCTR.productionId,
          avgViews: videos.reduce((sum, v) => sum + v.views, 0) / videos.length,
          avgEngagement: videos.reduce((sum, v) => sum + v.engagementRate, 0) / videos.length
        }
      };
    } catch (e) {
      console.warn('Video comparison failed:', e);
      return { videos: [], comparison: { bestViews: '', bestEngagement: '', bestCTR: '', avgViews: 0, avgEngagement: 0 } };
    }
  }

  /**
   * Estimate CTR from viral metadata
   */
  private static estimateCTR(metadata?: any): number {
    if (!metadata?.title) return 50;

    const title = metadata.title.toLowerCase();
    let ctr = 50; // Base

    // Check for numbers
    if (/\d+/.test(title)) ctr += 15;
    
    // Check for power words
    const powerWords = ['breaking', 'shocking', 'exposed', 'revealed', 'urgent', 'alerta', 'exclusivo'];
    if (powerWords.some(word => title.includes(word))) ctr += 10;

    // Check for questions
    if (title.includes('?')) ctr += 12;

    // Check length (50-60 chars optimal)
    if (title.length >= 50 && title.length <= 60) ctr += 8;

    return Math.min(100, ctr);
  }

  /**
   * Group array by key
   */
  private static groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((acc, item) => {
      const k = String(item[key] || 'unknown');
      if (!acc[k]) acc[k] = [];
      acc[k].push(item);
      return acc;
    }, {} as Record<string, T[]>);
  }
}
