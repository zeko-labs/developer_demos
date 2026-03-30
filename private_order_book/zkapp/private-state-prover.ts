import { Field, Provable, Struct, UInt64, VerificationKey, ZkProgram } from 'o1js';
import {
  PrivateStateRoots,
  PrivateStateMerkleTransitionWitness,
  PrivateStateTransitionPublicInput,
  PrivateStateTransitionPublicOutput,
} from './private-state.js';

export class PrivateStateBatchWitness extends Struct({
  witness: PrivateStateMerkleTransitionWitness,
  appliedSpendCount: UInt64,
  appliedOutputCount: UInt64,
  nextRoots: PrivateStateRoots
}) {}

export const PrivateStateTransitionProgram = ZkProgram({
  name: 'PrivateStateTransitionProgram',
  publicInput: PrivateStateTransitionPublicInput,
  publicOutput: PrivateStateTransitionPublicOutput,
  methods: {
    proveBatch: {
      privateInputs: [PrivateStateBatchWitness],
      async method(publicInput, batchWitness) {
        publicInput.transitionHash.assertEquals(batchWitness.witness.transitionHash());
        let workingNoteRoot = publicInput.prevRoots.noteRoot;
        for (const update of batchWitness.witness.noteSpendWitnesses) {
          const [rootBefore, keyBefore] = update.witness.computeRootAndKey(update.oldValue);
          Provable.if(update.enabled, rootBefore, workingNoteRoot).assertEquals(workingNoteRoot);
          Provable.if(update.enabled, keyBefore, update.key).assertEquals(update.key);
          Provable.if(update.enabled, update.newValue, Field(0)).assertEquals(Field(0));
          const [rootAfter] = update.witness.computeRootAndKey(update.newValue);
          workingNoteRoot = Provable.if(update.enabled, rootAfter, workingNoteRoot);
        }

        for (const update of batchWitness.witness.noteOutputWitnesses) {
          const [rootBefore, keyBefore] = update.witness.computeRootAndKey(update.oldValue);
          Provable.if(update.enabled, rootBefore, workingNoteRoot).assertEquals(workingNoteRoot);
          Provable.if(update.enabled, keyBefore, update.key).assertEquals(update.key);
          Provable.if(update.enabled, update.oldValue, Field(0)).assertEquals(Field(0));
          const [rootAfter] = update.witness.computeRootAndKey(update.newValue);
          workingNoteRoot = Provable.if(update.enabled, rootAfter, workingNoteRoot);
        }

        let workingNullifierRoot = publicInput.prevRoots.nullifierRoot;
        for (const update of batchWitness.witness.nullifierWitnesses) {
          const [rootBefore, keyBefore] = update.witness.computeRootAndKey(update.oldValue);
          Provable.if(update.enabled, rootBefore, workingNullifierRoot).assertEquals(workingNullifierRoot);
          Provable.if(update.enabled, keyBefore, update.key).assertEquals(update.key);
          Provable.if(update.enabled, update.oldValue, Field(0)).assertEquals(Field(0));
          const [rootAfter] = update.witness.computeRootAndKey(update.newValue);
          workingNullifierRoot = Provable.if(update.enabled, rootAfter, workingNullifierRoot);
        }

        publicInput.nextRoots.noteRoot.assertEquals(workingNoteRoot);
        publicInput.nextRoots.nullifierRoot.assertEquals(workingNullifierRoot);
        publicInput.nextRoots.settlementRoot.assertEquals(batchWitness.nextRoots.settlementRoot);
        batchWitness.nextRoots.noteRoot.assertEquals(workingNoteRoot);
        batchWitness.nextRoots.nullifierRoot.assertEquals(workingNullifierRoot);
        batchWitness.nextRoots.settlementRoot.assertEquals(publicInput.nextRoots.settlementRoot);

        return {
          publicOutput: new PrivateStateTransitionPublicOutput({
            appliedSpendCount: batchWitness.appliedSpendCount,
            appliedOutputCount: batchWitness.appliedOutputCount,
            nextRoots: batchWitness.nextRoots
          })
        };
      }
    }
  }
});

export class PrivateStateTransitionProof extends ZkProgram.Proof(PrivateStateTransitionProgram) {}

export async function compilePrivateStateTransitionProgram(): Promise<VerificationKey> {
  const { verificationKey } = await PrivateStateTransitionProgram.compile();
  return verificationKey;
}
