import { buildPrivateStateMerkleSnapshot } from './private-state-merkle.js';

async function main() {
  const snapshot = await buildPrivateStateMerkleSnapshot();
  console.log(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  console.error('[zkapp:inspect-private-state-merkle] failed', error);
  process.exit(1);
});
