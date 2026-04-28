import path from 'node:path';
import { readFileSync } from 'node:fs';
import { PrivateKey } from 'o1js';

export type SponsorLane = 'request' | 'output' | 'registry' | 'credits';

export interface SponsorLaneStatus {
  lane: SponsorLane;
  privateKeyConfigured: boolean;
  publicKey: string | null;
  source:
    | 'env-lane'
    | 'env-shared'
    | 'stored-lane'
    | 'stored-shared'
    | 'missing';
  envVar: string | null;
  filePath: string | null;
  usesSharedFallback: boolean;
}

const sponsorLaneEnvVar: Record<SponsorLane, string> = {
  request: 'ZEKO_AI_REQUEST_SPONSOR_PRIVATE_KEY',
  output: 'ZEKO_AI_OUTPUT_SPONSOR_PRIVATE_KEY',
  registry: 'ZEKO_AI_REGISTRY_SPONSOR_PRIVATE_KEY',
  credits: 'ZEKO_AI_CREDITS_SPONSOR_PRIVATE_KEY'
};

const sponsorLaneLegacyEnvVar: Record<SponsorLane, string> = {
  request: 'OPENGRADIENT_REQUEST_SPONSOR_PRIVATE_KEY',
  output: 'OPENGRADIENT_OUTPUT_SPONSOR_PRIVATE_KEY',
  registry: 'OPENGRADIENT_REGISTRY_SPONSOR_PRIVATE_KEY',
  credits: 'OPENGRADIENT_CREDITS_SPONSOR_PRIVATE_KEY'
};

const sponsorLaneFileName: Record<SponsorLane, string> = {
  request: 'request-sponsor-private-key.txt',
  output: 'output-sponsor-private-key.txt',
  registry: 'registry-sponsor-private-key.txt',
  credits: 'credits-sponsor-private-key.txt'
};

function getSecret(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readLocalTextFile(filePath: string): string | null {
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    return raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function getDeploymentDir() {
  return path.join(process.cwd(), 'data', 'deployments');
}

export function getSponsorLaneEnvVar(lane: SponsorLane) {
  return sponsorLaneEnvVar[lane];
}

export function getSponsorLaneFilePath(lane: SponsorLane) {
  return path.join(getDeploymentDir(), sponsorLaneFileName[lane]);
}

function getDisabledSponsorLanes() {
  const csv = process.env.ZEKO_AI_DISABLED_SPONSOR_LANES || process.env.OPENGRADIENT_DISABLED_SPONSOR_LANES;
  if (typeof csv !== 'string' || csv.trim().length === 0) {
    return new Set<SponsorLane>();
  }
  return new Set(
    csv
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry): entry is SponsorLane => (['request', 'output', 'registry', 'credits'] as SponsorLane[]).includes(entry as SponsorLane))
  );
}

export function resolveSponsorPrivateKeyForLane(lane: SponsorLane) {
  if (getDisabledSponsorLanes().has(lane)) {
    return {
      lane,
      privateKey: null,
      source: 'missing' as const,
      envVar: getSponsorLaneEnvVar(lane),
      filePath: getSponsorLaneFilePath(lane),
      usesSharedFallback: false
    };
  }
  const laneEnvVar = sponsorLaneEnvVar[lane];
  const envLane = getSecret(laneEnvVar) || getSecret(sponsorLaneLegacyEnvVar[lane]);
  if (envLane) {
    return {
      lane,
      privateKey: envLane,
      source: 'env-lane' as const,
      envVar: getSecret(laneEnvVar) ? laneEnvVar : sponsorLaneLegacyEnvVar[lane],
      filePath: null,
      usesSharedFallback: false
    };
  }

  const laneFilePath = getSponsorLaneFilePath(lane);
  const storedLane = readLocalTextFile(laneFilePath);
  if (storedLane) {
    return {
      lane,
      privateKey: storedLane,
      source: 'stored-lane' as const,
      envVar: null,
      filePath: laneFilePath,
      usesSharedFallback: false
    };
  }

  const sharedEnv = getSecret('SPONSOR_PRIVATE_KEY');
  if (sharedEnv) {
    return {
      lane,
      privateKey: sharedEnv,
      source: 'env-shared' as const,
      envVar: 'SPONSOR_PRIVATE_KEY',
      filePath: null,
      usesSharedFallback: true
    };
  }

  const sharedFilePath = path.join(getDeploymentDir(), 'sponsor-private-key.txt');
  const storedShared = readLocalTextFile(sharedFilePath);
  if (storedShared) {
    return {
      lane,
      privateKey: storedShared,
      source: 'stored-shared' as const,
      envVar: null,
      filePath: sharedFilePath,
      usesSharedFallback: true
    };
  }

  return {
    lane,
    privateKey: null,
    source: 'missing' as const,
    envVar: laneEnvVar,
    filePath: laneFilePath,
    usesSharedFallback: false
  };
}

export function resolveSponsorPublicKeyForLane(lane: SponsorLane) {
  const resolved = resolveSponsorPrivateKeyForLane(lane);
  if (!resolved.privateKey) return null;
  try {
    return PrivateKey.fromBase58(resolved.privateKey).toPublicKey().toBase58();
  } catch {
    return null;
  }
}

export function getSponsorLaneStatus(lane: SponsorLane): SponsorLaneStatus {
  const resolved = resolveSponsorPrivateKeyForLane(lane);
  return {
    lane,
    privateKeyConfigured: Boolean(resolved.privateKey),
    publicKey: resolveSponsorPublicKeyForLane(lane),
    source: resolved.source,
    envVar: resolved.envVar,
    filePath: resolved.filePath,
    usesSharedFallback: resolved.usesSharedFallback
  };
}

export function listSponsorLaneStatuses(): SponsorLaneStatus[] {
  return (['request', 'output', 'registry', 'credits'] as SponsorLane[]).map((lane) => getSponsorLaneStatus(lane));
}

export function hasAnySponsorLanePrivateKey() {
  return listSponsorLaneStatuses().some((entry) => entry.privateKeyConfigured);
}
