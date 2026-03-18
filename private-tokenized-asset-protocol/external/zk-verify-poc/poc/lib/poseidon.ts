import { Field, Poseidon } from "o1js";

export function utf8BytesToFields(value: string): Field[] {
  return [...Buffer.from(value, "utf8")].map((byte) => Field(byte));
}

export function hashUtf8StringPoseidon(value: string): Field {
  return Poseidon.hash(utf8BytesToFields(value));
}

export function commitmentHash(
  salary: number,
  hireDateUnixMs: number,
  statusHash: Field,
  responseBodyHash: Field,
): Field {
  return Poseidon.hash([Field(salary), Field(hireDateUnixMs), statusHash, responseBodyHash]);
}
