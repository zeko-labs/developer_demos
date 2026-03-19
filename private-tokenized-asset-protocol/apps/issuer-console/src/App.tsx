import { useEffect, useMemo, useState } from 'react';
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

  const pendingCount = useMemo(
    () => issuerRequests.filter((record) => String(record.status || '') === 'requested').length,
    [issuerRequests]
  );
  const approvedCount = useMemo(
    () => issuerRequests.filter((record) => String(record.status || '') === 'approved').length,
    [issuerRequests]
  );

  return (
    <main className="app-shell issuer-shell">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">Consortium issuer surface</span>
          <h1>Run policy-controlled mint and approval workflows with a public-facing control room.</h1>
          <p className="hero-copy">
            This pilot UI shows the issuer side of TAP: reserve-aware mint requests, maker-checker approvals, and
            policy-linked settlement snapshots for private stablecoin operations.
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat-card">
            <span>API runtime</span>
            <strong>{health}</strong>
          </div>
          <div className="stat-card">
            <span>Pending approvals</span>
            <strong>{pendingCount}</strong>
          </div>
          <div className="stat-card">
            <span>Approved requests</span>
            <strong>{approvedCount}</strong>
          </div>
        </div>
      </section>

      <div className="content-grid two-up">
        <SectionCard title="Create Mint Request">
          <p className="section-intro">
            Start a new issuer-controlled stablecoin mint request under the active consortium policy profile.
          </p>
          <button className="primary-button" onClick={createMintRequest}>
            Create Demo Mint Request
          </button>
          {mintResult ? <pre className="result-block">{mintResult}</pre> : null}
        </SectionCard>

        <SectionCard title="Policy Snapshot Feed">
          <p className="section-intro">Recent settlement records show which policy snapshot governed the action.</p>
          {recentSettlements.length === 0 ? <p className="muted">No settlements yet.</p> : null}
          <div className="stack-list">
            {recentSettlements.map((record) => {
              const metadata = (record.metadata || {}) as Record<string, unknown>;
              return (
                <article className="list-row" key={String(record.settlementId || record.eventId)}>
                  <div>
                    <strong>{String(record.settlementId || 'settlement')}</strong>
                    <p>Effective {String(metadata.policyEffectiveAt || 'n/a')}</p>
                  </div>
                  <code>{String(metadata.policySnapshotHash || 'n/a')}</code>
                </article>
              );
            })}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Maker-Checker Queue">
        <p className="section-intro">
          Review live issuer requests and action them through the same approval controls a consortium team would use.
        </p>
        {issuerRequests.length === 0 ? <p className="muted">No issuer requests yet.</p> : null}
        <div className="stack-list">
          {issuerRequests.map((record) => {
            const requestId = String(record.requestId || '');
            const kind = String(record.kind || 'mint') as 'mint' | 'burn';
            const status = String(record.status || '');
            return (
              <article className="request-row" key={requestId}>
                <div>
                  <div className="request-meta">
                    <strong>{requestId}</strong>
                    <span className={`status-pill status-${status}`}>{status}</span>
                  </div>
                  <p>
                    kind <code>{kind}</code>
                  </p>
                </div>
                {status === 'requested' ? (
                  <div className="button-row">
                    <button className="primary-button" onClick={() => approveRequest(kind, requestId)}>
                      Approve
                    </button>
                    <button className="secondary-button" onClick={() => rejectRequest(kind, requestId)}>
                      Reject
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        {queueResult ? <pre className="result-block">{queueResult}</pre> : null}
      </SectionCard>
    </main>
  );
}
