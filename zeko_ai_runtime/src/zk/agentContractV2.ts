import 'reflect-metadata';
import {
  Bool,
  Field,
  MerkleTree,
  Permissions,
  Poseidon,
  PublicKey,
  Signature,
  SmartContract,
  State,
  UInt64,
  method,
  state
} from 'o1js';

function publicKeyHash(publicKey: PublicKey) {
  return Poseidon.hash(PublicKey.toFields(publicKey));
}

export class AgentRequestContractV2 extends SmartContract {
  static TREE_HEIGHT = 20;
  static QUORUM = 2;

  @state(Field) merkleRoot: State<Field> = State<Field>();
  @state(Field) outputMerkleRoot: State<Field> = State<Field>();
  @state(Field) agentMerkleRoot: State<Field> = State<Field>();
  @state(Field) creditsMerkleRoot: State<Field> = State<Field>();
  @state(Field) nullifierMerkleRoot: State<Field> = State<Field>();
  @state(Field) attester1Hash: State<Field> = State<Field>();
  @state(Field) attester2Hash: State<Field> = State<Field>();
  @state(Field) attester3Hash: State<Field> = State<Field>();

  init() {
    super.init();
    const emptyRoot = new MerkleTree(AgentRequestContractV2.TREE_HEIGHT).getRoot();
    this.merkleRoot.set(emptyRoot);
    this.outputMerkleRoot.set(emptyRoot);
    this.agentMerkleRoot.set(emptyRoot);
    this.creditsMerkleRoot.set(emptyRoot);
    this.nullifierMerkleRoot.set(emptyRoot);
    this.attester1Hash.set(Field(0));
    this.attester2Hash.set(Field(0));
    this.attester3Hash.set(Field(0));
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature()
    });
  }

  @method async configureAttesters(attester1: PublicKey, attester2: PublicKey, attester3: PublicKey) {
    const attester1Hash = publicKeyHash(attester1);
    const attester2Hash = publicKeyHash(attester2);
    const attester3Hash = publicKeyHash(attester3);

    attester1Hash.assertNotEquals(attester2Hash);
    attester1Hash.assertNotEquals(attester3Hash);
    attester2Hash.assertNotEquals(attester3Hash);

    this.attester1Hash.set(attester1Hash);
    this.attester2Hash.set(attester2Hash);
    this.attester3Hash.set(attester3Hash);
  }

  private assertAuthorizedAttester(attester: PublicKey) {
    const attesterHash = publicKeyHash(attester);
    const attester1Hash = this.attester1Hash.getAndRequireEquals();
    const attester2Hash = this.attester2Hash.getAndRequireEquals();
    const attester3Hash = this.attester3Hash.getAndRequireEquals();

    attesterHash
      .equals(attester1Hash)
      .or(attesterHash.equals(attester2Hash))
      .or(attesterHash.equals(attester3Hash))
      .assertTrue();

    return attesterHash;
  }

  private verifyThreshold(message: Field[], attester1: PublicKey, signature1: Signature, attester2: PublicKey, signature2: Signature) {
    const attester1Hash = this.assertAuthorizedAttester(attester1);
    const attester2Hash = this.assertAuthorizedAttester(attester2);
    attester1Hash.assertNotEquals(attester2Hash);
    signature1.verify(attester1, message).assertTrue();
    signature2.verify(attester2, message).assertTrue();
  }

  @method async submitThresholdRequest(
    requestHash: Field,
    agentIdHash: Field,
    attester1: PublicKey,
    signature1: Signature,
    attester2: PublicKey,
    signature2: Signature,
    newRoot: Field
  ) {
    this.verifyThreshold([requestHash, agentIdHash, newRoot], attester1, signature1, attester2, signature2);
    this.merkleRoot.set(newRoot);
  }

  @method async submitThresholdOutput(
    requestHash: Field,
    outputHash: Field,
    attester1: PublicKey,
    signature1: Signature,
    attester2: PublicKey,
    signature2: Signature,
    newRoot: Field
  ) {
    this.verifyThreshold([requestHash, outputHash, newRoot], attester1, signature1, attester2, signature2);
    this.outputMerkleRoot.set(newRoot);
  }

  @method async registerThresholdAgent(
    agentIdHash: Field,
    ownerHash: Field,
    treasuryHash: Field,
    stakeAmount: Field,
    attester1: PublicKey,
    signature1: Signature,
    attester2: PublicKey,
    signature2: Signature,
    newRoot: Field
  ) {
    this.verifyThreshold(
      [agentIdHash, ownerHash, treasuryHash, stakeAmount, newRoot],
      attester1,
      signature1,
      attester2,
      signature2
    );
    this.agentMerkleRoot.set(newRoot);
  }

  @method async submitThresholdCreditsUpdate(
    creditsRoot: Field,
    nullifierRoot: Field,
    attester1: PublicKey,
    signature1: Signature,
    attester2: PublicKey,
    signature2: Signature
  ) {
    this.verifyThreshold(
      [creditsRoot, nullifierRoot, Field(0), Field(0)],
      attester1,
      signature1,
      attester2,
      signature2
    );
    this.creditsMerkleRoot.set(creditsRoot);
    this.nullifierMerkleRoot.set(nullifierRoot);
  }

  @method async submitThresholdCreditsSpend(
    creditsRoot: Field,
    nullifierRoot: Field,
    attester1: PublicKey,
    signature1: Signature,
    attester2: PublicKey,
    signature2: Signature,
    payee: PublicKey,
    amount: UInt64,
    platformPayee: PublicKey,
    platformAmount: UInt64
  ) {
    this.verifyThreshold(
      [creditsRoot, nullifierRoot, amount.value, platformAmount.value],
      attester1,
      signature1,
      attester2,
      signature2
    );
    this.creditsMerkleRoot.set(creditsRoot);
    this.nullifierMerkleRoot.set(nullifierRoot);
    this.send({ to: payee, amount });
    this.send({ to: platformPayee, amount: platformAmount });
  }
}
