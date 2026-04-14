import 'reflect-metadata';
import { AccountUpdate, Field, Mina, PrivateKey, Signature } from 'o1js';
import { NavaIntentZkApp } from '../src/NavaIntentZkApp.js';
import {
  buildApprovalDomainCommitment,
  buildApprovalMessageFields,
  buildVerifierQuorumInput,
  computeVerifierSetRoot
} from '../src/zekoVerifierAttestation.js';

async function submit(txPromise: ReturnType<typeof Mina.transaction>, signerKeys: { key: unknown }[]) {
  const tx = await txPromise;
  await tx.prove();
  await tx.sign(signerKeys.map((item) => item.key as never)).send();
}

async function main() {
  const Local = await Mina.LocalBlockchain({ proofsEnabled: true });
  Mina.setActiveInstance(Local);

  const [sender] = Local.testAccounts;
  const verifierKeys = [PrivateKey.random(), PrivateKey.random(), PrivateKey.random()];
  const verifierPublicKeys = verifierKeys.map((key) => key.toPublicKey());
  const verifierSetRoot = computeVerifierSetRoot(verifierPublicKeys);
  const approvalDomainCommitment = buildApprovalDomainCommitment({
    verifierSetRoot
  });
  const intentHash = Field(11);
  const quorumThreshold = Field(2);
  const messageFields = buildApprovalMessageFields({
    intentHash,
    quorumThreshold,
    approvalDomainCommitment
  });
  const zkappAccount = Mina.TestPublicKey.random();
  const zkapp = new NavaIntentZkApp(zkappAccount);

  await NavaIntentZkApp.compile();

  await submit(
    Mina.transaction(sender, async () => {
      AccountUpdate.fundNewAccount(sender);
      await zkapp.deploy();
      zkapp.intentHash.set(intentHash);
      zkapp.statementHash.set(Field(12));
      zkapp.approvalCommitment.set(Field(13));
      zkapp.status.set(Field(0));
      zkapp.requiredVerifierApprovals.set(quorumThreshold);
      zkapp.observedVerifierApprovals.set(Field(0));
      zkapp.approvalDomainCommitment.set(approvalDomainCommitment);
      zkapp.lastUpdatedAt.set(Field(100));
    }),
    [sender, zkappAccount]
  );

  let invalidQuorumRejected = false;
  try {
    const { quorum } = buildVerifierQuorumInput({
      registeredVerifierPublicKeys: verifierPublicKeys,
      approvalSignatures: [
        {
          verifierPublicKey: verifierPublicKeys[0].toBase58(),
          signature: Signature.create(verifierKeys[0], messageFields).toBase58()
        }
      ],
      messageFields
    });
    await submit(
      Mina.transaction(sender, async () => {
        await zkapp.approveWithVerifierQuorum(Field(22), Field(23), Field(101), quorum);
      }),
      [sender]
    );
  } catch {
    invalidQuorumRejected = true;
  }

  const { quorum } = buildVerifierQuorumInput({
    registeredVerifierPublicKeys: verifierPublicKeys,
    approvalSignatures: [
      {
        verifierPublicKey: verifierPublicKeys[0].toBase58(),
        signature: Signature.create(verifierKeys[0], messageFields).toBase58()
      },
      {
        verifierPublicKey: verifierPublicKeys[1].toBase58(),
        signature: Signature.create(verifierKeys[1], messageFields).toBase58()
      }
    ],
    messageFields
  });
  await submit(
    Mina.transaction(sender, async () => {
      await zkapp.approveWithVerifierQuorum(Field(22), Field(23), Field(101), quorum);
    }),
    [sender]
  );

  let invalidSettleRejected = false;
  try {
    await submit(
      Mina.transaction(sender, async () => {
        await zkapp.syncLifecycle(Field(24), Field(25), Field(3), Field(2), Field(102));
      }),
      [sender]
    );
  } catch {
    invalidSettleRejected = true;
  }

  await submit(
    Mina.transaction(sender, async () => {
      await zkapp.syncLifecycle(Field(26), Field(27), Field(2), Field(2), Field(102));
    }),
    [sender]
  );

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        verifierSetRoot: verifierSetRoot.toString(),
        verifierPublicKeys: verifierPublicKeys.map((key) => key.toBase58()),
        invalidQuorumRejected,
        invalidSettleRejected,
        finalStatus: zkapp.status.get().toString(),
        finalObservedVerifierApprovals: zkapp.observedVerifierApprovals.get().toString(),
        finalUpdatedAt: zkapp.lastUpdatedAt.get().toString()
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[zkapp-intent:lifecycle-check] failed', error);
  process.exit(1);
});
