import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { deriveProofStatus, normalizeManifest } from "../lib/proof-data";
import { selectTimestampRunDirs } from "../modules/proof-output-sync";

describe("ui contract behavior", () => {
  it("Given Nuxt SPA requirements When reading ui/nuxt.config.ts Then SSR is explicitly disabled", () => {
    const configPath = resolve(process.cwd(), "nuxt.config.ts");
    const source = readFileSync(configPath, "utf8");

    expect(source).toMatch(/ssr\s*:\s*false/);
  });

  it("Given mixed output names When selecting timestamp run directories Then only timestamp directories are retained", () => {
    expect(
      selectTimestampRunDirs(["latest", "notes", "2026-02-19T04-24-17", "2026-02-18T22-03-05"]),
    ).toEqual(["2026-02-19T04-24-17", "2026-02-18T22-03-05"]);
  });

  it("Given proof outputs When deriving status Then verified failed and unknown are mapped deterministically", () => {
    expect(deriveProofStatus(["1"])).toBe("verified");
    expect(deriveProofStatus(["0"])).toBe("failed");
    expect(deriveProofStatus([])).toBe("unknown");
  });

  it("Given missing manifest data When normalizing manifest Then empty defaults are returned", () => {
    expect(normalizeManifest(undefined)).toEqual({
      generatedAt: null,
      latestRunId: null,
      runs: [],
    });
  });

  it("Given run directory identifiers When formatting for UI Then full datetime is preserved", async () => {
    const proofLib = await import("../lib/proof-data");
    expect(proofLib.runIdToDateLabel("2026-02-19T04-24-17")).toBe("2026-02-19 04:24:17");
  });

  it("Given proof artifact payload text When normalizing for UI display Then minified proof text is returned", async () => {
    const proofLib = await import("../lib/proof-data");

    expect(typeof (proofLib as Record<string, unknown>).normalizeProofPayload).toBe("function");

    const normalizeProofPayload = (
      proofLib as { normalizeProofPayload?: (input: string | null) => string | null }
    ).normalizeProofPayload;

    if (!normalizeProofPayload) {
      return;
    }

    expect(normalizeProofPayload('{\n  "proof":"sample"\n}\n')).toBe('{"proof":"sample"}');
    expect(normalizeProofPayload(null)).toBeNull();
  });

  it("Given proof preview requirements When selecting preview source Then proof payload property is preferred over whole JSON text", async () => {
    const proofLib = await import("../lib/proof-data");
    const extractProofPreviewValue = (
      proofLib as {
        extractProofPreviewValue?: (
          proof: {
            proof?: { proof?: string; publicInput?: string[] };
          } | null,
        ) => string | null;
      }
    ).extractProofPreviewValue;

    expect(typeof extractProofPreviewValue).toBe("function");

    if (!extractProofPreviewValue) {
      return;
    }

    expect(
      extractProofPreviewValue({
        proof: {
          proof: "proof-bytes",
          publicInput: ["1"],
        },
      }),
    ).toBe("proof-bytes");

    expect(
      extractProofPreviewValue({
        proof: {
          publicInput: ["1"],
        },
      }),
    ).toBe('{"publicInput":["1"]}');
  });

  it("Given timestamp-named run directories When filtering by renderable artifact sets Then ineligible runs are included and unknown-only runs are excluded", async () => {
    const syncModule = await import("../modules/proof-output-sync");
    const selectCompleteTimestampRunDirs = (
      syncModule as {
        selectCompleteTimestampRunDirs?: (
          runEntries: Array<{ id: string; filesPresent: string[] }>,
        ) => string[];
      }
    ).selectCompleteTimestampRunDirs;

    expect(typeof selectCompleteTimestampRunDirs).toBe("function");

    if (!selectCompleteTimestampRunDirs) {
      return;
    }

    expect(
      selectCompleteTimestampRunDirs([
        {
          id: "2026-02-19T04-24-17",
          filesPresent: [
            "attestation.json",
            "disclosed-fields.json",
            "proof.json",
            "verification-key.json",
          ],
        },
        {
          id: "2026-02-19T06-11-06",
          filesPresent: ["attestation.json", "disclosed-fields.json"],
        },
        { id: "2026-02-19T03-59-59", filesPresent: ["tlsnotary-notary.log"] },
      ]),
    ).toEqual(["2026-02-19T06-11-06", "2026-02-19T04-24-17"]);
  });

  it("Given duplicate complete run ids When filtering renderable run directories Then duplicate run ids are removed", async () => {
    const syncModule = await import("../modules/proof-output-sync");
    const selectCompleteTimestampRunDirs = (
      syncModule as {
        selectCompleteTimestampRunDirs?: (
          runEntries: Array<{ id: string; filesPresent: string[] }>,
        ) => string[];
      }
    ).selectCompleteTimestampRunDirs;

    expect(typeof selectCompleteTimestampRunDirs).toBe("function");

    if (!selectCompleteTimestampRunDirs) {
      return;
    }

    expect(
      selectCompleteTimestampRunDirs([
        {
          id: "2026-02-19T04-24-17",
          filesPresent: ["attestation.json", "disclosed-fields.json", "proof.json"],
        },
        {
          id: "2026-02-19T04-24-17",
          filesPresent: ["attestation.json", "disclosed-fields.json", "proof.json"],
        },
      ]),
    ).toEqual(["2026-02-19T04-24-17"]);
  });

  it("Given ineligible artifact presence When deriving run status Then missing proof output is classified as failed", async () => {
    const proofLib = await import("../lib/proof-data");
    const deriveRunStatus = (
      proofLib as {
        deriveRunStatus?: (input: {
          publicOutput?: string[];
          hasDisclosedFields: boolean;
        }) => string;
      }
    ).deriveRunStatus;

    expect(typeof deriveRunStatus).toBe("function");

    if (!deriveRunStatus) {
      return;
    }

    expect(
      deriveRunStatus({
        publicOutput: undefined,
        hasDisclosedFields: true,
      }),
    ).toBe("failed");
  });

  it("Given full-record on-chain section requirements When inspecting detail page source Then ZekoScan transaction and account links are present", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/pages/proof/[runId]/detail.vue"),
      "utf8",
    );

    expect(source).toContain("https://zekoscan.io/testnet/account/");
    expect(source).toContain("https://zekoscan.io/testnet/tx/");
  });

  it("Given settlement metadata requirements When inspecting proof record contracts Then settlement tx data is not sourced from deploy_tx_hash", () => {
    const detailSource = readFileSync(
      resolve(process.cwd(), "app/pages/proof/[runId]/detail.vue"),
      "utf8",
    );
    const proofDataSource = readFileSync(resolve(process.cwd(), "lib/proof-data.ts"), "utf8");

    expect(proofDataSource).toContain("settlement.json");
    expect(detailSource).toContain('label: "Deploy Tx Hash"');
    expect(detailSource).not.toContain("const txHash = deployed?.deploy_tx_hash ?? null;");
  });

  it("Given full-record attestation requirements When inspecting detail page source Then notary key and signature values are not truncated", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/pages/proof/[runId]/detail.vue"),
      "utf8",
    );

    expect(source).toContain("x: ${attestation.notary_public_key.x_hex}");
    expect(source).toContain("r: ${attestation.signature.r_hex}");
    expect(source).not.toContain("attestation.notary_public_key.x_hex.slice");
    expect(source).not.toContain("attestation.signature.r_hex.slice");
  });

  it("Given ineligible run status When selecting proof field value Then ineligible values are empty", async () => {
    const proofLib = await import("../lib/proof-data");
    const selectProofFieldValue = (
      proofLib as {
        selectProofFieldValue?: (
          status: "verified" | "failed" | "unknown",
          normalizedProofValue: string | null,
        ) => string | null;
      }
    ).selectProofFieldValue;

    expect(typeof selectProofFieldValue).toBe("function");

    if (!selectProofFieldValue) {
      return;
    }

    expect(selectProofFieldValue("failed", '{"proof":"sample"}')).toBeNull();
    expect(selectProofFieldValue("verified", '{"proof":"sample"}')).toBe('{"proof":"sample"}');
  });

  it("Given UI typecheck requirements When inspecting ui moon task config Then typecheck target exists and validate depends on it", () => {
    const moonConfig = readFileSync(resolve(process.cwd(), "moon.yml"), "utf8");

    expect(moonConfig).toContain("typecheck:");
    expect(moonConfig).toContain("pnpm exec nuxi typecheck");
    expect(moonConfig).toContain('- "ui:typecheck"');
  });

  it("Given manifest summary metadata When normalizing manifest Then status date and network fields are preserved with safe fallbacks", () => {
    expect(
      normalizeManifest({
        generatedAt: "2026-02-25T12:00:00.000Z",
        latestRunId: "2026-02-19T06-11-06",
        runs: [
          {
            id: "2026-02-19T06-11-06",
            filesPresent: ["attestation.json", "disclosed-fields.json", "proof.json"],
            timestamp: "2026-02-19T06:11:06.000Z",
            summary: {
              status: "verified",
              runDate: "2026-02-19 06:11:06",
              network: "Zeko Testnet",
            },
          },
          {
            id: "2026-02-19T04-24-17",
            filesPresent: ["attestation.json", "disclosed-fields.json"],
            timestamp: "2026-02-19T04:24:17.000Z",
            summary: {
              status: "not-a-status",
              runDate: 42,
              network: "",
            },
          },
        ],
      }),
    ).toEqual({
      generatedAt: "2026-02-25T12:00:00.000Z",
      latestRunId: "2026-02-19T06-11-06",
      runs: [
        {
          id: "2026-02-19T06-11-06",
          filesPresent: ["attestation.json", "disclosed-fields.json", "proof.json"],
          timestamp: "2026-02-19T06:11:06.000Z",
          summary: {
            status: "verified",
            runDate: "2026-02-19 06:11:06",
            network: "Zeko Testnet",
          },
        },
        {
          id: "2026-02-19T04-24-17",
          filesPresent: ["attestation.json", "disclosed-fields.json"],
          timestamp: "2026-02-19T04:24:17.000Z",
          summary: {
            status: "failed",
            runDate: "2026-02-19 04:24:17",
            network: "Zeko Testnet",
          },
        },
      ],
    });
  });

  it("Given copied proof artifacts When generating manifest row summary Then sync emits status date and network metadata", async () => {
    const syncModule = await import("../modules/proof-output-sync");
    const createManifestRunSummary = (
      syncModule as {
        createManifestRunSummary?: (input: {
          runId: string;
          filesPresent: string[];
          proofText: string | null;
        }) => { status: string; runDate: string; network: string };
      }
    ).createManifestRunSummary;

    expect(typeof createManifestRunSummary).toBe("function");

    if (!createManifestRunSummary) {
      return;
    }

    expect(
      createManifestRunSummary({
        runId: "2026-02-19T06-11-06",
        filesPresent: ["attestation.json", "disclosed-fields.json", "proof.json"],
        proofText: JSON.stringify({
          proof: {
            publicOutput: ["1"],
          },
        }),
      }),
    ).toEqual({
      status: "verified",
      runDate: "2026-02-19 06:11:06",
      network: "Zeko Testnet",
    });

    expect(
      createManifestRunSummary({
        runId: "2026-02-19T04-24-17",
        filesPresent: ["attestation.json", "disclosed-fields.json"],
        proofText: null,
      }),
    ).toEqual({
      status: "failed",
      runDate: "2026-02-19 04:24:17",
      network: "Zeko Testnet",
    });
  });

  it("Given directory page manifest summary requirements When inspecting directory source Then loadRunSummary Promise.all hydration is not used", () => {
    const source = readFileSync(resolve(process.cwd(), "app/pages/index.vue"), "utf8");

    expect(source).not.toContain("loadRunSummary");
    expect(source).not.toContain("Promise.all(manifest.runs.map");
    expect(source).toContain("run.summary");
  });
});
