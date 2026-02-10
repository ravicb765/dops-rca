// packages/backend/src/plugins/auth/resolvers/genericGroupSync.ts
import {
  createSignInResolverFactory,
  SignInInfo,
  AuthResolverContext,
} from '@backstage/plugin-auth-node';
import { Config } from '@backstage/config';
import { Logger } from 'winston';

export interface GenericGroupSyncConfig {
  groupAttribute?: string;
  groupPrefix?: string;
  groupDomain: string;
  enableDebugLogging: boolean;
}

/**
 * Generic Group Synchronization Resolver
 * 
 * Works with SAML, LDAP, Azure AD, and other OAuth providers
 * 
 * Extracts groups from various claim formats and maps to Backstage groups.
 * 
 * Supported Attributes:
 * - groups (array or comma-separated)
 * - http://schemas.xmlsoap.org/claims/Group (SAML)
 * - http://schemas.microsoft.com/ws/2008/06/identity/claims/groups (Azure AD)
 * - memberOf (LDAP)
 * 
 * Example Mappings:
 * SAML: "CN=team-a-admins,OU=Groups,DC=company,DC=com" → group:default/team-a
 * Azure AD: "team-b-developers" → group:default/team-b
 * LDAP: "cn=platform-engineering,ou=teams,dc=company,dc=com" → group:default/platform-engineering
 */
export class GenericGroupSyncResolver {
  constructor(
    private readonly config: GenericGroupSyncConfig,
    private readonly logger: Logger,
  ) {}

  async resolve(
    info: SignInInfo<any>,
    ctx: AuthResolverContext,
  ): Promise<any> {
    const { profile } = info;
    const claims = info.result?.session?.idToken?.claims || {};

    this.debug('Processing authentication token', {
      email: profile.email,
      claimsKeys: Object.keys(claims),
    });

    // Extract user identity
    const userId = this.extractUserId(claims, profile);
    
    // Extract and map groups
    const backstageGroups = this.extractGroups(claims, profile);

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

  private extractUserId(claims: any, profile: any): string {
    // Prefer email as user ID, fallback to other identifiers
    return (
      claims.email ||
      profile.email ||
      claims.preferred_username ||
      claims.upn || // Azure AD User Principal Name
      claims.sub
    );
  }

  private extractGroups(claims: any, profile: any): string[] {
    try {
      const rawGroups = this.getRawGroups(claims, profile);
      
      if (!rawGroups || rawGroups.length === 0) {
        this.logger.warn('No groups found in token', {
          claimsKeys: Object.keys(claims),
        });
        return [];
      }

      // Extract team names from group identifiers
      const teams = this.extractTeamsFromGroups(rawGroups);
      
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

  private getRawGroups(claims: any, profile: any): string[] {
    const possibleGroupAttributes = [
      // Standard OAuth/OIDC
      'groups',
      
      // SAML attributes
      'http://schemas.xmlsoap.org/claims/Group',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/groups',
      
      // Azure AD
      'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
      'http://schemas.microsoft.com/identity/claims/groups',
      
      // LDAP
      'memberOf',
      
      // Custom attribute (from config)
      this.config.groupAttribute,
    ];

    for (const attr of possibleGroupAttributes) {
      if (!attr) continue;
      
      const value = claims[attr] || profile[attr];
      
      if (value) {
        // Handle array
        if (Array.isArray(value)) {
          return value;
        }
        
        // Handle comma-separated string
        if (typeof value === 'string') {
          return value.split(',').map(g => g.trim());
        }
        
        // Handle single value
        return [String(value)];
      }
    }

    return [];
  }

  private extractTeamsFromGroups(groups: string[]): string[] {
    const teams = new Set<string>();
    const prefix = this.config.groupPrefix || '';

    for (const group of groups) {
      // Handle LDAP DN format: CN=team-a-admins,OU=Groups,DC=company,DC=com
      if (group.toLowerCase().includes('cn=')) {
        const cnMatch = group.match(/CN=([^,]+)/i);
        if (cnMatch) {
          const teamName = this.normalizeTeamName(cnMatch[1], prefix);
          if (teamName) teams.add(teamName);
        }
        continue;
      }

      // Handle simple group names: team-a-admins, platform-engineering
      const teamName = this.normalizeTeamName(group, prefix);
      if (teamName) teams.add(teamName);
    }

    return Array.from(teams);
  }

  private normalizeTeamName(rawName: string, prefix: string): string | null {
    // Remove prefix if present
    let name = rawName;
    if (prefix && name.startsWith(prefix)) {
      name = name.substring(prefix.length);
    }

    // Remove common role suffixes
    const roleSuffixes = [
      '-admin', '-admins',
      '-developer', '-developers', '-devs',
      '-viewer', '-viewers',
      '-owner', '-owners',
      '-member', '-members',
      '-user', '-users',
    ];

    for (const suffix of roleSuffixes) {
      if (name.toLowerCase().endsWith(suffix)) {
        name = name.substring(0, name.length - suffix.length);
        break;
      }
    }

    // Clean up: lowercase, replace spaces with hyphens
    name = name.toLowerCase().trim().replace(/\s+/g, '-');

    // Validate: must be alphanumeric with hyphens
    if (!/^[a-z0-9-]+$/.test(name)) {
      this.logger.warn('Invalid team name format', { rawName, normalized: name });
      return null;
    }

    return name;
  }

  private debug(message: string, metadata?: any): void {
    if (this.config.enableDebugLogging) {
      this.logger.debug(`[GenericGroupSync] ${message}`, metadata);
    }
  }
}

/**
 * Factory function for Backstage auth provider
 */
export const genericGroupSyncResolverFactory = createSignInResolverFactory({
  create(options: { config: Config; logger: Logger }) {
    const resolverConfig: GenericGroupSyncConfig = {
      groupAttribute: options.config.getOptionalString(
        'auth.groupAttribute'
      ),
      
      groupPrefix: options.config.getOptionalString(
        'auth.groupPrefix'
      ),
      
      groupDomain: options.config.getOptionalString(
        'auth.groupDomain'
      ) || 'default',
      
      enableDebugLogging: options.config.getOptionalBoolean(
        'auth.enableDebugLogging'
      ) ?? false,
    };

    const resolver = new GenericGroupSyncResolver(
      resolverConfig,
      options.logger,
    );

    return async (info: SignInInfo<any>, ctx: AuthResolverContext) => {
      return resolver.resolve(info, ctx);
    };
  },
});

/**
 * Usage Examples:
 * 
 * SAML Provider:
 * ```typescript
 * import { genericGroupSyncResolverFactory } from './resolvers/genericGroupSync';
 * 
 * providers: {
 *   saml: providers.saml.create({
 *     signIn: {
 *       resolver: genericGroupSyncResolverFactory,
 *     },
 *   }),
 * }
 * ```
 * 
 * Azure AD Provider:
 * ```typescript
 * providers: {
 *   microsoft: providers.microsoft.create({
 *     signIn: {
 *       resolver: genericGroupSyncResolverFactory,
 *     },
 *   }),
 * }
 * ```
 * 
 * LDAP Provider:
 * ```typescript
 * providers: {
 *   ldap: providers.ldap.create({
 *     signIn: {
 *       resolver: genericGroupSyncResolverFactory,
 *     },
 *   }),
 * }
 * ```
 */
