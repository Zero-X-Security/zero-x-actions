# Zero-X Security Scan – Architecture Overview

## High-level design

The repository implements a GitHub Action that triggers security scans on Zero-X Cloud from GitHub Actions workflows. It is a **Node.js / TypeScript** project that compiles to JavaScript and is executed by the GitHub Actions runner.

At a high level:

- A workflow in a consumer repository uses `zero-x-security/zero-x-actions`.
- The action reads configuration (Zero-X URL, API key, scanners, repository metadata).
- It **pre-checks** that the repository exists in Zero-X (Datasources), then starts a scan and polls until completion.
- It exposes the scan result URL and outcome as action outputs.

## Code structure

- `action.yml`  
  Declares the GitHub Action: inputs (Zero-X API key, URL, scanners, provider type, metadata) and outputs (`scanResultUrl`, `outcome`), plus runtime (`node20`, `dist/index.js`).

- `src/index.ts`  
  Thin entry point that calls the main runner and handles top-level errors.

- `src/main.ts`  
  Core orchestration:
  - Reads inputs via `@actions/core` (API key, URL, scanners, provider type, branch/repo metadata).
  - Builds a client using `createZeroXClient` from `api.ts`.
  - Pre-checks repo availability; fails early with a setup note if missing.
  - Starts a scan and periodically polls each scan report.
  - Interprets the scan result, sets outputs (`scanResultUrl`, `outcome`), and fails the action on error.

- `src/api.ts`  
  Zero-X tenant API client (public OpenAPI):
  - Auth via `api-key` header.
  - `findRepoDatasource(...)` – `GET /tenant/datasource/datasource-list` + `GET /tenant/datasource/datasource-details/{id}`.
  - `startScan(...)` – `POST /tenant/scan/execution`.
  - `getScanStatus(scanId)` – `GET /tenant/scan/{scanId}/report`.

- `dist/*.js`  
  Compiled JavaScript output (`index.js`, `main.js`, `api.js`) produced by TypeScript. The GitHub Action runtime executes `dist/index.js`.

## Runtime behavior

When the action runs in a workflow:

1. GitHub Actions runner executes `node dist/index.js`.
2. The code reads required inputs:
   - `zerox-api-key` and `zerox-url` must be provided (typically from GitHub secrets).
   - Optional inputs (scanners, provider type, branch name, repo metadata) default from the GitHub context if not provided.
3. **Pre-check:** looks up the repository in Zero-X datasources. If not found, sets `outcome=failure` and fails with a note to add the repo under Datasources → GitHub.
4. A scan is started on Zero-X Cloud (`/tenant/scan/execution`), and the action polls each scan report until:
   - All scanners complete successfully (sets `outcome=success` and `scanResultUrl`).
   - Any scanner fails (sets `outcome=failure`, sets `scanResultUrl` if available, marks the action as failed).
   - A timeout or unexpected error occurs (marks the action as failed and surfaces the error message).

This design keeps the business logic isolated in `main.ts` and `api.ts` while the surrounding CI workflows and configuration handle distribution and validation.
