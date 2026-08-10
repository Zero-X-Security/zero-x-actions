/**
 * Map Zero-X security findings to SARIF 2.1.0 for GitHub Code Scanning.
 */

import type {
  SecurityFindingDetails,
  SecurityFindingListItem,
} from './api';

export interface FindingForSarif {
  findingId: string;
  list: SecurityFindingListItem;
  details?: SecurityFindingDetails;
}

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

interface SarifRun {
  tool: {
    driver: {
      name: string;
      informationUri?: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
}

interface SarifRule {
  id: string;
  name?: string;
  shortDescription?: { text: string };
  fullDescription?: { text: string };
  defaultConfiguration?: { level: SarifLevel };
  properties?: { tags?: string[]; precision?: string };
  helpUri?: string;
}

interface SarifResult {
  ruleId: string;
  ruleIndex?: number;
  level?: SarifLevel;
  message: { text: string };
  locations?: Array<{
    physicalLocation: {
      artifactLocation: { uri: string; uriBaseId?: string };
      region?: { startLine: number; startColumn?: number };
    };
  }>;
  partialFingerprints?: Record<string, string>;
  properties?: Record<string, string | number | undefined>;
}

type SarifLevel = 'error' | 'warning' | 'note' | 'none';

function severityToLevel(severity?: string): SarifLevel {
  const value = (severity ?? '').toLowerCase();
  if (value === 'critical' || value === 'high') return 'error';
  if (value === 'medium' || value === 'moderate') return 'warning';
  if (value === 'low' || value === 'info' || value === 'informational') {
    return 'note';
  }
  return 'warning';
}

function sanitizeRuleId(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._:-]/g, '-')
    .slice(0, 128);
  return cleaned || 'zerox-finding';
}

function resolveRuleId(finding: FindingForSarif): string {
  const list = finding.list;
  const details = finding.details;
  const candidate =
    details?.checkId ||
    list.checkId ||
    details?.vulnerabilityId ||
    list.vulnerabilityId ||
    details?.title ||
    list.title ||
    finding.findingId;
  return sanitizeRuleId(String(candidate));
}

function resolveMessage(finding: FindingForSarif): string {
  const details = finding.details;
  const list = finding.list;
  const parts = [
    details?.title || list.title,
    details?.description || list.description,
  ].filter(Boolean);
  if (details?.vulnerabilityId || list.vulnerabilityId) {
    parts.push(`ID: ${details?.vulnerabilityId || list.vulnerabilityId}`);
  }
  if (details?.cweWithDescription) {
    parts.push(details.cweWithDescription);
  } else if (list.cweId) {
    parts.push(`CWE: ${list.cweId}`);
  }
  if (details?.pkgName) {
    const pkg = [
      details.pkgName,
      details.installedVersion ? `@${details.installedVersion}` : '',
      details.fixedVersion ? ` (fix: ${details.fixedVersion})` : '',
    ].join('');
    parts.push(`Package: ${pkg}`);
  }
  return parts.join('\n\n') || `Zero-X finding ${finding.findingId}`;
}

function resolveFilePath(finding: FindingForSarif): string | undefined {
  const path =
    finding.details?.filePath ||
    finding.list.resourceName ||
    finding.list.resource;
  if (!path || typeof path !== 'string') return undefined;
  // Prefer repo-relative paths for Code Scanning
  return path.replace(/^\.?\//, '').replace(/\\/g, '/');
}

function looksLikeFilePath(path: string): boolean {
  return (
    path.includes('/') ||
    path.includes('.') ||
    path.endsWith('.ts') ||
    path.endsWith('.js') ||
    path.endsWith('.py') ||
    path.endsWith('.go') ||
    path.endsWith('.java') ||
    path.endsWith('.yml') ||
    path.endsWith('.yaml') ||
    path.endsWith('.json') ||
    path.endsWith('.tf')
  );
}

export function buildSarif(
  findings: FindingForSarif[],
  options?: { toolName?: string; informationUri?: string },
): SarifLog {
  const toolName = options?.toolName ?? 'Zero-X Security Scan';
  const ruleIndexById = new Map<string, number>();
  const rules: SarifRule[] = [];
  const results: SarifResult[] = [];

  for (const finding of findings) {
    const ruleId = resolveRuleId(finding);
    let ruleIndex = ruleIndexById.get(ruleId);
    if (ruleIndex === undefined) {
      ruleIndex = rules.length;
      ruleIndexById.set(ruleId, ruleIndex);
      const title =
        finding.details?.title || finding.list.title || ruleId;
      const description =
        finding.details?.description ||
        finding.list.description ||
        title;
      rules.push({
        id: ruleId,
        name: title,
        shortDescription: { text: title },
        fullDescription: { text: description },
        defaultConfiguration: {
          level: severityToLevel(
            finding.details?.severity || finding.list.severity,
          ),
        },
        properties: {
          tags: [
            finding.details?.category || finding.list.category || 'security',
            'security',
          ].filter(Boolean) as string[],
        },
        helpUri: options?.informationUri,
      });
    }

    const level = severityToLevel(
      finding.details?.severity || finding.list.severity,
    );
    const filePath = resolveFilePath(finding);
    const startLine = finding.details?.line;
    const result: SarifResult = {
      ruleId,
      ruleIndex,
      level,
      message: { text: resolveMessage(finding) },
      partialFingerprints: {
        primaryLocationLineHash: finding.findingId,
      },
      properties: {
        findingId: finding.findingId,
        severity: finding.details?.severity || finding.list.severity,
        category: finding.details?.category || finding.list.category,
      },
    };

    if (filePath && looksLikeFilePath(filePath)) {
      result.locations = [
        {
          physicalLocation: {
            artifactLocation: { uri: filePath },
            ...(typeof startLine === 'number' && startLine > 0
              ? { region: { startLine } }
              : {}),
          },
        },
      ];
    }

    results.push(result);
  }

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            informationUri: options?.informationUri,
            rules,
          },
        },
        results,
      },
    ],
  };
}
