import { useEffect, useState } from 'react';
import { TapClient } from '@tap/sdk';
import { SectionCard } from '@tap/ui-kit';

const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:7001';
const makerClient = new TapClient(baseUrl, { apiKey: import.meta.env.VITE_ISSUER_MAKER_API_KEY });
const checkerClient = new TapClient(baseUrl, { apiKey: import.meta.env.VITE_ISSUER_CHECKER_API_KEY });
const healthClient = new TapClient(baseUrl);

export function App() {
  const [health, setHealth] = useState<string>('loading');
  const [mintResult, setMintResult] = useState('');
  const [queueResult, setQueueResult] = useState('');
  const [recentSettlements, setRecentSettlements] = useState<Record<string, unknown>[]>([]);
  const [issuerRequests, setIssuerRequests] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    healthClient
      .health()
      .then((h) => setHealth(`${h.status} (${h.service})`))
      .catch(() => setHealth('error'));

    healthClient
      .recentSettlements()
      .then((result) => {
        const records = Array.isArray((result as { records?: unknown[] }).records)
          ? (((result as { records?: unknown[] }).records || []) as Record<string, unknown>[])
          : [];
        setRecentSettlements(records.slice(0, 5));
      })
      .catch(() => setRecentSettlements([]));

    void refreshIssuerRequests();
  }, []);

  async function refreshIssuerRequests() {
    const response = (await makerClient.listIssuerRequests()) as { records?: Record<string, unknown>[] };
    setIssuerRequests(response.records || []);
  }

  async function createMintRequest() {
    const result = await makerClient.requestMint({
      issuerId: 'issuer_demo_bank',
      recipientCommitment: 'subj_demo_001',
      amountCents: '100000',
      assetId: 1,
      tenantId: 'tenant-a',
      policyId: 1
    });
    setMintResult(JSON.stringify(result, null, 2));
    await refreshIssuerRequests();
  }

  async function approveRequest(kind: 'mint' | 'burn', requestId: string) {
    const result = await checkerClient.approveIssuerRequest(kind, requestId, 'checker approval');
    setQueueResult(JSON.stringify(result, null, 2));
    await refreshIssuerRequests();
  }

  async function rejectRequest(kind: 'mint' | 'burn', requestId: string) {
    const result = await checkerClient.rejectIssuerRequest(kind, requestId, 'checker rejection');
    setQueueResult(JSON.stringify(result, null, 2));
    await refreshIssuerRequests();
  }

  return (
    <main>
      <h1>Issuer Console</h1>
      <p>Consortium policy, mint/burn workflow, and reserve controls.</p>

      <SectionCard title="System Health">
        <p>
          API status: <code>{health}</code>
        </p>
      </SectionCard>

      <SectionCard title="Mint Request Demo">
        <button onClick={createMintRequest}>Create Mint Request</button>
        {mintResult ? <pre>{mintResult}</pre> : null}
      </SectionCard>

      <SectionCard title="Maker-Checker Queue">
        {issuerRequests.length === 0 ? <p>No issuer requests.</p> : null}
        {issuerRequests.map((record) => {
          const requestId = String(record.requestId || '');
          const kind = String(record.kind || 'mint') as 'mint' | 'burn';
          const status = String(record.status || '');
          return (
            <p key={requestId}>
              <code>{requestId}</code> kind=<code>{kind}</code> status=<code>{status}</code>{' '}
              {status === 'requested' ? (
                <>
                  <button onClick={() => approveRequest(kind, requestId)}>Approve</button>{' '}
                  <button onClick={() => rejectRequest(kind, requestId)}>Reject</button>
                </>
              ) : null}
            </p>
          );
        })}
        {queueResult ? <pre>{queueResult}</pre> : null}
      </SectionCard>

      <SectionCard title="Recent Policy Snapshots">
        {recentSettlements.length === 0 ? <p>No settlements yet.</p> : null}
        {recentSettlements.map((record) => {
          const metadata = (record.metadata || {}) as Record<string, unknown>;
          return (
            <p key={String(record.settlementId || record.eventId)}>
              <code>{String(record.settlementId || 'settlement')}</code> policy=
              <code>{String(metadata.policySnapshotHash || 'n/a')}</code> effective=
              <code>{String(metadata.policyEffectiveAt || 'n/a')}</code>
            </p>
          );
        })}
      </SectionCard>
    </main>
  );
}
