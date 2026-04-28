import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import { AccountUpdate, Field, Mina, PrivateKey, Signature, UInt64 } from 'o1js';
import { AgentRequestContract } from '../src/zk/agentContract.js';
import { AgentRequestContractV2 } from '../src/zk/agentContractV2.js';

type BenchTarget = 'all' | 'request' | 'registry' | 'credits-update' | 'credits-spend';

function bytesOf(tx: unknown) {
  return Buffer.byteLength(JSON.stringify(tx));
}

async function measureCompile(label: string, compile: () => Promise<unknown>) {
  const start = performance.now();
  await compile();
  return {
    label,
    ms: Math.round(performance.now() - start)
  };
}

async function deployV1(feePayerKey: PrivateKey, zkappKey: PrivateKey) {
  const feePayer = feePayerKey.toPublicKey();
  const zkapp = new AgentRequestContract(zkappKey.toPublicKey());
  const tx = await Mina.transaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer);
    await zkapp.deploy();
    const prefund = AccountUpdate.createSigned(feePayer);
    prefund.send({ to: zkapp.address, amount: UInt64.from(BigInt(20e9)) });
  });
  await tx.prove();
  await tx.sign([feePayerKey, zkappKey]).send();
  return zkapp;
}

async function deployV2(
  feePayerKey: PrivateKey,
  zkappKey: PrivateKey,
  attesterKeys: [PrivateKey, PrivateKey, PrivateKey]
) {
  const feePayer = feePayerKey.toPublicKey();
  const zkapp = new AgentRequestContractV2(zkappKey.toPublicKey());
  const tx = await Mina.transaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer);
    await zkapp.deploy();
    await zkapp.configureAttesters(
      attesterKeys[0].toPublicKey(),
      attesterKeys[1].toPublicKey(),
      attesterKeys[2].toPublicKey()
    );
    const prefund = AccountUpdate.createSigned(feePayer);
    prefund.send({ to: zkapp.address, amount: UInt64.from(BigInt(20e9)) });
  });
  const proveStart = performance.now();
  await tx.prove();
  const proveMs = Math.round(performance.now() - proveStart);
  await tx.sign([feePayerKey, zkappKey]).send();
  return { zkapp, configureProveMs: proveMs };
}

async function benchmarkV1Request(zkapp: AgentRequestContract, feePayerKey: PrivateKey) {
  const feePayer = feePayerKey.toPublicKey();
  const requestHash = Field(101);
  const agentIdHash = Field(202);
  const newRoot = Field(303);
  const oracleKey = PrivateKey.random();
  const signature = Signature.create(oracleKey, [requestHash, agentIdHash, newRoot]);

  const tx = await Mina.transaction(feePayer, async () => {
    await zkapp.submitSignedRequest(requestHash, agentIdHash, oracleKey.toPublicKey(), signature, newRoot);
  });
  const proveStart = performance.now();
  await tx.prove();
  return {
    proveMs: Math.round(performance.now() - proveStart),
    jsonBytes: bytesOf(tx.toJSON())
  };
}

async function benchmarkV2Request(
  zkapp: AgentRequestContractV2,
  feePayerKey: PrivateKey,
  attesterKeys: [PrivateKey, PrivateKey, PrivateKey]
) {
  const feePayer = feePayerKey.toPublicKey();
  const requestHash = Field(101);
  const agentIdHash = Field(202);
  const newRoot = Field(303);
  const signature1 = Signature.create(attesterKeys[0], [requestHash, agentIdHash, newRoot]);
  const signature2 = Signature.create(attesterKeys[1], [requestHash, agentIdHash, newRoot]);

  const tx = await Mina.transaction(feePayer, async () => {
    await zkapp.submitThresholdRequest(
      requestHash,
      agentIdHash,
      attesterKeys[0].toPublicKey(),
      signature1,
      attesterKeys[1].toPublicKey(),
      signature2,
      newRoot
    );
  });
  const proveStart = performance.now();
  await tx.prove();
  return {
    proveMs: Math.round(performance.now() - proveStart),
    jsonBytes: bytesOf(tx.toJSON())
  };
}

