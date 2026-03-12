"use strict";
/**
 * Zero-X Cloud API client (placeholder paths – replace with real API when available).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createZeroXClient = createZeroXClient;
function normalizeBaseUrl(url) {
    return url.replace(/\/+$/, '');
}
async function request(baseUrl, apiKey, path, options = {}) {
    const url = `${normalizeBaseUrl(baseUrl)}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...options.headers,
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Zero-X API error ${res.status}: ${body || res.statusText}`);
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') {
        return {};
    }
    return res.json();
}
function createZeroXClient(baseUrl, apiKey) {
    return {
        async startScan(params) {
            const body = {
                scanners: params.scanners?.split(',').map((s) => s.trim()).filter(Boolean),
                branchName: params.branchName,
                commitSha: params.commitSha,
                repoName: params.repoName,
                repoOwner: params.repoOwner,
                repoUrl: params.repoUrl,
                runUrl: params.runUrl,
            };
            const data = await request(baseUrl, apiKey, '/api/v1/scans', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const scanId = data.scanId ?? data.id;
            if (!scanId) {
                throw new Error('Start scan response missing scanId');
            }
            return { scanId: String(scanId) };
        },
        async getScanStatus(scanId) {
            const data = await request(baseUrl, apiKey, `/api/v1/scans/${encodeURIComponent(scanId)}`, { method: 'GET' });
            const status = (data.status ?? 'pending');
            return {
                status,
                resultUrl: data.resultUrl,
            };
        },
    };
}
