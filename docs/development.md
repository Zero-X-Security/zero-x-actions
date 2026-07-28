# Development & Testing Guide

This document explains how to set up the project locally, run builds, lint/format the code, and exercise the CI behavior.

## 1. Local setup

Clone the repository and install dependencies:

```bash
npm ci
```

> Use `npm ci` instead of `npm install` to get a clean, reproducible install based on `package-lock.json`.

## 2. Build the action

Compile the TypeScript sources to JavaScript in `dist/`:

```bash
npm run build
```

This runs `tsc` using `tsconfig.json` with:

- `rootDir: src`
- `outDir: dist`

The GitHub Action runtime uses `dist/index.js` as declared in `action.yml`.

## 3. Lint and format

Run ESLint on the TypeScript sources:

```bash
npm run lint
```

Format the code with Prettier:

```bash
npm run format
```

These commands only affect the source under `src/` and do not change the compiled output directly.

## 4. Running and testing the action

Because this repository is a GitHub Action, the most realistic way to test it is within GitHub Actions itself.

### 4.1 Test via pull request (recommended)

When you open or update a pull request on GitHub:

- The **Publish** workflow:
  - Runs `npm ci` and `npm run build`.
  - Verifies `dist/` is up to date by running `git diff --ignore-space-at-eol dist/` and failing if there are changes.
- The **Test action** workflow:
  - Checks out the repo and runs `uses: ./` with:
    - `zerox-api-key: ${{ secrets.ZEROX_API_KEY }}`
    - `zerox-url: ${{ secrets.ZEROX_URL }}`
- The **Security (zizmor)** workflow:
  - Scans `.github/workflows` for security issues.

To make these PR checks pass, configure the following repository secrets in GitHub:

- `ZEROX_API_KEY` – Zero-X platform API key.
- `ZEROX_URL` – Zero-X base URL (e.g. `https://app.zero-x.cloud`).

Also create a GitHub Environment named `zerox-ci` (**Settings → Environments**) used by the Test action workflow. Prefer storing `ZEROX_*` as Environment secrets on `zerox-ci`.

### 4.2 Testing in a consumer repository

To exercise the action in a real pipeline, in another repository:

1. Publish a version of this action (see the README section on publishing).
2. Reference it from a workflow:

   ```yaml
   jobs:
     zerox-scan:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4

         - name: Zero-X Security Scan
           id: zerox
           uses: zero-x-security/zero-x-actions@v1
           with:
             zerox-api-key: ${{ secrets.ZEROX_API_KEY }}
             zerox-url: ${{ secrets.ZEROX_URL }}
   ```

3. Inspect the resulting `scanResultUrl` and `outcome` outputs in the job logs.

### 4.3 Optional: local workflow runner

If you want to approximate GitHub Actions behavior locally, you can use a tool like [`act`](https://github.com/nektos/act) and run the workflows defined under `.github/workflows/`. This can mimic:

- The build and dist verification in `publish.yml`.
- The `uses: ./` execution in `test.yml`.

Note that you will need to provide local secrets (`ZEROX_API_KEY`, `ZEROX_URL`) when running workflows with `act`.

