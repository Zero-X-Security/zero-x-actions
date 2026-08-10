/**
 * Upload SARIF to GitHub Code Scanning.
 * POST /repos/{owner}/{repo}/code-scanning/sarifs
 */

import { gzipSync } from 'zlib';

export interface UploadSarifParams {
  token: string;
  owner: string;
  repo: string;
  sarifJson: string;
  commitSha: string;
  ref: string;
  apiUrl?: string;
}

export interface UploadSarifResult {
  id?: string;
  url?: string;
  status?: number;
}

function normalizeApiUrl(apiUrl?: string): string {
  return (apiUrl || 'https://api.github.com').replace(/\/+$/, '');
}

export async function uploadSarifToCodeScanning(
  params: UploadSarifParams,
): Promise<UploadSarifResult> {
  const apiUrl = normalizeApiUrl(params.apiUrl);
  const compressed = gzipSync(Buffer.from(params.sarifJson, 'utf8'));
  const sarifBase64 = compressed.toString('base64');

  const url = `${apiUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/code-scanning/sarifs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      commit_sha: params.commitSha,
      ref: params.ref,
      sarif: sarifBase64,
      tool_name: 'Zero-X Security Scan',
    }),
  });

  const bodyText = await res.text();
  let body: { id?: string | number; url?: string; message?: string } = {};
  try {
    body = bodyText ? (JSON.parse(bodyText) as typeof body) : {};
  } catch {
    body = { message: bodyText };
  }

  if (!res.ok) {
    const hint =
      res.status === 403 || res.status === 404
        ? ' Ensure the workflow has permissions.security-events: write and Code scanning is enabled for this repository.'
        : '';
    throw new Error(
      `GitHub Code Scanning upload failed (${res.status}): ${body.message || bodyText || res.statusText}.${hint}`,
    );
  }

  return {
    id: body.id !== undefined ? String(body.id) : undefined,
    url: body.url,
    status: res.status,
  };
}

export function parseOwnerRepo(
  repository?: string,
): { owner: string; repo: string } | undefined {
  if (!repository) return undefined;
  const [owner, repo] = repository.split('/');
  if (!owner || !repo) return undefined;
  return { owner, repo };
}

export function resolveGitRef(ref?: string, branchName?: string): string {
  if (ref && (ref.startsWith('refs/') || ref.startsWith('refs/heads/'))) {
    return ref;
  }
  if (branchName) {
    return `refs/heads/${branchName}`;
  }
  return ref || 'refs/heads/main';
}
