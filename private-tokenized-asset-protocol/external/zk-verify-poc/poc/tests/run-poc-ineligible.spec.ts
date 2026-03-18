import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function createPipelineStub(tempDir: string, scriptBody: string): string {
  const stubPath = join(tempDir, "pipeline-stub.sh");
  writeFileSync(stubPath, scriptBody, "utf8");
  chmodSync(stubPath, 0o755);
  return stubPath;
}

describe("ineligible pipeline task contracts", () => {
  it("Given workspace Moon task definitions When inspected Then run-ineligible invokes run-poc-ineligible.sh", () => {
    const source = readFileSync("moon.yml", "utf8");

    expect(source).toMatch(/run-ineligible:\s*\n\s*command:\s*['"]\.\/run-poc-ineligible\.sh['"]/m);
  });

  it("Given an expected prove-stage rejection When run-poc-ineligible.sh executes Then it exits successfully", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-poc-ineligible-"));
    const stubPath = createPipelineStub(
      tempDir,
      `#!/bin/bash
set -euo pipefail
echo "endpoint:\${TLSN_ENDPOINT:-unset}"
echo "[run-poc] failed at step: poc:prove" >&2
echo "[prove] failed: Error: salary 49000 is below required minimum 50000" >&2
exit 1
`,
    );

    const result = spawnSync("bash", ["run-poc-ineligible.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RUN_POC_INELIGIBLE_PIPELINE_CMD: stubPath,
      },
      encoding: "utf8",
      timeout: 30_000,
    });

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(result.status).toBe(0);
    expect(output).toContain("endpoint:/api/v1/employee/EMP-002");
    expect(output).toContain("proof rejected as expected");
  });

  it("Given an inherited eligible endpoint When run-poc-ineligible.sh executes Then it overrides TLSN_ENDPOINT to the ineligible endpoint", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-poc-ineligible-"));
    const stubPath = createPipelineStub(
      tempDir,
      `#!/bin/bash
set -euo pipefail
echo "endpoint:\${TLSN_ENDPOINT:-unset}"
echo "[run-poc] failed at step: poc:prove" >&2
echo "[prove] failed: Error: salary 49000 is below required minimum 50000" >&2
exit 1
`,
    );

    const result = spawnSync("bash", ["run-poc-ineligible.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TLSN_ENDPOINT: "/api/v1/employee/EMP-001",
        RUN_POC_INELIGIBLE_PIPELINE_CMD: stubPath,
      },
      encoding: "utf8",
      timeout: 30_000,
    });

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(result.status).toBe(0);
    expect(output).toContain("endpoint:/api/v1/employee/EMP-002");
  });

  it("Given dotenv loading rewrites TLSN_ENDPOINT When run-poc-ineligible.sh executes Then the ineligible override is reapplied for the pipeline", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-poc-ineligible-"));
    const dotenvPath = join(tempDir, ".env");
    writeFileSync(dotenvPath, "TLSN_ENDPOINT=/api/v1/employee/EMP-001\n", "utf8");

    const stubPath = createPipelineStub(
      tempDir,
      `#!/bin/bash
set -euo pipefail
if [ -f "\${RUN_POC_INELIGIBLE_DOTENV_PATH:-}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "\${RUN_POC_INELIGIBLE_DOTENV_PATH}"
  set +a
fi
if [ -n "\${RUN_POC_TLSN_ENDPOINT_OVERRIDE:-}" ]; then
  export TLSN_ENDPOINT="\${RUN_POC_TLSN_ENDPOINT_OVERRIDE}"
fi
echo "endpoint:\${TLSN_ENDPOINT:-unset}"
echo "[run-poc] failed at step: poc:prove" >&2
echo "[prove] failed: Error: salary 49000 is below required minimum 50000" >&2
exit 1
`,
    );

    const result = spawnSync("bash", ["run-poc-ineligible.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RUN_POC_INELIGIBLE_DOTENV_PATH: dotenvPath,
        RUN_POC_INELIGIBLE_PIPELINE_CMD: stubPath,
      },
      encoding: "utf8",
      timeout: 30_000,
    });

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(result.status).toBe(0);
    expect(output).toContain("endpoint:/api/v1/employee/EMP-002");
  });

  it("Given a command-style override with quoted arguments When run-poc-ineligible.sh executes Then it preserves override arguments and succeeds", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-poc-ineligible-"));
    const stubPath = createPipelineStub(
      tempDir,
      `#!/bin/bash
set -euo pipefail
echo "arg1:\${1:-unset}"
echo "arg2:\${2:-unset}"
echo "arg3:\${3:-unset}"
echo "arg4:\${4:-unset}"
echo "endpoint:\${TLSN_ENDPOINT:-unset}"
echo "[run-poc] failed at step: poc:prove" >&2
echo "[prove] failed: Error: salary 49000 is below required minimum 50000" >&2
exit 1
`,
    );

    const result = spawnSync("bash", ["run-poc-ineligible.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RUN_POC_INELIGIBLE_PIPELINE_CMD: `${stubPath} --note "hello world" --tag 'with spaces'`,
      },
      encoding: "utf8",
      timeout: 30_000,
    });

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(result.status).toBe(0);
    expect(output).toContain("arg1:--note");
    expect(output).toContain("arg2:hello world");
    expect(output).toContain("arg3:--tag");
    expect(output).toContain("arg4:with spaces");
    expect(output).toContain("endpoint:/api/v1/employee/EMP-002");
    expect(output).toContain("proof rejected as expected");
  });

  it("Given a failure outside prove stage When run-poc-ineligible.sh executes Then it exits with diagnostics", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-poc-ineligible-"));
    const stubPath = createPipelineStub(
      tempDir,
      `#!/bin/bash
set -euo pipefail
echo "[run-poc] failed at step: tlsnotary:prover" >&2
exit 1
`,
    );

    const result = spawnSync("bash", ["run-poc-ineligible.sh"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RUN_POC_INELIGIBLE_PIPELINE_CMD: stubPath,
      },
      encoding: "utf8",
      timeout: 30_000,
    });

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    expect(result.status).not.toBe(0);
    expect(output).toContain("expected failure step: poc:prove");
  });
});