async function benchmarkV1AgentRegistration(zkapp: AgentRequestContract, feePayerKey: PrivateKey) {
  const feePayer = feePayerKey.toPublicKey();
  const agentIdHash = Field(401);
  const ownerHash = Field(402);
  const treasuryHash = Field(403);
  const stakeAmount = Field(0);
  const newRoot = Field(404);
  const oracleKey = PrivateKey.random();
  const signature = Signature.create(oracleKey, [agentIdHash, ownerHash, treasuryHash, stakeAmount, newRoot]);

  const tx = await Mina.transaction(feePayer, async () => {
    await zkapp.registerAgent(
      agentIdHash,
      ownerHash,
      treasuryHash,
      stakeAmount,
      oracleKey.toPublicKey(),
      signature,
      newRoot
    );
  });
  const proveStart = performance.now();
  await tx.prove();
  return {
    proveMs: Math.round(performance.now() - proveStart),
    jsonBytes: bytesOf(tx.toJSON())
  };
}

async function benchmarkV2AgentRegistration(
  zkapp: AgentRequestContractV2,
  feePayerKey: PrivateKey,
  attesterKeys: [PrivateKey, PrivateKey, PrivateKey]
) {
  const feePayer = feePayerKey.toPublicKey();
  const agentIdHash = Field(401);
  const ownerHash = Field(402);
  const treasuryHash = Field(403);
  const stakeAmount = Field(0);
  const newRoot = Field(404);
  const signature1 = Signature.create(attesterKeys[0], [agentIdHash, ownerHash, treasuryHash, stakeAmount, newRoot]);
  const signature2 = Signature.create(attesterKeys[1], [agentIdHash, ownerHash, treasuryHash, stakeAmount, newRoot]);

  const tx = await Mina.transaction(feePayer, async () => {
    await zkapp.registerThresholdAgent(
      agentIdHash,
      ownerHash,
      treasuryHash,
      stakeAmount,
      attesterKeys[0].toPublicKey(),
      signature1,
      attesterKeys[1].toPublicKey(),
      signature2,
      newRoot
    );
  });
  const proveStart = performance.now();
  await tx.prove();
  return {
    proveMs: Math.round(performance.now() - proveStart),
    jsonBytes: bytesOf(tx.toJSON())
  };
}

async function benchmarkV1CreditsUpdate(zkapp: AgentRequestContract, feePayerKey: PrivateKey) {
  const feePayer = feePayerKey.toPublicKey();
  const creditsRoot = Field(501);
  const nullifierRoot = Field(502);
  const oracleKey = PrivateKey.random();
  const signature = Signature.create(oracleKey, [creditsRoot, nullifierRoot, Field(0), Field(0)]);

  const tx = await Mina.transaction(feePayer, async () => {
    await zkapp.submitSignedCreditsUpdate(creditsRoot, nullifierRoot, oracleKey.toPublicKey(), signature);
  });
  const proveStart = performance.now();
  await tx.prove();
  return {
    proveMs: Math.round(performance.now() - proveStart),
    jsonBytes: bytesOf(tx.toJSON())
  };
}

async function benchmarkV2CreditsUpdate(
  zkapp: AgentRequestContractV2,
  feePayerKey: PrivateKey,
  attesterKeys: [PrivateKey, PrivateKey, PrivateKey]
) {
  const feePayer = feePayerKey.toPublicKey();
  const creditsRoot = Field(501);
  const nullifierRoot = Field(502);
  const signature1 = Signature.create(attesterKeys[0], [creditsRoot, nullifierRoot, Field(0), Field(0)]);
  const signature2 = Signature.create(attesterKeys[1], [creditsRoot, nullifierRoot, Field(0), Field(0)]);

  const tx = await Mina.transaction(feePayer, async () => {
    await zkapp.submitThresholdCreditsUpdate(
      creditsRoot,
      nullifierRoot,
      attesterKeys[0].toPublicKey(),
      signature1,
      attesterKeys[1].toPublicKey(),
      signature2
    );
  });
  const proveStart = performance.now();
  await tx.prove();
  return {
    proveMs: Math.round(performance.now() - proveStart),
    jsonBytes: bytesOf(tx.toJSON())
  };
}

