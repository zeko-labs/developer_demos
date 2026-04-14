import 'reflect-metadata';
import { Field, Permissions, SmartContract, State, method, state } from 'o1js';

export class TestValueZkApp extends SmartContract {
  @state(Field) value = State<Field>();
  @state(Field) lastUpdatedAt = State<Field>();

  init() {
    super.init();
    this.value.set(Field(0));
    this.lastUpdatedAt.set(Field(0));
    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof()
    });
  }

  @method async setValue(nextValue: Field, timestamp: Field) {
    this.value.getAndRequireEquals();
    this.lastUpdatedAt.getAndRequireEquals();
    this.value.set(nextValue);
    this.lastUpdatedAt.set(timestamp);
  }
}
