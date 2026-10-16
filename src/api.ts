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

/** Item of GET /tenant/datasource/integration-list (repositories and other resources). */
interface IntegrationListItem {
  resourceId?: string;
  /** Repository / resource name */
  name?: string;
  datasourceId?: string;
  datasourceName?: string;
  providerType?: string;
  resourceType?: string;
  type?: string;
  isActive?: boolean;
  status?: string;
}

interface MultiScanExecutionResponse {
  datasourceId?: string;
  datasourceName?: string;
  providerType?: string;
  results?: ScanExecutionResult[];
}

export interface ScanReport {
  scanId?: string;
  type?: string;
  target?: string;
  totalFindings?: number;
  status?: string;
  started?: string;
  finished?: string;
  duration?: string;
  detailedSummary?: {
    newVulnerabilities?: number;
    newCspmFindings?: number;
    resolvedVulnerabilities?: number;
    resolvedCspmFindings?: number;
  };
}

export interface ScanHistoryItem {
  /** scan_results.id */
  id?: string;
  name?: string;
  type?: string;
  date?: string;
  status?: string;
  findings?: number;
  duration?: string;
  targetType?: string;
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
        query.set('providerType', providerType);
      }
      query.set('pageNumber', '1');
      query.set('pageSize', '100');

      const list = await requestData<IntegrationListItem[]>(
        baseUrl,
        apiKey,
        `/tenant/datasource/integration-list?${query.toString()}`,
        { method: 'GET' },
      );
      const items = Array.isArray(list) ? list : [];

      // Prefer an exact owner/repo match, then a short repo-name match.
      const match =
        items.find((i) => equalsIgnoreCase(i.name, fullName)) ??
        items.find((i) => matchesRepoIdentity(i.name, fullName, shortName)) ??
        items.find((i) =>
          matchesRepoIdentity(i.datasourceName, fullName, shortName),
        );

      if (!match || !match.datasourceId) {
        return null;
      }

      return {
        datasourceId: match.datasourceId,
        name: match.datasourceName ?? match.name ?? fullName,
        providerType: match.providerType ?? match.type ?? providerType,
      };
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

    async getScanReport(scanResultId: string): Promise<ScanReport> {
      return requestData<ScanReport>(
        baseUrl,
        apiKey,
        `/tenant/scan/${encodeURIComponent(scanResultId)}/report`,
        { method: 'GET' },
      );
    },

    async listScanHistory(params: {
      dataSourceId: string;
      pageSize?: number;
    }): Promise<ScanHistoryItem[]> {
      const query = new URLSearchParams();
      query.set('dataSourceId', params.dataSourceId);
      query.set('pageNumber', '1');
      query.set('pageSize', String(params.pageSize ?? 10));
      const data = await requestData<ScanHistoryItem[]>(
        baseUrl,
        apiKey,
        `/tenant/scan/scan-history?${query.toString()}`,
        { method: 'GET' },
      );
      return Array.isArray(data) ? data : [];
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
