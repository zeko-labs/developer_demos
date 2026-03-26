import 'reflect-metadata';
import { Field, Permissions, SmartContract, State, method, state } from 'o1js';

export class PrayerBatchContract extends SmartContract {
  @state(Field) merkleRoot = State<Field>();

  init() {
    super.init();
    this.merkleRoot.set(Field(0));
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature()
    });
  }

  @method async anchorRoot(newRoot: Field) {
    this.requireSignature();
    this.merkleRoot.set(newRoot);
  }
}
