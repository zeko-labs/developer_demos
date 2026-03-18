import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

let baseUrl = '';
let server: Server;
let dataDir = '';
let integrationAvailable = true;

const adminHeaders = {
  authorization: 'Bearer admin_key',
  'content-type': 'application/json'
};

const tenantHeaders = {
  authorization: 'Bearer tenant_a_key',
  'content-type': 'application/json'
};

const makerHeaders = {
  authorization: 'Bearer maker_key',
  'content-type': 'application/json'
};

const checkerHeaders = {
  authorization: 'Bearer checker_key',
  'content-type': 'application/json'
};

const checker2Headers = {
  authorization: 'Bearer checker2_key',
  'content-type': 'application/json'
};

async function postJson(endpoint: string, body: unknown, headers: Record<string, string>) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { response, json };
}

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'tap-api-it-'));
  process.env.TAP_DATA_DIR = dataDir;
  process.env.TAP_DISABLE_LISTEN = '1';
  process.env.TAP_API_KEYS_JSON = JSON.stringify({
    admin_key: { role: 'CONSORTIUM_ADMIN' },
    tenant_a_key: { role: 'ISSUER', tenantId: 'tenant-a' },
    maker_key: { role: 'ISSUER_MAKER', tenantId: 'tenant-a' },
    checker_key: { role: 'ISSUER_CHECKER', tenantId: 'tenant-a' },
    checker2_key: { role: 'ISSUER_CHECKER', tenantId: 'tenant-a' }
  });
  process.env.PERSONA_WEBHOOK_SECRET = 'persona_test_secret';
  process.env.CUSTODY_WEBHOOK_SECRET = 'custody_test_secret';

  const mod = await import('./server.js');
  const candidate = mod.startServer(0);
  const started = await new Promise<{ ok: true } | { ok: false; error: Error & { code?: string } }>((resolve) => {
    candidate.once('listening', () => resolve({ ok: true }));
    candidate.once('error', (error) => resolve({ ok: false, error: error as Error & { code?: string } }));
  });
  if (!started.ok) {
    if (started.error.code === 'EPERM') {
      integrationAvailable = false;
      return;
    }
    throw started.error;
  }
  server = candidate;
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  const effectiveAt = '2026-02-01T00:00:00.000Z';
  const providerConfig = {
    provider: 'mock-bank',
    enabled: true,
    allowedHosts: [],
    quotaPerHour: 100,
    mappingVersion: 'v1',
    authProfiles: {}
  };

  const policyV1 = {
    tenantId: 'tenant-a',
    policyId: 1,
    version: 1,
    jurisdiction: 'US',
    rules: { minScore: 60 },
    effectiveAt,
    status: 'retired'
  };
  const policyV2 = {
    tenantId: 'tenant-a',
    policyId: 1,
    version: 2,
    jurisdiction: 'US',
    rules: { minScore: 70 },
    effectiveAt,
    status: 'active'
  };

  const cfgResp = await postJson('/tenant/tenant-a/provider-config', providerConfig, adminHeaders);
  assert.equal(cfgResp.response.status, 200);
  const genericRestCfgResp = await postJson(
    '/tenant/tenant-a/provider-config',
    {
      provider: 'generic-rest',
      enabled: true,
      allowedHosts: ['partner.example.com'],
      quotaPerHour: 100,
      mappingVersion: 'v1',
      authProfiles: {}
    },
    adminHeaders
  );
  assert.equal(genericRestCfgResp.response.status, 200);
  const personaCfgResp = await postJson(
    '/tenant/tenant-a/provider-config',
    {
      provider: 'persona',
      enabled: true,
      allowedHosts: ['withpersona.com'],
      quotaPerHour: 100,
      mappingVersion: 'v1',
      authProfiles: {}
    },
    adminHeaders
  );
  assert.equal(personaCfgResp.response.status, 200);
  const custodyCfgResp = await postJson(
    '/tenant/tenant-a/provider-config',
    {
      provider: 'custody-holdings',
      enabled: true,
      allowedHosts: ['sandbox.custody.example'],
      quotaPerHour: 100,
      mappingVersion: 'v1',
      authProfiles: {}
    },
    adminHeaders
  );
  assert.equal(custodyCfgResp.response.status, 200);

  const policyResp1 = await postJson('/policy/upsert', policyV1, adminHeaders);
  assert.equal(policyResp1.response.status, 200);
  const policyResp2 = await postJson('/policy/upsert', policyV2, adminHeaders);
  assert.equal(policyResp2.response.status, 200);
});

