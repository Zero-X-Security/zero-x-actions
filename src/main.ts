import * as core from '@actions/core';
import { createZeroXClient } from './api';

const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes

function parseScanners(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function repoUnavailableMessage(repoName: string, baseUrl: string): string {
  const platform = baseUrl.replace(/\/+$/, '');
  return [
    `Repository '${repoName}' is not available in Zero-X.`,
    '',
    'Note: Add/connect this repository in Zero-X Cloud (Datasources → GitHub), then re-run the workflow.',
    `Platform: ${platform}`,
  ].join('\n');
}

export async function run(): Promise<void> {
  const apiKey = core.getInput('zerox-api-key', { required: true });
  const baseUrl = core.getInput('zerox-url', { required: true });
  const scannersInput =
    core.getInput('scanners') || 'vulns,iac,sast,malware,sbom';
  const scanners = parseScanners(scannersInput);
  const providerType = core.getInput('provider-type') || 'github';
  const branchName =
    core.getInput('branch-name') || process.env.GITHUB_REF_NAME;
  const repoName = core.getInput('repo-name') || process.env.GITHUB_REPOSITORY;

  if (!repoName) {
    core.setOutput('outcome', 'failure');
    core.setFailed(
      'Repository name is required (set repo-name or run in GitHub Actions so GITHUB_REPOSITORY is available).',
    );
    return;
  }

  const client = createZeroXClient(baseUrl, apiKey);
  const baseUrlNormalized = baseUrl.replace(/\/+$/, '');

  let matched;
  try {
    matched = await client.findRepoDatasource(repoName, providerType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setOutput('outcome', 'failure');
    core.setFailed(message);
    return;
  }

  if (!matched) {
    core.setOutput('outcome', 'failure');
    core.setFailed(repoUnavailableMessage(repoName, baseUrlNormalized));
    return;
  }

  core.info(
    `Repository found in Zero-X: ${matched.name} (${matched.datasourceId})`,
  );

  let scanIds: string[];
  try {
    const startRes = await client.startScan({
      providerType: matched.providerType || providerType,
      datasourceName: matched.name,
      scanners,
      branchName,
    });
    scanIds = startRes.scanIds;
    core.info(`Scan started: ${scanIds.join(', ')}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setOutput('outcome', 'failure');
    core.setFailed(message);
    return;
  }

  const startedAt = Date.now();
  const pending = new Set(scanIds);
  const failedIds: string[] = [];
  let primaryScanId = scanIds[0];

  while (Date.now() - startedAt < MAX_WAIT_MS && pending.size > 0) {
    for (const scanId of [...pending]) {
      let statusRes;
      try {
        statusRes = await client.getScanStatus(scanId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        core.setOutput('outcome', 'failure');
        core.setFailed(message);
        return;
      }

      if (statusRes.status === 'completed') {
        pending.delete(scanId);
        primaryScanId = scanId;
        core.info(`Scan ${scanId} completed`);
        continue;
      }

      if (statusRes.status === 'failed') {
        pending.delete(scanId);
        failedIds.push(scanId);
        primaryScanId = scanId;
        core.warning(`Scan ${scanId} failed`);
        continue;
      }

      core.info(
        `Scan ${scanId} status: ${statusRes.status}. Waiting ${POLL_INTERVAL_MS / 1000}s...`,
      );
    }

    if (pending.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  const resultUrl = `${baseUrlNormalized}/scans/${primaryScanId}`;

  if (pending.size > 0) {
    core.setOutput('scanResultUrl', resultUrl);
    core.setOutput('outcome', 'timeout');
    core.setFailed('Scan did not complete within the maximum wait time');
    return;
  }

  if (failedIds.length > 0) {
    core.setOutput('scanResultUrl', resultUrl);
    core.setOutput('outcome', 'failure');
    core.setFailed(
      `Scan failed (${failedIds.length}/${scanIds.length} scanner(s)): ${failedIds.join(', ')}`,
    );
    return;
  }

  core.setOutput('scanResultUrl', resultUrl);
  core.setOutput('outcome', 'success');
  core.info(`Scan completed. Results: ${resultUrl}`);
}
