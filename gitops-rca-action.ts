// packages/backend/src/plugins/rca/actions/gitops-rca.ts
import { createTemplateAction } from '@backstage/plugin-scaffolder-backend';
import { Logger } from 'winston';
import { Config } from '@backstage/config';
import { VictoriaLogsClient } from '../../victorialogs/lib/logs-client';

interface RcaContext {
  namespace: string;
  cluster: string;
  k8sEvents: any[];
  podStatus: any[];
  deploymentStatus: any[];
}

interface RcaResult {
  summary: string;
  confidence: number;
  factors: string[];
  actions: string[];
  evidence: any;
  timestamp: string;
}

/**
 * GitOps RCA Action
 * 
 * Performs root cause analysis by correlating:
 * - Kubernetes events and resource status
 * - Log anomalies from VictoriaLogs
 * - k8sgpt analysis (if available)
 * - Historical patterns
 * 
 * Results are committed to Git for GitOps visibility.
 */
export function createRcaAnalyzeAction(options: {
  logger: Logger;
  config: Config;
  victoriaLogs: VictoriaLogsClient;
  k8sgptClient?: any;
}) {
  const { logger, config, victoriaLogs, k8sgptClient } = options;

  return createTemplateAction<{
    entityRef: string;
    timeRange: string;
    includeLogs?: boolean;
    includeMetrics?: boolean;
  }>({
    id: 'rca:analyze',
    description: 'Performs AI-powered root cause analysis',
    
    schema: {
      input: {
        type: 'object',
        required: ['entityRef', 'timeRange'],
        properties: {
          entityRef: {
            type: 'string',
            description: 'Entity reference (e.g., component:default/payment-service)',
          },
          timeRange: {
            type: 'string',
            enum: ['5m', '15m', '1h', '6h', '24h'],
            description: 'Time range for analysis',
          },
          includeLogs: {
            type: 'boolean',
            default: true,
            description: 'Include log analysis',
          },
          includeMetrics: {
            type: 'boolean',
            default: false,
            description: 'Include metrics analysis',
          },
        },
      },
      
      output: {
        type: 'object',
        properties: {
          rcaSummary: { type: 'string' },
          confidenceScore: { type: 'number' },
          contributingFactors: {
            type: 'array',
            items: { type: 'string' },
          },
          recommendedActions: {
            type: 'array',
            items: { type: 'string' },
          },
          evidence: { type: 'object' },
          gitCommit: { type: 'string' },
        },
      },
    },

    async handler(ctx) {
      const { entityRef, timeRange, includeLogs = true } = ctx.input;
      const startTime = Date.now();

      ctx.logger.info('Starting RCA analysis', {
        entityRef,
        timeRange,
        user: ctx.userEntity?.metadata.name,
      });

      try {
        // 1. Fetch entity metadata
        const entity = await fetchEntity(entityRef, ctx);
        const namespace = extractNamespace(entity);
        const cluster = extractCluster(entity);

        ctx.logger.info('Entity context', { namespace, cluster });

        // 2. Gather data from multiple sources (parallel with timeouts)
        const [k8sResult, logResult, k8sgptResult] = await Promise.allSettled([
          // Kubernetes context
          timeout(
            fetchK8sContext(namespace, cluster, timeRange),
            10000,
            'Kubernetes API timeout'
          ),
          
          // Log analysis
          includeLogs
            ? timeout(
                victoriaLogs.fetchLogAnomalies(namespace, timeRange),
                15000,
                'VictoriaLogs timeout'
              )
            : Promise.resolve(null),
          
          // k8sgpt analysis (optional)
          k8sgptClient
            ? timeout(
                k8sgptClient.analyze({ namespace, cluster }),
                20000,
                'k8sgpt timeout'
              ).catch(err => {
                ctx.logger.warn('k8sgpt analysis failed, continuing without it', {
                  error: err.message,
                });
                return null;
              })
            : Promise.resolve(null),
        ]);

        // 3. Check if we have enough data to proceed
        if (k8sResult.status === 'rejected') {
          throw new Error(`Failed to fetch Kubernetes context: ${k8sResult.reason}`);
        }

        const k8sContext = k8sResult.value;
        const logAnomalies = logResult.status === 'fulfilled' ? logResult.value : null;
        const k8sgptAnalysis = k8sgptResult.status === 'fulfilled' ? k8sgptResult.value : null;

        ctx.logger.info('Data collection complete', {
          k8sEvents: k8sContext.events?.length || 0,
          logEntries: logAnomalies?.entries.length || 0,
          k8sgptAvailable: !!k8sgptAnalysis,
        });

        // 4. Generate RCA analysis
        const rcaResult = await generateRCA({
          entity,
          k8sContext,
          logAnomalies,
          k8sgptAnalysis,
          timeRange,
          logger: ctx.logger,
        });

        // 5. Commit results to Git (GitOps workflow)
        const gitCommit = await commitRCAToGit({
          entityRef,
          rcaResult,
          author: ctx.userEntity?.metadata.name || 'backstage-system',
          config,
          logger: ctx.logger,
        });

        // 6. Audit logging
        ctx.logger.audit?.('RCA_COMPLETED', {
          entityRef,
          namespace,
          cluster,
          duration: Date.now() - startTime,
          confidence: rcaResult.confidence,
          gitCommit,
          dataSourcesUsed: {
            kubernetes: true,
            logs: !!logAnomalies,
            k8sgpt: !!k8sgptAnalysis,
          },
        });

        // 7. Set outputs
        ctx.output('rcaSummary', rcaResult.summary);
        ctx.output('confidenceScore', rcaResult.confidence);
        ctx.output('contributingFactors', rcaResult.factors);
        ctx.output('recommendedActions', rcaResult.actions);
        ctx.output('evidence', rcaResult.evidence);
        ctx.output('gitCommit', gitCommit);

        ctx.logger.info('RCA analysis completed successfully', {
          duration: Date.now() - startTime,
          confidence: rcaResult.confidence,
        });

      } catch (error) {
        // Audit log the failure
        ctx.logger.audit?.('RCA_FAILED', {
          entityRef,
          duration: Date.now() - startTime,
          error: error.message,
          user: ctx.userEntity?.metadata.name,
        });

        ctx.logger.error('RCA analysis failed', {
          error: error.message,
          stack: error.stack,
        });

        throw new Error(`RCA analysis failed: ${error.message}`);
      }
    },
  });
}

