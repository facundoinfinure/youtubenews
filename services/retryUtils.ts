/**
 * Retry Utilities
 * 
 * Provides retry logic with exponential backoff for API calls
 * and batch operations that may fail intermittently.
 */

import { RETRY, LIMITS, ERRORS } from '../constants';

export interface RetryOptions {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: Error) => void;
    shouldRetry?: (error: Error) => boolean;
}

export interface BatchResult<T, R> {
    item: T;
    result: R | null;
    error: Error | null;
}

/**
 * Check if an error message contains non-retryable error indicators
 */
const isNonRetryableError = (error: Error): boolean => {
    const message = error.message?.toLowerCase() || '';
    return message.includes(ERRORS.UNAUTHORIZED) ||
           message.includes(ERRORS.INVALID_KEY) ||
           message.includes(ERRORS.PERMISSION_DENIED) ||
           message.includes(ERRORS.NOT_FOUND);
};

/**
 * Check if an error message indicates a retryable condition
 */
const isRetryableError = (error: Error): boolean => {
    const message = error.message?.toLowerCase() || '';
    return message.includes(ERRORS.TIMEOUT) ||
           message.includes(ERRORS.NETWORK) ||
           message.includes(ERRORS.RATE_LIMIT) ||
           message.includes('503') ||
           message.includes('502') ||
           message.includes('500');
};

/**
 * Retry an async function with exponential backoff
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxRetries = LIMITS.MAX_RETRIES,
        baseDelay = RETRY.BASE_DELAY_MS,
        maxDelay = RETRY.MAX_DELAY_MS,
        onRetry,
        shouldRetry
    } = options;

    let lastError: Error = new Error('Unknown error');

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            lastError = err;

            // Don't retry on certain errors
            if (isNonRetryableError(err) || (shouldRetry && !shouldRetry(err))) {
                throw err;
            }

            if (attempt < maxRetries - 1) {
                const delay = Math.min(
                    baseDelay * Math.pow(2, attempt),
                    maxDelay
                );

                console.log(
                    `⚠️ Retry ${attempt + 1}/${maxRetries} after ${delay}ms:`,
                    err.message?.substring(0, 100)
                );

                onRetry?.(attempt + 1, err);
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
        onFailure?: (error: Error, attempt: number) => void;
        continueOnError?: boolean;
    } = {}
): Promise<T | null> {
    const {
        maxRetries = LIMITS.MAX_VIDEO_RETRIES,
        onFailure,
        continueOnError = false
    } = options;

    let lastError: Error = new Error('Unknown error');
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            lastError = err;
            
            // Don't retry on certain errors
            if (isNonRetryableError(err)) {
                if (continueOnError) {
                    onFailure?.(err, attempt + 1);
                    return null;
                }
                throw err;
            }

            // Check if should retry
            if (attempt < maxRetries - 1 && isRetryableError(err)) {
                const delay = Math.min(
                    RETRY.VIDEO_BASE_DELAY_MS * Math.pow(2, attempt), 
                    RETRY.VIDEO_MAX_DELAY_MS
                );
                console.log(`🔄 Retrying video generation (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms...`);
                onFailure?.(err, attempt + 1);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // No more retries
                if (continueOnError) {
                    console.warn(`⚠️ Video generation failed after ${attempt + 1} attempts, continuing...`);
                    onFailure?.(err, attempt + 1);
                    return null;
                }
                throw err;
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
export async function retryBatch<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    options: {
        maxRetries?: number;
        onItemFailure?: (item: T, index: number, error: Error) => void;
        concurrency?: number;
    } = {}
): Promise<BatchResult<T, R>[]> {
    const {
        maxRetries = 2,
        onItemFailure,
        concurrency = LIMITS.BATCH_CONCURRENCY
    } = options;

    const results: BatchResult<T, R>[] = [];
    
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
                            baseDelay: RETRY.BASE_DELAY_MS,
                            maxDelay: RETRY.MAX_DELAY_MS
                        }
                    );
                    return { item, result, error: null };
                } catch (error) {
                    const err = error instanceof Error ? error : new Error(String(error));
                    onItemFailure?.(item, globalIndex, err);
                    return { item, result: null, error: err };
                }
            })
        );

        results.push(...batchResults.map((r, idx) => 
            r.status === 'fulfilled' 
                ? r.value 
                : { item: batch[idx], result: null, error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)) }
        ));
    }

    return results;
}
