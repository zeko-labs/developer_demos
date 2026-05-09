#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const allowedSourceCategories = new Set([
  'balance',
  'reserves',
  'kyc',
  'identity',
  'holdings',
  'suitability',
  'transfer-agent',
  'treasury',
  'custom'
]);

const allowedIntegrationModes = new Set(['adapter', 'zktls']);
const allowedOperations = new Set(['mint', 'burn', 'issue', 'allocate', 'restrict', 'redeem', 'transfer']);

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null;
}

function pushIssue(target, code, message, detail = {}) {
  target.push({ code, message, ...detail });
}

function validateSource(source, index, issues, warnings) {
  const label = source?.sourceId || `sources[${index}]`;

  if (!isObject(source)) {
    pushIssue(issues, 'source_invalid', `Source ${index} must be an object.`);
    return;
  }

  if (!hasValue(source.sourceId)) {
    pushIssue(issues, 'source_id_required', `Source ${index} is missing sourceId.`);
  }

  if (!allowedSourceCategories.has(source.category)) {
    pushIssue(issues, 'source_category_invalid', `${label} has an unsupported category.`, {
      allowed: [...allowedSourceCategories]
    });
  }

  if (!allowedIntegrationModes.has(source.integrationMode)) {
    pushIssue(issues, 'source_integration_mode_invalid', `${label} must use adapter or zktls mode.`, {
      allowed: [...allowedIntegrationModes]
    });
  }

  if (!hasValue(source.providerLabel)) {
    pushIssue(issues, 'source_provider_label_required', `${label} is missing providerLabel.`);
  }

  if (!Array.isArray(source.requiredFields) || source.requiredFields.length === 0) {
    pushIssue(issues, 'source_fields_required', `${label} must declare requiredFields.`);
  }

  if (source.integrationMode === 'adapter') {
    if (!isObject(source.adapter)) {
      pushIssue(issues, 'adapter_config_required', `${label} uses adapter mode but is missing adapter config.`);
    } else {
      if (!hasValue(source.adapter.baseUrl)) {
        pushIssue(issues, 'adapter_base_url_required', `${label} adapter config is missing baseUrl.`);
      }
      if (!hasValue(source.adapter.authProfile)) {
        pushIssue(issues, 'adapter_auth_profile_required', `${label} adapter config is missing authProfile.`);
      }
      if (!Array.isArray(source.adapter.allowedHosts) || source.adapter.allowedHosts.length === 0) {
        pushIssue(warnings, 'adapter_allowed_hosts_missing', `${label} should declare explicit allowedHosts.`);
      }
      if (!hasValue(source.adapter.mappingVersion)) {
        pushIssue(warnings, 'adapter_mapping_version_missing', `${label} should declare mappingVersion.`);
      }
    }
  }

  if (source.integrationMode === 'zktls') {
    if (!isObject(source.zktls)) {
      pushIssue(issues, 'zktls_config_required', `${label} uses zkTLS mode but is missing zktls config.`);
    } else {
      if (!hasValue(source.zktls.httpsUrl)) {
        pushIssue(issues, 'zktls_https_url_required', `${label} zkTLS config is missing httpsUrl.`);
      }
      if (!hasValue(source.zktls.expectedServerName)) {
        pushIssue(issues, 'zktls_server_name_required', `${label} zkTLS config is missing expectedServerName.`);
      }
      if (!Array.isArray(source.zktls.disclosedFields) || source.zktls.disclosedFields.length === 0) {
        pushIssue(issues, 'zktls_disclosed_fields_required', `${label} zkTLS config must list disclosedFields.`);
      }
    }
  }
}

