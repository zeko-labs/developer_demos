import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

interface PipelineRunResult {
  status: number | null;
  output: string;
  logLines: string[];
}

function createMoonStub(tempDir: string, logPath: string): string {
  const binDir = join(tempDir, "bin");
  const moonPath = join(binDir, "moon");

  spawnSync("mkdir", ["-p", binDir], { stdio: "ignore" });

  const script = `#!/bin/bash
set -euo pipefail
TARGET="\${2:-}"
echo "run:\${TARGET}" >> "\${RUN_POC_TEST_LOG}"

if [ "\${RUN_POC_TEST_FAIL_TARGET:-}" = "\${TARGET}" ]; then
  echo "fail:\${TARGET}" >> "\${RUN_POC_TEST_LOG}"
  exit 1
fi

case "\${TARGET}" in
  mock-server:serve|tlsnotary:notary)
    trap 'echo "killed:'"\${TARGET}"'" >> "\${RUN_POC_TEST_LOG}"; exit 0' TERM INT
    while true; do sleep 1; done
    ;;
  *)
    exit 0
    ;;
esac
`;

  writeFileSync(moonPath, script, "utf8");
  chmodSync(moonPath, 0o755);
  writeFileSync(logPath, "", "utf8");

  return binDir;
}

function runPipeline(options?: { failTarget?: string }): PipelineRunResult {
  const tempDir = mkdtempSync(join(tmpdir(), "run-poc-smoke-"));
  const logPath = join(tempDir, "moon.log");
  const binDir = createMoonStub(tempDir, logPath);
  const cwd = process.cwd();

  const result = spawnSync("bash", ["run-poc.sh"], {
    cwd,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      RUN_POC_TEST_LOG: logPath,
      RUN_POC_TEST_FAIL_TARGET: options?.failTarget ?? "",
      RUN_POC_SKIP_READY_CHECK: "1",
    },
    encoding: "utf8",
    timeout: 60_000,
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    logLines: readFileSync(logPath, "utf8").split(/\r?\n/).filter(Boolean),
  };
}

function expectOrder(logLines: string[], targets: string[]): void {
  const indexes = targets.map((target) => logLines.indexOf(`run:${target}`));
  for (let i = 0; i < indexes.length; i += 1) {
    expect(indexes[i]).toBeGreaterThanOrEqual(0);
    if (i > 0) {
      expect(indexes[i]).toBeGreaterThan(indexes[i - 1]);
    }
  }
}

function expectLogged(logLines: string[], target: string): number {
  const index = logLines.indexOf(`run:${target}`);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe("run-poc smoke behavior", () => {
  it("Given startup orchestration script When inspected Then service startup waits use readiness polling instead of fixed sleeps", () => {
    const script = readFileSync("run-poc.sh", "utf8");

    expect(script).toContain("wait_for_tcp");
    expect(script).not.toContain('sleep "$MOCK_SERVER_STARTUP_DELAY_SEC"');
    expect(script).not.toContain('sleep "$NOTARY_STARTUP_DELAY_SEC"');
  });

  it("Given endpoint override requirements When inspecting run-poc.sh Then dotenv loading can be followed by a TLSN endpoint override", () => {
    const script = readFileSync("run-poc.sh", "utf8");

    expect(script).toContain('if [ -n "${RUN_POC_TLSN_ENDPOINT_OVERRIDE:-}" ]; then');
    expect(script).toContain('export TLSN_ENDPOINT="${RUN_POC_TLSN_ENDPOINT_OVERRIDE}"');
  });

  it("Given successful stage execution When run-poc.sh runs Then startup order and cleanup diagnostics are emitted", () => {
    const result = runPipeline();

    expect(result.status).toBe(0);
    const mockServerIndex = expectLogged(result.logLines, "mock-server:serve");
    expectLogged(result.logLines, "tlsnotary:notary");
    const tlsnProverIndex = expectLogged(result.logLines, "tlsnotary:prover");
    const extractIndex = expectLogged(result.logLines, "poc:extract");
    expect(tlsnProverIndex).toBeLessThan(extractIndex);
    expect(mockServerIndex).toBeLessThan(extractIndex);
    expectOrder(result.logLines, [
      "poc:extract",
      "poc:prove",
      "poc:verify",
      "poc:settle",
      "poc:verify-chain",
    ]);
    expect(result.logLines).toContain("killed:mock-server:serve");
    expect(result.logLines).toContain("killed:tlsnotary:notary");
    expect(result.output).toContain("[run-poc] cleanup complete");
  });

  it("Given a downstream stage failure When run-poc.sh exits Then cleanup runs and failure diagnostics include the failed step", () => {
    const result = runPipeline({ failTarget: "poc:settle" });

    expect(result.status).not.toBe(0);
    expect(result.logLines).toContain("killed:mock-server:serve");
    expect(result.logLines).toContain("killed:tlsnotary:notary");
    expect(result.output).toContain("[run-poc] failed at step: poc:settle");
  });
});
