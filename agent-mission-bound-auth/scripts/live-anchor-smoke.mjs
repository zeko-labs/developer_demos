import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function runAnchor(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["scripts/anchor-private-compute-receipt.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `anchor exited ${code}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

const payload = {
  authCommitment: digest({ kind: "auth", smoke: Date.now() }),
  datasetCommitment: digest({ kind: "dataset", datasetId: "clinical-failures-q1" }),
  policyHash: digest({ kind: "policy", disclosure: "aggregate-output-only" }),
  outputHash: digest({ kind: "output", answer: "sealed aggregate risk summary" }),
  paymentContextDigest: digest({ kind: "payment", rail: "zeko", model: "x402" })
};

const result = await runAnchor(payload);
console.log(JSON.stringify(result, null, 2));
