export interface RetryOptions {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    onRetry?: (attempt: number, error: any) => void;
}

export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 10000,
        onRetry
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
                error.message?.includes('permission denied')) {
                throw error;
            }

            if (attempt < maxRetries - 1) {
                const delay = Math.min(
                    baseDelay * Math.pow(2, attempt),
                    maxDelay
                );

                console.log(
                    `⚠️ Retry ${attempt + 1}/${maxRetries} after ${delay}ms:`,
                    error.message
                );

                onRetry?.(attempt + 1, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}
