import type { ProofEnvelope } from '@tap/shared-types';
export interface ZkTlsArtifacts {
    runId: string;
    outputDir: string;
    attestation?: unknown;
    disclosedFields?: unknown;
    proof?: unknown;
    verificationKey?: unknown;
    settlement?: unknown;
}
export interface ZkTlsToTapOptions {
    subjectCommitment: string;
    proofIdPrefix?: string;
    tenantId?: string;
    policyId?: number;
    policyVersion?: number;
    policyHash?: string;
    sourceProfile?: 'employment' | 'bank';
}
export interface ZkTlsTaskResult {
    stdout: string;
    stderr: string;
}
export interface ZkTlsPipelineOptions {
    mode?: 'eligible' | 'ineligible';
    profile?: 'employment' | 'bank';
}
export declare function getZkTlsArtifacts(runId?: string): Promise<ZkTlsArtifacts>;
export declare function latestZkTlsArtifacts(): Promise<ZkTlsArtifacts>;
export declare function runZkTlsPipeline(modeOrOptions?: 'eligible' | 'ineligible' | ZkTlsPipelineOptions): Promise<{
    stdout: string;
    stderr: string;
    artifacts: ZkTlsArtifacts;
}>;
export declare function runZkTlsTask(task: 'poc:settle' | 'poc:verify-chain', options?: {
    runId?: string;
}): Promise<ZkTlsTaskResult>;
export declare function assertZkTlsRepoReady(): Promise<{
    repoPath: string;
    exists: boolean;
    hasMoon: boolean;
}>;
export declare function mapZkTlsArtifactsToTapProof(artifacts: ZkTlsArtifacts, options: ZkTlsToTapOptions): ProofEnvelope | null;
