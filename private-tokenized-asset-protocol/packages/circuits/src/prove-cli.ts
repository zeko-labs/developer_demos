import { stdin, stdout, stderr } from 'node:process';
import { createO1jsProofEnvelope } from './index.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const raw = await readStdin();
  const parsed = JSON.parse(raw || '{}') as {
    circuitId?: string;
    publicInput?: Record<string, string | number | boolean>;
  };

  if (!parsed.circuitId || !parsed.publicInput) {
    stdout.write(JSON.stringify({ ok: false, reason: 'invalid_request' }));
    process.exitCode = 1;
    return;
  }

  try {
    const proof = await createO1jsProofEnvelope(parsed.circuitId, parsed.publicInput);
    stdout.write(JSON.stringify(proof));
  } catch (error) {
    stderr.write(`${String(error)}\n`);
    stdout.write(
      JSON.stringify({
        ok: false,
        reason: 'o1js_prove_failed',
        detail: String(error)
      })
    );
    process.exitCode = 1;
  }
}

void main();