after(async () => {
  if (integrationAvailable && server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('source/collect settle path enforces policy and persists snapshot metadata', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const collect = await postJson(
    '/attest/source/collect',
    {
      provider: 'mock-bank',
      tenantId: 'tenant-a',
      subjectCommitment: 'subj_collect_ok',
      policyId: 1,
      settle: true,
      source: {
        balanceCents: 250000,
        kycPassed: true,
        accountStatus: 'active'
      }
    },
    tenantHeaders
  );

  assert.equal(collect.response.status, 200);
  const settlement = collect.json.settlement as Record<string, unknown>;
  assert.ok(settlement?.settlementId);

  const getResp = await fetch(`${baseUrl}/settlement/${String(settlement.settlementId)}`);
  assert.equal(getResp.status, 200);
  const settled = (await getResp.json()) as Record<string, unknown>;
  const metadata = (settled.metadata || {}) as Record<string, unknown>;
  assert.equal(typeof metadata.policySnapshotHash, 'string');
  assert.equal(typeof metadata.policyEffectiveAt, 'string');
});

test('source/collect rejects missing policy linkage when settle=true', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const collect = await postJson(
    '/attest/source/collect',
    {
      provider: 'mock-bank',
      subjectCommitment: 'subj_collect_missing_linkage',
      policyId: 1,
      settle: true,
      source: {
        balanceCents: 100000,
        kycPassed: true,
        accountStatus: 'active'
      }
    },
    tenantHeaders
  );
  assert.equal(collect.response.status, 422);
  assert.equal(collect.json.error, 'policy_linkage_missing');
});

test('source/collect settle path enforces risk min score', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const riskCfg = await postJson(
    '/risk/config/upsert',
    {
      tenantId: 'tenant-a',
      operation: 'eligibility',
      enabled: true,
      minScore: 90
    },
    adminHeaders
  );
  assert.equal(riskCfg.response.status, 200);

  const collect = await postJson(
    '/attest/source/collect',
    {
      provider: 'mock-bank',
      tenantId: 'tenant-a',
      subjectCommitment: 'subj_collect_risk_low_score',
      policyId: 1,
      settle: true,
      source: {
        balanceCents: 1000,
        kycPassed: false,
        accountStatus: 'restricted'
      }
    },
    tenantHeaders
  );
  assert.equal(collect.response.status, 422);
  assert.equal(collect.json.error, 'risk_min_score_failed');

  const disable = await postJson(
    '/risk/config/upsert',
    { tenantId: 'tenant-a', operation: 'eligibility', enabled: false },
    adminHeaders
  );
  assert.equal(disable.response.status, 200);
});

test('settlement/record rejects stale policy version and hash mismatch', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const staleProofResp = await postJson(
    '/proof/eligibility',
    {
      subjectCommitment: 'subj_stale',
      policyId: 1,
      tenantId: 'tenant-a',
      policyVersion: 1,
      policyHash: 'old_hash_v1'
    },
    adminHeaders
  );
  assert.equal(staleProofResp.response.status, 200);

  const staleSettlementResp = await postJson(
    '/settlement/record',
    {
      operation: 'eligibility',
      subjectCommitment: 'subj_stale',
      proof: staleProofResp.json
    },
    adminHeaders
  );
  assert.equal(staleSettlementResp.response.status, 422);
  assert.equal(staleSettlementResp.json.reason, 'policy_version_mismatch');

  const hashMismatchProofResp = await postJson(
    '/proof/eligibility',
    {
      subjectCommitment: 'subj_hash_mismatch',
      policyId: 1,
      tenantId: 'tenant-a',
      policyVersion: 2,
      policyHash: 'wrong_hash'
    },
    adminHeaders
  );
  assert.equal(hashMismatchProofResp.response.status, 200);

  const hashMismatchSettlementResp = await postJson(
    '/settlement/record',
    {
      operation: 'eligibility',
      subjectCommitment: 'subj_hash_mismatch',
      proof: hashMismatchProofResp.json
    },
    adminHeaders
  );
  assert.equal(hashMismatchSettlementResp.response.status, 422);
  assert.equal(hashMismatchSettlementResp.json.reason, 'policy_hash_mismatch');
});

