import type { SourceAdapterRequest, SourceProvider, TenantProviderConfig } from '@tap/shared-types';

export interface PartnerAdapterCertificationCase {
  id: string;
  request: SourceAdapterRequest;
  expect: {
    ok: boolean;
    errorCode?: string;
    selectedProvider?: string;
    minScore?: number;
    requireSettlement?: boolean;
  };
}

export interface PartnerAdapterCertificationResult {
  id: string;
  passed: boolean;
  detail?: string;
  response: unknown;
}

export interface PartnerAdapterCertificationSummary {
  total: number;
  passed: number;
  failed: number;
  scorePercent: number;
  status: 'pass' | 'fail';
}

function readScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = record.attestation;
    if (nested && typeof nested === 'object') {
      const score = (nested as Record<string, unknown>).score;
      if (typeof score === 'number' && Number.isFinite(score)) return score;
    }
  }
  return null;
}

function hasSettlement(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return Boolean(rec.settlement && typeof rec.settlement === 'object');
}

function readErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec.error === 'string') return rec.error;
  const nested = rec.error as Record<string, unknown> | undefined;
  if (nested && typeof nested.code === 'string') return nested.code;
  if (typeof rec.reason === 'string') return rec.reason;
  return undefined;
}

function readSelectedProvider(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec.selectedProvider === 'string') return rec.selectedProvider;
  if (typeof rec.provider === 'string') return rec.provider;
  return undefined;
}

export async function runPartnerAdapterCertification(
  cases: PartnerAdapterCertificationCase[],
  invoke: (request: SourceAdapterRequest) => Promise<unknown>
): Promise<{
  passed: number;
  failed: number;
  results: PartnerAdapterCertificationResult[];
  summary: PartnerAdapterCertificationSummary;
}> {
  const results: PartnerAdapterCertificationResult[] = [];

  for (const c of cases) {
    const response = await invoke(c.request);
    const errorCode = readErrorCode(response);
    const score = readScore(response);
    const selectedProvider = readSelectedProvider(response);
    const settlement = hasSettlement(response);

    if (c.expect.ok) {
      if (errorCode) {
        results.push({
          id: c.id,
          passed: false,
          detail: `expected success but got error=${errorCode}`,
          response
        });
        continue;
      }
      if (typeof c.expect.minScore === 'number' && (score === null || score < c.expect.minScore)) {
        results.push({
          id: c.id,
          passed: false,
          detail: `expected minScore=${c.expect.minScore} got=${String(score)}`,
          response
        });
        continue;
      }
      if (c.expect.requireSettlement && !settlement) {
        results.push({
          id: c.id,
          passed: false,
          detail: 'expected settlement object in response',
          response
        });
        continue;
      }
      if (c.expect.selectedProvider && selectedProvider !== c.expect.selectedProvider) {
        results.push({
          id: c.id,
          passed: false,
          detail: `expected selectedProvider=${c.expect.selectedProvider} got=${String(selectedProvider)}`,
          response
        });
        continue;
      }
      results.push({ id: c.id, passed: true, response });
      continue;
    }

    if (!errorCode) {
      results.push({
        id: c.id,
        passed: false,
        detail: 'expected failure but response has no error code',
        response
      });
      continue;
    }
    if (c.expect.errorCode && c.expect.errorCode !== errorCode) {
      results.push({
        id: c.id,
        passed: false,
        detail: `expected errorCode=${c.expect.errorCode} got=${errorCode}`,
        response
      });
      continue;
    }
    results.push({ id: c.id, passed: true, response });
  }

  const passed = results.filter((v) => v.passed).length;
  const failed = results.length - passed;
  const scorePercent = results.length === 0 ? 0 : Math.round((passed / results.length) * 100);
  return {
    passed,
    failed,
    results,
    summary: {
      total: results.length,
      passed,
      failed,
      scorePercent,
      status: failed === 0 ? 'pass' : 'fail'
    }
  };
}

export function buildTenantProviderConfigStarter(input: {
  tenantId: string;
  provider: SourceProvider;
  allowedHosts?: string[];
  quotaPerHour?: number;
  mappingVersion?: string;
  failoverProviders?: SourceProvider[];
  routingStrategy?: 'ordered' | 'health-weighted';
  routingWeight?: number;
}): TenantProviderConfig {
  return {
    tenantId: input.tenantId,
    provider: input.provider,
    enabled: true,
    allowedHosts: input.allowedHosts || [],
    quotaPerHour: input.quotaPerHour || 1000,
    mappingVersion: input.mappingVersion || 'v1',
    authProfiles: {},
    mtlsProfiles: {},
    failoverProviders: input.failoverProviders || [],
    routingStrategy: input.routingStrategy || 'ordered',
    routingWeight: Number.isFinite(input.routingWeight) ? Number(input.routingWeight) : 0
  };
}

export function buildGenericRestCertificationCases(input: {
  tenantId: string;
  policyId: number;
  subjectCommitment: string;
  goodUrl: string;
  badUrl?: string;
}): PartnerAdapterCertificationCase[] {
  const common = {
    provider: 'generic-rest' as const,
    tenantId: input.tenantId,
    policyId: input.policyId,
    subjectCommitment: input.subjectCommitment
  };
  return [
    {
      id: 'generic_rest_missing_url',
      request: {
        ...common,
        settle: false,
        source: {}
      },
      expect: {
        ok: false,
        errorCode: 'invalid_config'
      }
    },
    {
      id: 'generic_rest_domain_not_allowed',
      request: {
        ...common,
        settle: false,
        source: {
          url: input.badUrl || 'https://forbidden.example.com/balance',
          method: 'GET'
        }
      },
      expect: {
        ok: false,
        errorCode: 'domain_not_allowed'
      }
    },
    {
      id: 'generic_rest_with_failover_mock_bank',
      request: {
        ...common,
        settle: true,
        source: {
          url: input.goodUrl,
          method: 'GET',
          timeoutMs: 500,
          extract: {
            subjectPath: '$.subject',
            eligibilityPath: '$.eligible',
            scorePath: '$.score'
          }
        },
        failover: {
          providers: ['mock-bank'],
          sources: {
            'mock-bank': {
              balanceCents: 900000,
              kycPassed: true,
              accountStatus: 'active'
            }
          }
        }
      },
      expect: {
        ok: true,
        selectedProvider: 'mock-bank',
        minScore: 80,
        requireSettlement: true
      }
    }
  ];
}
