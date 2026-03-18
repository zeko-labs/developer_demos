import { useEffect, useState } from 'react';
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

  return (
    <main>
      <h1>Auditor Portal</h1>
      <p>Inspect proof mode, verify recent settlements, and review audit trail.</p>

      {error ? (
        <SectionCard title="Error">
          <pre>{error}</pre>
        </SectionCard>
      ) : null}

      <SectionCard title="Runtime Config">
        <pre>{JSON.stringify(config, null, 2)}</pre>
      </SectionCard>

      <SectionCard title="Recent Settlements">
        <pre>{JSON.stringify(recent, null, 2)}</pre>
      </SectionCard>

      <SectionCard title="Policy Snapshot View">
        {records.length === 0 ? <p>No settlements yet.</p> : null}
        {records.map((record) => {
          const metadata = (record.metadata || {}) as Record<string, unknown>;
          return (
            <div key={String(record.settlementId || record.eventId)}>
              <p>
                <strong>{String(record.settlementId || 'settlement')}</strong> status={String(record.status || '')}
              </p>
              <p>
                policySnapshotHash: <code>{String(metadata.policySnapshotHash || 'n/a')}</code>
              </p>
              <p>
                policyEffectiveAt: <code>{String(metadata.policyEffectiveAt || 'n/a')}</code>
              </p>
            </div>
          );
        })}
      </SectionCard>

      <SectionCard title="Semantics">
        <p>
          <code>verified</code> means proof artifact validates under current verifier.
        </p>
        <p>
          <code>anchored</code> means recorded into settlement registry (and later chain mode).
        </p>
      </SectionCard>
    </main>
  );
}
