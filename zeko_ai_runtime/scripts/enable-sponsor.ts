import 'dotenv/config';
import path from 'node:path';
import process from 'node:process';
import { promises as fs } from 'node:fs';
import { PrivateKey } from 'o1js';

function getSecret(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function promptHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error('A TTY is required to securely prompt for the sponsor key.');
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return await new Promise((resolve, reject) => {
    let value = '';

    const cleanup = () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Cancelled by user.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value.trim());
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    process.stdin.on('data', onData);
  });
}

async function main() {
  const sponsorKey = getSecret('SPONSOR_PRIVATE_KEY') || (await promptHidden('Sponsor private key: '));
  if (!sponsorKey) {
    throw new Error('Missing sponsor private key.');
  }

  const sponsor = PrivateKey.fromBase58(sponsorKey);
  const sponsorPublicKey = sponsor.toPublicKey().toBase58();
  const deploymentDir = path.join(process.cwd(), 'data', 'deployments');
  const sponsorKeyPath = path.join(deploymentDir, 'sponsor-private-key.txt');

  await fs.mkdir(deploymentDir, { recursive: true });
  await fs.writeFile(sponsorKeyPath, `${sponsorKey}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        sponsorPublicKey,
        sponsorKeyPath
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[sponsor:enable] failed', error);
  process.exit(1);
});
