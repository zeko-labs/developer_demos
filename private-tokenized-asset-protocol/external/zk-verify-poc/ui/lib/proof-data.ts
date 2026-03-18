export type ProofStatus = "verified" | "failed" | "unknown";

export interface ProofDataManifestRunSummary {
  status: ProofStatus;
  runDate: string;
  network: string;
}

export interface ProofDataManifestRun {
  id: string;
  filesPresent: string[];
  timestamp: string | null;
  summary: ProofDataManifestRunSummary;
}

export interface ProofDataManifest {
  generatedAt: string | null;
  latestRunId: string | null;
  runs: ProofDataManifestRun[];
}

interface AttestationPayload {
  session_header_bytes_hex?: string;
  signature?: {
    r_hex?: string;
    s_hex?: string;
  };
  notary_public_key?: {
    x_hex?: string;
    y_hex?: string;
  };
  server_name?: string;
  timestamp?: number;
  signature_alg?: string;
}

interface DisclosedFieldsPayload {
  data_commitment?: string;
  status_hash?: string;
  salary?: number;
  hire_date_unix?: number;
  notary_public_key?: {
    x?: string;
    y?: string;
  };
  ecdsa_signature?: {
    r?: string;
    s?: string;
  };
}

interface ProofPayload {
  min_salary?: number;
  min_tenure_months?: number;
  current_date_unix_ms?: number;
  session_header_length_bytes?: number;
  proof?:
    | {
        publicInput?: string[];
        publicOutput?: string[];
        proof?: string;
      }
    | string;
}

interface VerificationKeyPayload {
  hash?: string;
}

interface DeployedAddressPayload {
  zkapp_public_key?: string;
  deploy_tx_hash?: string;
  verification_key_hash?: string;
}

interface SettlementPayload {
  settlement_tx_hash?: string;
  tx_hash?: string;
}

export interface ProofSummary {
  runId: string;
  runDate: string;
  status: ProofStatus;
  proofHash: string | null;
  network: string;
}

export interface ProofRecord {
  runId: string;
  status: ProofStatus;
  proofHash: string | null;
  evaluationDate: string | null;
  attestation: AttestationPayload | null;
  disclosedFields: DisclosedFieldsPayload | null;
  proof: ProofPayload | null;
  verificationKey: VerificationKeyPayload | null;
  deployedAddress: DeployedAddressPayload | null;
  settlement: SettlementPayload | null;
  settlementTxHash: string | null;
}

const DEFAULT_MANIFEST: ProofDataManifest = {
  generatedAt: null,
  latestRunId: null,
  runs: [],
};

const ARTIFACT_FILES = [
  "attestation.json",
  "disclosed-fields.json",
  "proof.json",
  "verification-key.json",
] as const;

export const DEFAULT_PROOF_NETWORK = "Zeko Testnet";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeRunSummaryStatus(
  input: unknown,
  fallback: ProofDataManifestRunSummary["status"],
): ProofDataManifestRunSummary["status"] {
  if (input === "verified" || input === "failed" || input === "unknown") {
    return input;
  }

  return fallback;
}

function normalizeManifestRunSummary(
  input: unknown,
  fallback: ProofDataManifestRunSummary,
): ProofDataManifestRunSummary {
  if (!isObject(input)) {
    return fallback;
  }

  return {
    status: normalizeRunSummaryStatus(input.status, fallback.status),
    runDate:
      typeof input.runDate === "string" && input.runDate.length > 0
        ? input.runDate
        : fallback.runDate,
    network:
      typeof input.network === "string" && input.network.length > 0
        ? input.network
        : fallback.network,
  };
}

export function normalizeManifest(input: unknown): ProofDataManifest {
  if (!isObject(input) || !Array.isArray(input.runs)) {
    return { ...DEFAULT_MANIFEST };
  }

  const runs = input.runs
    .filter((entry): entry is Record<string, unknown> => isObject(entry))
    .map((entry) => {
      const id = typeof entry.id === "string" ? entry.id : "";
      const filesPresent = Array.isArray(entry.filesPresent)
        ? entry.filesPresent.filter((value): value is string => typeof value === "string")
        : [];
      const fallbackSummary = deriveProofDirectoryRunMetadata({
        runId: id,
        hasDisclosedFields: filesPresent.includes("disclosed-fields.json"),
      });

      return {
        id,
        filesPresent,
        timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null,
        summary: normalizeManifestRunSummary(entry.summary, fallbackSummary),
      };
    })
    .filter((entry) => entry.id.length > 0);

  return {
    generatedAt: typeof input.generatedAt === "string" ? input.generatedAt : null,
    latestRunId: typeof input.latestRunId === "string" ? input.latestRunId : null,
    runs,
  };
}

export function deriveProofStatus(publicOutput: string[] | undefined): ProofStatus {
  if (!publicOutput || publicOutput.length === 0) {
    return "unknown";
  }

  return publicOutput[0] === "1" ? "verified" : "failed";
}

export function deriveRunStatus(input: {
  publicOutput?: string[];
  hasDisclosedFields: boolean;
}): ProofStatus {
  const statusFromProof = deriveProofStatus(input.publicOutput);
  if (statusFromProof !== "unknown") {
    return statusFromProof;
  }

  if (input.hasDisclosedFields) {
    return "failed";
  }

  return "unknown";
}

export function deriveProofDirectoryRunMetadata(input: {
  runId: string;
  publicOutput?: string[];
  hasDisclosedFields: boolean;
  network?: string | null;
}): ProofDataManifestRunSummary {
  return {
    status: deriveRunStatus({
      publicOutput: input.publicOutput,
      hasDisclosedFields: input.hasDisclosedFields,
    }),
    runDate: runIdToDateLabel(input.runId),
    network:
      typeof input.network === "string" && input.network.length > 0
        ? input.network
        : DEFAULT_PROOF_NETWORK,
  };
}

