// Cost tracking and analytics - Persisted to Supabase
import { supabase } from './supabaseService';

interface CostEntry {
    id?: string;
    timestamp: number;
    task: string;
    model: string;
    cost: number;
    cached: boolean;
    channel_id?: string;
    user_email?: string;
}

// In-memory cache for recent entries (avoids constant DB reads)
let entriesCache: CostEntry[] = [];
let cacheLoaded = false;
let currentChannelId: string | null = null;
let currentUserEmail: string | null = null;

export class CostTracker {
    /**
     * Set the current context for cost tracking
     */
    static setContext(channelId: string | null, userEmail: string | null) {
        currentChannelId = channelId;
        currentUserEmail = userEmail;
        // Reset cache when context changes
        if (channelId !== currentChannelId) {
            cacheLoaded = false;
            entriesCache = [];
        }
    }

    /**
     * Track an API cost - saves to Supabase
     */
    static async track(task: string, model: string, cost: number, cached: boolean = false) {
        const entry: CostEntry = {
            timestamp: Date.now(),
            task,
            model,
            cost: cached ? 0 : cost,
            cached,
            channel_id: currentChannelId || undefined,
            user_email: currentUserEmail || undefined
        };

        // Add to local cache immediately for fast reads
        entriesCache.push(entry);

        // Save to Supabase in background (don't block)
        this.saveToSupabase(entry).catch(e => {
            console.warn('Failed to save cost to Supabase:', e);
        });
    }

    /**
     * Get statistics for the specified number of days
     */
    static async getStats(days: number = 30) {
        // Load from Supabase if not cached
        if (!cacheLoaded) {
            await this.loadFromSupabase(days);
        }

        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const recent = entriesCache.filter(e => e.timestamp >= cutoff);

        const totalCost = recent.reduce((sum, e) => sum + e.cost, 0);
        const cachedCount = recent.filter(e => e.cached).length;
        const totalCount = recent.length;
        const estimatedSavings = cachedCount * 0.025; // Average cost per cached call

        // Group by task
        const byTask = this.groupBy(recent, 'task');
        const breakdown = Object.entries(byTask).map(([task, entries]) => ({
            task,
            count: entries.length,
            cost: entries.reduce((sum, e) => sum + e.cost, 0),
            cached: entries.filter(e => e.cached).length
        }));

        return {
            totalCost,
            cachedCount,
            totalCount,
            estimatedSavings,
            cacheHitRate: totalCount > 0 ? (cachedCount / totalCount) * 100 : 0,
            breakdown
        };
    }

    /**
     * Get stats synchronously from cache (may be stale)
     */
    static getStatsSync(days: number = 30) {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const recent = entriesCache.filter(e => e.timestamp >= cutoff);

        const totalCost = recent.reduce((sum, e) => sum + e.cost, 0);
        const cachedCount = recent.filter(e => e.cached).length;
        const totalCount = recent.length;
        const estimatedSavings = cachedCount * 0.025;

        const byTask = this.groupBy(recent, 'task');
        const breakdown = Object.entries(byTask).map(([task, entries]) => ({
            task,
            count: entries.length,
            cost: entries.reduce((sum, e) => sum + e.cost, 0),
            cached: entries.filter(e => e.cached).length
        }));

        return {
            totalCost,
            cachedCount,
            totalCount,
            estimatedSavings,
            cacheHitRate: totalCount > 0 ? (cachedCount / totalCount) * 100 : 0,
            breakdown
        };
    }

    private static groupBy(arr: CostEntry[], key: keyof CostEntry) {
        return arr.reduce((acc, entry) => {
            const k = String(entry[key]);
            if (!acc[k]) acc[k] = [];
            acc[k].push(entry);
            return acc;
        }, {} as Record<string, CostEntry[]>);
    }

    /**
     * Save a single entry to Supabase
     */
    private static async saveToSupabase(entry: CostEntry) {
        if (!supabase) {
            console.warn('Supabase not initialized, cost not saved');
            return;
        }

        try {
            const { error } = await supabase
                .from('api_costs')
                .insert({
                    channel_id: entry.channel_id || null,
                    user_email: entry.user_email || null,
                    task: entry.task,
                    model: entry.model,
                    cost: entry.cost,
                    cached: entry.cached,
                    created_at: new Date(entry.timestamp).toISOString()
                });

            if (error) {
                // Table might not exist yet - fall back silently
                if (error.code === '42P01' || error.message?.includes('api_costs')) {
                    console.warn('⚠️ api_costs table not found - run migration');
                } else {
                    console.error('Error saving cost:', error);
                }
            }
        } catch (e) {
            console.warn('Cost tracker save failed:', e);
        }
    }

    /**
     * Load entries from Supabase
     */
    private static async loadFromSupabase(days: number = 30) {
        if (!supabase) {
            cacheLoaded = true;
            return;
        }

        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - days);

            let query = supabase
                .from('api_costs')
                .select('*')
                .gte('created_at', cutoffDate.toISOString())
                .order('created_at', { ascending: false })
                .limit(1000);

            if (currentChannelId) {
                query = query.eq('channel_id', currentChannelId);
            }

            const { data, error } = await query;

            if (error) {
                // Table might not exist yet
                if (error.code === '42P01' || error.message?.includes('api_costs')) {
                    console.warn('⚠️ api_costs table not found - costs stored locally only');
                } else {
                    console.error('Error loading costs:', error);
                }
                cacheLoaded = true;
                return;
            }

