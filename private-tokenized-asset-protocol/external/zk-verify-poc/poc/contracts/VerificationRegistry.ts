import { Field, SmartContract, State, Struct, method, state } from "o1js";

import { EligibilityProof } from "../circuits/eligibility.js";

export class VerificationEvent extends Struct({
  proofHash: Field,
  result: Field,
}) {}

export class VerificationRegistry extends SmartContract {
  @state(Field)
  lastProofHash = State<Field>();

  @state(Field)
  lastResult = State<Field>();

  events = {
    verification: VerificationEvent,
  };

  async init() {
    super.init();
    this.lastProofHash.set(Field(0));
    this.lastResult.set(Field(0));
  }

  @method
  async recordVerification(proofHash: Field, proof: EligibilityProof) {
    proof.verify();

    const result = proof.publicOutput.eligible.toField();
    this.lastProofHash.set(proofHash);
    this.lastResult.set(result);

    this.emitEvent(
      "verification",
      new VerificationEvent({
        proofHash,
        result,
      }),
    );
  }
}
