# Zero-X Security Scan (GitHub Action)

Trigger security scans on [Zero-X Cloud](https://app.zero-x.cloud) from your GitHub Actions workflow. The action starts a scan via the Zero-X API, polls until it completes, and outputs a link to the scan results.

For a deeper technical overview, see:

- [Architecture](docs/architecture.md) – internal code and runtime architecture.
- [CI workflows](docs/ci-workflows.md) – CI/CD and GitHub Actions workflows.
- [Development](docs/development.md) – local setup, build, lint, and testing.
- [Publishing](docs/publishing.md) – step-by-step guide to publish the action on GitHub / Marketplace.

## Prerequisites

1. **Platform API key** – In Zero-X Cloud go to **Settings → API Keys**, create a key (e.g. "GitHub Actions"), and copy it. Store it as a GitHub secret (e.g. `ZEROX_API_KEY`). The action sends this value in the `api-key` HTTP header.
2. **Zero-X URL** – Your Zero-X platform base URL (e.g. `https://app.zero-x.cloud` or `https://qa.zero-x.cloud`). Store as a secret `ZEROX_URL` or pass as input.
3. **Repository added in Zero-X** – The GitHub repository must already be connected/added under **Datasources → GitHub** in Zero-X Cloud. The action pre-checks availability and fails with a setup note if the repo is missing.

## Usage

Add a job to your workflow:

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
          # Optional overrides:
          # scanners: 'vulns,iac,sast,malware,sbom'
          # provider-type: github
          # branch-name: ${{ github.ref_name }}
          # commit-sha: ${{ github.sha }}
          # run-url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
          # repo-name: ${{ github.repository }}
          # repo-owner: ${{ github.repository_owner }}
          # repo-url: ${{ github.server_url }}/${{ github.repository }}

      - name: Open scan results
        run: echo "Results: ${{ steps.zerox.outputs.scanResultUrl }}"
```

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `zerox-api-key` | Yes | - | Platform API key from Zero-X Cloud (Settings → API Keys). Sent as `api-key` header. |
| `zerox-url` | Yes | - | Zero-X platform base URL (e.g. `https://app.zero-x.cloud`). |
| `scanners` | No | `vulns,iac,sast,malware,sbom` | Comma-separated list: `vulns`, `iac`, `sast`, `malware`, `sbom`. |
| `provider-type` | No | `github` | Datasource provider type used for pre-check and scan execution. |
| `branch-name` | No | `github.ref_name` | Branch name sent to Zero-X. |
| `commit-sha` | No | `github.sha` | Commit SHA (reserved for metadata; scan API uses branch). |
| `run-url` | No | Workflow run URL | URL to the GitHub Actions run. |
| `repo-name` | No | `github.repository` | Repository full name (`owner/repo`) used for Zero-X availability pre-check. |
| `repo-owner` | No | `github.repository_owner` | Repository owner. |
| `repo-url` | No | `github.repository_url`-style | Repository URL. |

### Outputs

| Output | Description |
|--------|-------------|
| `scanResultUrl` | Link to the scan results in Zero-X Cloud. |
| `outcome` | Scan outcome: `success`, `failure`, or `timeout`. |

## Development – how to start and run the project

From the repository root:

```bash
npm ci
npm run build
```

- `npm ci` installs dependencies in a clean, reproducible way based on `package-lock.json`.
- `npm run build` compiles TypeScript from `src/` to JavaScript in `dist/`.
- The GitHub Action entry point is `dist/index.js` (as declared in `action.yml`).

Optional quality checks:

```bash
npm run lint
npm run format
```

- `npm run lint` runs ESLint on `src/**/*.ts`.
- `npm run format` runs Prettier on `src/**/*.ts`.

See `docs/development.md` for more details.

## Testing – how to test everything

There are two main ways to validate the project:

1. **Via GitHub pull requests (recommended)**  
   When you open a PR on GitHub:
   - `Publish` workflow builds the project and verifies that `dist/` is up to date via `git diff --ignore-space-at-eol dist/`.
   - `Test action` workflow checks out the repo and runs `uses: ./` with `ZEROX_API_KEY` and `ZEROX_URL` secrets.
   - `Security (zizmor)` workflow scans `.github/workflows` for security issues.

   Configure repo secrets (prefer Environment `zerox-ci`):
   - `ZEROX_API_KEY` – Zero-X API key.
   - `ZEROX_URL` – Zero-X base URL.
   - Create Environment **zerox-ci** under Settings → Environments (required by Test action).

2. **In a consumer repository**  
   Publish or reference a version of this action (e.g. `zero-x-security/zero-x-actions@v1`) and use it in a workflow as shown in the Usage section above.

For more details on the CI workflows, see [docs/ci-workflows.md](docs/ci-workflows.md).

## Publishing to GitHub Marketplace

See **[`docs/publishing.md`](docs/publishing.md)** for the full step-by-step guide (build `dist/`, tag, GitHub Release, Marketplace listing, and verification).

Short version:

1. Build and commit `dist/` (`npm ci && npm run build`).
2. Create a release tag (e.g. `v1.0.0`) and publish a **GitHub Release**.
3. Optionally check **Publish this Action to the GitHub Marketplace** (public repo + 2FA required).
4. Consumers use `YOUR_ORG/zero-x-actions@v1` or `@v1.0.0`.
