// packages/backend/src/plugins/victorialogs/lib/logs-client.ts
import { Logger } from 'winston';
import fetch from 'node-fetch';
import { Config } from '@backstage/config';

export interface LogEntry {
  timestamp: Date;
  message: string;
  labels: Record<string, string>;
  level?: string;
  isError: boolean;
  raw?: any;
}

export interface LogQuery {
  query: string;
  start: string | number;
  end: string | number;
  limit?: number;
}

export interface LogAnomalyResult {
  entries: LogEntry[];
  errorCount: number;
  warningCount: number;
  patterns: string[];
  timeRange: {
    start: Date;
    end: Date;
  };
}

/**
 * VictoriaLogs API Client
 * 
 * Interfaces with VictoriaMetrics unified logs API (v1.91.0+)
 * Supports LogQL-like queries for log aggregation and analysis.
 * 
 * API Documentation:
 * - Query: GET /select/logsql/query
 * - Insert: POST /insert/jsonline
 * 
 * Example Queries:
 * - Error logs: '{namespace="team-a-prod"} | json | level="error"'
 * - Timeout patterns: '{namespace="team-a-prod"} |~ "timeout|deadline"'
 * - OOM kills: '{namespace="team-a-prod"} |~ "OOMKilled|OutOfMemory"'
 */
export class VictoriaLogsClient {
  private readonly baseUrl: string;
  private readonly queryPath: string;
  private readonly insertPath: string;
  private readonly timeout: number;

  constructor(
    config: Config,
    private readonly logger: Logger,
  ) {
    // Read configuration
    this.baseUrl = config.getString('victoriametrics.logsUrl');
    this.queryPath = config.getOptionalString('victoriametrics.queryPath') ||
      '/select/logsql/query';
    this.insertPath = config.getOptionalString('victoriametrics.insertPath') ||
      '/insert/jsonline';
    this.timeout = config.getOptionalNumber('victoriametrics.timeout') || 30000;

    this.logger.info('VictoriaLogs client initialized', {
      baseUrl: this.baseUrl,
      queryPath: this.queryPath,
    });
  }

  /**
   * Query logs using LogQL syntax
   * 
   * @param query - LogQL query string
   * @param start - Start time (RFC3339, Unix timestamp, or relative like "5m")
   * @param end - End time (RFC3339, Unix timestamp, or "now")
   * @param limit - Maximum log entries to return (default: 1000)
   */
  async queryLogs(options: LogQuery): Promise<LogEntry[]> {
    const { query, start, end, limit = 1000 } = options;

    try {
      // Normalize time values
      const startTime = this.normalizeTime(start);
      const endTime = this.normalizeTime(end);

      // Build query URL
      const url = new URL(this.queryPath, this.baseUrl);
      url.searchParams.set('query', query);
      url.searchParams.set('start', startTime.toString());
      url.searchParams.set('end', endTime.toString());
      url.searchParams.set('limit', limit.toString());

      this.logger.debug('Querying VictoriaLogs', {
        query,
        start: startTime,
        end: endTime,
        limit,
      });

      // Execute query with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `VictoriaLogs query failed: ${response.status} ${errorText}`
        );
      }

      const result = await response.json();
      const entries = this.parseLogResult(result);

      this.logger.debug('Query completed', {
        entriesReturned: entries.length,
      });