test('settlement/record rejects missing policy linkage', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const proofResp = await postJson(
    '/proof/eligibility',
    {
      subjectCommitment: 'subj_missing_linkage',
      policyId: 1
    },
    adminHeaders
  );
  assert.equal(proofResp.response.status, 200);

  const settlementResp = await postJson(
    '/settlement/record',
    {
      operation: 'eligibility',
      subjectCommitment: 'subj_missing_linkage',
      proof: proofResp.json
    },
    adminHeaders
  );
  assert.equal(settlementResp.response.status, 422);
  assert.equal(settlementResp.json.reason, 'policy_linkage_missing');
});

test('persona webhook verifies signature', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const payload = JSON.stringify({
    type: 'inquiry.completed',
    data: {
      id: 'inq_test_123',
      attributes: {
        status: 'approved',
        'reference-id': 'subj_persona_1'
      }
    }
  });
  const tSec = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', 'persona_test_secret').update(`${tSec}.${payload}`).digest('hex');

  const response = await fetch(`${baseUrl}/attest/identity/persona/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'persona-signature': `t=${tSec},v1=${v1}`
    },
    body: payload
  });
  assert.equal(response.status, 200);
  const json = (await response.json()) as Record<string, unknown>;
  assert.equal(json.verified, true);
  assert.equal(json.provider, 'persona');
  assert.equal(json.inquiryId, 'inq_test_123');
});

test('persona webhook rejects bad signature', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const payload = JSON.stringify({
    type: 'inquiry.completed',
    data: { id: 'inq_bad_sig', attributes: { status: 'approved' } }
  });
  const tSec = Math.floor(Date.now() / 1000);
  const response = await fetch(`${baseUrl}/attest/identity/persona/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'persona-signature': `t=${tSec},v1=deadbeef`
    },
    body: payload
  });
  assert.equal(response.status, 401);
  const json = (await response.json()) as Record<string, unknown>;
  assert.equal(json.verified, false);
  assert.equal(json.reason, 'signature_mismatch');
});

test('custody webhook verifies signature', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const payload = JSON.stringify({
    type: 'holding.updated',
    data: {
      attributes: {
        'account-id': 'acct_123',
        symbol: 'DEMO',
        'certificate-id': 'cert_123',
        status: 'verified'
      }
    }
  });
  const tSec = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', 'custody_test_secret').update(`${tSec}.${payload}`).digest('hex');

  const response = await fetch(`${baseUrl}/attest/holdings/custody/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-custody-signature': `t=${tSec},v1=${v1}`
    },
    body: payload
  });
  assert.equal(response.status, 200);
  const json = (await response.json()) as Record<string, unknown>;
  assert.equal(json.verified, true);
  assert.equal(json.provider, 'custody-holdings');
  assert.equal(json.accountId, 'acct_123');
});

test('custody webhook rejects bad signature', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const payload = JSON.stringify({
    type: 'holding.updated',
    data: { attributes: { 'account-id': 'acct_bad', status: 'verified' } }
  });
  const tSec = Math.floor(Date.now() / 1000);
  const response = await fetch(`${baseUrl}/attest/holdings/custody/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-custody-signature': `t=${tSec},v1=deadbeef`
    },
    body: payload
  });
  assert.equal(response.status, 401);
  const json = (await response.json()) as Record<string, unknown>;
  assert.equal(json.verified, false);
  assert.equal(json.reason, 'signature_mismatch');
});

test('maker cannot self-approve issuer request', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const created = await postJson(
    '/issuer/mint/request',
    {
      issuerId: 'issuer_demo_bank',
      recipientCommitment: 'subj_maker_self_approve',
      amountCents: '100000',
      assetId: 1,
      tenantId: 'tenant-a',
      policyId: 1
    },
    makerHeaders
  );
  assert.equal(created.response.status, 200);
  const requestId = String(created.json.requestId);

  const approval = await postJson(`/issuer/mint/${requestId}/approve`, { note: 'self-approve' }, makerHeaders);
  assert.equal(approval.response.status, 422);
  assert.equal(approval.json.error, 'maker_checker_separation_required');
});

