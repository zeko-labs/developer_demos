<script setup lang="ts">
import { computed } from "vue";

import { artifactEntries, loadManifest, loadProofRecord } from "~~/lib/proof-data";

const route = useRoute();

const runId = computed(() => String(route.params.runId ?? ""));

const breadcrumbs = computed(() => [
  { label: "Directory", to: "/" },
  { label: "Certificate", to: `/proof/${runId.value}` },
  { label: "Full Record" },
]);

const { data, pending } = await useAsyncData(
  () => `proof-detail-${runId.value}`,
  async () => {
    const [record, manifest] = await Promise.all([
      loadProofRecord(runId.value),
      loadManifest(),
    ]);

    return { record, manifest };
  },
  {
    watch: [runId],
  },
);

const runManifest = computed(() =>
  data.value?.manifest.runs.find((run) => run.id === runId.value),
);

const artifactItems = computed(() => {
  if (!runManifest.value) {
    return [];
  }

  return artifactEntries(runManifest.value);
});

const resultValue = computed(() => {
  if (data.value?.record.status === "verified") {
    return "true (Verified)";
  }

  if (data.value?.record.status === "failed") {
    return "false (Failed)";
  }

  return "unknown";
});

const statusItems = computed(() => [
  {
    label: "Result",
    value: resultValue.value,
    mono: true,
    highlight: data.value?.record.status === "verified",
  },
  {
    label: "Evaluation Date",
    value: data.value?.record.evaluationDate ?? "N/A",
    mono: true,
  },
]);

const attestationItems = computed(() => {
  const attestation = data.value?.record.attestation;

  return [
    {
      label: "Signature Algorithm",
      value: attestation?.signature_alg ?? "N/A",
      mono: true,
    },
    {
      label: "Attested Server",
      value: attestation?.server_name ? `${attestation.server_name}:4443` : "N/A",
    },
    {
      label: "Notary Public Key",
      value:
        attestation?.notary_public_key?.x_hex && attestation?.notary_public_key?.y_hex
          ? `x: ${attestation.notary_public_key.x_hex}\ny: ${attestation.notary_public_key.y_hex}`
          : "N/A",
      mono: true,
    },
    {
      label: "ECDSA Signature",
      value:
        attestation?.signature?.r_hex && attestation?.signature?.s_hex
          ? `r: ${attestation.signature.r_hex}\ns: ${attestation.signature.s_hex}`
          : "N/A",
      mono: true,
    },
  ];
});

const zkItems = computed(() => {
  const proof = data.value?.record.proof;

  return [
    {
      label: "Circuit Name",
      value: "employment-eligibility",
      mono: true,
      highlight: true,
    },
    {
      label: "Minimum Salary",
      value:
        typeof proof?.min_salary === "number"
          ? `$${proof.min_salary.toLocaleString("en-US")}`
          : "$50,000",
    },
    {
      label: "Minimum Tenure",
      value:
        typeof proof?.min_tenure_months === "number"
          ? `${proof.min_tenure_months} months`
          : "12 months",
      mono: true,
    },
    {
      label: "Session Header Length",
      value:
        typeof proof?.session_header_length_bytes === "number"
          ? `${proof.session_header_length_bytes} bytes`
          : "N/A",
      mono: true,
    },
  ];
});

const onChainItems = computed(() => {
  const deployed = data.value?.record.deployedAddress;
  const zkAppAddress = deployed?.zkapp_public_key ?? null;
  const settlementTxHash = data.value?.record.settlementTxHash ?? null;
  const deployTxHash = deployed?.deploy_tx_hash ?? null;
  const fullProofValue = data.value?.record.proofHash ?? null;
  const deployTxHref =
    deployTxHash && deployTxHash !== "already-deployed"
      ? `https://zekoscan.io/testnet/tx/${deployTxHash}`
      : undefined;

  const truncatedProofValue = fullProofValue
    ? fullProofValue.length <= 140
      ? fullProofValue
      : `${fullProofValue.slice(0, 108)}...${fullProofValue.slice(-24)}`
    : "";

  return [
    {
      label: "Network",
      value: "Zeko Testnet",
    },
    {
      label: "zkApp Address",
      value: zkAppAddress ?? "N/A",
      href: zkAppAddress
        ? `https://zekoscan.io/testnet/account/${zkAppAddress}`
        : undefined,
      external: true,
      mono: true,
    },
    {
      label: "Settlement Tx Hash",
      value: settlementTxHash ?? "N/A",
      href: settlementTxHash ? `https://zekoscan.io/testnet/tx/${settlementTxHash}` : undefined,
      external: true,
      mono: true,
    },
    {
      label: "Deploy Tx Hash",
      value: deployTxHash ?? "N/A",
      href: deployTxHref,
      external: true,
      mono: true,
    },
    {
      label: "Proof",
      value: truncatedProofValue,
      copyValue: fullProofValue ?? undefined,
      mono: true,
    },
  ];
});

