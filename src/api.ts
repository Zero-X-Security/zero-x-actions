/**
 * Zero-X Cloud API client (placeholder paths – replace with real API when available).
 */

export interface StartScanParams {
  scanners?: string;
  branchName?: string;
  commitSha?: string;
  repoName?: string;
  repoOwner?: string;
  repoUrl?: string;
  runUrl?: string;
}

export interface StartScanResponse {
  scanId: string;
}

export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ScanStatusResponse {
  status: ScanStatus;
  resultUrl?: string;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

async function request<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
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
    return {} as T;
  }
  return res.json() as Promise<T>;
}

export function createZeroXClient(baseUrl: string, apiKey: string) {
  return {
    async startScan(params: StartScanParams): Promise<StartScanResponse> {
      const body = {
        scanners: params.scanners?.split(',').map((s) => s.trim()).filter(Boolean),
        branchName: params.branchName,
        commitSha: params.commitSha,
        repoName: params.repoName,
        repoOwner: params.repoOwner,
        repoUrl: params.repoUrl,
        runUrl: params.runUrl,
      };
      const data = await request<{ scanId?: string; id?: string }>(
        baseUrl,
        apiKey,
        '/api/v1/scans',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      const scanId = data.scanId ?? data.id;
      if (!scanId) {
        throw new Error('Start scan response missing scanId');
      }
      return { scanId: String(scanId) };
    },

    async getScanStatus(scanId: string): Promise<ScanStatusResponse> {
      const data = await request<{ status?: string; resultUrl?: string }>(
        baseUrl,
        apiKey,
        `/api/v1/scans/${encodeURIComponent(scanId)}`,
        { method: 'GET' }
      );
      const status = (data.status ?? 'pending') as ScanStatus;
      return {
        status,
        resultUrl: data.resultUrl,
      };
    },
  };
}
