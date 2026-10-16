# Zero-X Security Scan – Architecture Overview

## High-level design

The repository implements a GitHub Action that triggers security scans on Zero-X Cloud from GitHub Actions workflows. It is a **Node.js / TypeScript** project that compiles to JavaScript and is executed by the GitHub Actions runner.

At a high level:

- A workflow in a consumer repository uses `zero-x-security/zero-x-actions`.
- The action reads configuration (Zero-X URL, API key, scanners, repository metadata).
- It **pre-checks** that the repository exists in Zero-X (Datasources), then queues scans and polls the scan jobs until they finish.
- After success, it fetches findings, converts them to **SARIF 2.1.0**, and uploads to **GitHub Code Scanning** (Security tab).
- It exposes the scan result URL, outcome, and SARIF path as action outputs.

## Code structure

- `action.yml`  
  Declares the GitHub Action: inputs (Zero-X API key, URL, scanners, provider type, upload flags, metadata) and outputs (`scanResultUrl`, `outcome`, `sarifPath`), plus runtime (`node20`, `dist/index.js`).

- `src/index.ts`  
  Thin entry point that calls the main runner and handles top-level errors.

- `src/main.ts`  
  Core orchestration:
  - Reads inputs via `@actions/core`.
  - Builds a client using `createZeroXClient` from `api.ts`.
  - Pre-checks repo availability; fails early with a setup note if missing.
  - Queues a scan per scanner and periodically polls each scan job (`jobId`).
  - On success: fetches findings, writes `zerox-results.sarif`, uploads to Code Scanning when enabled.

- `src/api.ts`  
  Zero-X tenant API client (public OpenAPI):
  - Auth via `api-key` header.
  - `findRepoDatasource(...)` – looks up the repository via `GET /tenant/datasource/integration-list` (`keyword`, `providerType`).
  - `startScan(...)` – `POST /scan/execution`; returns one `jobId` per scanner (`scanId` is null while queued).
  - `getScanStatus(jobId)` – `GET /scan-jobs/{jobId}`; returns `status` (`QUEUED` → `DISPATCHED` → `RUNNING` → `COMPLETED` / `FAILED` / `RETRY`), `scanResultId`, `reportReady`, `errorCode`.
  - `listSecurityFindings(...)` / `getSecurityFindingDetails(findingId)`.

- `src/sarif.ts`  
  Maps Zero-X findings to SARIF 2.1.0 (rules, severity levels, file/line locations).

- `src/github.ts`  
  Uploads gzip+base64 SARIF to `POST /repos/{owner}/{repo}/code-scanning/sarifs`.

- `dist/*.js`  
  ncc-bundled output. The GitHub Action runtime executes the single file `dist/index.js`.

## Runtime behavior

When the action runs in a workflow:

1. GitHub Actions runner executes `node dist/index.js`.
2. The code reads required inputs (`zerox-api-key`, `zerox-url`) and optional metadata.
3. **Pre-check:** looks up the repository in Zero-X datasources. If not found, fails with a setup note.
4. Scans are queued (`POST /scan/execution` → `jobId` per scanner) and each job is polled (`GET /scan-jobs/{jobId}`) until it is `COMPLETED` or `FAILED` (`RETRY` keeps polling), or the 30-minute timeout is hit. On completion the job's `scanResultId` (`scan_results.id`) is used for the result link; job IDs must not be passed to `/scan/{id}/report`.
5. On success, the log shows this run's per-scanner report and the datasource's recent scan history (`/scan/{scanResultId}/report`, `/scan/scan-history`). Then:
   - Findings are loaded from `/tenant/security-findings/...`.
   - SARIF is written to the workspace (`zerox-results.sarif`).
   - If `upload-to-github` is true, SARIF is uploaded to GitHub Code Scanning (requires `security-events: write`).
6. Outputs: `scanResultUrl`, `outcome`, `sarifPath`.

Findings appear under the consumer repo **Security → Code scanning** (Security and quality). They do **not** appear under Dependabot vulnerability alerts.

Current published version for consumers: **`v1.0.4`**.

This design keeps the business logic isolated in `main.ts`, `api.ts`, `sarif.ts`, and `github.ts` while CI workflows handle distribution and validation.
