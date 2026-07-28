# Publishing the Zero-X GitHub Action

Step-by-step guide to publish **zero-x-actions** as a reusable GitHub Action (and optionally list it on the [GitHub Marketplace](https://github.com/marketplace)).

---

## What you will publish

| Item | Value in this repo |
|------|--------------------|
| Action metadata | Root [`action.yml`](../action.yml) |
| Runtime entry | `dist/index.js` (Node 20, **ncc-bundled** with deps) |
| Typical consumer ref | `OWNER/zero-x-actions@v1` or `@v1.0.0` |

Consumers do **not** run `npm install` on this repo. The committed `dist/index.js` must include dependencies (built with `@vercel/ncc`). Shipping plain `tsc` output without `node_modules` causes `Cannot find module '@actions/core'`.

---

## Prerequisites

1. A **GitHub account** with **2FA enabled** (required for Marketplace publishing).
2. Permission to create **Releases** and **tags** on the repository.
3. For Marketplace: the repository must be **public**.
4. Local tooling: Node.js 20+, `npm`, `git`.

---

## Step 1 - Prepare the repository

1. Push your latest code to GitHub (e.g. `main`).
2. Confirm these exist at the **repository root**:
   - `action.yml`
   - `README.md` (Marketplace uses this as the listing description)
   - `dist/` with the **bundled** JavaScript (`index.js` from `npm run build` / ncc)
3. Keep workflows only under `.github/workflows/` (not at repo root).

---

## Step 2 - Build and commit `dist/`

GitHub Actions runners execute the committed `dist/` files. CI also fails if `dist/` is out of date ([`publish.yml`](../.github/workflows/publish.yml)).

```bash
npm ci
npm run build
npm run lint   # optional but recommended
```

If `dist/` changed:

```bash
git add dist/ src/ action.yml README.md docs/ package.json package-lock.json
git commit -m "Prepare release: rebuild dist and docs"
git push origin main
```

Wait for CI (Publish / Test / Security) to pass on `main` before tagging.

---

## Step 3 - Choose a version

Use [semantic versioning](https://semver.org/):

| Tag | Meaning |
|-----|---------|
| `v1.0.0` | Exact release |
| `v1` | Moving major tag (optional; point to latest `v1.x.x`) |

Recommended first release: `v1.0.0`, then also maintain major tag `v1`.

Bump `version` in [`package.json`](../package.json) to match (e.g. `1.0.0`) if you track it there.

---

## Step 4 - Create a Git tag

From a clean `main` (or the release commit):

```bash
git checkout main
git pull origin main

# Annotated tag for the exact version
git tag -a v1.0.0 -m "Release v1.0.0"

# Optional: major version tag for consumers using @v1
git tag -fa v1 -m "Release v1"

git push origin v1.0.0
git push origin v1 --force   # only for moving major tag v1
```

> Prefer creating the release from the GitHub UI (Step 5), which can create the tag for you if it does not exist yet.

---

## Step 5 - Create a GitHub Release

1. Open the repository on GitHub.
2. Go to **Releases** → **Draft a new release**.
3. **Choose a tag**: create or select `v1.0.0` (target: `main`).
4. **Release title**: e.g. `v1.0.0`.
5. **Description**: summarize changes (inputs, pre-check, API alignment, etc.).
6. (Optional Marketplace) Check **Publish this Action to the GitHub Marketplace**:
   - Accept the Marketplace agreement if prompted.
   - Pick a **primary category** (e.g. *Security* or *Continuous integration*).
   - Add a short **Marketplace description** if asked.
7. Click **Publish release**.

Publishing the release triggers the **Publish** workflow (`on: release: types: [published]`), which rebuilds and verifies `dist/`.

---

## Step 6 - Verify the published action

### 6.1 Check the release

- Tag `v1.0.0` appears under **Releases**.
- Release assets / commit include `action.yml` and `dist/`.

### 6.2 Test in another repository (or this one)

```yaml
jobs:
  zerox-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Zero-X Security Scan
        id: zerox
        uses: YOUR_ORG/zero-x-actions@v1.0.0
        # or: uses: YOUR_ORG/zero-x-actions@v1
        with:
          zerox-api-key: ${{ secrets.ZEROX_API_KEY }}
          zerox-url: ${{ secrets.ZEROX_URL }}

      - run: echo "Results: ${{ steps.zerox.outputs.scanResultUrl }}"
```

Replace `YOUR_ORG` with your GitHub user or organization (e.g. `zero-x-security`).

### 6.3 Marketplace listing (if enabled)

- Open [GitHub Marketplace](https://github.com/marketplace) and search for **Zero-X Security Scan**, or open:

  `https://github.com/marketplace/actions/<action-slug>`

- Confirm name, branding (`shield` / `blue` from `action.yml`), and README render correctly.

---

## Step 7 - Publish later versions

For each new release:

1. Merge changes to `main`.
2. Run `npm run build` and commit updated `dist/` if needed.
3. Tag `v1.0.1` (or `v1.1.0` / `v2.0.0` as appropriate).
4. Create a new GitHub Release for that tag.
5. Update the major tag if you use it:

   ```bash
   git tag -fa v1 -m "Update v1 to v1.0.1"
   git push origin v1 --force
   ```

Consumers on `@v1` pick up the latest `v1.x.x` only after you move the `v1` tag.

---

## Checklist (quick)

- [ ] Repo is public (for Marketplace)
- [ ] 2FA enabled on the publisher account
- [ ] `action.yml` at repo root with `name`, `description`, `runs`
- [ ] `dist/` committed and matches `npm run build`
- [ ] CI green on `main`
- [ ] Tag created (`vX.Y.Z`)
- [ ] GitHub Release published
- [ ] (Optional) Marketplace checkbox + category set
- [ ] Smoke-tested `uses: OWNER/zero-x-actions@vX.Y.Z` in a workflow

---

## Common issues

| Problem | Fix |
|---------|-----|
| Marketplace checkbox missing | Repo must be **public**; account needs **2FA**; `action.yml` must be valid at root. |
| Action fails with missing module / old code | Rebuild with `npm run build` (ncc bundle), **commit** `dist/`, then retag / release. |
| `Cannot find module '@actions/core'` | Dist was compiled with `tsc` only. Bundle with ncc so deps are inlined, commit `dist/index.js`, publish a new tag. |
| CI “dist is out of date” | Run `npm run build`, commit `dist/`, push again. |
| Consumer cannot find `@v1` | Create/push major tag `v1`, or tell them to use `@v1.0.0`. |
| Scan fails “repo not available” | Add the consumer repo in Zero-X (**Datasources → GitHub**) before running the action. |

---

## Related docs

- [`README.md`](../README.md) – usage and inputs
- [`docs/development.md`](development.md) – local build / lint
- [`docs/ci-workflows.md`](ci-workflows.md) – Publish / Test / Security workflows
- [`docs/architecture.md`](architecture.md) – how the action works
