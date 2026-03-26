import 'reflect-metadata';
import { Bool, Field, MerkleTree, Permissions, PublicKey, Signature, SmartContract, State, method, state } from 'o1js';

export class AiVerdictContract extends SmartContract {
  static TREE_HEIGHT = 20;
  @state(Field) lastImageHash = State<Field>();
  @state(Bool) lastVerdict = State<Bool>();
  @state(PublicKey) oraclePublicKey = State<PublicKey>();
  @state(Field) merkleRoot = State<Field>();

  init() {
    super.init();
    this.lastImageHash.set(Field(0));
    this.lastVerdict.set(Bool(false));
    this.oraclePublicKey.set(PublicKey.empty());
    const emptyRoot = new MerkleTree(AiVerdictContract.TREE_HEIGHT).getRoot();
    this.merkleRoot.set(emptyRoot);
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature()
    });
  }

  @method async submitSignedVerdict(
    imageHash: Field,
    verdict: Bool,
    oraclePk: PublicKey,
    signature: Signature,
    newRoot: Field
  ) {
    this.requireSignature();
    signature
      .verify(oraclePk, [imageHash, verdict.toField(), newRoot])
      .assertTrue();
    this.oraclePublicKey.set(oraclePk);
    this.lastImageHash.set(imageHash);
    this.lastVerdict.set(verdict);
    this.merkleRoot.set(newRoot);
  }
}
