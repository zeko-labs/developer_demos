import 'reflect-metadata';
import { Bool, Field, PublicKey, Signature, Struct, ZkProgram } from 'o1js';

export class VerdictInput extends Struct({
  imageHash: Field,
  verdict: Bool,
  merkleRoot: Field
}) {}

export const AiVerdictProgram = ZkProgram({
  name: 'AiVerdictProgram',
  publicInput: VerdictInput,
  methods: {
    verifyOracle: {
      privateInputs: [PublicKey, Signature],
      async method(publicInput: VerdictInput, oraclePk: PublicKey, signature: Signature) {
        signature
          .verify(oraclePk, [
            publicInput.imageHash,
            publicInput.verdict.toField(),
            publicInput.merkleRoot
          ])
          .assertTrue();
      }
    }
  }
});

export class AiVerdictProof extends ZkProgram.Proof(AiVerdictProgram) {}
