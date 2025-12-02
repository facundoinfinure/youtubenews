// Cost tracking and analytics
interface CostEntry {
    timestamp: number;
    task: string;
    model: string;
    cost: number;
    cached: boolean;
}

export class CostTracker {
    private static entries: CostEntry[] = [];
    private static STORAGE_KEY = 'cost_tracker';

    static {
        // Load from localStorage on init
        this.load();
    }

    static track(task: string, model: string, cost: number, cached: boolean = false) {
        this.entries.push({
            timestamp: Date.now(),
            task,
            model,
            cost: cached ? 0 : cost,
            cached
        });

        this.save();
    }

    static getStats(days: number = 30) {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        const recent = this.entries.filter(e => e.timestamp >= cutoff);

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

    private static groupBy(arr: CostEntry[], key: keyof CostEntry) {
        return arr.reduce((acc, entry) => {
            const k = String(entry[key]);
            if (!acc[k]) acc[k] = [];
            acc[k].push(entry);
            return acc;
        }, {} as Record<string, CostEntry[]>);
    }

    private static save() {
        try {
            // Keep only last 1000 entries to avoid storage issues
            const toSave = this.entries.slice(-1000);
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(toSave));
        } catch (e) {
            console.warn('Cost tracker storage failed', e);
        }
    }

    private static load() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            if (data) {
                this.entries = JSON.parse(data);
            }
        } catch (e) {
            console.warn('Cost tracker load failed', e);
            this.entries = [];
        }
    }

    static clear() {
        this.entries = [];
        localStorage.removeItem(this.STORAGE_KEY);
    }

    static export() {
        return JSON.stringify(this.entries, null, 2);
    }
}
