// packages/backend/src/plugins/auth/resolvers/zitadelGroupSync.ts
import {
  createSignInResolverFactory,
  SignInInfo,
  AuthResolverContext,
} from '@backstage/plugin-auth-node';
import { Config } from '@backstage/config';
import { Logger } from 'winston';

export interface ZitadelGroupSyncConfig {
  roleClaimPath: string;
  teamPrefix: string;
  groupDomain: string;
  enableDebugLogging: boolean;
}

/**
 * ZITADEL Group Synchronization Resolver
 * 
 * Maps ZITADEL groups/roles to Backstage groups for RBAC enforcement.
 * 
 * Token Structure (ZITADEL):
 * {
 *   "sub": "123456789",
 *   "email": "user@company.com",
 *   "urn:zitadel:iam:org:project:roles": {
 *     "team-a-admin": { "org": "backstage-dev" },
 *     "team-a-developer": { "org": "backstage-dev" },
 *     "team-b-viewer": { "org": "backstage-dev" }
 *   }
 * }
 * 
 * Backstage Groups (Output):
 * - group:default/team-a
 * - group:default/team-b
 * 
 * Configuration:
 * - roleClaimPath: Path to roles in token (default: urn:zitadel:iam:org:project:roles)
 * - teamPrefix: Prefix for team extraction (default: team-)
 * - groupDomain: Group domain (default: default)
 */
export class ZitadelGroupSyncResolver {
  constructor(
    private readonly config: ZitadelGroupSyncConfig,
    private readonly logger: Logger,
  ) {}

  async resolve(
    info: SignInInfo<any>,
    ctx: AuthResolverContext,
  ): Promise<any> {
    const { profile } = info;
    const claims = info.result?.session?.idToken?.claims || {};

    this.debug('Processing ZITADEL token', {
      sub: claims.sub,
      email: profile.email,
      claimsKeys: Object.keys(claims),
    });

    // Validate issuer (security check)
    this.validateIssuer(claims);

    // Extract user identity
    const userId = this.extractUserId(claims, profile);
    
    // Extract and map groups
    const backstageGroups = this.extractGroups(claims);

    this.debug('Resolved groups', {
      userId,
      groupCount: backstageGroups.length,
      groups: backstageGroups,
    });

    // Issue Backstage token
    return ctx.issueToken({
      claims: {
        sub: userId,
        ent: backstageGroups,
      },
    });
  }

  private validateIssuer(claims: any): void {
    const issuer = claims.iss;
    
    if (!issuer) {
      throw new Error('Token missing issuer claim');
    }

    // CRITICAL: Validate issuer to prevent token forgery
    const expectedIssuers = [
      'http://zitadel:8080',              // Local dev
      'http://localhost:8080',             // Local dev
      'https://zitadel.yourcompany.com',  // Production
    ];

    const isValidIssuer = expectedIssuers.some(expected =>
      issuer.startsWith(expected)
    );

    if (!isValidIssuer) {
      this.logger.error('Invalid token issuer', { issuer });
      throw new Error(`Invalid token issuer: ${issuer}`);
    }
  }

  private extractUserId(claims: any, profile: any): string {
    // Prefer email as user ID, fallback to subject
    return (
      claims.email ||
      profile.email ||
      claims.preferred_username ||
      claims.sub
    );
  }

  private extractGroups(claims: any): string[] {
    try {
      // Get roles from ZITADEL token
      const roles = this.getRolesFromClaims(claims);
      
      if (!roles || typeof roles !== 'object') {
        this.logger.warn('No roles found in token or invalid format', {
          roleClaimPath: this.config.roleClaimPath,
        });
        return [];
      }

      // Extract team names from role keys
      const teams = this.extractTeamsFromRoles(Object.keys(roles));
      
      // Map to Backstage groups
      const groups = teams.map(team =>
        `group:${this.config.groupDomain}/${team}`
      );

      return [...new Set(groups)]; // Deduplicate
    } catch (error) {
      this.logger.error('Failed to extract groups from token', {
        error: error.message,
      });
      return [];
    }
  }

