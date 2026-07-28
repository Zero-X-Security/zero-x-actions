/**
 * Zero-X Cloud tenant API client.
 * Auth: api-key header. Paths from public OpenAPI (/tenant/v3/api-docs/public).
 */

export interface MatchedDatasource {
  datasourceId: string;
  name: string;
  providerType: string;
}

export interface StartScanParams {
  providerType: string;
  datasourceName: string;
  scanners: string[];
  branchName?: string;
}

export interface ScanExecutionResult {
  scanner?: string;
  resolvedScanner?: string;
  scanId?: string;
  success: boolean;
  message?: string;
}

export interface StartScanResponse {
  datasourceId?: string;
  datasourceName?: string;
  providerType?: string;
  results: ScanExecutionResult[];
  scanIds: string[];
}

export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ScanStatusResponse {
  status: ScanStatus;
  resultUrl?: string;
  scanId?: string;
}

interface ResponseEnvelope<T> {
  data?: T;
  message?: string;
  status?: number;
}

interface DatasourceListItem {
  datasourceId?: string;
  type?: string;
  name?: string;
  isActive?: boolean;
  status?: string;
}

interface GitHubRepositoryInfo {
  id?: string;
  name?: string;
  fullName?: string;
  htmlUrl?: string;
  added?: boolean;
}

interface DatasourceDetails {
  dataSourceId?: string;
  name?: string;
  provider?: string;
  githubRepositories?: GitHubRepositoryInfo[];
}

interface MultiScanExecutionResponse {
  datasourceId?: string;
  datasourceName?: string;
  providerType?: string;
  results?: ScanExecutionResult[];
}

interface ScanReport {
  scanId?: string;
  status?: string;
  target?: string;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function equalsIgnoreCase(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

function parseRepoNames(fullName: string): { fullName: string; shortName: string } {
  const trimmed = fullName.trim();
  const slash = trimmed.lastIndexOf('/');
  const shortName = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return { fullName: trimmed, shortName };
}

function normalizeScanStatus(raw?: string): ScanStatus {
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

function matchesRepoIdentity(
  candidateName: string | undefined,
  fullName: string,
  shortName: string,
): boolean {
  return (
    equalsIgnoreCase(candidateName, fullName) ||
    equalsIgnoreCase(candidateName, shortName)
  );
}

function githubRepoMatches(
  repos: GitHubRepositoryInfo[] | undefined,
  fullName: string,
  shortName: string,
): boolean {
  if (!repos || repos.length === 0) {
    return false;
  }
  return repos.some(
    (repo) =>
      repo.added === true &&
      (matchesRepoIdentity(repo.fullName, fullName, shortName) ||
        matchesRepoIdentity(repo.name, fullName, shortName)),
  );
}

async function request<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
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
    throw new Error(
      `Zero-X API error ${res.status}: ${body || res.statusText}`,
    );
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return {} as T;
  }
  return res.json() as Promise<T>;
}

async function requestData<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const envelope = await request<ResponseEnvelope<T> | T>(
    baseUrl,
    apiKey,
    path,
    options,
  );
  if (
    envelope &&
    typeof envelope === 'object' &&
    'data' in envelope &&
    (envelope as ResponseEnvelope<T>).data !== undefined
  ) {
    return (envelope as ResponseEnvelope<T>).data as T;
  }
  return envelope as T;
}

export function createZeroXClient(baseUrl: string, apiKey: string) {
  return {
    async findRepoDatasource(
      repoFullName: string,
      providerType: string,
    ): Promise<MatchedDatasource | null> {
      const { fullName, shortName } = parseRepoNames(repoFullName);
      if (!fullName) {
        return null;
      }

      const query = new URLSearchParams();
      query.set('keyword', shortName || fullName);
      if (providerType) {
        query.set('provideType', providerType);
      }

      const list = await requestData<DatasourceListItem[]>(
        baseUrl,
        apiKey,
        `/tenant/datasource/datasource-list?${query.toString()}`,
        { method: 'GET' },
      );

      const candidates = (Array.isArray(list) ? list : []).filter((ds) =>
        matchesRepoIdentity(ds.name, fullName, shortName),
      );

      // Fall back to all returned items when keyword search is loose / name layout differs
      const toInspect =
        candidates.length > 0 ? candidates : Array.isArray(list) ? list : [];

      for (const ds of toInspect) {
        const datasourceId = ds.datasourceId;
        if (!datasourceId) continue;

        let details: DatasourceDetails | undefined;
        try {
          details = await requestData<DatasourceDetails>(
            baseUrl,
            apiKey,
            `/tenant/datasource/datasource-details/${encodeURIComponent(datasourceId)}`,
            { method: 'GET' },
          );
        } catch {
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
        if (
          matchesRepoIdentity(ds.name, fullName, shortName) ||
          matchesRepoIdentity(details?.name, fullName, shortName)
        ) {
          return {
            datasourceId,
            name: details?.name ?? ds.name ?? fullName,
            providerType: details?.provider ?? ds.type ?? providerType,
          };
        }
      }

      return null;
    },

    async startScan(params: StartScanParams): Promise<StartScanResponse> {
      const body = {
        providerType: params.providerType,
        datasourceName: params.datasourceName,
        scanners: params.scanners,
        branchName: params.branchName,
      };

      const data = await requestData<MultiScanExecutionResponse>(
        baseUrl,
        apiKey,
        '/tenant/scan/execution',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      );

      const results = Array.isArray(data?.results) ? data.results : [];
      const scanIds = results
        .filter((r) => r.success && r.scanId)
        .map((r) => String(r.scanId));

      if (scanIds.length === 0) {
        const failed = results
          .filter((r) => !r.success)
          .map((r) => r.message || r.scanner || 'unknown')
          .join('; ');
        throw new Error(
          failed
            ? `Start scan failed: ${failed}`
            : 'Start scan response missing scanId',
        );
      }

      return {
        datasourceId: data?.datasourceId,
        datasourceName: data?.datasourceName,
        providerType: data?.providerType,
        results,
        scanIds,
      };
    },

    async getScanStatus(scanId: string): Promise<ScanStatusResponse> {
      const report = await requestData<ScanReport>(
        baseUrl,
        apiKey,
        `/tenant/scan/${encodeURIComponent(scanId)}/report`,
        { method: 'GET' },
      );

      return {
        status: normalizeScanStatus(report?.status),
        scanId: report?.scanId ?? scanId,
      };
    },
  };
}