function validatePolicy(policy, sourceIds, index, issues, warnings) {
  const label = policy?.policyId !== undefined ? `policy ${policy.policyId}` : `policies[${index}]`;

  if (!isObject(policy)) {
    pushIssue(issues, 'policy_invalid', `Policy ${index} must be an object.`);
    return;
  }

  if (!Number.isInteger(policy.policyId)) {
    pushIssue(issues, 'policy_id_required', `${label} is missing integer policyId.`);
  }

  if (!hasValue(policy.purpose)) {
    pushIssue(issues, 'policy_purpose_required', `${label} is missing purpose.`);
  }

  if (!Array.isArray(policy.requiredSources) || policy.requiredSources.length === 0) {
    pushIssue(issues, 'policy_sources_required', `${label} must declare requiredSources.`);
  } else {
    for (const sourceId of policy.requiredSources) {
      if (!sourceIds.has(sourceId)) {
        pushIssue(issues, 'policy_source_unknown', `${label} references unknown source ${sourceId}.`);
      }
    }
  }

  if (!hasValue(policy.jurisdiction)) {
    pushIssue(warnings, 'policy_jurisdiction_missing', `${label} should declare jurisdiction.`);
  }
}

function validateOperation(operation, policyIds, index, issues, warnings) {
  const label = operation?.operation || `operations[${index}]`;

  if (!isObject(operation)) {
    pushIssue(issues, 'operation_invalid', `Operation ${index} must be an object.`);
    return;
  }

  if (!allowedOperations.has(operation.operation)) {
    pushIssue(issues, 'operation_invalid_name', `${label} is not a supported TAP operation.`, {
      allowed: [...allowedOperations]
    });
  }

  if (!Number.isInteger(operation.policyId)) {
    pushIssue(issues, 'operation_policy_required', `${label} is missing integer policyId.`);
  } else if (!policyIds.has(operation.policyId)) {
    pushIssue(issues, 'operation_policy_unknown', `${label} references unknown policyId ${operation.policyId}.`);
  }

  if (operation.approvalRequired !== true) {
    pushIssue(warnings, 'operation_approval_not_required', `${label} should normally require issuer approval.`);
  }
}

function scoreReadiness(issues, warnings) {
  const issuePenalty = Math.min(80, issues.length * 16);
  const warningPenalty = Math.min(20, warnings.length * 4);
  return Math.max(0, 100 - issuePenalty - warningPenalty);
}

function buildIntegrationPlan(profile) {
  const sources = Array.isArray(profile.sources) ? profile.sources : [];
  const policies = Array.isArray(profile.policies) ? profile.policies : [];
  const operations = Array.isArray(profile.operations) ? profile.operations : [];

  return {
    tenantId: profile.tenantId || null,
    enabledRails: {
      stablecoin: Boolean(profile.assets?.stablecoin?.enabled),
      tokenizedStock: Boolean(profile.assets?.tokenizedStock?.enabled)
    },
    adapterProviderConfigs: sources
      .filter((source) => source?.integrationMode === 'adapter')
      .map((source) => ({
        provider: source.sourceId,
        category: source.category,
        baseUrl: source.adapter?.baseUrl || null,
        allowedHosts: source.adapter?.allowedHosts || [],
        authProfile: source.adapter?.authProfile || null,
        mappingVersion: source.adapter?.mappingVersion || null,
        requiredFields: source.requiredFields || []
      })),
    zktlsProfiles: sources
      .filter((source) => source?.integrationMode === 'zktls')
      .map((source) => ({
        sourceId: source.sourceId,
        category: source.category,
        httpsUrl: source.zktls?.httpsUrl || null,
        expectedServerName: source.zktls?.expectedServerName || null,
        disclosedFields: source.zktls?.disclosedFields || []
      })),
    policySeedPlan: policies.map((policy) => ({
      policyId: policy.policyId,
      purpose: policy.purpose || null,
      jurisdiction: policy.jurisdiction || null,
      requiredSources: policy.requiredSources || []
    })),
    issuerWorkflowPlan: operations.map((operation) => ({
      operation: operation.operation,
      policyId: operation.policyId,
      approvalRequired: operation.approvalRequired === true
    })),
    transcriptTargets: [
      'customer-owned dual-asset flow',
      'stablecoin mint and burn approval flow',
      'tokenized stock issue, allocate, restrict, and redeem flow',
      'zkTLS source collection flow when zktlsProfiles is non-empty'
    ]
  };
}