test('mint settlement rejects when request is not approved', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const created = await postJson(
    '/issuer/mint/request',
    {
      issuerId: 'issuer_demo_bank',
      recipientCommitment: 'subj_unapproved_settle',
      amountCents: '100000',
      assetId: 1,
      tenantId: 'tenant-a',
      policyId: 1
    },
    makerHeaders
  );
  assert.equal(created.response.status, 200);
  const requestId = String(created.json.requestId);

  const activePolicy = await fetch(`${baseUrl}/policy/tenant-a/1/active`, {
    headers: { authorization: 'Bearer admin_key' }
  }).then((r) => r.json() as Promise<Record<string, unknown>>);

  const proof = await postJson(
    '/proof/eligibility',
    {
      subjectCommitment: 'subj_unapproved_settle',
      policyId: 1,
      tenantId: 'tenant-a',
      policyVersion: Number(activePolicy.version),
      policyHash: String(activePolicy.policyHash)
    },
    adminHeaders
  );
  assert.equal(proof.response.status, 200);

  const settlement = await postJson(
    '/settlement/record',
    {
      operation: 'mint',
      subjectCommitment: 'subj_unapproved_settle',
      proof: proof.json,
      metadata: {
        issuerRequestId: requestId,
        tenantId: 'tenant-a',
        policyId: 1
      }
    },
    adminHeaders
  );
  assert.equal(settlement.response.status, 422);
  assert.equal(settlement.json.reason, 'issuer_request_not_approved');
});

test('approved mint settlement succeeds and persists approval policy snapshot metadata', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const created = await postJson(
    '/issuer/mint/request',
    {
      issuerId: 'issuer_demo_bank',
      recipientCommitment: 'subj_approved_settle',
      amountCents: '100000',
      assetId: 1,
      tenantId: 'tenant-a',
      policyId: 1
    },
    makerHeaders
  );
  assert.equal(created.response.status, 200);
  const requestId = String(created.json.requestId);

  const approved = await postJson(`/issuer/mint/${requestId}/approve`, { note: 'checker approve' }, checkerHeaders);
  assert.equal(approved.response.status, 200);
  assert.equal(approved.json.status, 'approved');

  const activePolicy = await fetch(`${baseUrl}/policy/tenant-a/1/active`, {
    headers: { authorization: 'Bearer admin_key' }
  }).then((r) => r.json() as Promise<Record<string, unknown>>);

  const proof = await postJson(
    '/proof/eligibility',
    {
      subjectCommitment: 'subj_approved_settle',
      policyId: 1,
      tenantId: 'tenant-a',
      policyVersion: Number(activePolicy.version),
      policyHash: String(activePolicy.policyHash)
    },
    adminHeaders
  );
  assert.equal(proof.response.status, 200);

  const settlement = await postJson(
    '/settlement/record',
    {
      operation: 'mint',
      subjectCommitment: 'subj_approved_settle',
      proof: proof.json,
      metadata: {
        issuerRequestId: requestId,
        tenantId: 'tenant-a',
        policyId: 1
      }
    },
    adminHeaders
  );
  assert.equal(settlement.response.status, 200);
  assert.equal(settlement.json.verified, true);
  assert.equal(settlement.json.policySnapshotHash, String(activePolicy.policyHash));

  const details = await fetch(`${baseUrl}/settlement/${String(settlement.json.settlementId)}`).then((r) =>
    r.json() as Promise<Record<string, unknown>>
  );
  const metadata = (details.metadata || {}) as Record<string, unknown>;
  assert.equal(metadata.issuerRequestId, requestId);
  assert.equal(metadata.approvedByKeyId, 'checker_key');
  assert.equal(typeof metadata.approvalPolicySnapshotHash, 'string');
});