const pipelineSteps = computed(() => {
  if (data.value?.record.status === "failed") {
    return [
      {
        title: "Mock Server Response",
        description: "Fixture employee data was served over HTTPS for attestation capture.",
      },
      {
        title: "TLSNotary Attestation",
        description: "The notary witnessed and signed the employer API response transcript.",
      },
      {
        title: "Disclosed Fields Extraction",
        description: "Required policy fields were extracted without exposing raw payload internals.",
      },
      {
        title: "Eligibility Evaluation",
        description: "Policy constraints evaluated this run as ineligible.",
      },
      {
        title: "Proof Generation",
        description: "Proof generation was skipped because eligibility requirements were not met.",
      },
      {
        title: "Failure Output",
        description: "Failure artifacts were retained for auditing and troubleshooting.",
      },
    ];
  }

  return [
    {
      title: "Mock Server Response",
      description: "Fixture employee data was served over HTTPS for attestation capture.",
    },
    {
      title: "TLSNotary Attestation",
      description: "The notary witnessed and signed the employer API response transcript.",
    },
    {
      title: "Disclosed Fields Extraction",
      description: "Required policy fields were extracted and normalized for the circuit witness.",
    },
    {
      title: "Eligibility Proof Generation",
      description: "Zero-knowledge proof was generated for the employment eligibility circuit.",
    },
    {
      title: "Proof Verification",
      description: "Proof validity was checked against the verification key and public inputs.",
    },
    {
      title: "On-Chain Settlement",
      description: "Verification result was anchored to Zeko Testnet for public auditability.",
    },
  ];
});
</script>

<template>
  <main class="content-page">
    <section class="content-container detail-shell">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <template v-for="(crumb, index) in breadcrumbs" :key="`${crumb.label}-${index}`">
          <NuxtLink v-if="crumb.to" :to="crumb.to" class="crumb-link">
            {{ crumb.label }}
          </NuxtLink>
          <span v-else class="crumb-current">{{ crumb.label }}</span>
          <span v-if="index < breadcrumbs.length - 1" class="crumb-separator">/</span>
        </template>
      </nav>

      <h1 class="record-title">Cryptographic Verification Record</h1>

      <p v-if="pending" class="panel-message">Loading full record...</p>

      <section v-else class="detail-stack">
        <details open class="detail-block">
          <summary>1. Certificate Status</summary>
          <div class="detail-content">
            <KeyValueGrid :items="statusItems" />
          </div>
        </details>

        <details class="detail-block">
          <summary>2. Data Attestation</summary>
          <div class="detail-content">
            <KeyValueGrid :items="attestationItems" />
          </div>
        </details>

        <details class="detail-block">
          <summary>3. Disclosed Fields (Privacy Layer)</summary>
          <div class="detail-content">
            <div class="privacy-box">
              <p><strong>Salary threshold</strong> proven without revealing the raw salary.</p>
              <p><strong>Tenure threshold</strong> proven without revealing the hire date.</p>
              <p><strong>Employment status</strong> proven as active in-circuit.</p>
            </div>
          </div>
        </details>

        <details class="detail-block">
          <summary>4. ZK Computation</summary>
          <div class="detail-content">
            <KeyValueGrid :items="zkItems" />
          </div>
        </details>

        <details class="detail-block">
          <summary>5. On-Chain Settlement</summary>
          <div class="detail-content">
            <KeyValueGrid :items="onChainItems" />
          </div>
        </details>

        <details class="detail-block">
          <summary>6. Pipeline Steps</summary>
          <div class="detail-content">
            <ol class="pipeline-steps">
              <li v-for="item in pipelineSteps" :key="item.title" class="pipeline-step">
                <p class="pipeline-step-title">{{ item.title }}</p>
                <p class="pipeline-step-description">{{ item.description }}</p>
              </li>
            </ol>
          </div>
        </details>

        <details class="detail-block">
          <summary>7. Raw Artifacts</summary>
          <div class="detail-content">
            <ArtifactLinks :items="artifactItems" />
          </div>
        </details>
      </section>
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

.detail-shell {
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

.record-title {
  margin: 0 0 1.55rem;
  border-bottom: 1px solid #284363;
  padding-bottom: 1rem;
  font-size: 2.9rem;
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.detail-stack {
  display: grid;
  gap: 0.85rem;
}

.detail-block {
  overflow: hidden;
  border: 1px solid #284363;
  border-radius: 10px;
  background: rgba(18, 31, 50, 0.9);
}

.detail-block summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  list-style: none;
  cursor: pointer;
  font-size: 1.02rem;
  font-weight: 600;
  padding: 1.08rem 1.2rem;
}

.detail-block summary::-webkit-details-marker {
  display: none;
}

.detail-block summary::after {
  content: "-";
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 1.35rem;
  line-height: 1;
}

.detail-block[open] > summary {
  border-bottom: 1px solid #284363;
}

.detail-content {
  padding: 1.08rem 1.2rem 1.22rem;
}

.privacy-box {
  display: grid;
  gap: 0.78rem;
  border: 1px solid #284363;
  border-radius: 8px;
  background: rgba(7, 12, 22, 0.52);
  color: var(--text-muted);
  padding: 1rem;
}

.privacy-box p {
  margin: 0;
}

.privacy-box strong {
  color: #d8e2f2;
}

.pipeline-steps {
  margin: 0;
  padding-left: 1.25rem;
  display: grid;
  gap: 0.72rem;
}

.pipeline-step {
  border: 1px solid #284363;
  border-radius: 8px;
  background: rgba(7, 12, 22, 0.5);
  padding: 0.88rem 0.95rem;
}

.pipeline-step-title {
  margin: 0;
  color: #dbe5f4;
  font-weight: 600;
}

.pipeline-step-description {
  margin: 0.28rem 0 0;
  color: var(--text-muted);
  font-size: 0.94rem;
}

@media (max-width: 1024px) {
  .content-page {
    padding: 1.4rem 1.1rem 2.25rem;
  }

  .detail-shell {
    max-width: 100%;
  }

  .record-title {
    font-size: 2.05rem;
  }

  .detail-content {
    padding: 0.9rem;
  }
}
</style>
