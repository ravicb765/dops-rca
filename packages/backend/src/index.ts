// packages/backend/src/index.ts
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// Core plugins
backend.add(import('@backstage/plugin-app-backend/alpha'));
backend.add(import('@backstage/plugin-proxy-backend/alpha'));
backend.add(import('@backstage/plugin-scaffolder-backend/alpha'));
backend.add(import('@backstage/plugin-catalog-backend/alpha'));
backend.add(import('@backstage/plugin-permission-backend/alpha'));

// Authentication
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-zitadel-provider'));

// Kubernetes
backend.add(import('@backstage/plugin-kubernetes-backend/alpha'));

backend.start();
