"use strict";
/**
 * Zero-X Cloud tenant API client.
 * Auth: api-key header. Paths from public OpenAPI (/tenant/v3/api-docs/public).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createZeroXClient = createZeroXClient;
function normalizeBaseUrl(url) {
    return url.replace(/\/+$/, '');
}
function equalsIgnoreCase(a, b) {
    if (!a || !b)
        return false;
    return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}
function parseRepoNames(fullName) {
    const trimmed = fullName.trim();
    const slash = trimmed.lastIndexOf('/');
    const shortName = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
    return { fullName: trimmed, shortName };
}
function normalizeScanStatus(raw) {
    const value = (raw ?? 'pending').toLowerCase();
    if (value === 'completed' || value === 'complete' || value === 'success' || value === 'succeeded') {
        return 'completed';
    }
    if (value === 'failed' || value === 'failure' || value === 'error') {
        return 'failed';
    }
    if (value === 'running' || value === 'in_progress' || value === 'in-progress') {
        return 'running';
    }
    return 'pending';
}
function matchesRepoIdentity(candidateName, fullName, shortName) {
    return (equalsIgnoreCase(candidateName, fullName) ||
        equalsIgnoreCase(candidateName, shortName));
}
function githubRepoMatches(repos, fullName, shortName) {
    if (!repos || repos.length === 0) {
        return false;
    }
    return repos.some((repo) => repo.added === true &&
        (matchesRepoIdentity(repo.fullName, fullName, shortName) ||
            matchesRepoIdentity(repo.name, fullName, shortName)));
}
async function request(baseUrl, apiKey, path, options = {}) {
    const url = `${normalizeBaseUrl(baseUrl)}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey,
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
async function requestData(baseUrl, apiKey, path, options = {}) {
    const envelope = await request(baseUrl, apiKey, path, options);
    if (envelope &&
        typeof envelope === 'object' &&
        'data' in envelope &&
        envelope.data !== undefined) {
        return envelope.data;
    }
    return envelope;
}
function createZeroXClient(baseUrl, apiKey) {
    return {
        async findRepoDatasource(repoFullName, providerType) {
            const { fullName, shortName } = parseRepoNames(repoFullName);
            if (!fullName) {
                return null;
            }
            const query = new URLSearchParams();
            query.set('keyword', shortName || fullName);
            if (providerType) {
                query.set('provideType', providerType);
            }
            const list = await requestData(baseUrl, apiKey, `/tenant/datasource/datasource-list?${query.toString()}`, { method: 'GET' });
            const candidates = (Array.isArray(list) ? list : []).filter((ds) => matchesRepoIdentity(ds.name, fullName, shortName));
            // Fall back to all returned items when keyword search is loose / name layout differs
            const toInspect = candidates.length > 0 ? candidates : Array.isArray(list) ? list : [];
            for (const ds of toInspect) {
                const datasourceId = ds.datasourceId;
                if (!datasourceId)
                    continue;
                let details;
                try {
                    details = await requestData(baseUrl, apiKey, `/tenant/datasource/datasource-details/${encodeURIComponent(datasourceId)}`, { method: 'GET' });
                }
                catch {
                    // If details fail but name already matched, accept datasource-name match.
                    if (matchesRepoIdentity(ds.name, fullName, shortName)) {
                        return {
                            datasourceId,
                            name: ds.name ?? fullName,
                            providerType: ds.type ?? providerType,
                        };
                    }
                    continue;
                }
                const githubRepos = details?.githubRepositories;
                if (githubRepos && githubRepos.length > 0) {
                    if (githubRepoMatches(githubRepos, fullName, shortName)) {
                        return {
                            datasourceId,
                            name: details?.name ?? ds.name ?? fullName,
                            providerType: details?.provider ?? ds.type ?? providerType,
                        };
                    }
                    continue;
                }
                // No githubRepositories list: accept datasource-name match alone
                if (matchesRepoIdentity(ds.name, fullName, shortName) ||
                    matchesRepoIdentity(details?.name, fullName, shortName)) {
                    return {
                        datasourceId,
                        name: details?.name ?? ds.name ?? fullName,
                        providerType: details?.provider ?? ds.type ?? providerType,
                    };
                }
            }
            return null;
        },
        async startScan(params) {
            const body = {
                providerType: params.providerType,
                datasourceName: params.datasourceName,
                scanners: params.scanners,
                branchName: params.branchName,
            };
            const data = await requestData(baseUrl, apiKey, '/tenant/scan/execution', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const results = Array.isArray(data?.results) ? data.results : [];
            const scanIds = results
                .filter((r) => r.success && r.scanId)
                .map((r) => String(r.scanId));
            if (scanIds.length === 0) {
                const failed = results
                    .filter((r) => !r.success)
                    .map((r) => r.message || r.scanner || 'unknown')
                    .join('; ');
                throw new Error(failed
                    ? `Start scan failed: ${failed}`
                    : 'Start scan response missing scanId');
            }
            return {
                datasourceId: data?.datasourceId,
                datasourceName: data?.datasourceName,
                providerType: data?.providerType,
                results,
                scanIds,
            };
        },
        async getScanStatus(scanId) {
            const report = await requestData(baseUrl, apiKey, `/tenant/scan/${encodeURIComponent(scanId)}/report`, { method: 'GET' });
            return {
                status: normalizeScanStatus(report?.status),
                scanId: report?.scanId ?? scanId,
            };
        },
    };
}