async function benchmarkV1CreditsSpend(zkapp: AgentRequestContract, feePayerKey: PrivateKey, payeeKeys: PrivateKey[]) {
  const feePayer = feePayerKey.toPublicKey();
  const creditsRoot = Field(601);
  const nullifierRoot = Field(602);
  const oracleKey = PrivateKey.random();
  const spendAmount = UInt64.from(BigInt(1e8));
  const platformAmount = UInt64.from(BigInt(1e7));
  const signature = Signature.create(oracleKey, [creditsRoot, nullifierRoot, spendAmount.value, platformAmount.value]);

  const tx = await Mina.transaction(feePayer, async () => {
    await zkapp.submitSignedCreditsSpend(
      creditsRoot,
      nullifierRoot,
      oracleKey.toPublicKey(),
      signature,
      payeeKeys[0].toPublicKey(),
      spendAmount,
      payeeKeys[1].toPublicKey(),
      platformAmount
    );
  });
  const proveStart = performance.now();
  await tx.prove();
  return {
    proveMs: Math.round(performance.now() - proveStart),
    jsonBytes: bytesOf(tx.toJSON())
  };
}

async function benchmarkV2CreditsSpend(
  zkapp: AgentRequestContractV2,
  feePayerKey: PrivateKey,
  attesterKeys: [PrivateKey, PrivateKey, PrivateKey],
  payeeKeys: PrivateKey[]
) {
  const feePayer = feePayerKey.toPublicKey();
  const creditsRoot = Field(601);
  const nullifierRoot = Field(602);
  const spendAmount = UInt64.from(BigInt(1e8));
  const platformAmount = UInt64.from(BigInt(1e7));
  const signature1 = Signature.create(attesterKeys[0], [creditsRoot, nullifierRoot, spendAmount.value, platformAmount.value]);
  const signature2 = Signature.create(attesterKeys[1], [creditsRoot, nullifierRoot, spendAmount.value, platformAmount.value]);

  const tx = await Mina.transaction(feePayer, async () => {
    await zkapp.submitThresholdCreditsSpend(
      creditsRoot,
      nullifierRoot,
      attesterKeys[0].toPublicKey(),
      signature1,
      attesterKeys[1].toPublicKey(),
      signature2,
      payeeKeys[0].toPublicKey(),
      spendAmount,
      payeeKeys[1].toPublicKey(),
      platformAmount
    );
  });
  const proveStart = performance.now();
  await tx.prove();
  return {
    proveMs: Math.round(performance.now() - proveStart),
    jsonBytes: bytesOf(tx.toJSON())
  };
}

function summarizeSamples(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    samples,
    avgMs: Math.round(total / samples.length),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    medianMs: sorted[Math.floor(sorted.length / 2)]
  };
}

async function collectOperationBench(
  label: string,
  benchV1: () => Promise<{ proveMs: number; jsonBytes: number }>,
  benchV2: () => Promise<{ proveMs: number; jsonBytes: number }>
) {
  const v1 = await benchV1();
  const v2 = await benchV2();
  const v1Samples = [v1.proveMs];
  const v2Samples = [v2.proveMs];
  const v1JsonBytes = v1.jsonBytes;
  const v2JsonBytes = v2.jsonBytes;

  const v1Summary = summarizeSamples(v1Samples);
  const v2Summary = summarizeSamples(v2Samples);
  const deltaMs = v2Summary.avgMs - v1Summary.avgMs;
  const deltaPct = v1Summary.avgMs > 0 ? Math.round((deltaMs / v1Summary.avgMs) * 100) : null;
  const deltaBytes = v2JsonBytes - v1JsonBytes;
  const deltaBytesPct = v1JsonBytes > 0 ? Math.round((deltaBytes / v1JsonBytes) * 100) : null;

  return {
    label,
    proving: {
      v1: v1Summary,
      v2: v2Summary,
      deltaMs,
      deltaPct
    },
    transactionSize: {
      v1JsonBytes,
      v2JsonBytes,
      deltaBytes,
      deltaPct: deltaBytesPct
    }
  };
}

