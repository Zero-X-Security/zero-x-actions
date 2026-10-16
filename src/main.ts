import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import {
  createZeroXClient,
  type SecurityFindingListItem,
  type MatchedDatasource,
} from './api';
import {
  parseOwnerRepo,
  resolveGitRef,
  uploadSarifToCodeScanning,
} from './github';
import { buildSarif, type FindingForSarif } from './sarif';

const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes
const FINDINGS_PAGE_SIZE = 100;
const MAX_FINDING_DETAILS = 500;
const SARIF_FILENAME = 'zerox-results.sarif';
const HISTORY_PAGE_SIZE = 10;

function parseScanners(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBool(raw: string, defaultValue: boolean): boolean {
  if (!raw) return defaultValue;
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(value)) return true;
  if (['false', '0', 'no', 'n'].includes(value)) return false;
  return defaultValue;
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

function describeCount(n?: number): string {
  return `${n ?? 0} finding${n === 1 ? '' : 's'}`;
}

/**
 * Log this run's scan reports and the datasource's recent scan history.
 * Best effort: failures only produce warnings.
 */
async function logScanHistory(
  client: ReturnType<typeof createZeroXClient>,
  matched: MatchedDatasource,
  scanResultIds: string[],
): Promise<number> {
  let reportedFindings = 0;
  core.info('');
  core.info('Scan results for this run:');
  for (const id of scanResultIds) {
    try {
      const report = await client.getScanReport(id);
      reportedFindings += report.totalFindings ?? 0;
      const summary = report.detailedSummary;
      const delta = summary
        ? ` (new: ${(summary.newVulnerabilities ?? 0) + (summary.newCspmFindings ?? 0)}, resolved: ${(summary.resolvedVulnerabilities ?? 0) + (summary.resolvedCspmFindings ?? 0)})`
        : '';
      core.info(
        `  ${report.type ?? 'scan'} | ${report.status ?? 'unknown'} | ${describeCount(report.totalFindings)}${delta} | ${report.duration ?? '-'} | ${id}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      core.warning(`Could not load report for scan ${id}: ${message}`);
    }
  }

  try {
    const history = await client.listScanHistory({
      dataSourceId: matched.datasourceId,
      pageSize: HISTORY_PAGE_SIZE,
    });
    core.info('');
    core.info(`Scan history for ${matched.name} (latest ${history.length}):`);
    if (history.length === 0) {
      core.info('  (no previous scans)');
    }
    for (const item of history) {
      const current = item.id && scanResultIds.includes(item.id) ? '  <- this run' : '';
      core.info(
        `  ${item.date ?? '-'} | ${item.type ?? item.name ?? 'scan'} | ${item.status ?? 'unknown'} | ${describeCount(item.findings)} | ${item.duration ?? '-'}${current}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.warning(`Could not load scan history: ${message}`);
  }
  core.info('');
  return reportedFindings;
}

async function collectFindings(
  client: ReturnType<typeof createZeroXClient>,
  matched: MatchedDatasource,
  repoName: string,
): Promise<FindingForSarif[]> {
  const listItems: SecurityFindingListItem[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const pageResult = await client.listSecurityFindings({
      repository: repoName,
      datasourceName: matched.name,
      pageNumber: page,
      pageSize: FINDINGS_PAGE_SIZE,
    });
    listItems.push(...pageResult.findings);
    totalPages = Math.max(1, pageResult.totalPages);
    page += 1;
  } while (page <= totalPages && listItems.length < MAX_FINDING_DETAILS);

  if (listItems.length === 0) {
    // Retry with short name only (some tenants store repo without owner)
    const shortName = repoName.includes('/')
      ? repoName.split('/').pop()!
      : repoName;
    if (shortName !== repoName) {
      const pageResult = await client.listSecurityFindings({
        repository: shortName,
        datasourceName: matched.name,
        pageNumber: 1,
        pageSize: FINDINGS_PAGE_SIZE,
      });
      listItems.push(...pageResult.findings);
    }
  }

  const capped = listItems.slice(0, MAX_FINDING_DETAILS);
  if (listItems.length > MAX_FINDING_DETAILS) {
    core.warning(
      `Truncating finding details to ${MAX_FINDING_DETAILS} of ${listItems.length} for SARIF export.`,
    );
  }

  const enriched: FindingForSarif[] = [];
  for (const item of capped) {
    const findingId = item.findingId;
    if (!findingId) continue;

    let details;
    try {
      details = await client.getSecurityFindingDetails(
        findingId,
        item.category,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      core.warning(
        `Could not load details for finding ${findingId}: ${message}`,
      );
    }

    enriched.push({ findingId, list: item, details });
  }

  return enriched;
}

async function publishFindingsToGitHub(params: {
  client: ReturnType<typeof createZeroXClient>;
  matched: MatchedDatasource;
  repoName: string;
  baseUrlNormalized: string;
  uploadToGithub: boolean;
  githubToken?: string;
  branchName?: string;
  reportedFindings: number;
}): Promise<void> {
  let findings: FindingForSarif[] = [];
  try {
    findings = await collectFindings(
      params.client,
      params.matched,
      params.repoName,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.warning(`Failed to fetch Zero-X findings for SARIF: ${message}`);
    return;
  }

  if (findings.length === 0) {
    // Nothing to export; the scan history above already shows the results.
    if (params.reportedFindings > 0) {
      core.warning(
        `Scan reports show ${params.reportedFindings} finding(s) but the findings list returned none; nothing was exported to GitHub Code Scanning.`,
      );
    }
    return;
  }

  core.info(`Fetched ${findings.length} Zero-X finding(s) for SARIF export`);

  const sarif = buildSarif(findings, {
    informationUri: params.baseUrlNormalized,
  });
  const sarifJson = JSON.stringify(sarif, null, 2);

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const sarifPath = path.join(workspace, SARIF_FILENAME);
  fs.writeFileSync(sarifPath, sarifJson, 'utf8');
  core.setOutput('sarifPath', sarifPath);
  core.info(`Wrote SARIF: ${sarifPath}`);

  if (!params.uploadToGithub) {
    core.info('Skipping GitHub Code Scanning upload (upload-to-github=false)');
    return;
  }

  const token = params.githubToken || process.env.GITHUB_TOKEN;
  if (!token) {
    core.setOutput('outcome', 'failure');
    core.setFailed(
      'upload-to-github is true but no github-token / GITHUB_TOKEN was provided. Add permissions.security-events: write and pass github-token: ${{ secrets.GITHUB_TOKEN }}.',
    );
    return;
  }

  const ownerRepo =
    parseOwnerRepo(params.repoName) ||
    parseOwnerRepo(process.env.GITHUB_REPOSITORY);
  if (!ownerRepo) {
    core.setOutput('outcome', 'failure');
    core.setFailed(
      'Cannot determine GitHub owner/repo for Code Scanning upload.',
    );
    return;
  }

  const commitSha =
    core.getInput('commit-sha') || process.env.GITHUB_SHA || '';
  if (!commitSha) {
    core.setOutput('outcome', 'failure');
    core.setFailed(
      'Cannot upload SARIF without commit SHA (set commit-sha or GITHUB_SHA).',
    );
    return;
  }

  const ref = resolveGitRef(process.env.GITHUB_REF, params.branchName);

  try {
    const upload = await uploadSarifToCodeScanning({
      token,
      owner: ownerRepo.owner,
      repo: ownerRepo.repo,
      sarifJson,
      commitSha,
      ref,
      apiUrl: process.env.GITHUB_API_URL,
    });
    core.info(
      `Uploaded SARIF to GitHub Code Scanning${upload.id ? ` (id: ${upload.id})` : ''}. Findings appear under Security → Code scanning.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setOutput('outcome', 'failure');
    core.setFailed(message);
  }
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
  const uploadToGithub = parseBool(core.getInput('upload-to-github'), true);
  const githubToken =
    core.getInput('github-token') || process.env.GITHUB_TOKEN;

  if (!repoName) {
    core.setOutput('outcome', 'failure');
    core.setFailed(
      'Repository name is required (set repo-name or run in GitHub Actions so GITHUB_REPOSITORY is available).',
    );
    return;
  }

  const client = createZeroXClient(baseUrl, apiKey);
  const baseUrlNormalized = baseUrl.replace(/\/+$/, '');

  let matched: MatchedDatasource | null;
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

  let jobIds: string[];
  try {
    const startRes = await client.startScan({
      providerType: matched.providerType || providerType,
      datasourceName: matched.name,
      scanners,
      branchName,
    });
    jobIds = startRes.jobIds;
    core.info(`Scan queued (job ids): ${jobIds.join(', ')}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    core.setOutput('outcome', 'failure');
    core.setFailed(message);
    return;
  }

  const startedAt = Date.now();
  const pending = new Set(jobIds);
  const failedIds: string[] = [];
  const scanResultIds: string[] = [];
  let primaryScanId = jobIds[0];

  while (Date.now() - startedAt < MAX_WAIT_MS && pending.size > 0) {
    for (const jobId of [...pending]) {
      let statusRes;
      try {
        statusRes = await client.getScanStatus(jobId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        core.setOutput('outcome', 'failure');
        core.setFailed(message);
        return;
      }

      if (statusRes.status === 'completed') {
        pending.delete(jobId);
        // Report/results links use scan_results.id, not the job id.
        primaryScanId = statusRes.scanResultId || jobId;
        if (statusRes.scanResultId) scanResultIds.push(statusRes.scanResultId);
        core.info(`Scan job ${jobId} completed`);
        continue;
      }

      if (statusRes.status === 'failed') {
        pending.delete(jobId);
        failedIds.push(jobId);
        primaryScanId = statusRes.scanResultId || jobId;
        core.warning(
          `Scan job ${jobId} failed${statusRes.errorCode ? ` (${statusRes.errorCode})` : ''}`,
        );
        continue;
      }

      core.info(
        `Scan job ${jobId} status: ${statusRes.status}. Waiting ${POLL_INTERVAL_MS / 1000}s...`,
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
      `Scan failed (${failedIds.length}/${jobIds.length} scanner(s)): ${failedIds.join(', ')}`,
    );
    return;
  }

  core.setOutput('scanResultUrl', resultUrl);
  core.setOutput('outcome', 'success');
  core.info(`Scan completed. Results: ${resultUrl}`);

  const reportedFindings = await logScanHistory(
    client,
    matched,
    scanResultIds,
  );

  await publishFindingsToGitHub({
    client,
    matched,
    repoName,
    baseUrlNormalized,
    uploadToGithub,
    githubToken,
    branchName,
    reportedFindings,
  });
}
