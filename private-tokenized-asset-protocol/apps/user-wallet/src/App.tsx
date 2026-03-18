import { useState } from 'react';
import { SectionCard } from '@tap/ui-kit';
import { TapClient } from '@tap/sdk';
import type { ProofEnvelope } from '@tap/shared-types';

const client = new TapClient(import.meta.env.VITE_API_BASE_URL || 'http://localhost:7001');

export function App() {
  const [subjectCommitment, setSubjectCommitment] = useState('subj_demo_001');
  const [policyId, setPolicyId] = useState(1);
  const [proof, setProof] = useState<ProofEnvelope | null>(null);
  const [verifyResult, setVerifyResult] = useState<string>('');
  const [settlement, setSettlement] = useState<string>('');
  const [error, setError] = useState<string>('');

  async function runGoldenFlow() {
    setError('');
    setVerifyResult('');
    setSettlement('');

    try {
      const created = await client.createEligibilityProof({ subjectCommitment, policyId });
      if (created?.error) {
        throw new Error(String(created.error));
      }
      setProof(created as ProofEnvelope);

      const verified = await client.verifyProof(created as ProofEnvelope);
      setVerifyResult(JSON.stringify(verified, null, 2));

      const settled = await client.recordSettlement({
        operation: 'eligibility',
        subjectCommitment,
        proof: created as ProofEnvelope,
        metadata: {
          source: 'user-wallet-demo',
          note: 'Golden flow eligibility settlement'
        }
      });
      setSettlement(JSON.stringify(settled, null, 2));
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main>
      <h1>User Wallet</h1>
      <p>Run one real proof flow end-to-end: generate, verify, settle.</p>

      <SectionCard title="Golden Flow Inputs">
        <label>
          Subject commitment
          <input
            value={subjectCommitment}
            onChange={(e) => setSubjectCommitment(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 6, marginBottom: 12 }}
          />
        </label>
        <label>
          Policy ID
          <input
            type="number"
            value={policyId}
            onChange={(e) => setPolicyId(Number(e.target.value))}
            style={{ display: 'block', width: 180, marginTop: 6, marginBottom: 12 }}
          />
        </label>
        <button onClick={runGoldenFlow}>Generate + Verify + Settle</button>
      </SectionCard>

      {error ? (
        <SectionCard title="Error">
          <pre>{error}</pre>
        </SectionCard>
      ) : null}

      {proof ? (
        <SectionCard title="Proof Artifact">
          <pre>{JSON.stringify(proof, null, 2)}</pre>
        </SectionCard>
      ) : null}

      {verifyResult ? (
        <SectionCard title="Local Verification">
          <pre>{verifyResult}</pre>
        </SectionCard>
      ) : null}

      {settlement ? (
        <SectionCard title="Settlement Result">
          <pre>{settlement}</pre>
        </SectionCard>
      ) : null}
    </main>
  );
}
