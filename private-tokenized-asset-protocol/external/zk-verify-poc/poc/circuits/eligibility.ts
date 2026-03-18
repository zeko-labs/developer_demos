import {
  Bool,
  Bytes,
  Crypto,
  Field,
  Hash,
  Poseidon,
  Struct,
  UInt64,
  ZkProgram,
  createEcdsa,
  createForeignCurve,
} from "o1js";

import {
  CURRENT_DATE_UNIX_MS,
  MIN_SALARY,
  MIN_TENURE_MONTHS,
  REQUIRED_EMPLOYMENT_STATUS,
  SESSION_HEADER_LENGTH_BYTES,
  TRUSTED_NOTARY_PUBLIC_KEY_X_HEX,
  TRUSTED_NOTARY_PUBLIC_KEY_Y_HEX,
} from "../lib/poc-security-config.js";
import { hashUtf8StringPoseidon } from "../lib/poseidon.js";

export const THIRTY_DAYS_MS_U64 = UInt64.from(2_592_000_000);
export const REQUIRED_STATUS_HASH = hashUtf8StringPoseidon(REQUIRED_EMPLOYMENT_STATUS);

const MIN_SALARY_U64 = UInt64.from(MIN_SALARY);
const MIN_TENURE_MONTHS_U64 = UInt64.from(MIN_TENURE_MONTHS);
const CURRENT_DATE_UNIX_U64 = UInt64.from(CURRENT_DATE_UNIX_MS);

function hexToBigInt(value: string): bigint {
  return BigInt(`0x${value}`);
}

export class Secp256k1 extends createForeignCurve(Crypto.CurveParams.Secp256k1) {}
export class EcdsaSignature extends createEcdsa(Secp256k1) {}
export class SessionHeaderBytes extends Bytes(SESSION_HEADER_LENGTH_BYTES) {}

export class EligibilityOutput extends Struct({
  eligible: Bool,
  responseBodyHash: Field,
}) {}

const trustedNotaryPublicKey = new Secp256k1({
  x: hexToBigInt(TRUSTED_NOTARY_PUBLIC_KEY_X_HEX),
  y: hexToBigInt(TRUSTED_NOTARY_PUBLIC_KEY_Y_HEX),
});

export const EligibilityProgram = ZkProgram({
  name: "employment-eligibility",
  publicInput: Field,
  publicOutput: EligibilityOutput,
  methods: {
    verifyEligibility: {
      privateInputs: [UInt64, UInt64, Field, Field, EcdsaSignature, SessionHeaderBytes],
      async method(
        dataCommitment: Field,
        salary: UInt64,
        hireDateUnix: UInt64,
        statusHash: Field,
        responseBodyHash: Field,
        signature: EcdsaSignature,
        sessionHeader: SessionHeaderBytes,
      ) {
        const computedDataCommitment = Poseidon.hash([
          salary.value,
          hireDateUnix.value,
          statusHash,
          responseBodyHash,
        ]);
        computedDataCommitment.assertEquals(dataCommitment);

        const signedMessageHash = Hash.SHA2_256.hash(sessionHeader);
        signature.verifySignedHash(signedMessageHash, trustedNotaryPublicKey).assertTrue();

        statusHash.assertEquals(REQUIRED_STATUS_HASH);
        salary.assertGreaterThanOrEqual(MIN_SALARY_U64);

        const tenureMs = CURRENT_DATE_UNIX_U64.sub(hireDateUnix);
        const tenureMonths = tenureMs.div(THIRTY_DAYS_MS_U64);
        tenureMonths.assertGreaterThanOrEqual(MIN_TENURE_MONTHS_U64);

        return { publicOutput: new EligibilityOutput({ eligible: Bool(true), responseBodyHash }) };
      },
    },
  },
});

export class EligibilityProof extends ZkProgram.Proof(EligibilityProgram) {}