async function main() {
  const target = (process.argv[2] || 'all') as BenchTarget;
  if (!['all', 'request', 'registry', 'credits-update', 'credits-spend'].includes(target)) {
    throw new Error(`Unknown benchmark target: ${target}`);
  }

  const compileV1 = await measureCompile('v1', () => AgentRequestContract.compile());
  const compileV2 = await measureCompile('v2', () => AgentRequestContractV2.compile());

  const local = await Mina.LocalBlockchain({ proofsEnabled: true });
  Mina.setActiveInstance(local);

  const feePayerKey = local.testAccounts[0].key;
  const payeeKeys = [local.testAccounts[1].key, local.testAccounts[2].key];
  const v1Key = PrivateKey.random();
  const v2Key = PrivateKey.random();
  const attesterKeys: [PrivateKey, PrivateKey, PrivateKey] = [
    PrivateKey.random(),
    PrivateKey.random(),
    PrivateKey.random()
  ];

  const v1 = await deployV1(feePayerKey, v1Key);
  const { zkapp: v2, configureProveMs } = await deployV2(feePayerKey, v2Key, attesterKeys);

  const operations: Record<string, unknown> = {};

  if (target === 'all' || target === 'request') {
    operations.request = await collectOperationBench(
      'requestReceipt',
      () => benchmarkV1Request(v1, feePayerKey),
      () => benchmarkV2Request(v2, feePayerKey, attesterKeys)
    );
  }

  if (target === 'all' || target === 'registry') {
    operations.agentRegistration = await collectOperationBench(
      'agentRegistration',
      () => benchmarkV1AgentRegistration(v1, feePayerKey),
      () => benchmarkV2AgentRegistration(v2, feePayerKey, attesterKeys)
    );
  }

  if (target === 'all' || target === 'credits-update') {
    operations.creditsUpdate = await collectOperationBench(
      'creditsUpdate',
      () => benchmarkV1CreditsUpdate(v1, feePayerKey),
      () => benchmarkV2CreditsUpdate(v2, feePayerKey, attesterKeys)
    );
  }

  if (target === 'all' || target === 'credits-spend') {
    operations.creditsSpend = await collectOperationBench(
      'creditsSpend',
      () => benchmarkV1CreditsSpend(v1, feePayerKey, payeeKeys),
      () => benchmarkV2CreditsSpend(v2, feePayerKey, attesterKeys, payeeKeys)
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        environment: {
          proofsEnabled: true,
          comparison: 'single-signer v1 contract paths vs 2-of-3 threshold-verifying v2 contract paths'
        },
        target,
        compile: {
          v1Ms: compileV1.ms,
          v2Ms: compileV2.ms,
          deltaMs: compileV2.ms - compileV1.ms,
          deltaPct: compileV1.ms > 0 ? Math.round(((compileV2.ms - compileV1.ms) / compileV1.ms) * 100) : null
        },
        operations,
        setup: {
          v2ConfigureAttestersMs: configureProveMs
        },
        notes: [
          'Compile time is a one-time developer and deployer cost.',
          'Per-operation proving overhead comes from verifying two attester signatures instead of one oracle signature.',
          'Credits spend includes zkApp sends, so its proving time is expected to be the heaviest path.',
          'Results are local-machine benchmarks and will vary across hardware.'
        ]
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[benchmark:v2] failed', error);
  process.exit(1);
});
