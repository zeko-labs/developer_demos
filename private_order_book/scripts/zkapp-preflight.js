import { access } from 'node:fs/promises';
import path from 'node:path';

function hasEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const root = process.cwd();
  const distDeploy = path.resolve(root, 'dist-zkapp', 'deploy.js');
  const distCommit = path.resolve(root, 'dist-zkapp', 'commit-next-batch.js');
  const distProve = path.resolve(root, 'dist-zkapp', 'prove-private-state-batch.js');
  const batchFile = path.resolve(root, 'data', 'settlement-batches.json');

  const report = {
    ok: true,
    zkapp: {
      graphqlConfigured: hasEnv('ZEKO_GRAPHQL'),
      deployerPrivateKeyConfigured: hasEnv('DEPLOYER_PRIVATE_KEY'),
      zkappPrivateKeyConfigured: hasEnv('ZKAPP_PRIVATE_KEY'),
      zkappPublicKeyConfigured: hasEnv('ZKAPP_PUBLIC_KEY'),
      operatorPublicKeyConfigured: hasEnv('OPERATOR_PUBLIC_KEY'),
      vaultConfigured: hasEnv('VAULT_DEPOSIT_ADDRESS'),
      compiledArtifactsPresent: {
        deploy: await exists(distDeploy),
        commitNext: await exists(distCommit),
        provePrivateState: await exists(distProve)
      },
      settlementBatchFilePresent: await exists(batchFile)
    }
  };

  report.zkapp.readyToDeploy = Boolean(
    report.zkapp.graphqlConfigured &&
      report.zkapp.deployerPrivateKeyConfigured &&
      report.zkapp.zkappPrivateKeyConfigured
  );
  report.zkapp.readyToCommit = Boolean(
    report.zkapp.graphqlConfigured &&
      report.zkapp.deployerPrivateKeyConfigured &&
      report.zkapp.zkappPublicKeyConfigured &&
      report.zkapp.compiledArtifactsPresent.commitNext
  );

  report.nextSteps = [];
  if (
    !report.zkapp.compiledArtifactsPresent.deploy ||
    !report.zkapp.compiledArtifactsPresent.commitNext ||
    !report.zkapp.compiledArtifactsPresent.provePrivateState
  ) {
    report.nextSteps.push('Run `pnpm build:zkapp`.');
  }
  if (!report.zkapp.readyToDeploy) {
    report.nextSteps.push('Set `ZEKO_GRAPHQL`, `DEPLOYER_PRIVATE_KEY`, and `ZKAPP_PRIVATE_KEY`.');
  }
  if (report.zkapp.readyToDeploy && !report.zkapp.zkappPublicKeyConfigured) {
    report.nextSteps.push('After deploy, set `ZKAPP_PUBLIC_KEY` for commit/get-state flows.');
  }
  if (report.zkapp.readyToCommit && !report.zkapp.settlementBatchFilePresent) {
    report.nextSteps.push('Create a pending settlement batch by executing trades first.');
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('[zkapp:preflight] failed', error);
  process.exit(1);
});
