// packages/backend/src/plugins/permission/policies/k8s-namespace-policy.ts
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyDecision,
} from '@backstage/plugin-permission-node';
import {
  AuthorizeResult,
  Permission,
} from '@backstage/plugin-permission-common';
import { CatalogApi } from '@backstage/catalog-client';
import { IdentityApi } from '@backstage/plugin-auth-node';
import { Config } from '@backstage/config';
import { Logger } from 'winston';
import { Entity } from '@backstage/catalog-model';

export interface K8sNamespacePolicyConfig {
  sharedNamespaces: string[];
  enableAuditLogging: boolean;
  strictMode: boolean; // If true, deny access when namespace annotation is missing
}

/**
 * Kubernetes Namespace Policy
 * 
 * Enforces multi-tenant isolation by validating that users can only access
 * Kubernetes resources in namespaces owned by their groups.
 * 
 * Ownership Model:
 * - Namespace format: {team}-{environment} (e.g., team-a-prod)
 * - Group format: group:default/{team} (e.g., group:default/team-a)
 * - Shared namespaces (monitoring, platform-tools) are accessible to all
 * 
 * Example:
 * - User in group:default/team-a can access:
 *   ✅ team-a-prod, team-a-staging, team-a-dev
 *   ❌ team-b-prod, team-c-staging
 *   ✅ monitoring (shared)
 */
export class K8sNamespacePolicy implements PermissionPolicy {
  constructor(
    private readonly catalog: CatalogApi,
    private readonly identity: IdentityApi,
    private readonly config: K8sNamespacePolicyConfig,
    private readonly logger: Logger,
  ) {}

  async handle(request: PolicyQuery): Promise<PolicyDecision> {
    const permission = request.permission;

    // Only apply policy to Kubernetes-related permissions
    if (!this.isKubernetesPermission(permission)) {
      return { result: AuthorizeResult.ALLOW };
    }

    try {
      // Extract user identity and groups
      const userGroups = await this.getUserGroups(request);
      
      // Get the entity being accessed
      const entity = await this.getEntity(request);
      
      if (!entity) {
        return this.denyAccess(request, 'Entity not found');
      }

      // Extract namespace from entity
      const namespace = this.extractNamespace(entity);
      
      if (!namespace) {
        if (this.config.strictMode) {
          return this.denyAccess(
            request,
            'Entity missing kubernetes namespace annotation'
          );
        }
        // In non-strict mode, allow access if no namespace annotation
        this.logger.warn('Entity missing namespace annotation', {
          entityRef: entity.metadata.name,
        });
        return { result: AuthorizeResult.ALLOW };
      }

      // Check if namespace is shared (accessible to all)
      if (this.isSharedNamespace(namespace)) {
        this.auditLog('SHARED_NAMESPACE_ACCESS', {
          userId: request.principal.subject,
          namespace,
          entity: entity.metadata.name,
        });
        return { result: AuthorizeResult.ALLOW };
      }

      // Validate namespace ownership
      const hasAccess = this.validateNamespaceOwnership(
        namespace,
        userGroups
      );

      if (hasAccess) {
        this.auditLog('NAMESPACE_ACCESS_GRANTED', {
          userId: request.principal.subject,
          namespace,
          entity: entity.metadata.name,
          userGroups,
        });
        return { result: AuthorizeResult.ALLOW };
      }

      // Access denied
      return this.denyAccess(request, 'User not authorized for namespace', {
        namespace,
        userGroups,
        requiredOwner: this.getExpectedOwner(namespace),
      });

    } catch (error) {
      this.logger.error('Permission policy error', {
        error: error.message,
        stack: error.stack,
        permission: permission.name,
      });
      
      // Fail closed - deny access on errors
      return { result: AuthorizeResult.DENY };
    }
  }

  private isKubernetesPermission(permission: Permission): boolean {
    return (
      permission.name.startsWith('kubernetes.') ||
      permission.name.startsWith('catalog.entity.kubernetes')
    );
  }

  private async getUserGroups(request: PolicyQuery): Promise<string[]> {
    try {
      const ownershipRefs = await this.identity.getOwnershipEntityRefs(
        request.principal
      );
      return ownershipRefs;
    } catch (error) {
      this.logger.error('Failed to get user groups', {
        error: error.message,
        userId: request.principal.subject,
      });
      return [];
    }
  }

  private async getEntity(request: PolicyQuery): Promise<Entity | undefined> {
    const resourceRef = request.resource?.resourceRef;
    
    if (!resourceRef) {
      return undefined;
    }

    try {
      return await this.catalog.getEntityByRef(resourceRef);
    } catch (error) {
      this.logger.warn('Failed to fetch entity', {
        error: error.message,
        resourceRef,
      });
      return undefined;
    }
  }

  private extractNamespace(entity: Entity): string | undefined {
    return (
      entity.metadata.annotations?.['backstage.io/kubernetes-namespace'] ||
      entity.metadata.annotations?.['kubernetes.io/namespace']
    );
  }

  private isSharedNamespace(namespace: string): boolean {
    return this.config.sharedNamespaces.includes(namespace);
  }

  private validateNamespaceOwnership(
    namespace: string,
    userGroups: string[]
  ): boolean {
    const expectedOwner = this.getExpectedOwner(namespace);
    
    // Check if user is in the owning group
    return userGroups.includes(expectedOwner);
  }

  private getExpectedOwner(namespace: string): string {
    // Extract team from namespace: team-a-prod → team-a
    const parts = namespace.split('-');
    
    if (parts.length < 2) {
      this.logger.warn('Invalid namespace format', { namespace });
      return `group:default/${namespace}`;
    }

    // Handle multi-part team names: platform-engineering-prod → platform-engineering
    const environment = parts[parts.length - 1];
    const validEnvironments = ['prod', 'staging', 'dev', 'test'];
    
    let teamName: string;
    if (validEnvironments.includes(environment)) {
      // Last part is environment, rest is team name
      teamName = parts.slice(0, -1).join('-');
    } else {
      // No environment suffix, use entire namespace as team
      teamName = namespace;
    }

    return `group:default/${teamName}`;
  }

  private denyAccess(
    request: PolicyQuery,
    reason: string,
    metadata?: Record<string, any>
  ): PolicyDecision {
    this.auditLog('NAMESPACE_ACCESS_DENIED', {
      userId: request.principal.subject,
      reason,
      permission: request.permission.name,
      ...metadata,
    });

    return { result: AuthorizeResult.DENY };
  }

  private auditLog(action: string, metadata: Record<string, any>): void {
    if (!this.config.enableAuditLogging) {
      return;
    }

    this.logger.info(action, {
      ...metadata,
      timestamp: new Date().toISOString(),
      action,
    });
  }
}

/**
 * Factory function to create policy from Backstage config
 */
export async function createK8sNamespacePolicy(
  catalog: CatalogApi,
  identity: IdentityApi,
  config: Config,
  logger: Logger
): Promise<K8sNamespacePolicy> {
  const policyConfig: K8sNamespacePolicyConfig = {
    sharedNamespaces: config.getOptionalStringArray(
      'permission.kubernetes.sharedNamespaces'
    ) || ['monitoring', 'platform-tools', 'flux-system'],
    enableAuditLogging: config.getOptionalBoolean(
      'permission.kubernetes.enableAuditLogging'
    ) ?? true,
    strictMode: config.getOptionalBoolean(
      'permission.kubernetes.strictMode'
    ) ?? true,
  };

  return new K8sNamespacePolicy(catalog, identity, policyConfig, logger);
}
