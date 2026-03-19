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
    <main className="app-shell wallet-shell">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">End-user proof surface</span>
          <h1>Generate, verify, and settle one real TAP proof flow from a wallet-facing experience.</h1>
          <p className="hero-copy">
            This view makes the protocol tangible for customers and partners: a private subject commitment, one active
            policy, one proof artifact, one settlement result.
          </p>
        </div>
        <div className="hero-callout">
          <span>Flow</span>
          <strong>Create proof</strong>
          <strong>Verify locally</strong>
          <strong>Record settlement</strong>
        </div>
      </section>

      <div className="content-grid two-up">
        <SectionCard title="Golden Flow Inputs">
          <p className="section-intro">Use the default demo subject or plug in a different commitment to simulate another user.</p>
          <label className="field-label">
            Subject commitment
            <input value={subjectCommitment} onChange={(e) => setSubjectCommitment(e.target.value)} />
          </label>
          <label className="field-label">
            Policy ID
            <input type="number" value={policyId} onChange={(e) => setPolicyId(Number(e.target.value))} />
          </label>
          <button className="primary-button" onClick={runGoldenFlow}>
            Generate + Verify + Settle
          </button>
        </SectionCard>

        <SectionCard title="What This Proves">
          <div className="bullet-stack">
            <p>Proof creation is policy-scoped, not generic.</p>
            <p>Verification happens before settlement, not after the fact.</p>
            <p>Settlement records the proof artifact and the governing metadata.</p>
          </div>
        </SectionCard>
      </div>

      {error ? (
        <SectionCard title="Error">
          <pre className="result-block">{error}</pre>
        </SectionCard>
      ) : null}

      {proof ? (
        <SectionCard title="Proof Artifact">
          <pre className="result-block">{JSON.stringify(proof, null, 2)}</pre>
        </SectionCard>
      ) : null}

      <div className="content-grid two-up">
        {verifyResult ? (
          <SectionCard title="Local Verification">
            <pre className="result-block">{verifyResult}</pre>
          </SectionCard>
        ) : null}

        {settlement ? (
          <SectionCard title="Settlement Result">
            <pre className="result-block">{settlement}</pre>
          </SectionCard>
        ) : null}
      </div>
    </main>
  );
}
