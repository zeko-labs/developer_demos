<script setup lang="ts">
import { computed, ref } from "vue";

import { loadProofRecord } from "~~/lib/proof-data";

const route = useRoute();

const runId = computed(() => String(route.params.runId ?? ""));

const { data: record, pending } = await useAsyncData(
  () => `proof-overview-${runId.value}`,
  () => loadProofRecord(runId.value),
  {
    watch: [runId],
  },
);

const status = computed(() => record.value?.status ?? "unknown");
const isIneligible = computed(() => status.value === "failed");

const statusLabel = computed(() => {
  if (status.value === "verified") {
    return "VERIFIED";
  }

  if (status.value === "failed") {
    return "FAILED";
  }

  return "UNKNOWN";
});

const statusIcon = computed(() => {
  if (status.value === "verified") {
    return "✓";
  }

  if (status.value === "failed") {
    return "✕";
  }

  return "•";
});

const subtitleText = computed(() => {
  if (isIneligible.value) {
    return "Cryptographic verification shows this record does not satisfy eligibility policy requirements.";
  }

  return "Cryptographically proven policy adherence without data disclosure.";
});

const zkProofCardText = computed(() => {
  if (isIneligible.value) {
    return "No zero-knowledge eligibility proof was produced because policy checks failed.";
  }

  return "Eligibility math was computed locally. Result is guaranteed correct while keeping exact salary and dates entirely hidden.";
});

const settlementCardText = computed(() => {
  if (isIneligible.value) {
    return "Failure metadata is retained for auditability and downstream troubleshooting.";
  }

  return "The verification proof is permanently anchored to the Zeko Testnet for immutable public auditing.";
});

function trustCardTone(index: number): "positive" | "negative" {
  if (status.value === "verified") {
    return "positive";
  }

  return index === 1 ? "positive" : "negative";
}

function truncateProofValue(value: string): string {
  if (value.length <= 140) {
    return value;
  }

  return `${value.slice(0, 108)}...${value.slice(-24)}`;
}

const fullProofValue = computed(() => record.value?.proofHash ?? null);
const truncatedProofValue = computed(() =>
  fullProofValue.value ? truncateProofValue(fullProofValue.value) : "",
);

const copyState = ref<"idle" | "copied" | "error">("idle");

const copyButtonTitle = computed(() => {
  if (copyState.value === "copied") {
    return "Copied";
  }

  if (copyState.value === "error") {
    return "Copy failed";
  }

  return "Copy full proof";
});

async function copyFullProof(): Promise<void> {
  if (
    !fullProofValue.value ||
    typeof navigator === "undefined" ||
    !navigator.clipboard
  ) {
    copyState.value = "error";
    return;
  }

  try {
    await navigator.clipboard.writeText(fullProofValue.value);
    copyState.value = "copied";
  } catch {
    copyState.value = "error";
  }

  setTimeout(() => {
    copyState.value = "idle";
  }, 1500);
}
</script>

<template>
  <main class="content-page">
    <section class="content-container overview-shell">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <NuxtLink to="/" class="crumb-link">Directory</NuxtLink>
        <span class="crumb-separator">/</span>
        <span class="crumb-current">Certificate Overview</span>
      </nav>

      <p v-if="pending" class="panel-message">Loading certificate...</p>

      <article v-else class="certificate-card">
        <header class="certificate-top">
          <span class="hero-status" :class="`is-${status}`">
            <span aria-hidden="true">{{ statusIcon }}</span>
            <span>{{ statusLabel }}</span>
          </span>
          <h1>Employment Eligibility Record</h1>
          <p class="certificate-subtitle">{{ subtitleText }}</p>
        </header>

        <section class="trust-grid">
          <article class="trust-card" :class="`is-${trustCardTone(1)}`">
            <p class="trust-icon" aria-hidden="true">🔐</p>
            <h2>1. Data Attestation</h2>
            <p>
              Origin data was directly witnessed from the employer API via TLSNotary.
              Manipulation is cryptographically impossible.
            </p>
          </article>

          <article class="trust-card" :class="`is-${trustCardTone(2)}`">
            <p class="trust-icon" aria-hidden="true">🛡️</p>
            <h2>2. Zero-Knowledge Proof</h2>
            <p>{{ zkProofCardText }}</p>
          </article>

          <article class="trust-card" :class="`is-${trustCardTone(3)}`">
            <p class="trust-icon" aria-hidden="true">⛓</p>
            <h2>3. On-Chain Settlement</h2>
            <p>{{ settlementCardText }}</p>
          </article>
        </section>

        <dl class="certificate-meta mono">
          <dt>Evaluation Date</dt>
          <dd>{{ record?.evaluationDate ?? "N/A" }}</dd>

          <dt>Run Directory</dt>
          <dd>{{ runId }}</dd>

          <dt>Circuit Name</dt>
          <dd class="highlight">employment-eligibility</dd>

          <dt>Proof</dt>
          <dd class="meta-break proof-field-meta">
            <span class="proof-field-text mono">{{ truncatedProofValue }}</span>
            <button
              v-if="fullProofValue"
              type="button"
              class="copy-proof-btn"
              aria-label="Copy full proof to clipboard"
              :title="copyButtonTitle"
              @click="copyFullProof"
            >
              <svg
                class="copy-proof-icon"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <rect
                  x="9"
                  y="3"
                  width="11"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <rect
                  x="4"
                  y="8"
                  width="11"
                  height="13"
                  rx="2"
                  stroke="currentColor"
                  stroke-width="2"
                />
              </svg>
            </button>
          </dd>
        </dl>

        <NuxtLink :to="`/proof/${runId}/detail`" class="action-link action-link-center">
          VIEW FULL CRYPTOGRAPHIC RECORD
        </NuxtLink>
      </article>
    </section>
  </main>
