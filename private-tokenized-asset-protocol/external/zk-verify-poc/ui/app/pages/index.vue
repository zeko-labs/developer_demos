<script setup lang="ts">
import { computed } from "vue";

import { loadManifest, normalizeManifest } from "~~/lib/proof-data";

const { data, pending } = await useAsyncData(
  "proof-directory",
  async () => {
    const manifest = await loadManifest();
    const runs = manifest.runs.map((run) => ({
      runId: run.id,
      status: run.summary.status,
      runDate: run.summary.runDate,
      network: run.summary.network,
    }));

    return {
      manifest,
      runs,
    };
  },
  {
    default: () => ({
      manifest: normalizeManifest(undefined),
      runs: [],
    }),
  },
);

const orderedRuns = computed(() => {
  const sorted = [...data.value.runs].sort((left, right) =>
    right.runId.localeCompare(left.runId),
  );

  const seenRunDates = new Set<string>();

  return sorted.filter((run) => {
    if (seenRunDates.has(run.runDate)) {
      return false;
    }

    seenRunDates.add(run.runDate);
    return true;
  });
});

const totalCount = computed(() => orderedRuns.value.length);
const verifiedCount = computed(
  () => orderedRuns.value.filter((run) => run.status === "verified").length,
);
const failedCount = computed(
  () => orderedRuns.value.filter((run) => run.status === "failed").length,
);
const visibleRuns = computed(() => orderedRuns.value);

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
</script>

<template>
  <main class="directory-page">
    <section class="directory-container">
      <header class="directory-header">
        <h1 class="directory-brand">
          <span class="brand-name">zkVerify</span>
          <span class="brand-divider">//</span>
          <span class="brand-mark">PROOF_EXPLORER</span>
        </h1>

        <section class="stats-row">
          <article class="stat-chip">
            <span>Total</span>
            <strong>{{ formatCount(totalCount) }}</strong>
          </article>
          <article class="stat-chip">
            <span>Verified</span>
            <strong class="stat-positive">{{ formatCount(verifiedCount) }}</strong>
          </article>
          <article class="stat-chip">
            <span>Failed</span>
            <strong class="stat-negative">{{ formatCount(failedCount) }}</strong>
          </article>
        </section>
      </header>

      <p v-if="pending" class="directory-empty">Loading proof directory...</p>

      <p v-else-if="visibleRuns.length === 0" class="directory-empty">
        No timestamped runs found in <code>output/</code>. Run
        <code>moon run workspace:run</code> and restart
        <code>moon run ui:dev</code>.
      </p>

      <section v-else class="directory-table">
        <header class="directory-row directory-row-head">
          <span class="directory-cell">Status</span>
          <span class="directory-cell">Circuit Name</span>
          <span class="directory-cell">Date</span>
          <span class="directory-cell">Network</span>
        </header>

        <NuxtLink
          v-for="run in visibleRuns"
          :key="run.runId"
          :to="`/proof/${run.runId}`"
          class="directory-row directory-row-link"
        >
          <span class="directory-cell status-cell">
            <span class="directory-mobile-label">Status</span>
            <StatusBadge :status="run.status" />
          </span>
          <span class="directory-cell circuit-cell">
            <span class="directory-mobile-label">Circuit</span>
            <span class="circuit-pill mono">employment-eligibility</span>
          </span>
          <span class="directory-cell date-cell">
            <span class="directory-mobile-label">Date</span>
            <time class="cell-value">{{ run.runDate }}</time>
          </span>
          <span class="directory-cell network-cell">
            <span class="directory-mobile-label">Network</span>
            <span class="cell-value">{{ run.network }}</span>
          </span>
        </NuxtLink>
      </section>
    </section>
  </main>
</template>

<style scoped>
.directory-page {
  min-height: 100vh;
  padding: 2.2rem 2.5rem 4rem;
}

.directory-container {
  margin: 0 auto;
  max-width: 1240px;
}

.directory-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--border);
  padding-bottom: 1rem;
}

.directory-brand {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin: 0;
  font-size: 2.2rem;
  font-weight: 650;
  letter-spacing: -0.03em;
  line-height: 1;
}

.brand-name {
  color: #d4dcec;
}

.brand-divider {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 1.35rem;
  font-weight: 500;
}

.brand-mark {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 1.1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.9rem;
}

.stat-chip {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.85rem;
  min-width: 132px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.7rem 0.95rem;
  background: rgba(13, 22, 36, 0.9);
  font-family: var(--font-mono);
  font-size: 0.98rem;
}

.stat-chip span {
  color: #c8d3e7;
}

.stat-chip strong {
  color: #f2f6fe;
  font-size: 1.15rem;
  font-weight: 600;
}

.stat-positive {
  color: var(--accent) !important;
}

.stat-negative {
  color: var(--fail) !important;
}

.directory-empty {
  margin-top: 1.65rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(13, 22, 36, 0.9);
  color: var(--text-muted);
  padding: 1.1rem 1.25rem;
}

.directory-table {
  --directory-columns: minmax(0, 1fr) minmax(0, 3fr) minmax(0, 1.7fr) minmax(0, 1.8fr);
  margin-top: 2rem;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(13, 22, 36, 0.92);
  box-shadow: 0 22px 52px rgba(0, 0, 0, 0.45);
}

.directory-row {
  display: grid;
  grid-template-columns: var(--directory-columns);
  gap: 1.1rem;
  align-items: center;
  border-top: 1px solid rgba(44, 68, 98, 0.85);
  padding: 1.15rem 1.55rem;
}

.directory-row:first-child {
  border-top: none;
}

.directory-row-head {
  border-top: none;
  background: rgba(6, 13, 24, 0.96);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.86rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.directory-row-link {
  transition: background 160ms ease;
}

.directory-row-link:hover {
  background: var(--bg-hover);
}

.directory-cell {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 1.4rem;
}

.status-cell {
  justify-content: flex-start;
}

.circuit-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid #4a5d7d;
  border-radius: 4px;
  background: #28374c;
  color: #d8e3f4;
  font-size: 0.82rem;
  line-height: 1.1;
  padding: 0.24rem 0.54rem;
}

.directory-mobile-label {
  display: none;
}

.date-cell,
.network-cell,
.cell-value {
  font-family: var(--font-mono);
  font-size: 1rem;
}

.date-cell .cell-value,
.network-cell .cell-value {
  white-space: nowrap;
}

@media (max-width: 1024px) {
  .directory-page {
    padding: 1.4rem 1.1rem 2.25rem;
  }

  .directory-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .directory-brand {
    font-size: 1.95rem;
  }

  .directory-table {
    border: none;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    overflow: visible;
  }

  .directory-row {
    grid-template-columns: 1fr;
    gap: 0.58rem;
    padding: 0.95rem 1rem;
  }

  .directory-row-head {
    display: none;
  }

  .directory-row-link {
    border: 1px solid #284363;
    border-radius: 10px;
    background: rgba(13, 22, 36, 0.92);
    margin-bottom: 0.72rem;
  }

  .directory-row-link:last-child {
    margin-bottom: 0;
  }

  .directory-cell {
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 0;
  }

  .directory-mobile-label {
    display: inline-flex;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.74rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .status-cell,
  .circuit-cell {
    justify-content: flex-start;
    gap: 0.58rem;
  }
}
</style>
