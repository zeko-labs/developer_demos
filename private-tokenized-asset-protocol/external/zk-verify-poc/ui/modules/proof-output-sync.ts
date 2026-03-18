import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { defineNuxtModule } from "nuxt/kit";
import {
  deriveProofDirectoryRunMetadata,
  type ProofDataManifestRunSummary,
} from "../lib/proof-data";

const TIMESTAMP_RUN_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;
const MINIMUM_RENDERABLE_ARTIFACT_FILES = new Set(["attestation.json", "disclosed-fields.json"]);

interface ProofDataManifestRun {
  id: string;
  filesPresent: string[];
  timestamp: string | null;
  summary: ProofDataManifestRunSummary;
}

interface ProofDataManifest {
  generatedAt: string;
  latestRunId: string | null;
  runs: ProofDataManifestRun[];
}

export interface ProofOutputSyncOptions {
  sourceDir?: string;
  publicDir?: string;
  includeRootMetadata?: boolean;
}

const DEFAULT_OPTIONS: Required<ProofOutputSyncOptions> = {
  sourceDir: "../output",
  publicDir: "proof-data",
  includeRootMetadata: true,
};

interface ProofPayload {
  proof?:
    | {
        publicOutput?: string[];
      }
    | string;
}

function toTimestamp(runId: string): string | null {
  const match = runId.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function listFiles(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }

  return readdirSync(directoryPath)
    .filter((entry) => statSync(join(directoryPath, entry)).isFile())
    .sort();
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

function readOptionalText(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function extractProofPublicOutput(proof: ProofPayload | null): string[] | undefined {
  if (!proof?.proof || typeof proof.proof === "string") {
    return undefined;
  }

  return proof.proof.publicOutput;
}

export function createManifestRunSummary(input: {
  runId: string;
  filesPresent: string[];
  proofText: string | null;
}): ProofDataManifestRunSummary {
  const proof = parseJsonText<ProofPayload>(input.proofText);

  return deriveProofDirectoryRunMetadata({
    runId: input.runId,
    publicOutput: extractProofPublicOutput(proof),
    hasDisclosedFields: input.filesPresent.includes("disclosed-fields.json"),
  });
}

export function selectTimestampRunDirs(entries: string[]): string[] {
  return entries
    .filter((entry) => TIMESTAMP_RUN_DIR_PATTERN.test(entry))
    .sort((left, right) => right.localeCompare(left));
}

export function selectCompleteTimestampRunDirs(
  runEntries: Array<{ id: string; filesPresent: string[] }>,
): string[] {
  return Array.from(
    new Set(
      runEntries
        .filter(
          (entry) =>
            TIMESTAMP_RUN_DIR_PATTERN.test(entry.id) &&
            Array.from(MINIMUM_RENDERABLE_ARTIFACT_FILES).every((fileName) =>
              entry.filesPresent.includes(fileName),
            ),
        )
        .map((entry) => entry.id),
    ),
  ).sort((left, right) => right.localeCompare(left));
}

function createEmptyManifest(): ProofDataManifest {
  return {
    generatedAt: new Date().toISOString(),
    latestRunId: null,
    runs: [],
  };
}

function syncProofOutput(
  rootDir: string,
  options: Required<ProofOutputSyncOptions>,
): ProofDataManifest {
  const sourceOutputDir = resolve(rootDir, options.sourceDir);
  const targetBaseDir = resolve(rootDir, "public", options.publicDir);
  const targetRunsDir = join(targetBaseDir, "runs");

  rmSync(targetBaseDir, { force: true, recursive: true });
  mkdirSync(targetRunsDir, { recursive: true });

  if (!existsSync(sourceOutputDir)) {
    const manifest = createEmptyManifest();
    writeFileSync(
      join(targetBaseDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    return manifest;
  }

  const directoryEntries = readdirSync(sourceOutputDir).filter((entry) => {
    const entryPath = join(sourceOutputDir, entry);
    return statSync(entryPath).isDirectory();
  });

  const runEntries = directoryEntries.map((entry) => {
    const sourceRunPath = join(sourceOutputDir, entry);
    return {
      id: entry,
      filesPresent: listFiles(sourceRunPath),
    };
  });

  const runIds = selectCompleteTimestampRunDirs(runEntries);
  const runEntryById = new Map(runEntries.map((entry) => [entry.id, entry]));

  const runs: ProofDataManifestRun[] = [];

  for (const runId of runIds) {
    const sourceRunPath = join(sourceOutputDir, runId);
    const targetRunPath = join(targetRunsDir, runId);

    cpSync(sourceRunPath, targetRunPath, { recursive: true });

    const filesPresent = runEntryById.get(runId)?.filesPresent ?? listFiles(targetRunPath);
    const proofText = filesPresent.includes("proof.json")
      ? readOptionalText(join(sourceRunPath, "proof.json"))
      : null;

    runs.push({
      id: runId,
      filesPresent,
      timestamp: toTimestamp(runId),
      summary: createManifestRunSummary({
        runId,
        filesPresent,
        proofText,
      }),
    });
  }

  if (options.includeRootMetadata) {
    const sourceDeployedAddress = join(sourceOutputDir, "deployed-address.json");
    const targetDeployedAddress = join(targetBaseDir, "deployed-address.json");

    if (existsSync(sourceDeployedAddress)) {
      cpSync(sourceDeployedAddress, targetDeployedAddress, { force: true });
    }
  }

  const manifest: ProofDataManifest = {
    generatedAt: new Date().toISOString(),
    latestRunId: runIds[0] ?? null,
    runs,
  };

  writeFileSync(
    join(targetBaseDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

export default defineNuxtModule<ProofOutputSyncOptions>({
  meta: {
    name: "proof-output-sync",
    configKey: "proofOutputSync",
  },
  defaults: DEFAULT_OPTIONS,
  setup(options, nuxt) {
    const mergedOptions: Required<ProofOutputSyncOptions> = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    const manifest = syncProofOutput(nuxt.options.rootDir, mergedOptions);

    if (nuxt.options.dev) {
      const count = manifest.runs.length;
      // eslint-disable-next-line no-console
      console.log(`[proof-output-sync] copied ${count} run(s) into public assets`);
    }
  },
});