test('approved stock issue settlement succeeds and persists asset lifecycle metadata', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const created = await postJson(
    '/issuer/stock/issue/request',
    {
      issuerId: 'issuer_demo_bank',
      investorCommitment: 'subj_stock_issue_001',
      quantityUnits: '1250',
      assetId: 101,
      securityId: 'sec_fund_a',
      issuanceType: 'primary',
      notionalCents: '750000',
      tenantId: 'tenant-a',
      policyId: 1
    },
    makerHeaders
  );
  assert.equal(created.response.status, 200);
  const requestId = String(created.json.requestId);

  const approved = await postJson(`/issuer/issue/${requestId}/approve`, { note: 'checker approve stock issue' }, checkerHeaders);
  assert.equal(approved.response.status, 200);
  assert.equal(approved.json.status, 'approved');

  const activePolicy = await fetch(`${baseUrl}/policy/tenant-a/1/active`, {
    headers: { authorization: 'Bearer admin_key' }
  }).then((r) => r.json() as Promise<Record<string, unknown>>);

  const proof = await postJson(
    '/proof/eligibility',
    {
      subjectCommitment: 'subj_stock_issue_001',
      policyId: 1,
      tenantId: 'tenant-a',
      policyVersion: Number(activePolicy.version),
      policyHash: String(activePolicy.policyHash)
    },
    adminHeaders
  );
  assert.equal(proof.response.status, 200);

  const settlement = await postJson(
    '/settlement/record',
    {
      operation: 'issue',
      subjectCommitment: 'subj_stock_issue_001',
      proof: proof.json,
      metadata: {
        issuerRequestId: requestId,
        tenantId: 'tenant-a',
        policyId: 1
      }
    },
    adminHeaders
  );
  assert.equal(settlement.response.status, 200);
  assert.equal(settlement.json.verified, true);

  const details = await fetch(`${baseUrl}/settlement/${String(settlement.json.settlementId)}`).then((r) =>
    r.json() as Promise<Record<string, unknown>>
  );
  const metadata = (details.metadata || {}) as Record<string, unknown>;
  assert.equal(metadata.issuerRequestId, requestId);
  assert.equal(metadata.issuerRequestKind, 'issue');
  assert.equal(metadata.investorCommitment, 'subj_stock_issue_001');
  assert.equal(metadata.quantityUnits, '1250');
  assert.equal(metadata.securityId, 'sec_fund_a');
  assert.equal(metadata.notionalCents, '750000');
});

test('issuer request listing supports stock lifecycle kinds', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const created = await postJson(
    '/issuer/stock/restrict/request',
    {
      issuerId: 'issuer_demo_bank',
      holderCommitment: 'subj_stock_hold_001',
      assetId: 101,
      securityId: 'sec_fund_a',
      restrictionCode: 'compliance_hold',
      tenantId: 'tenant-a',
      policyId: 1
    },
    makerHeaders
  );
  assert.equal(created.response.status, 200);

  const listResp = await fetch(`${baseUrl}/issuer/requests?kind=restrict`, {
    headers: { authorization: 'Bearer maker_key' }
  });
  assert.equal(listResp.status, 200);
  const listJson = (await listResp.json()) as { records: Array<Record<string, unknown>> };
  assert.ok(listJson.records.some((record) => record.kind === 'restrict'));
});

test('mint settlement enforces risk max per tx', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }
  const riskCfg = await postJson(
    '/risk/config/upsert',
    {
      tenantId: 'tenant-a',
      operation: 'mint',
      enabled: true,
      maxPerTxnAmountCents: '50000'
    },
    adminHeaders
  );
  assert.equal(riskCfg.response.status, 200);

  const created = await postJson(
    '/issuer/mint/request',
    {
      issuerId: 'issuer_demo_bank',
      recipientCommitment: 'subj_risk_mint_limit',
      amountCents: '100000',
      assetId: 1,
      tenantId: 'tenant-a',
      policyId: 1
    },
    makerHeaders
  );
  assert.equal(created.response.status, 200);
  const requestId = String(created.json.requestId);

  const approved = await postJson(`/issuer/mint/${requestId}/approve`, { note: 'checker approve' }, checkerHeaders);
  assert.equal(approved.response.status, 200);

  const activePolicy = await fetch(`${baseUrl}/policy/tenant-a/1/active`, {
    headers: { authorization: 'Bearer admin_key' }
  }).then((r) => r.json() as Promise<Record<string, unknown>>);

  const proof = await postJson(
    '/proof/eligibility',
    {
      subjectCommitment: 'subj_risk_mint_limit',
      policyId: 1,
      tenantId: 'tenant-a',
      policyVersion: Number(activePolicy.version),
      policyHash: String(activePolicy.policyHash)
    },
    adminHeaders
  );
  assert.equal(proof.response.status, 200);

  const settlement = await postJson(
    '/settlement/record',
    {
      operation: 'mint',
      subjectCommitment: 'subj_risk_mint_limit',
      proof: proof.json,
      metadata: {
        issuerRequestId: requestId,
        tenantId: 'tenant-a',
        policyId: 1
      }
    },
    adminHeaders
  );
  assert.equal(settlement.response.status, 422);
  assert.equal(settlement.json.error, 'risk_max_per_txn_exceeded');

  const disable = await postJson(
    '/risk/config/upsert',
    { tenantId: 'tenant-a', operation: 'mint', enabled: false },
    adminHeaders
  );
  assert.equal(disable.response.status, 200);
});

