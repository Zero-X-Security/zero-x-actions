# CI & Workflows – Zero-X Security Scan

This repository uses GitHub Actions workflows to validate the action, enforce build consistency, and secure workflow configuration.

## Workflows overview

### 1. `Publish` workflow – build & dist verification

**File:** `.github/workflows/publish.yml`

```12:41:/home/pranav/Desktop/Data/Projects/nodejs/zero-x-actions/.github/workflows/publish.yml
name: Publish

on:
  release:
    types: [published]
  push:
    branches: [main]
    paths-ignore:
      - '**.md'
      - '.gitignore'
  pull_request:
    branches:
      - '**'

permissions: {}

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Verify dist is up to date
        run: |
          if [ "$(git diff --ignore-space-at-eol dist/ | wc -l)" -gt "0" ]; then
            echo "Detected uncommitted changes in dist/ after build. See diff below:"
            git diff dist/
            exit 1
          fi
```

**Behavior:**

- **Triggers:**
  - `release` of type `published`.
  - `push` to `main` (excluding docs/ignore files).
  - `pull_request` from any branch.
- **Steps:**
  1. Check out the repository.
  2. Set up Node.js 20 with npm caching.
  3. Install dependencies with `npm ci`.
  4. Build with `npm run build` (ncc bundles `src/` + deps into `dist/index.js`).
  5. Run `git diff --ignore-space-at-eol dist/` and **fail if there are changes**.

This enforces that the **committed `dist/` bundle is always in sync** with the TypeScript source and dependencies. If a contributor changes `src/` but forgets to rebuild, CI will fail.

### 2. `Test action` workflow – run the action on PRs

**File:** `.github/workflows/test.yml`

```1:28:/home/pranav/Desktop/Data/Projects/nodejs/zero-x-actions/.github/workflows/test.yml
name: Test action

on:
  pull_request:
    branches:
      - '**'

permissions: {}

jobs:
  test:
    runs-on: ubuntu-latest
    environment: zerox-ci
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - name: Run Zero-X Security Scan action
        uses: ./
        with:
          zerox-api-key: ${{ secrets.ZEROX_API_KEY }}
          zerox-url: ${{ secrets.ZEROX_URL }}
          # Optionally override scanners / metadata here if needed
          # scanners: 'vulns,iac,sast,malware,sbom'
```

**Behavior:**

- **Trigger:** Any `pull_request`.
- **Job:**
  - Runs in the GitHub Environment `zerox-ci` (create it under **Settings → Environments**).
  - Checks out the repo.
  - Runs the repository **as a GitHub Action** (`uses: ./`).
  - Provides `zerox-api-key` and `zerox-url` from secrets (prefer Environment secrets on `zerox-ci`).
- **Purpose:**
  - Validates that the action can run end-to-end with real inputs.
  - Surfaces regressions in scan orchestration before merges.

To make this workflow pass, configure the following (Environment secrets on `zerox-ci`, or repository secrets):

- `ZEROX_API_KEY` – Zero-X platform API key.
- `ZEROX_URL` – Zero-X base URL (e.g. `https://app.zero-x.cloud`).

### 3. `Security (zizmor)` workflow – workflow security checks

**File:** `.github/workflows/secure.yml`

```1:29:/home/pranav/Desktop/Data/Projects/nodejs/zero-x-actions/.github/workflows/secure.yml
# Run zizmor to find and fix security issues in GitHub Actions workflows
# https://docs.zizmor.sh/
name: Security (zizmor)

on:
  push:
    branches: [main]
  pull_request:
    branches: ['**']

permissions: {}

jobs:
  zizmor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - name: Run zizmor
        uses: zizmorcore/zizmor-action@71321a20a9ded102f6e9ce5718a2fcec2c4f70d8 # v0.5.2
        with:
          advanced-security: false
          inputs: .github/workflows
```

**Behavior:**

- Runs on both pushes to `main` and all pull requests.
- Uses the Zizmor action to scan `.github/workflows` for security issues and misconfigurations.

## How to “test everything”

Given this setup, you can validate the project in three layers:

1. **Local build & lint** – ensure TypeScript compiles and code style is clean (see `docs/development.md`).
2. **Pull request CI** – open a PR in GitHub; the following will run:
   - `Publish` (build + dist verification).
   - `Test action` (runs the action with Zero-X secrets).
   - `Security (zizmor)` (checks workflow security).
3. **Consumer workflow** – in a separate repository, use `zero-x-security/zero-x-actions@v1` in a real pipeline to confirm behavior in your own environment.

