import { buildDisclosedFields } from "./lib/disclosure.js";
import { readJsonFile, writeJsonFile } from "./lib/io.js";
import { outputDir } from "./lib/paths.js";

const ATTESTATION_PATH = `${outputDir()}/attestation.json`;
const DISCLOSED_PATH = `${outputDir()}/disclosed-fields.json`;

async function main(): Promise<void> {
  const attestation = await readJsonFile<unknown>(ATTESTATION_PATH);
  const disclosed = buildDisclosedFields(attestation);

  await writeJsonFile(DISCLOSED_PATH, disclosed);

  if (disclosed.source_profile === "bank") {
    console.log(
      `[extract-fields] Disclosed current_balance_cents=${disclosed.current_balance_cents}, statement_as_of_unix=${disclosed.statement_as_of_unix}`,
    );
  } else {
    console.log(
      `[extract-fields] Disclosed annual_salary=${disclosed.salary}, hire_date_unix=${disclosed.hire_date_unix}`,
    );
  }
  console.log(`[extract-fields] Saved ${DISCLOSED_PATH}`);
}

main().catch((error: unknown) => {
  console.error("[extract-fields] failed:", error);
  process.exit(1);
});
