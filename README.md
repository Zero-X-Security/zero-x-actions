# Zero-X Security Scan (GitHub Action)

Trigger security scans on [Zero-X Cloud](https://app.zero-x.cloud) from your GitHub Actions workflow. The action starts a scan via the Zero-X API, polls until it completes, and outputs a link to the scan results.

## Prerequisites

1. **Platform API key** – In Zero-X Cloud go to **Settings → API Keys**, create a key (e.g. "GitHub Actions"), and copy it. Store it as a GitHub secret (e.g. `ZEROX_API_KEY`).
2. **Zero-X URL** – Your Zero-X platform base URL (e.g. `https://app.zero-x.cloud`). Store as a secret `ZEROX_URL` or pass as input.

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
| `zerox-api-key` | Yes | - | Platform API key from Zero-X Cloud (Settings → API Keys). |
| `zerox-url` | Yes | - | Zero-X platform base URL (e.g. `https://app.zero-x.cloud`). |
| `scanners` | No | `vulns,iac,sast,malware,sbom` | Comma-separated list: `vulns`, `iac`, `sast`, `malware`, `sbom`. |
| `branch-name` | No | `github.ref_name` | Branch name sent to Zero-X. |
| `commit-sha` | No | `github.sha` | Commit SHA sent to Zero-X. |
| `run-url` | No | Workflow run URL | URL to the GitHub Actions run. |
| `repo-name` | No | `github.repository` | Repository name. |
| `repo-owner` | No | `github.repository_owner` | Repository owner. |
| `repo-url` | No | `github.repository_url`-style | Repository URL. |

### Outputs

| Output | Description |
|--------|-------------|
| `scanResultUrl` | Link to the scan results in Zero-X Cloud. |
| `outcome` | Scan outcome: `success`, `failure`, or `timeout`. |

## Development

```bash
npm install
npm run build
```

The action entry point is `dist/index.js`. Run the build before committing if you track `dist/`, or use a CI workflow to build and publish.

## Publishing to GitHub Marketplace

1. Create a **public** repository with this action (e.g. `zero-x-security/zero-x-actions`).
2. Ensure the repo has a root `action.yml` and no workflow files except under `.github/workflows/` (release/CI only).
3. Create a new **Release** with a semantic version tag (e.g. `v1.0.0`).
4. In the release form, check **Publish this Action to the GitHub Marketplace**.
5. Set category and description; complete the release. Two-factor authentication is required for publishing.

After that, users can reference the action as `zero-x-security/zero-x-actions@v1` or `@v1.0.0`.
