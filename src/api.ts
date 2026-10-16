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
  jobId?: string;
  scanId?: string;
  success: boolean;
  message?: string;
}

export interface StartScanResponse {
  datasourceId?: string;
  datasourceName?: string;
  providerType?: string;
  results: ScanExecutionResult[];
  /** scan_jobs ids to poll via GET /scan-jobs/{jobId} */
  jobIds: string[];
}

export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ScanStatusResponse {
  status: ScanStatus;
  jobId?: string;
  /** scan_results id; use for /scan/{id}/report once set */
  scanResultId?: string;
  reportReady?: boolean;
  errorCode?: string;
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

interface ScanJob {
  jobId?: string;
  status?: string;
  scanner?: string;
  datasourceId?: string;
  errorCode?: string;
  scanResultId?: string | null;
  reportReady?: boolean;
}

export interface SecurityFindingListItem {
  findingId?: string;
  resourceId?: string;
  title?: string;
  resource?: string;
  resourceName?: string;
  resourceType?: string;
  severity?: string;
  category?: string;
  riskScore?: number;
  provider?: string;
  description?: string;
  checkId?: string;
  branchName?: string;
  vulnerabilityId?: string;
  cweId?: string;
  datasourceName?: string;
  datasourceId?: string;
  status?: string;
}

export interface SecurityFindingDetails {
  title?: string;
  description?: string;
  severity?: string;
  category?: string;
  riskScore?: number;
  resourceName?: string;
  resourceType?: string;
  vulnerabilityId?: string;
  cvssScore?: number;
  filePath?: string;
  line?: number;
  cweWithDescription?: string;
  checkId?: string;
  findingType?: string;
  dataSourceName?: string;
  datasourceId?: string;
  repoName?: string;
  branchName?: string;
  status?: string;
  pkgName?: string;
  installedVersion?: string;
  fixedVersion?: string;
}

export interface ListFindingsParams {
  repository?: string;
  datasourceName?: string;
  pageNumber?: number;
  pageSize?: number;
}

interface PaginationDto {
  pageNumber?: number;
  pageSize?: number;
  totalRecords?: number;
  totalPages?: number;
}

interface FindingsListEnvelope {
  data?: SecurityFindingListItem[];
  paginationDto?: PaginationDto;
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
    // The platform answers a missing/invalid/expired api-key with 401, or with
    // this generic 400 body, so point users at the credentials.
    const authRejected =
      res.status === 401 ||
      res.status === 403 ||
      (res.status === 400 &&
        body.includes('An error occurred while processing your request'));
    const hint = authRejected
      ? ` Zero-X may have rejected the credentials: check that zerox-api-key is a valid, unexpired API key and that zerox-url (${normalizeBaseUrl(baseUrl)}) is the host that issued it.`
      : '';
    throw new Error(
      `Zero-X API error ${res.status} on ${options.method ?? 'GET'} ${path.split('?')[0]}: ${body || res.statusText}.${hint}`,
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
      // New flow: queue returns jobId (scanId is null until the scanner starts).
      // Fall back to scanId for backends that still return it only.
      const jobIds = results
        .filter((r) => r.success && (r.jobId || r.scanId))
        .map((r) => String(r.jobId || r.scanId));

      if (jobIds.length === 0) {
        const failed = results
          .filter((r) => !r.success)
          .map((r) => r.message || r.scanner || 'unknown')
          .join('; ');
        throw new Error(
          failed
            ? `Start scan failed: ${failed}`
            : 'Start scan response missing jobId',
        );
      }

      return {
        datasourceId: data?.datasourceId,
        datasourceName: data?.datasourceName,
        providerType: data?.providerType,
        results,
        jobIds,
      };
    },

    async getScanStatus(jobId: string): Promise<ScanStatusResponse> {
      const job = await requestData<ScanJob>(
        baseUrl,
        apiKey,
        `/tenant/scan-jobs/${encodeURIComponent(jobId)}`,
        { method: 'GET' },
      );

      return {
        status: normalizeScanStatus(job?.status),
        jobId: job?.jobId ?? jobId,
        scanResultId: job?.scanResultId ? String(job.scanResultId) : undefined,
        reportReady: job?.reportReady,
        errorCode: job?.errorCode,
      };
    },

    async listSecurityFindings(
      params: ListFindingsParams,
    ): Promise<{
      findings: SecurityFindingListItem[];
      totalPages: number;
      totalRecords: number;
    }> {
      const query = new URLSearchParams();
      query.set('pageNumber', String(params.pageNumber ?? 1));
      query.set('pageSize', String(params.pageSize ?? 100));
      if (params.repository) {
        query.append('repository', params.repository);
      }
      if (params.datasourceName) {
        query.append('datasourceName', params.datasourceName);
      }

      const envelope = await request<FindingsListEnvelope>(
        baseUrl,
        apiKey,
        `/tenant/security-findings/security-findings-list?${query.toString()}`,
        { method: 'GET' },
      );

      const findings = Array.isArray(envelope?.data)
        ? envelope.data
        : Array.isArray(envelope)
          ? (envelope as unknown as SecurityFindingListItem[])
          : [];

      return {
        findings,
        totalPages: envelope?.paginationDto?.totalPages ?? 1,
        totalRecords: envelope?.paginationDto?.totalRecords ?? findings.length,
      };
    },

    async getSecurityFindingDetails(
      findingId: string,
      category?: string,
    ): Promise<SecurityFindingDetails> {
      const query = new URLSearchParams();
      if (category) {
        query.set('category', category);
      }
      const qs = query.toString();
      const path = `/tenant/security-findings/get-security-findings-details/${encodeURIComponent(findingId)}${qs ? `?${qs}` : ''}`;
      return requestData<SecurityFindingDetails>(baseUrl, apiKey, path, {
        method: 'GET',
      });
    },
  };
}
