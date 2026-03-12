import * as core from '@actions/core';
import { createZeroXClient } from './api';

const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes

function getRunUrl(): string | undefined {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (server && repo && runId) {
    return `${server}/${repo}/actions/runs/${runId}`;
  }
  return undefined;
}

export async function run(): Promise<void> {
  const apiKey = core.getInput('zerox-api-key', { required: true });
  const baseUrl = core.getInput('zerox-url', { required: true });
  const scanners = core.getInput('scanners') || 'vulns,iac,sast,malware,sbom';
  const branchName = core.getInput('branch-name') || process.env.GITHUB_REF_NAME;
  const commitSha = core.getInput('commit-sha') || process.env.GITHUB_SHA;
  const repoName = core.getInput('repo-name') || process.env.GITHUB_REPOSITORY;
  const repoOwner = core.getInput('repo-owner') || process.env.GITHUB_REPOSITORY_OWNER;
  const repoUrl = core.getInput('repo-url') || (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
    : undefined);
  const runUrl = core.getInput('run-url') || getRunUrl();

  const client = createZeroXClient(baseUrl, apiKey);

  let scanId: string;
  try {
    const startRes = await client.startScan({
      scanners,
      branchName,
      commitSha,
      repoName,
      repoOwner,
      repoUrl,
      runUrl,
    });
    scanId = startRes.scanId;
    core.info(`Scan started: ${scanId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setFailed(message);
    return;
  }

  const startedAt = Date.now();
  const baseUrlNormalized = baseUrl.replace(/\/+$/, '');

  while (Date.now() - startedAt < MAX_WAIT_MS) {
    let statusRes;
    try {
      statusRes = await client.getScanStatus(scanId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      core.setFailed(message);
      return;
    }

    if (statusRes.status === 'completed') {
      const resultUrl = statusRes.resultUrl ?? `${baseUrlNormalized}/scans/${scanId}`;
      core.setOutput('scanResultUrl', resultUrl);
      core.setOutput('outcome', 'success');
      core.info(`Scan completed. Results: ${resultUrl}`);
      return;
    }

    if (statusRes.status === 'failed') {
      const resultUrl = statusRes.resultUrl ?? `${baseUrlNormalized}/scans/${scanId}`;
      if (resultUrl) {
        core.setOutput('scanResultUrl', resultUrl);
      }
      core.setOutput('outcome', 'failure');
      core.setFailed('Scan failed');
      return;
    }

    core.info(`Scan status: ${statusRes.status}. Waiting ${POLL_INTERVAL_MS / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  core.setOutput('outcome', 'timeout');
  core.setFailed('Scan did not complete within the maximum wait time');
}
