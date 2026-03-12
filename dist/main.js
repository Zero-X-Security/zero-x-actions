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
function getRunUrl() {
    const server = process.env.GITHUB_SERVER_URL;
    const repo = process.env.GITHUB_REPOSITORY;
    const runId = process.env.GITHUB_RUN_ID;
    if (server && repo && runId) {
        return `${server}/${repo}/actions/runs/${runId}`;
    }
    return undefined;
}
async function run() {
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
    const client = (0, api_1.createZeroXClient)(baseUrl, apiKey);
    let scanId;
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
    }
    catch (err) {
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
        }
        catch (err) {
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
