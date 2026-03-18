export type RiskOperation = 'eligibility' | 'mint' | 'burn' | 'issue' | 'allocate' | 'restrict' | 'redeem';

export interface RiskConfig {
  tenantId: string;
  operation: RiskOperation;
  enabled: boolean;
  minScore?: number;
  maxPerTxnAmountCents?: string;
  maxDailyAmountCents?: string;
  maxSubjectDailyAmountCents?: string;
  maxRequestsPerHour?: number;
  updatedAt: string;
}

export interface UpsertRiskConfigInput {
  tenantId: string;
  operation: RiskOperation;
  enabled?: boolean;
  minScore?: number;
  maxPerTxnAmountCents?: string;
  maxDailyAmountCents?: string;
  maxSubjectDailyAmountCents?: string;
  maxRequestsPerHour?: number;
}

export interface EvaluateRiskInput {
  tenantId: string;
  operation: RiskOperation;
  subjectCommitment: string;
  amountCents?: string;
  score?: number;
}

export interface RiskDecision {
  ok: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
  config?: RiskConfig;
}

function nowIso() {
  return new Date().toISOString();
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hourKey() {
  return new Date().toISOString().slice(0, 13);
}

const configs = new Map<string, RiskConfig>();

const usageByHour = new Map<string, number>();
const usageByDayAmount = new Map<string, bigint>();
const usageByDaySubjectAmount = new Map<string, bigint>();

function parseAmount(value: string | undefined): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function addHourUsage(key: string): number {
  const count = (usageByHour.get(key) || 0) + 1;
  usageByHour.set(key, count);
  return count;
}

function addDailyAmount(key: string, amount: bigint): bigint {
  const total = (usageByDayAmount.get(key) || 0n) + amount;
  usageByDayAmount.set(key, total);
  return total;
}

function addDailySubjectAmount(key: string, amount: bigint): bigint {
  const total = (usageByDaySubjectAmount.get(key) || 0n) + amount;
  usageByDaySubjectAmount.set(key, total);
  return total;
}

export function resetRiskRuntimeState() {
  usageByHour.clear();
  usageByDayAmount.clear();
  usageByDaySubjectAmount.clear();
}

export async function resetRiskConfigStore() {
  configs.clear();
}

export async function upsertRiskConfig(input: UpsertRiskConfigInput): Promise<RiskConfig> {
  const record: RiskConfig = {
    tenantId: input.tenantId,
    operation: input.operation,
    enabled: input.enabled ?? true,
    minScore: input.minScore,
    maxPerTxnAmountCents: input.maxPerTxnAmountCents,
    maxDailyAmountCents: input.maxDailyAmountCents,
    maxSubjectDailyAmountCents: input.maxSubjectDailyAmountCents,
    maxRequestsPerHour: input.maxRequestsPerHour,
    updatedAt: nowIso()
  };
  configs.set(`${record.tenantId}:${record.operation}`, record);
  return record;
}

export async function listRiskConfigs(tenantId?: string): Promise<RiskConfig[]> {
  const all = [...configs.values()];
  if (!tenantId) return all;
  return all.filter((v) => v.tenantId === tenantId);
}

export async function resolveRiskConfig(
  tenantId: string,
  operation: RiskOperation
): Promise<RiskConfig | null> {
  return configs.get(`${tenantId}:${operation}`) || null;
}

export async function evaluateAndRecordRisk(input: EvaluateRiskInput): Promise<RiskDecision> {
  const config = await resolveRiskConfig(input.tenantId, input.operation);
  if (!config || !config.enabled) return { ok: true, config: config || undefined };

  if (
    typeof config.minScore === 'number' &&
    typeof input.score === 'number' &&
    Number.isFinite(input.score) &&
    input.score < config.minScore
  ) {
    return {
      ok: false,
      reason: 'risk_min_score_failed',
      detail: { score: input.score, minScore: config.minScore },
      config
    };
  }

  const amount = parseAmount(input.amountCents);
  const maxPerTxn = parseAmount(config.maxPerTxnAmountCents);
  if (amount !== null && maxPerTxn !== null && amount > maxPerTxn) {
    return {
      ok: false,
      reason: 'risk_max_per_txn_exceeded',
      detail: { amountCents: input.amountCents, maxPerTxnAmountCents: config.maxPerTxnAmountCents },
      config
    };
  }

  const hourUsageKey = `${input.tenantId}:${input.operation}:${hourKey()}`;
  const hourCount = addHourUsage(hourUsageKey);
  if (typeof config.maxRequestsPerHour === 'number' && hourCount > config.maxRequestsPerHour) {
    return {
      ok: false,
      reason: 'risk_max_requests_per_hour_exceeded',
      detail: { count: hourCount, maxRequestsPerHour: config.maxRequestsPerHour },
      config
    };
  }

  if (amount !== null) {
    const maxDaily = parseAmount(config.maxDailyAmountCents);
    if (maxDaily !== null) {
      const total = addDailyAmount(`${input.tenantId}:${input.operation}:${dayKey()}`, amount);
      if (total > maxDaily) {
        return {
          ok: false,
          reason: 'risk_max_daily_amount_exceeded',
          detail: { totalCents: total.toString(), maxDailyAmountCents: maxDaily.toString() },
          config
        };
      }
    }

    const maxSubjectDaily = parseAmount(config.maxSubjectDailyAmountCents);
    if (maxSubjectDaily !== null) {
      const total = addDailySubjectAmount(
        `${input.tenantId}:${input.operation}:${input.subjectCommitment}:${dayKey()}`,
        amount
      );
      if (total > maxSubjectDaily) {
        return {
          ok: false,
          reason: 'risk_max_subject_daily_amount_exceeded',
          detail: { totalCents: total.toString(), maxSubjectDailyAmountCents: maxSubjectDaily.toString() },
          config
        };
      }
    }
  }

  return { ok: true, config };
}