function recommendedNextSteps(profile, issues, warnings) {
  if (issues.length > 0) {
    return [
      'Resolve blocker items in the integration profile.',
      'Run this validator again until blockerCount is zero.',
      'Bootstrap tenant provider config and active policies before running a transcript.'
    ];
  }

  const modes = new Set((profile.sources || []).map((source) => source.integrationMode));
  const steps = [
    'Bootstrap the declared tenant provider configs.',
    'Seed the declared active policies.',
    'Run one source collection for each required source.',
    'Generate a customer-owned dual-asset transcript.'
  ];

  if (modes.has('zktls')) {
    steps.splice(2, 0, 'Run zkTLS readiness checks for HTTPS source binding and disclosed fields.');
  }

  if (warnings.length > 0) {
    steps.push('Address warning items before treating this as bank-pilot ready.');
  }

  return steps;
}

function validateProfile(profile) {
  const issues = [];
  const warnings = [];

  if (!isObject(profile)) {
    return {
      ok: false,
      readinessScore: 0,
      blockerCount: 1,
      warningCount: 0,
      issues: [{ code: 'profile_invalid', message: 'Profile must be a JSON object.' }],
      warnings: [],
      nextSteps: ['Provide a valid JSON object.']
    };
  }

  if (!hasValue(profile.profileVersion)) {
    pushIssue(warnings, 'profile_version_missing', 'profileVersion is recommended for repeatable bank reviews.');
  }

  if (!hasValue(profile.tenantId)) {
    pushIssue(issues, 'tenant_id_required', 'tenantId is required.');
  }

  if (!isObject(profile.institution) || !hasValue(profile.institution.legalName)) {
    pushIssue(issues, 'institution_required', 'institution.legalName is required.');
  }

  if (!isObject(profile.assets)) {
    pushIssue(issues, 'assets_required', 'assets object is required.');
  } else if (!profile.assets.stablecoin?.enabled && !profile.assets.tokenizedStock?.enabled) {
    pushIssue(issues, 'asset_rail_required', 'At least one asset rail must be enabled.');
  }

  const sources = Array.isArray(profile.sources) ? profile.sources : [];
  if (sources.length === 0) {
    pushIssue(issues, 'sources_required', 'At least one source must be declared.');
  }
  sources.forEach((source, index) => validateSource(source, index, issues, warnings));
  const sourceIds = new Set(sources.map((source) => source?.sourceId).filter(Boolean));

  const policies = Array.isArray(profile.policies) ? profile.policies : [];
  if (policies.length === 0) {
    pushIssue(issues, 'policies_required', 'At least one policy must be declared.');
  }
  policies.forEach((policy, index) => validatePolicy(policy, sourceIds, index, issues, warnings));
  const policyIds = new Set(policies.map((policy) => policy?.policyId).filter(Number.isInteger));

  const operations = Array.isArray(profile.operations) ? profile.operations : [];
  if (operations.length === 0) {
    pushIssue(issues, 'operations_required', 'At least one operation must be declared.');
  }
  operations.forEach((operation, index) => validateOperation(operation, policyIds, index, issues, warnings));

  const readinessScore = scoreReadiness(issues, warnings);

  return {
    ok: issues.length === 0,
    readinessScore,
    blockerCount: issues.length,
    warningCount: warnings.length,
    profile: {
      tenantId: profile.tenantId || null,
      institution: profile.institution?.legalName || null,
      sourceCount: sources.length,
      policyCount: policies.length,
      operationCount: operations.length
    },
    issues,
    warnings,
    integrationPlan: buildIntegrationPlan(profile),
    nextSteps: recommendedNextSteps(profile, issues, warnings)
  };
}

function usage() {
  const script = path.basename(process.argv[1] || 'validate_bank_rwa_profile.mjs');
  console.error(`usage: node scripts/${script} <profile.json>`);
}

const filePath = process.argv[2];
if (!filePath) {
  usage();
  process.exit(2);
}

try {
  const resolved = path.resolve(process.cwd(), filePath);
  const profile = readJson(resolved);
  const result = validateProfile(profile);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
