import fs from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import type { CoordinatorAuth } from './coordinator-client.js';

export interface CoordinatorEnvLoadOptions {
  cwd?: string;
  envFile?: string | null;
  includeBuilderFallback?: boolean;
}

export interface CoordinatorEnvLoadResult {
  cwd: string;
  candidatePaths: string[];
  loadedPaths: string[];
}

const defaultCoordinatorUrl = 'http://127.0.0.1:5180';

function firstDefinedEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeCandidatePath(filePath: string | null | undefined, cwd: string) {
  const trimmed = filePath?.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
}

function pushCandidate(candidates: string[], candidatePath: string | null) {
  if (!candidatePath || candidates.includes(candidatePath)) {
    return;
  }
  candidates.push(candidatePath);
}

function findSingleBuilderEnvPath(cwd: string) {
  const candidateDirs = [
    path.join(cwd, 'data', 'zeko-ai', 'http-auth', 'builders'),
    path.join(cwd, 'data', 'opengradient', 'http-auth', 'builders')
  ];
  for (const builderDir of candidateDirs) {
    try {
      const entries = fs.readdirSync(builderDir).filter((entry) => entry.endsWith('.local.env')).sort();
      if (entries.length === 1) {
        return path.join(builderDir, entries[0]!);
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function resolveCoordinatorEnvCandidates(
  options: CoordinatorEnvLoadOptions = {}
): Pick<CoordinatorEnvLoadResult, 'cwd' | 'candidatePaths'> {
  const cwd = options.cwd || process.cwd();
  const candidates: string[] = [];

  pushCandidate(
    candidates,
    normalizeCandidatePath(
      options.envFile || firstDefinedEnv('ZEKO_AI_COORDINATOR_ENV_FILE', 'OPENGRADIENT_COORDINATOR_ENV_FILE'),
      cwd
    )
  );
  if (options.includeBuilderFallback !== false) {
    pushCandidate(candidates, findSingleBuilderEnvPath(cwd));
  }
  pushCandidate(candidates, path.join(cwd, 'data', 'zeko-ai', 'http-auth', 'sdk.local.env'));
  pushCandidate(candidates, path.join(cwd, 'data', 'opengradient', 'http-auth', 'sdk.local.env'));

  return {
    cwd,
    candidatePaths: candidates
  };
}

export function loadCoordinatorEnv(options: CoordinatorEnvLoadOptions = {}): CoordinatorEnvLoadResult {
  const { cwd, candidatePaths } = resolveCoordinatorEnvCandidates(options);
  const loadedPaths: string[] = [];

  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }
    dotenv.config({
      path: candidatePath,
      override: false
    });
    loadedPaths.push(candidatePath);
  }

  return {
    cwd,
    candidatePaths,
    loadedPaths
  };
}

export function resolveCoordinatorAuth(): CoordinatorAuth {
  const apiKey = firstDefinedEnv('ZEKO_AI_COORDINATOR_API_KEY', 'OPENGRADIENT_COORDINATOR_API_KEY');
  if (apiKey) {
    return { kind: 'api-key', apiKey };
  }
  const bearerToken = firstDefinedEnv('ZEKO_AI_COORDINATOR_BEARER_TOKEN', 'OPENGRADIENT_COORDINATOR_BEARER_TOKEN');
  if (bearerToken) {
    return { kind: 'bearer', token: bearerToken };
  }
  return { kind: 'none' };
}

export function resolveCoordinatorBaseUrl(fallback = defaultCoordinatorUrl) {
  return firstDefinedEnv('ZEKO_AI_COORDINATOR_URL', 'OPENGRADIENT_COORDINATOR_URL') || fallback;
}