test('routing config upsert/list persists tenant routing defaults', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }

  const upsert = await postJson(
    '/routing/config/upsert',
    {
      tenantId: 'tenant-a',
      provider: 'mock-bank',
      failoverProviders: ['generic-rest'],
      routingStrategy: 'health-weighted',
      routingWeight: 42
    },
    adminHeaders
  );
  assert.equal(upsert.response.status, 200);
  assert.equal(upsert.json.routingStrategy, 'health-weighted');
  assert.equal(upsert.json.routingWeight, 42);

  const listedResp = await fetch(`${baseUrl}/routing/configs?tenantId=tenant-a`, {
    headers: { authorization: 'Bearer admin_key' }
  });
  assert.equal(listedResp.status, 200);
  const listed = (await listedResp.json()) as { records: Array<Record<string, unknown>> };
  const mockBank = listed.records.find((v) => v.provider === 'mock-bank');
  assert.ok(mockBank);
  assert.equal(mockBank?.routingStrategy, 'health-weighted');
  assert.equal(mockBank?.routingWeight, 42);
  assert.deepEqual(mockBank?.failoverProviders, ['generic-rest']);
});

test('source collect failover routes from failed generic-rest to mock-bank', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }

  const routeCfg = await postJson(
    '/routing/config/upsert',
    {
      tenantId: 'tenant-a',
      provider: 'generic-rest',
      failoverProviders: ['mock-bank'],
      routingStrategy: 'ordered',
      routingWeight: 0
    },
    adminHeaders
  );
  assert.equal(routeCfg.response.status, 200);

  const collect = await postJson(
    '/attest/source/collect',
    {
      provider: 'generic-rest',
      tenantId: 'tenant-a',
      subjectCommitment: 'subj_collect_failover_ok',
      policyId: 1,
      settle: true,
      source: {
        url: 'https://partner.example.com/unavailable',
        method: 'GET',
        timeoutMs: 200,
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
            balanceCents: 100000,
            kycPassed: true,
            accountStatus: 'active'
          }
        }
      }
    },
    tenantHeaders
  );

  assert.equal(collect.response.status, 200);
  assert.equal(collect.json.selectedProvider, 'mock-bank');
  assert.equal(collect.json.failoverUsed, true);
  assert.deepEqual(collect.json.attemptedProviders, ['generic-rest', 'mock-bank']);
});

test('issuer controls enforce reason codes and dual-approval quorum', async (t) => {
  if (!integrationAvailable) {
    t.skip('integration tests skipped: sandbox denied local listen');
    return;
  }

  const controls = await postJson(
    '/issuer/controls/upsert',
    {
      tenantId: 'tenant-a',
      approvalExpiryMinutes: 1440,
      dualApprovalThresholdCents: '50000',
      requireReasonCode: true,
      allowedReasonCodes: ['risk_ok', 'ops_approved']
    },
    adminHeaders
  );
  assert.equal(controls.response.status, 200);

  const created = await postJson(
    '/issuer/mint/request',
    {
      issuerId: 'issuer_demo_bank',
      recipientCommitment: 'subj_dual_approval',
      amountCents: '100000',
      assetId: 1,
      tenantId: 'tenant-a',
      policyId: 1
    },
    makerHeaders
  );
  assert.equal(created.response.status, 200);
  const requestId = String(created.json.requestId);

  const missingReason = await postJson(`/issuer/mint/${requestId}/approve`, { note: 'approve' }, checkerHeaders);
  assert.equal(missingReason.response.status, 422);
  assert.equal(missingReason.json.error, 'issuer_reason_code_required');

  const firstApprove = await postJson(
    `/issuer/mint/${requestId}/approve`,
    { reasonCode: 'risk_ok', note: 'checker1' },
    checkerHeaders
  );
  assert.equal(firstApprove.response.status, 200);
  assert.equal(firstApprove.json.status, 'requested');
  assert.equal((firstApprove.json.approvalProgress as Record<string, unknown>).remainingApprovals, 1);

  const secondApprove = await postJson(
    `/issuer/mint/${requestId}/approve`,
    { reasonCode: 'ops_approved', note: 'checker2' },
    checker2Headers
  );
  assert.equal(secondApprove.response.status, 200);
  assert.equal(secondApprove.json.status, 'approved');
  assert.equal((secondApprove.json.approvalProgress as Record<string, unknown>).remainingApprovals, 0);
});
