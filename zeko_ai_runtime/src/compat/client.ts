import {
  CoordinatorClient,
  type CoordinatorClientOptions,
  type CoordinatorCompatChatCompletionResponse,
  type CoordinatorCompatInferenceResponse,
  type CoordinatorCompatModelsResponse,
  type CoordinatorCompatReceiptResponse,
  type CoordinatorInferenceStatusResponse,
  type CoordinatorWaitForInferenceStatusOptions
} from '../sdk/coordinator-client.js';

export interface CompatInferenceCreateRequest {
  modelId?: string;
  model?: string;
  prompt?: string;
  input?: unknown;
  inputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  settlementMode?: string;
  clientEncryptionPublicKeyPem?: string;
  publishToDa?: boolean;
  waitForSettlement?: boolean;
  statusToken?: string;
  callbackUrl?: string;
  callbackMode?: 'terminal' | 'status-change';
}

export interface CompatChatCompletionRequest {
  model?: string;
  messages: Array<{ role: string; content: string; name?: string }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  settlementMode?: string;
  clientEncryptionPublicKeyPem?: string;
  publishToDa?: boolean;
  waitForSettlement?: boolean;
  statusToken?: string;
  callbackUrl?: string;
  callbackMode?: 'terminal' | 'status-change';
}

export class CompatClient extends CoordinatorClient {
  constructor(options: CoordinatorClientOptions) {
    super(options);
  }

  async listModels() {
    return await this.getCompatModels();
  }

  async createInference(
    body: CompatInferenceCreateRequest,
    options: { idempotencyKey?: string } = {}
  ) {
    return await this.createCompatInference(body as unknown as Record<string, unknown>, options);
  }

  async createChatCompletion(
    body: CompatChatCompletionRequest,
    options: { idempotencyKey?: string } = {}
  ) {
    return await this.createCompatChatCompletion(body as unknown as Record<string, unknown>, options);
  }

  async getInference(id: string) {
    return await this.getCompatInference(id);
  }

  async getInferenceStatus(id: string) {
    return await this.getCompatInferenceStatus(id);
  }

  async getReceipt(id: string) {
    return await this.getCompatInferenceReceipt(id);
  }

  async waitForInference(
    id: string,
    options: CoordinatorWaitForInferenceStatusOptions = {}
  ): Promise<CoordinatorInferenceStatusResponse> {
    const inference = await this.getCompatInference(id);
    const token = inference.status_token;
    if (!token) {
      throw new Error(`Compatibility inference ${id} did not include a status token.`);
    }
    return await this.waitForInferenceStatus(token, options);
  }
}

export function createCompatClient(options: CoordinatorClientOptions) {
  return new CompatClient(options);
}

export type {
  CoordinatorCompatChatCompletionResponse as CompatChatCompletionResponse,
  CoordinatorCompatInferenceResponse as CompatInferenceResponse,
  CoordinatorCompatModelsResponse as CompatModelsResponse,
  CoordinatorCompatReceiptResponse as CompatReceiptResponse
};
