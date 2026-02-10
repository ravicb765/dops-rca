// packages/backend/src/index.ts
// New Backend System (Recommended)
// https://backstage.io/docs/backend-system/

import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// ==========================================
// Core Plugins
// ==========================================

// App backend - serves the frontend
backend.add(import('@backstage/plugin-app-backend/alpha'));

// Auth backend - handles authentication
backend.add(import('@backstage/plugin-auth-backend'));

// Catalog backend - manages entities
backend.add(import('@backstage/plugin-catalog-backend/alpha'));

// Scaffolder backend - templates and actions
backend.add(import('@backstage/plugin-scaffolder-backend/alpha'));

// Kubernetes backend - multi-cluster support
backend.add(import('@backstage/plugin-kubernetes-backend/alpha'));

// TechDocs backend - documentation
backend.add(import('@backstage/plugin-techdocs-backend/alpha'));

// Search backend - search functionality
backend.add(import('@backstage/plugin-search-backend/alpha'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
// backend.add(import('@backstage/plugin-search-backend-module-catalog/alpha'));
// backend.add(import('@backstage/plugin-search-backend-module-techdocs/alpha'));
// backend.add(import('@backstage/plugin-search-backend-module-techdocs'));

// Proxy backend - API proxying
backend.add(import('@backstage/plugin-proxy-backend/alpha'));

// ==========================================
// Permission System
// ==========================================

// Permission backend with custom policy
backend.add(import('@backstage/plugin-permission-backend/alpha'));

// Custom namespace policy
backend.add(import('./plugins/permission/k8s-namespace-policy'));

// ==========================================
// Custom Plugins
// ==========================================

// VictoriaLogs plugin
backend.add(import('./plugins/victorialogs'));

// RCA action plugin
backend.add(import('./plugins/rca'));

// ==========================================
// Auth Providers
// ==========================================

// ZITADEL OIDC
// backend.add(import('./plugins/auth/zitadel-provider'));

// Guest provider (development only)
// backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));

// ==========================================
// Start Backend
// ==========================================

backend.start();
