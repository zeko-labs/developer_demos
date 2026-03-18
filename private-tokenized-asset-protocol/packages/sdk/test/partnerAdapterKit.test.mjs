import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGenericRestCertificationCases,
  runPartnerAdapterCertification
} from '../dist/partnerAdapterKit.js';

test('runPartnerAdapterCertification passes all expected cases', async () => {
  const cases = buildGenericRestCertificationCases({
    tenantId: 'tenant-a',
    policyId: 1,
    subjectCommitment: 'subj_cert_001',
    goodUrl: 'https://partner.example.com/unavailable'
  });

  const summary = await runPartnerAdapterCertification(cases, async (request) => {
    const source = request.source;
    if (!source || typeof source !== 'object' || typeof source.url !== 'string') {
      return { error: { code: 'invalid_config' } };
    }
    if (source.url.includes('forbidden.example.com')) {
      return { error: { code: 'domain_not_allowed' } };
    }
    return {
      selectedProvider: 'mock-bank',
      attestation: { score: 100 },
      settlement: { settlementId: 'set_demo_1' }
    };
  });

  assert.equal(summary.failed, 0);
  assert.equal(summary.passed, 3);
  assert.equal(summary.summary.scorePercent, 100);
  assert.equal(summary.summary.status, 'pass');
});

test('runPartnerAdapterCertification reports mismatch failures', async () => {
  const cases = [
    {
      id: 'expect_error',
      request: {
        provider: 'mock-bank',
        tenantId: 'tenant-a',
        subjectCommitment: 'subj_2',
        policyId: 1,
        settle: false,
        source: {}
      },
      expect: { ok: false, errorCode: 'invalid_config' }
    }
  ];

  const summary = await runPartnerAdapterCertification(cases, async () => {
    return { selectedProvider: 'mock-bank', attestation: { score: 100 } };
  });

  assert.equal(summary.failed, 1);
  assert.equal(summary.results[0]?.passed, false);
  assert.equal(summary.summary.status, 'fail');
});
