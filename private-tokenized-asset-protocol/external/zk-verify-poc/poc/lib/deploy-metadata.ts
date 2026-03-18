import { writeJsonFile } from "./io.js";

export const DEPLOYED_ADDRESS_PATH = "output/deployed-address.json";

interface WriteDeployedAddressMetadataInput {
  zkappPublicKey: string;
  zkappPrivateKeyGenerated: boolean;
  deployTxHash: string;
  alreadyDeployed: boolean;
  verificationKeyHash?: string;
}

export async function writeDeployedAddressMetadata(
  input: WriteDeployedAddressMetadataInput,
): Promise<void> {
  const payload: Record<string, string | boolean> = {
    zkapp_public_key: input.zkappPublicKey,
    zkapp_private_key_generated: input.zkappPrivateKeyGenerated,
    deploy_tx_hash: input.deployTxHash,
    already_deployed: input.alreadyDeployed,
  };

  if (input.verificationKeyHash) {
    payload.verification_key_hash = input.verificationKeyHash;
  }

  await writeJsonFile(DEPLOYED_ADDRESS_PATH, payload);
}
