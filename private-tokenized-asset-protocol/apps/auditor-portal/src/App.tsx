import { useEffect, useMemo, useState } from 'react';
import { SectionCard } from '@tap/ui-kit';
import { TapClient } from '@tap/sdk';

const client = new TapClient(import.meta.env.VITE_API_BASE_URL || 'http://localhost:7001');

export function App() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [recent, setRecent] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const records = Array.isArray((recent as { records?: unknown[] } | null)?.records)
    ? ((recent as { records?: unknown[] }).records as Array<Record<string, unknown>>)
    : [];

  useEffect(() => {
    Promise.all([client.config(), client.recentSettlements()])
      .then(([cfg, rec]) => {
        setConfig(cfg);
        setRecent(rec);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const anchoredCount = useMemo(
    () => records.filter((record) => Boolean(record.anchored)).length,
    [records]
  );

  return (
    <main className="app-shell auditor-shell">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">Audit and verification surface</span>
          <h1>Inspect runtime posture, recent settlements, and policy-linked records from one public-facing portal.</h1>
          <p className="hero-copy">
            This portal is the transparency layer for operators, counterparties, and reviewers who need to see what mode
            the system is in and how recent settlement artifacts were recorded.
          </p>
        </div>
        <div className="hero-stats">
          <div className="stat-card">
            <span>Recent records</span>
            <strong>{records.length}</strong>
          </div>
          <div className="stat-card">
            <span>Anchored</span>
            <strong>{anchoredCount}</strong>
          </div>
          <div className="stat-card">
            <span>Proof mode</span>
            <strong>{String(config?.proofMode || 'loading')}</strong>
          </div>
        </div>
      </section>

      {error ? (
        <SectionCard title="Error">
          <pre className="result-block">{error}</pre>
        </SectionCard>
      ) : null}

      <div className="content-grid two-up">
        <SectionCard title="Runtime Config">
          <pre className="result-block">{JSON.stringify(config, null, 2)}</pre>
        </SectionCard>

        <SectionCard title="Settlement Feed">
          <pre className="result-block">{JSON.stringify(recent, null, 2)}</pre>
        </SectionCard>
      </div>

      <SectionCard title="Policy Snapshot View">
        {records.length === 0 ? <p className="muted">No settlements yet.</p> : null}
        <div className="stack-list">
          {records.map((record) => {
            const metadata = (record.metadata || {}) as Record<string, unknown>;
            return (
              <article className="list-row" key={String(record.settlementId || record.eventId)}>
                <div>
                  <strong>{String(record.settlementId || 'settlement')}</strong>
                  <p>Status {String(record.status || '')}</p>
                </div>
                <div className="mini-stack">
                  <code>{String(metadata.policySnapshotHash || 'n/a')}</code>
                  <code>{String(metadata.policyEffectiveAt || 'n/a')}</code>
                </div>
              </article>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Semantics">
        <div className="bullet-stack">
          <p>
            <code>verified</code> means the proof artifact validates under the active verifier path.
          </p>
          <p>
            <code>anchored</code> means the record has been written into the settlement registry surface.
          </p>
        </div>
      </SectionCard>
    </main>
  );
}
