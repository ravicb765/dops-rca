import { WinstonLogger } from '@backstage/backend-common';
import { AuditLogger } from 'winston-audit';

export class KubernetesAuditLogger {
  private auditLogger: AuditLogger;
  
  constructor(private baseLogger: WinstonLogger) {
    this.auditLogger = new AuditLogger({
      logger: baseLogger,
      redact: ['token', 'password', 'secret', 'cert'],
      hooks: {
        // Redact sensitive fields in Kubernetes API requests
        beforeLog: (entry) => {
          if (entry.action?.includes('kubernetes')) {
            if (entry.metadata?.request?.headers?.authorization) {
              entry.metadata.request.headers.authorization = '[REDACTED]';
            }
            if (entry.metadata?.response?.body) {
              entry.metadata.response.body = this.redactSensitiveData(entry.metadata.response.body);
            }
          }
          return entry;
        }
      }
    });
  }
  
  logKubernetesCall({
    userId,
    cluster,
    namespace,
    method,
    path,
    statusCode,
    durationMs,
    error
  }: {
    userId: string;
    cluster: string;
    namespace: string;
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    error?: string;
  }) {
    this.auditLogger.log('kubernetes_api_call', {
      userId,
      cluster,
      namespace,
      method,
      path,
      statusCode,
      durationMs,
      success: !error,
      error: error || null,
      timestamp: new Date().toISOString()
    });
  }
  
  private redactSensitiveData(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    const redacted = { ...obj };
    for (const key of Object.keys(redacted)) {
      if (/(token|password|secret|cert|key)/i.test(key)) {
        redacted[key] = '[REDACTED]';
      } else if (typeof redacted[key] === 'object') {
        redacted[key] = this.redactSensitiveData(redacted[key]);
      }
    }
    return redacted;
  }
}
