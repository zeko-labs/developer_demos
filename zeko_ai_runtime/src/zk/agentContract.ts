import 'reflect-metadata';
import {
  Field,
  MerkleTree,
  Permissions,
  PublicKey,
  Signature,
  SmartContract,
  State,
  UInt64,
  method,
  state
} from 'o1js';

export class AgentRequestContract extends SmartContract {
  static TREE_HEIGHT = 20;

  @state(Field) merkleRoot: State<Field> = State<Field>();
  @state(Field) outputMerkleRoot: State<Field> = State<Field>();
  @state(Field) agentMerkleRoot: State<Field> = State<Field>();
  @state(Field) creditsMerkleRoot: State<Field> = State<Field>();
  @state(Field) nullifierMerkleRoot: State<Field> = State<Field>();

  init() {
    super.init();
    const emptyRoot = new MerkleTree(AgentRequestContract.TREE_HEIGHT).getRoot();
    this.merkleRoot.set(emptyRoot);
    this.outputMerkleRoot.set(emptyRoot);
    this.agentMerkleRoot.set(emptyRoot);
    this.creditsMerkleRoot.set(emptyRoot);
    this.nullifierMerkleRoot.set(emptyRoot);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature()
    });
  }

  @method async submitSignedRequest(
    requestHash: Field,
    agentIdHash: Field,
    oraclePk: PublicKey,
    signature: Signature,
    newRoot: Field
  ) {
    signature.verify(oraclePk, [requestHash, agentIdHash, newRoot]).assertTrue();
    this.merkleRoot.set(newRoot);
  }

  @method async submitSignedOutput(
    requestHash: Field,
    outputHash: Field,
    oraclePk: PublicKey,
    signature: Signature,
    newRoot: Field
  ) {
    signature.verify(oraclePk, [requestHash, outputHash, newRoot]).assertTrue();
    this.outputMerkleRoot.set(newRoot);
  }

  @method async registerAgent(
    agentIdHash: Field,
    ownerHash: Field,
    treasuryHash: Field,
    stakeAmount: Field,
    oraclePk: PublicKey,
    signature: Signature,
    newRoot: Field
  ) {
    signature.verify(oraclePk, [agentIdHash, ownerHash, treasuryHash, stakeAmount, newRoot]).assertTrue();
    this.agentMerkleRoot.set(newRoot);
  }

  @method async submitSignedCreditsUpdate(
    creditsRoot: Field,
    nullifierRoot: Field,
    oraclePk: PublicKey,
    signature: Signature
  ) {
    signature.verify(oraclePk, [creditsRoot, nullifierRoot, Field(0), Field(0)]).assertTrue();
    this.creditsMerkleRoot.set(creditsRoot);
    this.nullifierMerkleRoot.set(nullifierRoot);
  }

  @method async submitSignedCreditsSpend(
    creditsRoot: Field,
    nullifierRoot: Field,
    oraclePk: PublicKey,
    signature: Signature,
    payee: PublicKey,
    amount: UInt64,
    platformPayee: PublicKey,
    platformAmount: UInt64
  ) {
    signature.verify(oraclePk, [creditsRoot, nullifierRoot, amount.value, platformAmount.value]).assertTrue();
    this.creditsMerkleRoot.set(creditsRoot);
    this.nullifierMerkleRoot.set(nullifierRoot);
    this.send({ to: payee, amount });
    this.send({ to: platformPayee, amount: platformAmount });
  }
}
