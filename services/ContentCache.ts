// Content Cache - Persisted to Supabase with in-memory cache for performance
import { supabase } from './supabaseService';

interface CacheEntry<T> {
    value: T;
    timestamp: number;
    cost?: number; // Track API cost savings
    expires_at?: number;
}

// In-memory cache for fast reads
const memoryCache = new Map<string, CacheEntry<any>>();

// Current context
let currentChannelId: string | null = null;

export class ContentCache {
    /**
     * Set the current channel context for cache operations
     */
    static setContext(channelId: string | null) {
        currentChannelId = channelId;
    }

    /**
     * Get or generate cached content
     * Checks memory -> Supabase -> generates new
     */
    static async getOrGenerate<T>(
        key: string,
        generator: () => Promise<T>,
        ttl: number = 3600000, // 1 hour default
        cost: number = 0
    ): Promise<T> {
        // Check memory cache first (fastest)
        const memCached = memoryCache.get(key);
        if (memCached && Date.now() - memCached.timestamp < ttl) {
            console.log(`✅ Cache hit (memory): ${key} (saved $${memCached.cost || 0})`);
            return memCached.value;
        }

        // Check Supabase cache
        const dbCached = await this.loadFromSupabase<T>(key, ttl);
        if (dbCached) {
            memoryCache.set(key, dbCached);
            console.log(`✅ Cache hit (DB): ${key} (saved $${dbCached.cost || 0})`);
            return dbCached.value;
        }

        // Generate new content
        console.log(`❌ Cache miss: ${key}, generating...`);
        const value = await generator();
        const entry: CacheEntry<T> = { 
            value, 
            timestamp: Date.now(), 
            cost,
            expires_at: Date.now() + ttl
        };

        // Save to both caches
        memoryCache.set(key, entry);
        this.saveToSupabase(key, entry, ttl).catch(e => {
            console.warn('Failed to save cache to Supabase:', e);
        });

        return value;
    }

    /**
     * Load from Supabase cache
     */
    private static async loadFromSupabase<T>(key: string, ttl: number): Promise<CacheEntry<T> | null> {
        if (!supabase || !currentChannelId) return null;

        try {
            const { data, error } = await supabase
                .from('content_cache')
                .select('cache_value, created_at, cost_saved, expires_at')
                .eq('channel_id', currentChannelId)
                .eq('cache_key', key)
                .maybeSingle();

            if (error) {
                // Table might not exist yet
                if (error.code === '42P01' || error.message?.includes('content_cache')) {
                    // Silent - table doesn't exist
                    return null;
                }
                console.warn('Cache load error:', error);
                return null;
            }

            if (!data) return null;

            const timestamp = new Date(data.created_at).getTime();
            const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : timestamp + ttl;

            // Check if expired
            if (Date.now() > expiresAt) {
                // Delete expired entry in background
                this.deleteFromSupabase(key).catch(() => {});
                return null;
            }

            return {
                value: data.cache_value as T,
                timestamp,
                cost: parseFloat(data.cost_saved) || 0,
                expires_at: expiresAt
            };
        } catch (e) {
            console.warn('Cache load failed:', e);
            return null;
        }
    }

    /**
     * Save to Supabase cache
     */
    private static async saveToSupabase<T>(key: string, entry: CacheEntry<T>, ttl: number) {
        if (!supabase || !currentChannelId) return;

        try {
            const expiresAt = new Date(Date.now() + ttl).toISOString();

            const { error } = await supabase
                .from('content_cache')
                .upsert({
                    channel_id: currentChannelId,
                    cache_key: key,
                    cache_value: entry.value,
                    cost_saved: entry.cost || 0,
                    created_at: new Date(entry.timestamp).toISOString(),
                    expires_at: expiresAt
                }, {
                    onConflict: 'channel_id,cache_key'
                });

            if (error) {
                // Table might not exist yet
                if (error.code === '42P01' || error.message?.includes('content_cache')) {
                    console.warn('⚠️ content_cache table not found - run migration');
                } else {
                    console.warn('Cache save error:', error);
                }
            }
        } catch (e) {
            console.warn('Cache save failed:', e);
        }
    }

    /**
     * Delete from Supabase cache
     */
    private static async deleteFromSupabase(key: string) {
        if (!supabase || !currentChannelId) return;

        try {
            await supabase
                .from('content_cache')
                .delete()
                .eq('channel_id', currentChannelId)
                .eq('cache_key', key);
        } catch (e) {
            // Silent fail for cleanup
        }
    }