/**
 * Helper: Timeout wrapper
 */
function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ]);
}

/**
 * Fetch entity from catalog
 */
async function fetchEntity(entityRef: string, ctx: any): Promise<any> {
  // Implementation would use CatalogApi
  // Placeholder for demonstration
  return {
    metadata: {
      name: 'payment-service',
      namespace: 'default',
      annotations: {
        'backstage.io/kubernetes-namespace': 'team-a-prod',
        'backstage.io/kubernetes-cluster': 'prod-eks-us',
      },
    },
    spec: {
      type: 'service',
      lifecycle: 'production',
    },
  };
}

/**
 * Extract namespace from entity
 */
function extractNamespace(entity: any): string {
  return (
    entity.metadata.annotations?.['backstage.io/kubernetes-namespace'] ||
    entity.metadata.namespace ||
    'default'
  );
}

/**
 * Extract cluster from entity
 */
function extractCluster(entity: any): string {
  return (
    entity.metadata.annotations?.['backstage.io/kubernetes-cluster'] ||
    'default'
  );
}

/**
 * Fetch Kubernetes context (events, pod status, etc.)
 */
async function fetchK8sContext(
  namespace: string,
  cluster: string,
  timeRange: string,
): Promise<RcaContext> {
  // Implementation would use Kubernetes client
  // Placeholder for demonstration
  return {
    namespace,
    cluster,
    k8sEvents: [],
    podStatus: [],
    deploymentStatus: [],
  };
}

/**
 * Generate RCA analysis from collected data
 */
async function generateRCA(options: {
  entity: any;
  k8sContext: RcaContext;
  logAnomalies: any;
  k8sgptAnalysis: any;
  timeRange: string;
  logger: Logger;
}): Promise<RcaResult> {
  const { k8sContext, logAnomalies, k8sgptAnalysis, logger } = options;

  // Build analysis factors
  const factors: string[] = [];
  const actions: string[] = [];
  let confidence = 0;

  // Analyze k8sgpt results
  if (k8sgptAnalysis?.problems?.length > 0) {
    factors.push(...k8sgptAnalysis.problems.map(p => p.description));
    confidence += 30;
  }

  // Analyze log patterns
  if (logAnomalies?.errorCount > 0) {
    factors.push(`Found ${logAnomalies.errorCount} error logs`);
    factors.push(...logAnomalies.patterns);
    confidence += 25;
  }

  // Analyze Kubernetes events
  const criticalEvents = k8sContext.k8sEvents.filter(
    e => e.type === 'Warning' || e.reason === 'Failed'
  );
  if (criticalEvents.length > 0) {
    factors.push(`${criticalEvents.length} critical Kubernetes events`);
    confidence += 20;
  }

  // Generate recommended actions
  if (logAnomalies?.patterns.includes('OOMKilled')) {
    actions.push('Increase memory limits for affected pods');
    actions.push('Review memory usage patterns and optimize application');
  }

  if (logAnomalies?.patterns.includes('timeout')) {
    actions.push('Investigate network latency or slow dependencies');
    actions.push('Review timeout configurations');
  }

  // Build summary
  const summary = factors.length > 0
    ? `Analysis identified ${factors.length} contributing factors. ${actions.length} recommended actions available.`
    : 'No significant issues detected. System appears healthy.';

  // Normalize confidence (0-100)
  confidence = Math.min(confidence, 100);

  return {
    summary,
    confidence,
    factors,
    actions,
    evidence: {
      k8sEvents: criticalEvents.slice(0, 10),
      logSamples: logAnomalies?.entries.slice(0, 5) || [],
      k8sgptDetails: k8sgptAnalysis,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Commit RCA results to Git repository
 */
async function commitRCAToGit(options: {
  entityRef: string;
  rcaResult: RcaResult;
  author: string;
  config: Config;
  logger: Logger;
}): Promise<string> {
  const { entityRef, rcaResult, author, logger } = options;

  // Format RCA as Markdown
  const markdown = formatRCAMarkdown(entityRef, rcaResult, author);

  // Commit to Git (implementation would use Git client)
  const filename = `rca-${Date.now()}.md`;
  logger.info('Committing RCA to Git', { filename });

  // Placeholder - would use actual Git operations
  return `abc123`; // Git commit SHA
}

/**
 * Format RCA result as Markdown
 */
function formatRCAMarkdown(
  entityRef: string,
  rca: RcaResult,
  author: string,
): string {
  return `# RCA: ${entityRef}

**Generated**: ${rca.timestamp}  
**Author**: ${author}  
**Confidence**: ${rca.confidence}%

## Summary

${rca.summary}

## Contributing Factors

${rca.factors.map((f, i) => `${i + 1}. ${f}`).join('\n')}

## Recommended Actions

${rca.actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

## Evidence

### Kubernetes Events
\`\`\`
${JSON.stringify(rca.evidence.k8sEvents, null, 2)}
\`\`\`

### Log Samples
\`\`\`
${JSON.stringify(rca.evidence.logSamples, null, 2)}
\`\`\`
`;
}
