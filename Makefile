# Makefile - Cloud-Native AIOps Platform
# Unified command interface for development and deployment

.DEFAULT_GOAL := help
SHELL := /bin/bash

# Colors for output
CYAN := \033[0;36m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m

# Git metadata
GIT_SHA := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH := $(shell git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
BUILD_DATE := $(shell date -u +%Y%m%d-%H%M%S)
IMAGE_TAG := $(GIT_SHA)

# Docker image
REGISTRY := your-registry.io
IMAGE_NAME := backstage-aiops
FULL_IMAGE := $(REGISTRY)/$(IMAGE_NAME):$(IMAGE_TAG)

# ==========================================
# Help
# ==========================================
.PHONY: help
help: ## Show this help message
	@echo ""
	@echo "$(CYAN)Cloud-Native AIOps Platform - Make Commands$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(CYAN)%-20s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""

# ==========================================
# Local Development
# ==========================================
.PHONY: setup
setup: ## One-command local setup (idempotent)
	@echo "$(GREEN)🚀 Setting up Cloud-Native AIOps Platform...$(NC)"
	@./scripts/setup-dev.sh
	@echo "$(GREEN)✓ Setup complete!$(NC)"
	@echo ""
	@echo "$(CYAN)Next steps:$(NC)"
	@echo "  1. Run: make dev"
	@echo "  2. Open: http://localhost:3000"
	@echo "  3. Login with: zitadel-admin / SuperSecureDevPass123!"
	@echo ""

.PHONY: dev
dev: ## Start local development environment
	@echo "$(GREEN)▶ Starting development services...$(NC)"
	@docker compose up -d postgres zitadel victoriametrics mock-k8s
	@echo "$(YELLOW)⏳ Waiting for ZITADEL to be ready...$(NC)"
	@./scripts/wait-for-zitadel.sh
	@echo "$(GREEN)✓ Infrastructure ready$(NC)"
	@echo "$(GREEN)▶ Starting Backstage...$(NC)"
	@docker compose up backstage

.PHONY: dev-detached
dev-detached: ## Start all services in background
	@echo "$(GREEN)▶ Starting all services in background...$(NC)"
	@docker compose up -d
	@echo "$(GREEN)✓ Services started$(NC)"
	@make status

.PHONY: status
status: ## Show status of all services
	@echo "$(CYAN)Service Status:$(NC)"
	@docker compose ps

.PHONY: logs
logs: ## Stream Backstage logs
	@docker compose logs -f backstage

.PHONY: logs-all
logs-all: ## Stream all service logs
	@docker compose logs -f

.PHONY: shell
shell: ## Open shell in Backstage container
	@docker compose exec backstage sh

.PHONY: restart
restart: ## Restart Backstage service
	@docker compose restart backstage

.PHONY: clean
clean: ## Remove all containers and volumes
	@echo "$(RED)🧹 Cleaning up...$(NC)"
	@docker compose down -v --remove-orphans
	@rm -rf .zitadel-creds node_modules/.cache 2>/dev/null || true
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

# ==========================================
# Build & Test
# ==========================================
.PHONY: install
install: ## Install dependencies
	@echo "$(GREEN)📦 Installing dependencies...$(NC)"
	@yarn install --frozen-lockfile
	@echo "$(GREEN)✓ Dependencies installed$(NC)"

.PHONY: build
build: ## Build production Docker image
	@echo "$(GREEN)📦 Building production image...$(NC)"
	@docker build \
		-t $(FULL_IMAGE) \
		-t $(REGISTRY)/$(IMAGE_NAME):latest \
		-f packages/backend/Dockerfile \
		--build-arg BUILD_DATE=$(BUILD_DATE) \
		--build-arg GIT_SHA=$(GIT_SHA) \
		--build-arg GIT_BRANCH=$(GIT_BRANCH) \
		.
	@echo "$(GREEN)✓ Built: $(FULL_IMAGE)$(NC)"

.PHONY: build-dev
build-dev: ## Build development image
	@docker compose build backstage

.PHONY: test
test: ## Run all tests
	@echo "$(GREEN)🧪 Running tests...$(NC)"
	@yarn test

.PHONY: test-unit
test-unit: ## Run unit tests
	@yarn test:unit

.PHONY: test-e2e
test-e2e: ## Run end-to-end tests
	@docker compose up -d
	@echo "$(YELLOW)⏳ Waiting for services...$(NC)"
	@sleep 30
	@yarn test:e2e:ci
	@docker compose down

.PHONY: lint
lint: ## Run linter
	@yarn lint

.PHONY: lint-fix
lint-fix: ## Fix linting issues
	@yarn lint --fix

.PHONY: type-check
type-check: ## Run TypeScript type checking
	@yarn tsc --noEmit

# ==========================================
# Load Testing
# ==========================================
.PHONY: loadtest
loadtest: ## Run 50-user load test
	@echo "$(GREEN)🔥 Running load test...$(NC)"
	@./scripts/loadtest.sh

.PHONY: loadtest-quick
loadtest-quick: ## Quick load test (10 users, 1 minute)
	@artillery quick --count 10 --num 60 http://localhost:7007/healthcheck

# ==========================================
# Database
# ==========================================
.PHONY: db-migrate
db-migrate: ## Run database migrations
	@yarn backstage-cli migrate:up

.PHONY: db-reset
db-reset: ## Reset database (WARNING: destructive)
	@echo "$(RED)⚠️  This will delete all data!$(NC)"
	@read -p "Are you sure? (y/N) " -n 1 -r; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		docker compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS backstage;"; \
		docker compose exec postgres psql -U postgres -c "CREATE DATABASE backstage;"; \
		echo "$(GREEN)✓ Database reset$(NC)"; \
	fi

.PHONY: db-shell
db-shell: ## Open PostgreSQL shell
	@docker compose exec postgres psql -U postgres -d backstage

# ==========================================
# Kubernetes / Production
# ==========================================
.PHONY: k8s-install-operator
k8s-install-operator: ## Install External Secrets Operator
	@echo "$(GREEN)📦 Installing External Secrets Operator...$(NC)"
	@helm repo add external-secrets https://charts.external-secrets.io
	@helm repo update
	@helm upgrade --install external-secrets \
		external-secrets/external-secrets \
		-n external-secrets-system \
		--create-namespace \
		--wait
	@echo "$(GREEN)✓ External Secrets Operator installed$(NC)"

.PHONY: k8s-install-k8sgpt
k8s-install-k8sgpt: ## Install k8sgpt operator
	@echo "$(GREEN)📦 Installing k8sgpt operator...$(NC)"
	@helm repo add k8sgpt https://charts.k8sgpt.ai/
	@helm repo update
	@helm upgrade --install k8sgpt k8sgpt/k8sgpt-operator \
		-n k8sgpt \
		--create-namespace \
		-f ./configs/k8sgpt-values.yaml \
		--wait
	@echo "$(GREEN)✓ k8sgpt operator installed$(NC)"

.PHONY: deploy-staging
deploy-staging: build ## Deploy to staging via GitOps
	@echo "$(GREEN)🚀 Deploying to staging...$(NC)"
	@docker push $(FULL_IMAGE)
	@kubectl set image deployment/backstage \
		backstage=$(FULL_IMAGE) \
		-n platform-tools-staging
	@kubectl rollout status deployment/backstage -n platform-tools-staging
	@echo "$(GREEN)✓ Deployed to staging$(NC)"

.PHONY: deploy-production
deploy-production: ## Deploy to production via GitOps
	@echo "$(RED)⚠️  Deploying to PRODUCTION$(NC)"
	@read -p "Are you sure? (y/N) " -n 1 -r; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		echo ""; \
		echo "$(GREEN)🚀 Deploying to production...$(NC)"; \
		cp -r kubernetes/backstage gitops/apps/platform-tools/; \
		cd gitops && \
		git add . && \
		git commit -m "chore: deploy backstage $(IMAGE_TAG) - $(BUILD_DATE)" && \
		git push; \
		flux reconcile kustomization platform-tools --with-source; \
		echo "$(GREEN)✓ Deployment triggered$(NC)"; \
	fi

# ==========================================
# Audit & Security
# ==========================================
.PHONY: audit-logs
audit-logs: ## View Kubernetes audit logs
	@docker compose logs backstage | grep "k8s_api_call" | jq '.'

.PHONY: security-scan
security-scan: ## Run security scans
	@echo "$(GREEN)🔒 Running security scans...$(NC)"
	@trivy image $(FULL_IMAGE)
	@yarn audit

.PHONY: dependency-check
dependency-check: ## Check for outdated dependencies
	@yarn outdated

# ==========================================
# Utilities
# ==========================================
.PHONY: zitadel-ui
zitadel-ui: ## Open ZITADEL console
	@open http://localhost:8080 2>/dev/null || xdg-open http://localhost:8080 2>/dev/null || echo "Open http://localhost:8080"

.PHONY: backstage-ui
backstage-ui: ## Open Backstage UI
	@open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || echo "Open http://localhost:3000"

.PHONY: victoriametrics-ui
victoriametrics-ui: ## Open VictoriaMetrics UI
	@open http://localhost:8428 2>/dev/null || xdg-open http://localhost:8428 2>/dev/null || echo "Open http://localhost:8428"

.PHONY: docs-serve
docs-serve: ## Serve TechDocs locally
	@docker compose up -d backstage
	@yarn --cwd packages/app backstage-cli docs:serve

.PHONY: catalog-validate
catalog-validate: ## Validate catalog entities
	@yarn backstage-cli catalog:validate

.PHONY: vm-logs
vm-logs: ## Query VictoriaLogs for errors
	@curl -G http://localhost:9428/select/logsql/query \
		--data-urlencode 'query={namespace="team-a-prod"} | json | level="error"' \
		--data-urlencode 'start=-1h' \
		--data-urlencode 'end=now' \
		--data-urlencode 'limit=100' | jq '.'

.PHONY: vm-metrics
vm-metrics: ## Query VictoriaMetrics for CPU usage
	@curl -G http://localhost:8428/api/v1/query \
		--data-urlencode 'query=rate(container_cpu_usage_seconds_total{namespace="team-a-prod"}[5m])' | jq '.'

# ==========================================
# CI/CD
# ==========================================
.PHONY: ci
ci: lint type-check test-unit build ## Run CI pipeline locally
	@echo "$(GREEN)✓ CI pipeline passed$(NC)"

.PHONY: version
version: ## Show version information
	@echo "Git SHA:      $(GIT_SHA)"
	@echo "Git Branch:   $(GIT_BRANCH)"
	@echo "Build Date:   $(BUILD_DATE)"
	@echo "Image Tag:    $(IMAGE_TAG)"
	@echo "Full Image:   $(FULL_IMAGE)"

# ==========================================
# Dangerous Operations
# ==========================================
.PHONY: nuke
nuke: ## DANGER: Remove everything including images and volumes
	@echo "$(RED)⚠️⚠️⚠️  NUCLEAR OPTION - This will delete EVERYTHING!$(NC)"
	@read -p "Type 'DESTROY' to continue: " confirm; \
	if [ "$$confirm" = "DESTROY" ]; then \
		docker compose down -v --rmi all --remove-orphans; \
		docker system prune -af --volumes; \
		rm -rf node_modules .zitadel-creds 2>/dev/null || true; \
		echo "$(GREEN)✓ Everything destroyed$(NC)"; \
	else \
		echo "$(YELLOW)Aborted$(NC)"; \
	fi
