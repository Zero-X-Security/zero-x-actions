"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const core = __importStar(require("@actions/core"));
const api_1 = require("./api");
const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes
function parseScanners(raw) {
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
function repoUnavailableMessage(repoName, baseUrl) {
    const platform = baseUrl.replace(/\/+$/, '');
    return [
        `Repository '${repoName}' is not available in Zero-X.`,
        '',
        'Note: Add/connect this repository in Zero-X Cloud (Datasources → GitHub), then re-run the workflow.',
        `Platform: ${platform}`,
    ].join('\n');
}
async function run() {
    const apiKey = core.getInput('zerox-api-key', { required: true });
    const baseUrl = core.getInput('zerox-url', { required: true });
    const scannersInput = core.getInput('scanners') || 'vulns,iac,sast,malware,sbom';
    const scanners = parseScanners(scannersInput);
    const providerType = core.getInput('provider-type') || 'github';
    const branchName = core.getInput('branch-name') || process.env.GITHUB_REF_NAME;
    const repoName = core.getInput('repo-name') || process.env.GITHUB_REPOSITORY;
    if (!repoName) {
        core.setOutput('outcome', 'failure');
        core.setFailed('Repository name is required (set repo-name or run in GitHub Actions so GITHUB_REPOSITORY is available).');
        return;
    }
    const client = (0, api_1.createZeroXClient)(baseUrl, apiKey);
    const baseUrlNormalized = baseUrl.replace(/\/+$/, '');
    let matched;
    try {
        matched = await client.findRepoDatasource(repoName, providerType);
    }
    catch (err) {
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
    core.info(`Repository found in Zero-X: ${matched.name} (${matched.datasourceId})`);
    let scanIds;
    try {
        const startRes = await client.startScan({
            providerType: matched.providerType || providerType,
            datasourceName: matched.name,
            scanners,
            branchName,
        });
        scanIds = startRes.scanIds;
        core.info(`Scan started: ${scanIds.join(', ')}`);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        core.setOutput('outcome', 'failure');
        core.setFailed(message);
        return;
    }
    const startedAt = Date.now();
    const pending = new Set(scanIds);
    const failedIds = [];
    let primaryScanId = scanIds[0];
    while (Date.now() - startedAt < MAX_WAIT_MS && pending.size > 0) {
        for (const scanId of [...pending]) {
            let statusRes;
            try {
                statusRes = await client.getScanStatus(scanId);
            }
            catch (err) {
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
            core.info(`Scan ${scanId} status: ${statusRes.status}. Waiting ${POLL_INTERVAL_MS / 1000}s...`);
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
        core.setFailed(`Scan failed (${failedIds.length}/${scanIds.length} scanner(s)): ${failedIds.join(', ')}`);
        return;
    }
    core.setOutput('scanResultUrl', resultUrl);
    core.setOutput('outcome', 'success');
    core.info(`Scan completed. Results: ${resultUrl}`);
}