            // Convert to CostEntry format
            entriesCache = (data || []).map((row: any) => ({
                id: row.id,
                timestamp: new Date(row.created_at).getTime(),
                task: row.task,
                model: row.model,
                cost: parseFloat(row.cost) || 0,
                cached: row.cached || false,
                channel_id: row.channel_id,
                user_email: row.user_email
            }));

            cacheLoaded = true;
            console.log(`📊 Loaded ${entriesCache.length} cost entries from Supabase`);
        } catch (e) {
            console.warn('Cost tracker load failed:', e);
            cacheLoaded = true;
        }
    }

    /**
     * Clear all costs (local cache and optionally from DB)
     */
    static async clear(deleteFromDB: boolean = false) {
        entriesCache = [];
        cacheLoaded = false;

        if (deleteFromDB && supabase && currentChannelId) {
            try {
                await supabase
                    .from('api_costs')
                    .delete()
                    .eq('channel_id', currentChannelId);
                console.log('✅ Cleared costs from database');
            } catch (e) {
                console.warn('Failed to clear costs from DB:', e);
            }
        }
    }

    /**
     * Export costs as JSON
     */
    static export() {
        return JSON.stringify(entriesCache, null, 2);
    }

    /**
     * Force reload from Supabase
     */
    static async reload(days: number = 30) {
        cacheLoaded = false;
        entriesCache = [];
        await this.loadFromSupabase(days);
    }

    /**
     * NEW: Predict cost before generating
     */
    static predictCost(task: string, model: string, estimatedCalls: number = 1): number {
        // Cost estimates per task/model
        const costEstimates: Record<string, Record<string, number>> = {
            'script': {
                'gpt-4o': 0.01,
                'gpt-4o-mini': 0.002
            },
            'viralHook': {
                'gpt-4o': 0.01,
                'gpt-4o-mini': 0.002
            },
            'metadata': {
                'gpt-4o': 0.015,
                'gpt-4o-mini': 0.003
            },
            'audio': {
                'openai-tts': 0.015,
                'elevenlabs': 0.18
            },
            'video': {
                'infinitetalk-single': 0.30,
                'infinitetalk-multi': 0.36,
                'infinitetalk-480p': 0.15
            },
            'thumbnail': {
                'dall-e-3': 0.04,
                'wavespeed/nano-banana-pro': 0.14
            }
        };

        const taskEstimate = costEstimates[task]?.[model] || 0.01;
        return taskEstimate * estimatedCalls;
    }

    /**
     * NEW: Get cost breakdown for a production
     */
    static async getProductionCostBreakdown(productionId: string) {
        if (!supabase) return null;

        try {
            const { data, error } = await supabase
                .from('api_costs')
                .select('task, model, cost, cached, created_at, channel_id, user_email')
                .eq('channel_id', currentChannelId)
                .order('created_at', { ascending: false })
                .limit(100);

            if (error) return null;

            // Convert DB format to CostEntry format first
            const costEntries: CostEntry[] = (data || []).map((row: any) => ({
                timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
                task: row.task,
                model: row.model,
                cost: parseFloat(row.cost) || 0,
                cached: row.cached || false,
                channel_id: row.channel_id,
                user_email: row.user_email
            }));

            const breakdown = this.groupBy(costEntries, 'task');
            return Object.entries(breakdown).map(([task, entries]) => {
                const typedEntries = entries as CostEntry[];
                return {
                    task,
                    totalCost: typedEntries.reduce((sum, e) => sum + e.cost, 0),
                    count: typedEntries.length,
                    cached: typedEntries.filter(e => e.cached).length,
                    averageCost: typedEntries.length > 0 ? typedEntries.reduce((sum, e) => sum + e.cost, 0) / typedEntries.length : 0
                };
            });
        } catch (e) {
            console.warn('Cost breakdown failed:', e);
            return null;
        }
    }

    /**
     * NEW: Check if budget limit is exceeded
     */
    static async checkBudgetLimit(budgetLimit: number, days: number = 1): Promise<{
        exceeded: boolean;
        currentCost: number;
        remaining: number;
        percentage: number;
    }> {
        const stats = await this.getStats(days);
        const exceeded = stats.totalCost > budgetLimit;
        
        return {
            exceeded,
            currentCost: stats.totalCost,
            remaining: Math.max(0, budgetLimit - stats.totalCost),
            percentage: (stats.totalCost / budgetLimit) * 100
        };
    }

    /**
     * NEW: Get cost optimization suggestions
     */
    static async getOptimizationSuggestions(): Promise<string[]> {
        const stats = await this.getStats(30);
        const suggestions: string[] = [];

        // Check cache hit rate
        if (stats.cacheHitRate < 50) {
            suggestions.push(`Low cache hit rate (${stats.cacheHitRate.toFixed(1)}%). Consider enabling more aggressive caching.`);
        }

        // Check expensive tasks
        const expensiveTasks = stats.breakdown
            .filter(b => b.cost > 1.0)
            .sort((a, b) => b.cost - a.cost);
        
        if (expensiveTasks.length > 0) {
            suggestions.push(`High cost tasks: ${expensiveTasks.slice(0, 3).map(t => `${t.task} ($${t.cost.toFixed(2)})`).join(', ')}. Consider using lower-cost models or increasing cache usage.`);
        }

        // Check video costs
        const videoCost = stats.breakdown.find(b => b.task === 'video')?.cost || 0;
        if (videoCost > 5.0) {
            suggestions.push(`Video generation is expensive ($${videoCost.toFixed(2)}). Consider using 480p for non-critical scenes.`);
        }

        return suggestions;
    }
}