</template>

<style scoped>
.content-page {
  min-height: 100vh;
  padding: 2.2rem 2.5rem 4rem;
}

.content-container {
  margin: 0 auto;
  max-width: 1240px;
}

.overview-shell {
  max-width: 900px;
}

.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 0.58rem;
  margin-bottom: 1.35rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.98rem;
}

.crumb-link {
  color: var(--accent);
}

.crumb-current {
  color: #95a9c6;
}

.crumb-separator {
  color: #7589a8;
}

.panel-message {
  margin-top: 1.65rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(13, 22, 36, 0.9);
  color: var(--text-muted);
  padding: 1.1rem 1.25rem;
}

.certificate-card {
  position: relative;
  border: 1px solid #284363;
  border-radius: 12px;
  background: linear-gradient(120deg, rgba(18, 31, 50, 0.95), rgba(12, 23, 39, 0.92));
  box-shadow: 0 24px 58px rgba(0, 0, 0, 0.44);
  padding: 3.35rem 3rem 2.35rem;
}

.certificate-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, rgba(0, 247, 200, 0.95), transparent);
}

.certificate-top {
  text-align: center;
}

.hero-status {
  display: inline-flex;
  align-items: center;
  gap: 0.62rem;
  border: 2px solid currentColor;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.22);
  font-family: var(--font-mono);
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  padding: 0.6rem 1.95rem;
  text-transform: uppercase;
  margin-bottom: 1.9rem;
}

.hero-status.is-verified {
  color: var(--accent);
  box-shadow: 0 0 28px rgba(0, 247, 200, 0.2);
}

.hero-status.is-failed {
  color: var(--fail);
  box-shadow: 0 0 28px rgba(255, 87, 87, 0.18);
}

.hero-status.is-unknown {
  color: var(--warn);
  box-shadow: 0 0 28px rgba(255, 202, 86, 0.18);
}

.certificate-card h1 {
  margin: 0;
  font-size: 2.8rem;
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.certificate-subtitle {
  margin-top: 0.95rem;
  color: var(--text-muted);
  font-size: 1.04rem;
}

.trust-grid {
  margin-top: 2.4rem;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.35rem;
}

.trust-card {
  border: 1px solid #284363;
  border-radius: 10px;
  background: rgba(7, 12, 22, 0.56);
  padding: 1.4rem;
}

.trust-card.is-positive {
  border-color: rgba(0, 247, 200, 0.74);
  box-shadow: inset 0 0 0 1px rgba(0, 247, 200, 0.2);
}

.trust-card.is-negative {
  border-color: rgba(255, 87, 87, 0.72);
  box-shadow: inset 0 0 0 1px rgba(255, 87, 87, 0.16);
}

.trust-icon {
  margin: 0 0 0.9rem;
  font-size: 1.45rem;
  line-height: 1;
}

.trust-card h2 {
  margin: 0 0 0.7rem;
  font-size: 1.05rem;
  font-weight: 600;
}

.trust-card p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.97rem;
  line-height: 1.45;
}

.certificate-meta {
  margin-top: 2rem;
  border: 1px solid #284363;
  border-radius: 10px;
  background: rgba(7, 12, 22, 0.54);
  padding: 1.3rem;
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 0.78rem 1.18rem;
  font-size: 1rem;
}

.certificate-meta dt {
  color: #95a9c6;
}

.certificate-meta dd {
  margin: 0;
  color: #d8e2f2;
  overflow-wrap: anywhere;
}

.proof-field-meta {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  flex-wrap: nowrap;
}

.proof-field-text {
  flex: 1;
  min-height: 1.2rem;
}

.copy-proof-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 2rem;
  height: 2rem;
  min-width: 2rem;
  min-height: 2rem;
  border: 1px solid rgba(0, 247, 200, 0.7);
  border-radius: 6px;
  background: rgba(0, 247, 200, 0.1);
  color: var(--accent);
  cursor: pointer;
  padding: 0;
}

.copy-proof-btn:hover {
  background: rgba(0, 247, 200, 0.18);
}

.copy-proof-icon {
  width: 0.95rem;
  height: 0.95rem;
}

.meta-break {
  word-break: break-all;
}

.highlight {
  color: var(--accent);
}

.action-link {
  display: flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  border: 1px solid #05070b;
  border-radius: 6px;
  background: #ffffff;
  color: #05070b;
  font-family: var(--font-mono);
  font-size: 0.83rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  line-height: 1;
  padding: 0.82rem 1.18rem;
  text-transform: uppercase;
}

.action-link-center {
  margin: 1.1rem auto 0;
}

@media (max-width: 1024px) {
  .content-page {
    padding: 1.4rem 1.1rem 2.25rem;
  }

  .overview-shell {
    max-width: 100%;
  }

  .certificate-card {
    padding: 2.25rem 1.15rem 1.4rem;
  }

  .certificate-card h1 {
    font-size: 2rem;
  }

  .hero-status {
    font-size: 0.95rem;
    letter-spacing: 0.15em;
    padding: 0.5rem 1.35rem;
  }

  .trust-grid {
    grid-template-columns: 1fr;
    margin-top: 1.8rem;
  }

  .certificate-meta {
    grid-template-columns: 1fr;
    gap: 0.24rem;
    margin-top: 1.5rem;
    padding: 1rem;
  }
}
</style>
