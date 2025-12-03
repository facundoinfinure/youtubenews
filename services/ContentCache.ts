interface CacheEntry<T> {
    value: T;
    timestamp: number;
    cost?: number; // Track API cost savings
}

export class ContentCache {
    private static cache = new Map<string, CacheEntry<any>>();
    private static STORAGE_KEY = 'chimpnews_cache';

    static async getOrGenerate<T>(
        key: string,
        generator: () => Promise<T>,
        ttl: number = 3600000,
        cost: number = 0
    ): Promise<T> {
        // Check memory cache
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < ttl) {
            console.log(`✅ Cache hit: ${key} (saved $${cached.cost || 0})`);
            return cached.value;
        }

        // Check localStorage
        const stored = this.loadFromStorage(key, ttl);
        if (stored) {
            this.cache.set(key, stored);
            return stored.value as T;
        }

        // Generate new
        console.log(`❌ Cache miss: ${key}, generating...`);
        const value = await generator();
        const entry: CacheEntry<T> = { value, timestamp: Date.now(), cost };

        this.cache.set(key, entry);
        this.saveToStorage(key, entry);

        return value;
    }

    private static loadFromStorage<T>(key: string, ttl: number): CacheEntry<T> | null {
        try {
            const data = localStorage.getItem(`${this.STORAGE_KEY}_${key}`);
            if (!data) return null;

            const entry: CacheEntry<T> = JSON.parse(data);
            if (Date.now() - entry.timestamp < ttl) {
                return entry;
            }

            localStorage.removeItem(`${this.STORAGE_KEY}_${key}`);
            return null;
        } catch {
            return null;
        }
    }

    private static saveToStorage<T>(key: string, entry: CacheEntry<T>) {
        try {
            localStorage.setItem(
                `${this.STORAGE_KEY}_${key}`,
                JSON.stringify(entry)
            );
        } catch (e) {
            console.warn('Cache storage failed', e);
        }
    }

    static clear() {
        this.cache.clear();
        Object.keys(localStorage)
            .filter(k => k.startsWith(this.STORAGE_KEY))
            .forEach(k => localStorage.removeItem(k));
    }

    static get<T>(key: string): T | null {
        // Check memory cache
        const cached = this.cache.get(key);
        if (cached) {
            return cached.value as T;
        }

        // Check localStorage
        const stored = this.loadFromStorage<T>(key, 3600000); // Default 1 hour TTL
        if (stored) {
            this.cache.set(key, stored);
            return stored.value;
        }

        return null;
    }

    static set<T>(key: string, value: T, ttl: number = 3600000, cost: number = 0): void {
        const entry: CacheEntry<T> = { value, timestamp: Date.now(), cost };
        this.cache.set(key, entry);
        this.saveToStorage(key, entry);
    }

    static getStats() {
        const totalSaved = Array.from(this.cache.values())
            .reduce((sum, entry) => sum + (entry.cost || 0), 0);
        return {
            entries: this.cache.size,
            totalCostSaved: totalSaved
        };
    }
}