  private getRolesFromClaims(claims: any): any {
    // Navigate claim path (e.g., "urn:zitadel:iam:org:project:roles")
    const path = this.config.roleClaimPath;
    
    if (claims[path]) {
      return claims[path];
    }

    // Fallback: try nested path navigation
    const parts = path.split('.');
    let current = claims;
    
    for (const part of parts) {
      if (current && typeof current === 'object') {
        current = current[part];
      } else {
        return null;
      }
    }
    
    return current;
  }

  private extractTeamsFromRoles(roleKeys: string[]): string[] {
    const teams = new Set<string>();
    const prefix = this.config.teamPrefix;

    for (const role of roleKeys) {
      // Skip roles that don't start with team prefix
      if (!role.startsWith(prefix)) {
        continue;
      }

      // Extract team name: team-a-admin → team-a
      // Extract team name: team-platform-engineering-developer → team-platform-engineering
      const parts = role.split('-');
      
      if (parts.length < 2) {
        this.logger.warn('Invalid role format', { role });
        continue;
      }

      // Find the position of common role suffixes
      const roleSuffixes = ['admin', 'developer', 'viewer', 'owner', 'member'];
      let teamParts = parts.slice(1); // Remove "team" prefix
      
      // Remove role suffix if present
      const lastPart = teamParts[teamParts.length - 1];
      if (roleSuffixes.includes(lastPart.toLowerCase())) {
        teamParts = teamParts.slice(0, -1);
      }

      if (teamParts.length === 0) {
        this.logger.warn('Could not extract team name from role', { role });
        continue;
      }

      const teamName = teamParts.join('-');
      teams.add(teamName);
    }

    return Array.from(teams);
  }

  private debug(message: string, metadata?: any): void {
    if (this.config.enableDebugLogging) {
      this.logger.debug(`[ZitadelGroupSync] ${message}`, metadata);
    }
  }
}

/**
 * Factory function for Backstage auth provider
 */
export const zitadelGroupSyncResolverFactory = createSignInResolverFactory({
  create(options: { config: Config; logger: Logger }) {
    const resolverConfig: ZitadelGroupSyncConfig = {
      roleClaimPath: options.config.getOptionalString(
        'auth.providers.zitadel.roleClaimPath'
      ) || 'urn:zitadel:iam:org:project:roles',
      
      teamPrefix: options.config.getOptionalString(
        'auth.providers.zitadel.teamPrefix'
      ) || 'team-',
      
      groupDomain: options.config.getOptionalString(
        'auth.providers.zitadel.groupDomain'
      ) || 'default',
      
      enableDebugLogging: options.config.getOptionalBoolean(
        'auth.providers.zitadel.enableDebugLogging'
      ) ?? false,
    };

    const resolver = new ZitadelGroupSyncResolver(
      resolverConfig,
      options.logger,
    );

    return async (info: SignInInfo<any>, ctx: AuthResolverContext) => {
      return resolver.resolve(info, ctx);
    };
  },
});

/**
 * Usage in packages/backend/src/plugins/auth.ts:
 * 
 * import { zitadelGroupSyncResolverFactory } from './resolvers/zitadelGroupSync';
 * 
 * export default async function createPlugin(
 *   env: PluginEnvironment,
 * ): Promise<Router> {
 *   return await createRouter({
 *     logger: env.logger,
 *     config: env.config,
 *     database: env.database,
 *     discovery: env.discovery,
 *     tokenManager: env.tokenManager,
 *     providerFactories: {
 *       zitadel: providers.oidc.create({
 *         signIn: {
 *           resolver: zitadelGroupSyncResolverFactory,
 *         },
 *       }),
 *     },
 *   });
 * }
 */
