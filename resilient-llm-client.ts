import { Logger } from 'winston';
import Bottleneck from 'bottleneck';

/**
 * ResilientLLMClient
 * 
 * Provides a robust wrapper around AI/LLM providers with:
 * - Rate limiting (via Bottleneck)
 * - Circuit breaker patterns to prevent cascading failures
 * - Automatic timeout handling
 */
export class ResilientLLMClient {
  private limiter: Bottleneck;
  private circuitBreakerFailures = 0;
  private circuitBreakerOpen = false;
  private readonly maxFailures = 3;
  private readonly resetTimeout = 60000; // 1 minute

  constructor(
    private readonly baseClient: any,
    private readonly logger: Logger,
  ) {
    // Rate limiting: max 10 requests per minute by default
    this.limiter = new Bottleneck({
      reservoir: 10,
      reservoirRefreshAmount: 10,
      reservoirRefreshInterval: 60 * 1000,
      maxConcurrent: 2,
    });

    this.logger.info('ResilientLLMClient initialized', {
      maxFailures: this.maxFailures,
      resetTimeout: this.resetTimeout,
    });
  }

  /**
   * Execute a query against the LLM provider with resilience
   */
  async query(prompt: string, options: any = {}): Promise<string> {
    if (this.circuitBreakerOpen) {
      this.logger.warn('Circuit breaker open - rejecting LLM query');
      throw new Error('Circuit breaker open - LLM service unavailable');
    }

    return this.limiter.schedule(async () => {
      try {
        const result = await this.baseClient.query(prompt, {
          ...options,
          timeout: options.timeout || 30000, // Default 30s timeout
        });

        // Reset circuit breaker on successful response
        if (this.circuitBreakerFailures > 0) {
          this.logger.info('LLM query successful, resetting failure count');
          this.circuitBreakerFailures = 0;
        }
        
        return result;
      } catch (error: any) {
        this.handleFailure(error);
        throw error;
      }
    });
  }

  /**
   * Track failures and trigger circuit breaker if threshold reached
   */
  private handleFailure(error: Error) {
    this.circuitBreakerFailures++;
    
    this.logger.error('LLM query failed', {
      error: error.message,
      failures: this.circuitBreakerFailures,
      threshold: this.maxFailures,
    });

    if (this.circuitBreakerFailures >= this.maxFailures) {
      this.circuitBreakerOpen = true;
      this.logger.error('Circuit breaker OPENED for LLM service');

      // Schedule automatic reset
      setTimeout(() => {
        this.circuitBreakerOpen = false;
        this.circuitBreakerFailures = 0;
        this.logger.info('Circuit breaker RESET - LLM service available again');
      }, this.resetTimeout);
    }
  }

  /**
   * Get current state of the client
   */
  getState() {
    return {
      circuitBreakerOpen: this.circuitBreakerOpen,
      failureCount: this.circuitBreakerFailures,
      queuedRequests: this.limiter.counts().queued,
      runningRequests: this.limiter.counts().running,
    };
  }
}