      return entries;

    } catch (error) {
      if (error.name === 'AbortError') {
        this.logger.error('VictoriaLogs query timeout', {
          query: options.query,
          timeout: this.timeout,
        });
        throw new Error('Log query timeout');
      }

      this.logger.error('VictoriaLogs query error', {
        error: error.message,
        query: options.query,
      });
      throw error;
    }
  }

  /**
   * Analyze logs for anomalies and patterns
   * 
   * @param namespace - Kubernetes namespace to analyze
   * @param timeRange - Time range (e.g., "5m", "1h", "24h")
   * @param errorPatterns - Custom error patterns to search for
   */
  async fetchLogAnomalies(
    namespace: string,
    timeRange: string,
    errorPatterns: string[] = [],
  ): Promise<LogAnomalyResult> {
    const defaultPatterns = [
      'ERROR',
      'CRITICAL',
      'FATAL',
      'timeout',
      'deadline exceeded',
      'OOMKilled',
      'OutOfMemory',
      'connection refused',
      'failed to',
      'exception',
      'panic',
    ];

    const patterns = [...defaultPatterns, ...errorPatterns];
    
    // Build query for error detection
    const query = `{namespace="${namespace}"} |~ "${patterns.join('|')}"`;
    
    const end = 'now';
    const start = `-${timeRange}`;

    try {
      const entries = await this.queryLogs({
        query,
        start,
        end,
        limit: 1000,
      });

      // Analyze results
      const errorCount = entries.filter(e => 
        e.level === 'error' || e.level === 'critical' || e.level === 'fatal'
      ).length;

      const warningCount = entries.filter(e => 
        e.level === 'warning' || e.level === 'warn'
      ).length;

      // Extract common patterns
      const patternCounts = new Map<string, number>();
      entries.forEach(entry => {
        patterns.forEach(pattern => {
          if (entry.message.toLowerCase().includes(pattern.toLowerCase())) {
            const count = patternCounts.get(pattern) || 0;
            patternCounts.set(pattern, count + 1);
          }
        });
      });

      // Get top 5 patterns
      const topPatterns = Array.from(patternCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([pattern, count]) => `${pattern} (${count}x)`);

      return {
        entries,
        errorCount,
        warningCount,
        patterns: topPatterns,
        timeRange: {
          start: new Date(Date.now() - this.parseTimeRange(timeRange)),
          end: new Date(),
        },
      };

    } catch (error) {
      this.logger.error('Log anomaly detection failed', {
        namespace,
        timeRange,
        error: error.message,
      });
      
      // Return empty result on failure (non-blocking)
      return {
        entries: [],
        errorCount: 0,
        warningCount: 0,
        patterns: [],
        timeRange: {
          start: new Date(Date.now() - this.parseTimeRange(timeRange)),
          end: new Date(),
        },
      };
    }
  }

  /**
   * Ingest structured logs (JSON lines format)
   */
  async ingestLogs(logs: any[]): Promise<void> {
    try {
      const jsonLines = logs
        .map(log => JSON.stringify(log))
        .join('\n');

      const response = await fetch(`${this.baseUrl}${this.insertPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonLines,
      });

      if (!response.ok) {
        throw new Error(`Log ingestion failed: ${response.status}`);
      }

      this.logger.debug('Logs ingested', { count: logs.length });

    } catch (error) {
      // Log ingestion errors are non-blocking
      this.logger.warn('Log ingestion failed', {
        error: error.message,
        logCount: logs.length,
      });
    }
  }

  /**
   * Normalize time to Unix timestamp (seconds)
   */
  private normalizeTime(time: string | number): number {
    if (typeof time === 'number') {
      return time;
    }

    // Handle "now"
    if (time === 'now') {
      return Math.floor(Date.now() / 1000);
    }

    // Handle relative times: "-5m", "-1h", "-24h"
    if (time.startsWith('-')) {
      const duration = this.parseTimeRange(time.substring(1));
      return Math.floor((Date.now() - duration) / 1000);
    }

    // Handle relative times without minus: "5m", "1h"
    const relativeMatch = time.match(/^(\d+)([smhd])$/);
    if (relativeMatch) {
      const duration = this.parseTimeRange(time);
      return Math.floor((Date.now() - duration) / 1000);
    }

    // Assume RFC3339 or ISO timestamp
    try {
      return Math.floor(new Date(time).getTime() / 1000);
    } catch (error) {
      this.logger.warn('Failed to parse timestamp, using now', { time });
      return Math.floor(Date.now() / 1000);
    }
  }

  /**
   * Parse time range string to milliseconds
   */
  private parseTimeRange(range: string): number {
    const match = range.match(/^(\d+)([smhd])$/);
    
    if (!match) {
      throw new Error(`Invalid time range format: ${range}`);
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers = {
      's': 1000,           // seconds
      'm': 60 * 1000,      // minutes
      'h': 60 * 60 * 1000, // hours
      'd': 24 * 60 * 60 * 1000, // days
    };

    return amount * multipliers[unit];
  }

  /**
   * Parse VictoriaLogs query result
   */
  private parseLogResult(result: any): LogEntry[] {
    const entries: LogEntry[] = [];

    if (!result.streams || !Array.isArray(result.streams)) {
      return entries;
    }

    for (const stream of result.streams) {
      const labels = stream.stream || {};

      if (!stream.values || !Array.isArray(stream.values)) {
        continue;
      }

      for (const [timestampNs, line] of stream.values) {
        const timestampMs = parseInt(timestampNs, 10) / 1e6;
        
        // Try to parse JSON logs
        let parsed: any = {};
        try {
          parsed = JSON.parse(line);
        } catch {
          // Plain text log
          parsed = { message: line };
        }

        entries.push({
          timestamp: new Date(timestampMs),
          message: parsed.message || parsed.msg || line,
          labels,
          level: parsed.level || this.detectLogLevel(line),
          isError: this.isErrorLine(line),
          raw: parsed,
        });
      }
    }

    // Sort by timestamp (oldest first)
    return entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  private detectLogLevel(line: string): string {
    const lowerLine = line.toLowerCase();
    
    if (lowerLine.includes('fatal') || lowerLine.includes('critical')) {
      return 'critical';
    }
    if (lowerLine.includes('error')) {
      return 'error';
    }
    if (lowerLine.includes('warn')) {
      return 'warning';
    }
    if (lowerLine.includes('debug')) {
      return 'debug';
    }
    
    return 'info';
  }

  private isErrorLine(line: string): boolean {
    const errorPatterns = [
      /error/i,
      /critical/i,
      /fatal/i,
      /exception/i,
      /timeout/i,
      /oomkilled/i,
      /crash/i,
      /failed/i,
    ];

    return errorPatterns.some(pattern => pattern.test(line));
  }
}