function deriveSettlementTxHash(settlement: SettlementPayload | null): string | null {
  if (
    typeof settlement?.settlement_tx_hash === "string" &&
    settlement.settlement_tx_hash.length > 0
  ) {
    return settlement.settlement_tx_hash;
  }

  if (typeof settlement?.tx_hash === "string" && settlement.tx_hash.length > 0) {
    return settlement.tx_hash;
  }

  return null;
}

function parseRunIdToDate(runId: string): Date | null {
  const match = runId.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ),
  );

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatUtcDateTime(date: Date): string {
  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hour = pad2(date.getUTCHours());
  const minute = pad2(date.getUTCMinutes());
  const second = pad2(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function runIdToDateLabel(runId: string): string {
  const parsed = parseRunIdToDate(runId);
  if (!parsed) {
    return runId;
  }

  return formatUtcDateTime(parsed);
}

function toDateLabelFromUnixMs(unixMs: number | undefined): string | null {
  if (typeof unixMs !== "number" || Number.isNaN(unixMs)) {
    return null;
  }

  const parsed = new Date(unixMs);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseJsonText<T>(input: string | null): T | null {
  if (typeof input !== "string") {
    return null;
  }

  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

async function fetchOptionalJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchOptionalText(path: string): Promise<string | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

export function normalizeProofPayload(input: string | null): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const parsed = parseJsonText<unknown>(input);
  if (parsed !== null) {
    return JSON.stringify(parsed);
  }

  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function selectProofFieldValue(
  status: ProofStatus,
  normalizedProofValue: string | null,
): string | null {
  if (status === "failed") {
    return null;
  }

  return normalizedProofValue;
}

function extractProofPublicOutput(proof: ProofPayload | null): string[] | undefined {
  if (!proof?.proof || typeof proof.proof === "string") {
    return undefined;
  }

  return proof.proof.publicOutput;
}

export function extractProofPreviewValue(proof: ProofPayload | null): string | null {
  if (!proof?.proof) {
    return null;
  }

  if (typeof proof.proof === "string") {
    const trimmed = proof.proof.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof proof.proof.proof === "string") {
    const trimmed = proof.proof.proof.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const serialized = JSON.stringify(proof.proof);
  return serialized === "{}" ? null : serialized;
}

export async function loadManifest(): Promise<ProofDataManifest> {
  const manifest = await fetchOptionalJson<ProofDataManifest>("/proof-data/manifest.json");
  return normalizeManifest(manifest);
}

export async function loadRunSummary(runId: string): Promise<ProofSummary> {
  const proofPath = `/proof-data/runs/${runId}/proof.json`;
  const [disclosedFields, proofText] = await Promise.all([
    fetchOptionalJson<DisclosedFieldsPayload>(`/proof-data/runs/${runId}/disclosed-fields.json`),
    fetchOptionalText(proofPath),
  ]);

  const proof = parseJsonText<ProofPayload>(proofText);
  const status = deriveRunStatus({
    publicOutput: extractProofPublicOutput(proof),
    hasDisclosedFields: disclosedFields !== null,
  });
  const proofHash = selectProofFieldValue(status, extractProofPreviewValue(proof));
  const summary = deriveProofDirectoryRunMetadata({
    runId,
    publicOutput: extractProofPublicOutput(proof),
    hasDisclosedFields: disclosedFields !== null,
  });

  return {
    runId,
    proofHash,
    ...summary,
  };
}

export async function loadProofRecord(runId: string): Promise<ProofRecord> {
  const proofPath = `/proof-data/runs/${runId}/proof.json`;

  const [attestation, disclosedFields, proofText, verificationKey, deployedAddress, settlement] =
    await Promise.all([
      fetchOptionalJson<AttestationPayload>(`/proof-data/runs/${runId}/attestation.json`),
      fetchOptionalJson<DisclosedFieldsPayload>(`/proof-data/runs/${runId}/disclosed-fields.json`),
      fetchOptionalText(proofPath),
      fetchOptionalJson<VerificationKeyPayload>(`/proof-data/runs/${runId}/verification-key.json`),
      fetchOptionalJson<DeployedAddressPayload>("/proof-data/deployed-address.json"),
      fetchOptionalJson<SettlementPayload>(`/proof-data/runs/${runId}/settlement.json`),
    ]);

  const proof = parseJsonText<ProofPayload>(proofText);
  const status = deriveRunStatus({
    publicOutput: extractProofPublicOutput(proof),
    hasDisclosedFields: disclosedFields !== null,
  });
  const proofHash = selectProofFieldValue(status, extractProofPreviewValue(proof));
  const settlementTxHash = deriveSettlementTxHash(settlement);

  return {
    runId,
    status,
    proofHash,
    evaluationDate:
      toDateLabelFromUnixMs(proof?.current_date_unix_ms) ??
      runIdToDateLabel(runId).split(" ")[0] ??
      runId,
    attestation,
    disclosedFields,
    proof,
    verificationKey,
    deployedAddress,
    settlement,
    settlementTxHash,
  };
}

export function artifactEntries(run: ProofDataManifestRun) {
  const filesPresent = new Set(run.filesPresent);

  return ARTIFACT_FILES.map((fileName) => ({
    fileName,
    available: filesPresent.has(fileName),
    href: `/proof-data/runs/${run.id}/${fileName}`,
  }));
}