    /**
     * Clear all caches
     */
    static async clear() {
        memoryCache.clear();

        if (supabase && currentChannelId) {
            try {
                await supabase
                    .from('content_cache')
                    .delete()
                    .eq('channel_id', currentChannelId);
                console.log('✅ Cache cleared from database');
            } catch (e) {
                console.warn('Failed to clear cache from DB:', e);
            }
        }
    }

    /**
     * Get value from cache (sync - memory only)
     */
    static get<T>(key: string): T | null {
        const cached = memoryCache.get(key);
        if (cached) {
            return cached.value as T;
        }
        return null;
    }

    /**
     * Get value from cache (async - checks Supabase too)
     */
    static async getAsync<T>(key: string, ttl: number = 3600000): Promise<T | null> {
        // Check memory first
        const memCached = memoryCache.get(key);
        if (memCached && Date.now() - memCached.timestamp < ttl) {
            return memCached.value as T;
        }

        // Check Supabase
        const dbCached = await this.loadFromSupabase<T>(key, ttl);
        if (dbCached) {
            memoryCache.set(key, dbCached);
            return dbCached.value;
        }

        return null;
    }

    /**
     * Set value in cache
     */
    static set<T>(key: string, value: T, ttl: number = 3600000, cost: number = 0): void {
        const entry: CacheEntry<T> = { 
            value, 
            timestamp: Date.now(), 
            cost,
            expires_at: Date.now() + ttl
        };
        memoryCache.set(key, entry);
        
        // Save to Supabase in background
        this.saveToSupabase(key, entry, ttl).catch(e => {
            console.warn('Failed to save cache:', e);
        });
    }

    /**
     * Set value in cache (async version that waits for DB save)
     */
    static async setAsync<T>(key: string, value: T, ttl: number = 3600000, cost: number = 0): Promise<void> {
        const entry: CacheEntry<T> = { 
            value, 
            timestamp: Date.now(), 
            cost,
            expires_at: Date.now() + ttl
        };
        memoryCache.set(key, entry);
        await this.saveToSupabase(key, entry, ttl);
    }

    /**
     * Get cache statistics
     */
    static getStats() {
        const totalSaved = Array.from(memoryCache.values())
            .reduce((sum, entry) => sum + (entry.cost || 0), 0);
        return {
            entries: memoryCache.size,
            totalCostSaved: totalSaved
        };
    }

