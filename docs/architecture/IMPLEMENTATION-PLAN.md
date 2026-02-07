# Implementation Plan - Architecture Refinement & Fixes

This plan addresses the critical issues identified in `ARCHITECTURE_REVIEW.md` to ensure the Backstage AIOps platform is production-ready.

## Proposed Changes

### 1. Resilient LLM Client [NEW]
Create `packages/backend/src/plugins/rca/lib/resilient-llm-client.ts` to implement:
- **Rate Limiting**: Prevent overwhelming AI providers.
- **Circuit Breaker**: Fail fast when the AI service is down or timing out.

### 2. RCA Action Implementation [MODIFY]
Update `gitops-rca-action.ts` to replace placeholders with functional code.
- **`fetchEntity`**: Use `CatalogApi` to retrieve component metadata.
- **`fetchK8sContext`**: Use `kubernetes-client` to fetch real events and pod status.
- **`commitRCAToGit`**: Use `fs` and `child_process` to commit generated reports to the Git repository.
- **Integration**: Use `ResilientLLMClient` for AI analysis steps.

### 3. Audit Logging Refinement [MODIFY]
Ensure `audit-logger.ts` is fully aligned with production requirements.
- Enhance redaction for all sensitive fields.
- Ensure consistent metadata structure for VictoriaLogs ingestion.

### 4. Namespace Policy Refinement [MODIFY]
Verify and polish `k8s-namespace-policy.ts`.
- Ensure environment-to-group mapping handles all valid environments (`prod`, `staging`, `dev`, `test`).
- Strict mode enforcement.

---

## Verification Plan

### Automated Tests
- **RCA Action Mocked Test**: Test `gitops-rca-action.ts` by mocking Kubernetes API responses and verifying the generated report.
- **LLM Resilience Test**: Trigger multiple requests to `ResilientLLMClient` with induced failures to verify circuit breaker opens and resets.

### Manual Verification
1. **ZITADEL Group Sync**: Log in through ZITADEL and verify that the issued Backstage token contains the expected `ent` (membership) claims based on ZITADEL roles.
2. **Namespace Isolation**: Attempt to access a Kubernetes resource in a namespace not owned by the user's group and verify the request is denied with an audit log record.
3. **RCA Execution**: Run the `rca:analyze` template and verify a markdown report is committed to the repository with evidence from VictoriaLogs and k8sgpt.
