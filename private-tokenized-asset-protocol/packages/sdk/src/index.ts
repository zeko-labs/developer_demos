import type {
  BurnRequest,
  EligibilityProofRequest,
  MintRequest,
  ProofEnvelope,
  RecordSettlementRequest,
  SourceAdapterRequest,
  TenantProviderConfig,
  UpsertIssuerControlConfigRequest,
  TransferRequest
} from '@tap/shared-types';
export * from './partnerAdapterKit.js';

export class TapClient {
  constructor(
    private readonly baseUrl: string,
    private readonly options?: { apiKey?: string }
  ) {}

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options?.apiKey) {
      headers.authorization = `Bearer ${this.options.apiKey}`;
    }
    return headers;
  }

  async health() {
    return fetch(`${this.baseUrl}/api/v1/health`).then((r) => r.json());
  }

  async config() {
    return fetch(`${this.baseUrl}/api/v1/config/public`).then((r) => r.json());
  }

  async createEligibilityProof(payload: EligibilityProofRequest) {
    return fetch(`${this.baseUrl}/api/v1/proof/eligibility`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload)
    }).then((r) => r.json());
  }

  async verifyProof(payload: ProofEnvelope) {
    return fetch(`${this.baseUrl}/api/v1/proof/verify`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload)
    }).then((r) => r.json());
  }

  async recordSettlement(payload: RecordSettlementRequest) {
    return fetch(`${this.baseUrl}/api/v1/settlement/record`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload)
    }).then((r) => r.json());
  }

  async recentSettlements() {
    return fetch(`${this.baseUrl}/api/v1/settlement/recent`).then((r) => r.json());
  }

  async requestMint(payload: MintRequest) {
    return fetch(`${this.baseUrl}/api/v1/issuer/mint/request`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload)
    }).then((r) => r.json());
  }

  async requestBurn(payload: BurnRequest) {
    return fetch(`${this.baseUrl}/api/v1/issuer/burn/request`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload)
    }).then((r) => r.json());
  }

  async listIssuerRequests() {
    return fetch(`${this.baseUrl}/api/v1/issuer/requests`, {
      headers: this.headers()
    }).then((r) => r.json());
  }

  async approveIssuerRequest(kind: 'mint' | 'burn', requestId: string, note?: string) {
    return fetch(`${this.baseUrl}/api/v1/issuer/${kind}/${requestId}/approve`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(note ? { note } : {})
    }).then((r) => r.json());
  }

  async rejectIssuerRequest(kind: 'mint' | 'burn', requestId: string, note?: string) {
    return fetch(`${this.baseUrl}/api/v1/issuer/${kind}/${requestId}/reject`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(note ? { note } : {})
    }).then((r) => r.json());
  }

  async requestTransfer(payload: TransferRequest) {
    return fetch(`${this.baseUrl}/api/v1/transfer/request`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload)
    }).then((r) => r.json());
  }

  async listSourceProviders() {
    return fetch(`${this.baseUrl}/api/v1/attest/source/providers`, {
      headers: this.headers()
    }).then((r) => r.json());
  }

  async collectSourceAttestation(payload: SourceAdapterRequest) {
    return fetch(`${this.baseUrl}/api/v1/attest/source/collect`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload)
    }).then((r) => r.json());
  }

  async upsertTenantProviderConfig(tenantId: string, payload: Omit<TenantProviderConfig, 'tenantId'>) {
    return fetch(`${this.baseUrl}/api/v1/tenant/${tenantId}/provider-config`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ...payload, tenantId })
    }).then((r) => r.json());
  }

  async getTenantProviderConfigs(tenantId: string) {
    return fetch(`${this.baseUrl}/api/v1/tenant/${tenantId}/provider-configs`, {
      headers: this.headers()
    }).then((r) => r.json());
  }

  async upsertIssuerControls(payload: UpsertIssuerControlConfigRequest) {
    return fetch(`${this.baseUrl}/api/v1/issuer/controls/upsert`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload)
    }).then((r) => r.json());
  }

  async getIssuerControls(tenantId: string) {
    return fetch(`${this.baseUrl}/api/v1/issuer/controls?tenantId=${encodeURIComponent(tenantId)}`, {
      headers: this.headers()
    }).then((r) => r.json());
  }

  async runSettlementReconcileOnce(payload?: {
    limit?: number;
    staleMinutes?: number;
    dryRun?: boolean;
    force?: boolean;
    forceSupervisor?: boolean;
    policy?: {
      allowFinalizeMissingTimestamp?: boolean;
      allowRetryPendingSubmit?: boolean;
      allowPromoteSubmittedRecorded?: boolean;
      allowMarkSubmittedFailed?: boolean;
    };
  }) {
    return fetch(`${this.baseUrl}/api/v1/reliability/settlement-reconcile/run-once`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload || {})
    }).then((r) => r.json());
  }

  async getSettlementReconcileSupervisor() {
    return fetch(`${this.baseUrl}/api/v1/reliability/settlement-reconcile/supervisor`, {
      headers: this.headers()
    }).then((r) => r.json());
  }

  async upsertSettlementReconcileSupervisor(payload: {
    staleMinutes?: number;
    maxActionsPerRun?: number;
    failureBudgetPerHour?: number;
    pauseMinutesOnBudgetExceeded?: number;
    alertWebhookUrl?: string;
    slackWebhookUrl?: string;
    resetFailureBudget?: boolean;
    policy?: {
      allowFinalizeMissingTimestamp?: boolean;
      allowRetryPendingSubmit?: boolean;
      allowPromoteSubmittedRecorded?: boolean;
      allowMarkSubmittedFailed?: boolean;
    };
  }) {
    return fetch(`${this.baseUrl}/api/v1/reliability/settlement-reconcile/supervisor/upsert`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload || {})
    }).then((r) => r.json());
  }
}
