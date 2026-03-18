import { verify } from "o1js";

import { type AttestationJson, parseAttestationJson } from "./lib/attestation.js";
import { buildDisclosedFields } from "./lib/disclosure.js";
import { readJsonFile } from "./lib/io.js";
import { outputDir } from "./lib/paths.js";
import { hashUtf8StringPoseidon } from "./lib/poseidon.js";

const PROOF_PATH = `${outputDir()}/proof.json`;
const VK_PATH = `${outputDir()}/verification-key.json`;
const ATTESTATION_PATH = `${outputDir()}/attestation.json`;

interface StoredProof {
  proof: {
    publicInput: string[];
    publicOutput: string[];
    maxProofsVerified: 0 | 1 | 2;
    proof: string;
  };
}

interface StoredVerificationKey {
  data: string;
}

async function main(): Promise<void> {
  const storedProof = await readJsonFile<StoredProof>(PROOF_PATH);
  const verificationKey = await readJsonFile<StoredVerificationKey>(VK_PATH);

  const isValid = await verify(storedProof.proof, verificationKey.data);
  console.log(`[verify] Proof valid: ${isValid}`);

  if (!isValid) {
    process.exit(1);
  }

  const attestationRaw = await readJsonFile<unknown>(ATTESTATION_PATH);
  const attestation: AttestationJson = parseAttestationJson(attestationRaw);

  const expectedResponseBodyHash = hashUtf8StringPoseidon(attestation.response_body).toString();
  const proofResponseBodyHash = storedProof.proof.publicOutput[1];

  if (proofResponseBodyHash !== expectedResponseBodyHash) {
    console.error(
      `[verify] Attestation binding failed: proof responseBodyHash ${proofResponseBodyHash} does not match attestation response body hash ${expectedResponseBodyHash}`,
    );
    process.exit(1);
  }

  console.log("[verify] Attestation binding check passed: responseBodyHash matches");

  const disclosed = buildDisclosedFields(attestationRaw);
  const proofDataCommitment = storedProof.proof.publicInput[0];

  if (proofDataCommitment !== disclosed.data_commitment) {
    console.error(
      `[verify] Data commitment binding failed: proof dataCommitment ${proofDataCommitment} does not match re-derived commitment ${disclosed.data_commitment}`,
    );
    process.exit(1);
  }

  console.log(
    "[verify] Data commitment binding check passed: commitment matches attestation fields",
  );
}

main().catch((error: unknown) => {
  console.error("[verify] failed:", error);
  process.exit(1);
});