    /**
     * Invalidate cache entries matching a prefix (e.g., "serpapi_topic_news_")
     * Useful when channel config changes (like topicToken)
     */
    static async invalidateByPrefix(prefix: string) {
        // Clear from memory
        const keysToDelete: string[] = [];
        memoryCache.forEach((_, key) => {
            if (key.startsWith(prefix)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => memoryCache.delete(key));
        console.log(`🗑️ Invalidated ${keysToDelete.length} memory cache entries with prefix: ${prefix}`);

        // Clear from Supabase
        if (supabase && currentChannelId) {
            try {
                const { error, count } = await supabase
                    .from('content_cache')
                    .delete()
                    .eq('channel_id', currentChannelId)
                    .like('cache_key', `${prefix}%`);
                
                if (!error) {
                    console.log(`🗑️ Invalidated ${count || 0} DB cache entries with prefix: ${prefix}`);
                }
            } catch (e) {
                console.warn('Failed to invalidate cache from DB:', e);
            }
        }
    }

    /**
     * Invalidate news cache for a specific channel
     * Call this when topicToken or country changes
     */
    static async invalidateNewsCache(channelName: string) {
        const prefix = `serpapi_topic_news_${channelName}`;
        await this.invalidateByPrefix(prefix);
        console.log(`📰 News cache invalidated for channel: ${channelName}`);
    }

    /**
     * Preload cache from Supabase for current channel
     */
    static async preload() {
        if (!supabase || !currentChannelId) return;

        try {
            const { data, error } = await supabase
                .from('content_cache')
                .select('cache_key, cache_value, created_at, cost_saved, expires_at')
                .eq('channel_id', currentChannelId)
                .gt('expires_at', new Date().toISOString())
                .limit(100);

            if (error) {
                if (error.code !== '42P01') {
                    console.warn('Cache preload error:', error);
                }
                return;
            }

            let loadedCount = 0;
            for (const row of data || []) {
                const entry: CacheEntry<any> = {
                    value: row.cache_value,
                    timestamp: new Date(row.created_at).getTime(),
                    cost: parseFloat(row.cost_saved) || 0,
                    expires_at: row.expires_at ? new Date(row.expires_at).getTime() : undefined
                };
                memoryCache.set(row.cache_key, entry);
                loadedCount++;
            }

            if (loadedCount > 0) {
                console.log(`📦 Preloaded ${loadedCount} cache entries from Supabase`);
            }
        } catch (e) {
            console.warn('Cache preload failed:', e);
        }
    }

    /**
     * NEW: Fuzzy matching for similar content
     * Finds cache entries with similar keys (for dialogue/text matching)
     */
    static async findSimilar(key: string, similarityThreshold: number = 0.8): Promise<CacheEntry<any> | null> {
        // Normalize key for comparison
        const normalizedKey = key.toLowerCase().trim();
        
        // Check memory cache first
        for (const [cacheKey, entry] of memoryCache.entries()) {
            const normalizedCacheKey = cacheKey.toLowerCase().trim();
            const similarity = this.calculateSimilarity(normalizedKey, normalizedCacheKey);
            if (similarity >= similarityThreshold) {
                console.log(`🔍 Fuzzy cache match: ${key} ~ ${cacheKey} (${(similarity * 100).toFixed(1)}% similar)`);
                return entry;
            }
        }

        // Check Supabase for similar keys
        if (supabase && currentChannelId) {
            try {
                const { data, error } = await supabase
                    .from('content_cache')
                    .select('cache_key, cache_value, created_at, cost_saved, expires_at')
                    .eq('channel_id', currentChannelId)
                    .gt('expires_at', new Date().toISOString())
                    .limit(100);

                if (!error && data) {
                    for (const row of data) {
                        const normalizedCacheKey = row.cache_key.toLowerCase().trim();
                        const similarity = this.calculateSimilarity(normalizedKey, normalizedCacheKey);
                        if (similarity >= similarityThreshold) {
                            const entry: CacheEntry<any> = {
                                value: row.cache_value,
                                timestamp: new Date(row.created_at).getTime(),
                                cost: parseFloat(row.cost_saved) || 0,
                                expires_at: row.expires_at ? new Date(row.expires_at).getTime() : undefined
                            };
                            memoryCache.set(row.cache_key, entry);
                            console.log(`🔍 Fuzzy cache match (DB): ${key} ~ ${row.cache_key} (${(similarity * 100).toFixed(1)}% similar)`);
                            return entry;
                        }
                    }
                }
            } catch (e) {
                console.warn('Fuzzy cache search failed:', e);
            }
        }

        return null;
    }

    /**
     * NEW: Calculate similarity between two strings (Levenshtein-based)
     */
    private static calculateSimilarity(str1: string, str2: string): number {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    /**
     * NEW: Levenshtein distance calculation
     */
    private static levenshteinDistance(str1: string, str2: string): number {
        const matrix: number[][] = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    /**
     * NEW: Get or generate with fuzzy matching fallback
     */
    static async getOrGenerateWithFuzzy<T>(
        key: string,
        generator: () => Promise<T>,
        ttl: number = 3600000,
        cost: number = 0,
        similarityThreshold: number = 0.85
    ): Promise<T> {
        // Try exact match first
        const exact = await this.getAsync<T>(key, ttl);
        if (exact !== null) {
            return exact;
        }

        // Try fuzzy match
        const fuzzy = await this.findSimilar(key, similarityThreshold);
        if (fuzzy) {
            console.log(`✅ Using fuzzy cache match for: ${key}`);
            return fuzzy.value as T;
        }

        // Generate new
        return this.getOrGenerate(key, generator, ttl, cost);
    }

    /**
     * NEW: Cache warming - pre-generate common resources
     */
    static async warmCache(keys: string[], generators: Map<string, () => Promise<any>>) {
        console.log(`🔥 Warming cache for ${keys.length} entries...`);
        const warmPromises = keys.map(async (key) => {
            const generator = generators.get(key);
            if (generator) {
                try {
                    await this.getOrGenerate(key, generator, 3600000, 0);
                } catch (e) {
                    console.warn(`Cache warming failed for ${key}:`, e);
                }
            }
        });
        await Promise.all(warmPromises);
        console.log(`✅ Cache warming complete`);
    }

    /**
     * NEW: Predictive caching - cache likely-to-be-used resources
     */
    static async predictiveCache(pattern: string, generator: (key: string) => Promise<any>, count: number = 5) {
        // This would be called with patterns like "common_dialogue_*" or "frequent_news_*"
        // For now, it's a placeholder for future implementation
        console.log(`🔮 Predictive caching for pattern: ${pattern} (${count} entries)`);
    }
}
