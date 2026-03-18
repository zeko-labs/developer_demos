import { readFileSync } from "node:fs";
import { createServer, type ServerOptions } from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TLS_VERSION_OPTIONS = {
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
} as const;

export const EMPLOYEE_RECORD = {
  employee_id: "EMP-001",
  first_name: "Jane",
  last_name: "Doe",
  ssn_last4: "1234",
  employment_status: "active",
  hire_date: "2023-06-15",
  annual_salary: 85000,
  employer_name: "Acme Corp",
};

export const INELIGIBLE_EMPLOYEE_RECORD = {
  employee_id: "EMP-002",
  first_name: "Alex",
  last_name: "Smith",
  ssn_last4: "5678",
  employment_status: "active",
  hire_date: "2023-06-15",
  annual_salary: 49000,
  employer_name: "Acme Corp",
};

export const BANK_ACCOUNT_RECORD = {
  account_id: "BANK-001",
  account_status: "active",
  currency: "USD",
  current_balance_cents: 125000,
  available_balance_cents: 120000,
  kyc_passed: true,
  as_of_date: "2026-02-18",
  institution_name: "Acme Bank",
};

export const INELIGIBLE_BANK_ACCOUNT_RECORD = {
  account_id: "BANK-002",
  account_status: "active",
  currency: "USD",
  current_balance_cents: 9000,
  available_balance_cents: 9000,
  kyc_passed: false,
  as_of_date: "2026-02-18",
  institution_name: "Acme Bank",
};

const EMPLOYEE_RECORDS = {
  [EMPLOYEE_RECORD.employee_id]: EMPLOYEE_RECORD,
  [INELIGIBLE_EMPLOYEE_RECORD.employee_id]: INELIGIBLE_EMPLOYEE_RECORD,
} as const;

const BANK_ACCOUNT_RECORDS = {
  [BANK_ACCOUNT_RECORD.account_id]: BANK_ACCOUNT_RECORD,
  [INELIGIBLE_BANK_ACCOUNT_RECORD.account_id]: INELIGIBLE_BANK_ACCOUNT_RECORD,
} as const;

const DEFAULT_PORT = 4443;
const FILE_DIR = dirname(fileURLToPath(import.meta.url));

export interface TlsFilePaths {
  certPath: string;
  keyPath: string;
}

interface StartMockServerOptions {
  port?: number;
  certPath?: string;
  keyPath?: string;
}

function readTlsFile(path: string, label: "cert" | "key"): Buffer {
  try {
    return readFileSync(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read TLS ${label} file at ${path}: ${message}`);
  }
}

function resolveTlsFilePaths(input?: Partial<TlsFilePaths>): TlsFilePaths {
  return {
    certPath: input?.certPath ?? resolve(FILE_DIR, "cert.pem"),
    keyPath: input?.keyPath ?? resolve(FILE_DIR, "key.pem"),
  };
}

export function createTlsServerOptions(input?: Partial<TlsFilePaths>): ServerOptions {
  const { certPath, keyPath } = resolveTlsFilePaths(input);

  return {
    cert: readTlsFile(certPath, "cert"),
    key: readTlsFile(keyPath, "key"),
    ...TLS_VERSION_OPTIONS,
  };
}

export function startMockServer(options?: number | StartMockServerOptions): void {
  const port = typeof options === "number" ? options : (options?.port ?? DEFAULT_PORT);
  const tlsOptions = typeof options === "number" ? undefined : options;
  const serverOptions = createTlsServerOptions(tlsOptions);

  const server = createServer(serverOptions, (req, res) => {
    const routeMatch = req.url?.match(/^\/api\/v1\/employee\/([A-Za-z0-9-]+)$/);
    const employeeId = routeMatch?.[1];
    const employeeRecord = employeeId
      ? EMPLOYEE_RECORDS[employeeId as keyof typeof EMPLOYEE_RECORDS]
      : undefined;
    const url = req.url ? new URL(req.url, `https://localhost:${port}`) : null;
    const bankAccountId =
      url?.pathname === "/api/v1/accounts/balance" ? url.searchParams.get("account_id") : null;
    const bankRecord = bankAccountId
      ? BANK_ACCOUNT_RECORDS[bankAccountId as keyof typeof BANK_ACCOUNT_RECORDS]
      : undefined;

    if (req.method === "GET" && employeeRecord) {
      res.writeHead(200, {
        "content-type": "application/json",
        connection: "close",
      });
      res.end(JSON.stringify(employeeRecord));
      return;
    }

    if (req.method === "GET" && bankRecord) {
      res.writeHead(200, {
        "content-type": "application/json",
        connection: "close",
      });
      res.end(JSON.stringify(bankRecord));
      return;
    }

    res.writeHead(404, {
      "content-type": "application/json",
      connection: "close",
    });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  server.listen(port, () => {
    console.log(`[mock-server] Listening on https://localhost:${port}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startMockServer();
}
