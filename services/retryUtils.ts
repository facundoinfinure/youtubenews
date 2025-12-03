export interface RetryOptions {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: any) => void;
    shouldRetry?: (error: any) => boolean; // Custom retry condition
}

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 10000,
        onRetry,
        shouldRetry
    } = options;

    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // Don't retry on certain errors
            if (error.message?.includes('unauthorized') ||
                error.message?.includes('invalid key') ||
                error.message?.includes('permission denied') ||
                error.message?.includes('not found') ||
                (shouldRetry && !shouldRetry(error))) {
                throw error;
            }

            if (attempt < maxRetries - 1) {
                const delay = Math.min(
                    baseDelay * Math.pow(2, attempt),
                    maxDelay
                );

                console.log(
                    `⚠️ Retry ${attempt + 1}/${maxRetries} after ${delay}ms:`,
                    error.message?.substring(0, 100)
                );

                onRetry?.(attempt + 1, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

/**
 * Retry with exponential backoff for video generation
 * Handles common video generation errors and continues on partial failures
 */
export async function retryVideoGeneration<T>(
    fn: () => Promise<T>,
    options: {
        maxRetries?: number;
        onFailure?: (error: any, attempt: number) => void;
        continueOnError?: boolean; // If true, return null on final failure instead of throwing
    } = {}
): Promise<T | null> {
    const {
        maxRetries = 3,
        onFailure,
        continueOnError = false
    } = options;

    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            
            // Don't retry on certain errors
            if (error.message?.includes('unauthorized') ||
                error.message?.includes('invalid key') ||
                error.message?.includes('permission denied') ||
                error.message?.includes('not found')) {
                if (continueOnError) {
                    onFailure?.(error, attempt + 1);
                    return null;
                }
                throw error;
            }

            // Check if should retry
            const message = error.message?.toLowerCase() || '';
            const shouldRetry = message.includes('timeout') ||
                               message.includes('network') ||
                               message.includes('rate limit') ||
                               message.includes('503') ||
                               message.includes('502') ||
                               message.includes('500');

            if (attempt < maxRetries - 1 && shouldRetry) {
                const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
                console.log(`🔄 Retrying video generation (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms...`);
                onFailure?.(error, attempt + 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // No more retries
                if (continueOnError) {
                    console.warn(`⚠️ Video generation failed after ${attempt + 1} attempts, continuing...`);
                    onFailure?.(error, attempt + 1);
                    return null;
                }
                throw error;
            }
        }
    }

    if (continueOnError) {
        onFailure?.(lastError, maxRetries);
        return null;
    }
    throw lastError;
}

/**
 * Execute multiple operations with retry, continuing even if some fail
 * Returns array of results with null for failed items
 */
export async function retryBatch<T>(
    items: T[],
    fn: (item: T, index: number) => Promise<any>,
    options: {
        maxRetries?: number;
        onItemFailure?: (item: T, index: number, error: any) => void;
        concurrency?: number; // Process N items at a time
    } = {}
): Promise<Array<{ item: T; result: any | null; error: any | null }>> {
    const {
        maxRetries = 2,
        onItemFailure,
        concurrency = 3
    } = options;

    const results: Array<{ item: T; result: any | null; error: any | null }> = [];
    
    // Process in batches
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        
        const batchResults = await Promise.allSettled(
            batch.map(async (item, batchIndex) => {
                const globalIndex = i + batchIndex;
                try {
                    const result = await retryWithBackoff(
                        () => fn(item, globalIndex),
                        {
                            maxRetries,
                            baseDelay: 1000,
                            maxDelay: 10000
                        }
                    );
                    return { item, result, error: null };
                } catch (error) {
                    onItemFailure?.(item, globalIndex, error);
                    return { item, result: null, error };
                }
            })
        );

        results.push(...batchResults.map((r, idx) => 
            r.status === 'fulfilled' ? r.value : { item: batch[idx], result: null, error: r.reason }
        ));
    }

    return results;
}
