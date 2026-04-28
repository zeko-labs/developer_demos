import 'dotenv/config';

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  CoordinatorClient,
  loadCoordinatorEnv,
  resolveCoordinatorAuth,
  resolveCoordinatorBaseUrl
} from '../src/sdk/index.js';

type JsonSchema = Record<string, any>;
type OpenApiDocument = {
  paths: Record<string, any>;
  components?: {
    schemas?: Record<string, JsonSchema>;
  };
};

function defaultBuilderEnvFile() {
  return 'data/opengradient/http-auth/builders/builder-conformance-local.local.env';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaAt(document: OpenApiDocument, ref: string): JsonSchema {
  const pointer = ref.replace(/^#\//, '').split('/');
  let current: any = document;
  for (const segment of pointer) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      throw new Error(`Unable to resolve schema ref ${ref}`);
    }
    current = current[segment];
  }
  return current as JsonSchema;
}

function validateSchema(document: OpenApiDocument, schema: JsonSchema, value: unknown, label: string, errors: string[]) {
  if (!schema) return;
  if (schema.$ref) {
    validateSchema(document, schemaAt(document, schema.$ref), value, label, errors);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) {
      validateSchema(document, entry, value, label, errors);
    }
  }

  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const candidates = (schema.anyOf || schema.oneOf) as JsonSchema[];
    const localErrors = candidates.map(() => [] as string[]);
    const matched = candidates.some((entry, index) => {
      validateSchema(document, entry, value, label, localErrors[index]);
      return localErrors[index].length === 0;
    });
    if (!matched) {
      errors.push(`${label}: value did not satisfy any allowed schema variant.`);
    }
    return;
  }

  if (schema.nullable === true && value === null) {
    return;
  }

  if (Array.isArray(schema.type)) {
    const variants = schema.type as string[];
    const localErrors = variants.map(() => [] as string[]);
    const matched = variants.some((variant, index) => {
      validateSchema(document, { ...schema, type: variant }, value, label, localErrors[index]);
      return localErrors[index].length === 0;
    });
    if (!matched) {
      errors.push(`${label}: value did not satisfy any allowed type ${JSON.stringify(variants)}.`);
    }
    return;
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    errors.push(`${label}: expected constant ${JSON.stringify(schema.const)}, received ${JSON.stringify(value)}.`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${label}: expected one of ${JSON.stringify(schema.enum)}, received ${JSON.stringify(value)}.`);
  }

  const type = schema.type;
  if (type === 'object' || (!type && (schema.properties || schema.required))) {
    if (!isPlainObject(value)) {
      errors.push(`${label}: expected object, received ${Array.isArray(value) ? 'array' : typeof value}.`);
      return;
    }

    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${label}: missing required property ${key}.`);
      }
    }

    const properties = isPlainObject(schema.properties) ? (schema.properties as Record<string, JsonSchema>) : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) {
        validateSchema(document, propertySchema, value[key], `${label}.${key}`, errors);
      }
    }

    const additionalProperties = schema.additionalProperties;
    if (additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(`${label}: unexpected property ${key}.`);
        }
      }
    } else if (isPlainObject(additionalProperties)) {
      for (const [key, propertyValue] of Object.entries(value)) {
        if (!(key in properties)) {
          validateSchema(document, additionalProperties, propertyValue, `${label}.${key}`, errors);
        }
      }
    }
    return;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${label}: expected array, received ${typeof value}.`);
      return;
    }
    if (schema.items) {
      value.forEach((entry, index) => validateSchema(document, schema.items, entry, `${label}[${index}]`, errors));
    }
    return;
  }

  if (type === 'string' && typeof value !== 'string') {
    errors.push(`${label}: expected string, received ${typeof value}.`);
    return;
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${label}: expected boolean, received ${typeof value}.`);
    return;
  }
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    errors.push(`${label}: expected finite number, received ${JSON.stringify(value)}.`);
    return;
  }
  if (type === 'integer' && (!Number.isInteger(value) || typeof value !== 'number')) {
    errors.push(`${label}: expected integer, received ${JSON.stringify(value)}.`);
    return;
  }
}

function assertSchema(document: OpenApiDocument, schema: JsonSchema, value: unknown, label: string) {
  const errors: string[] = [];
  validateSchema(document, schema, value, label, errors);
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}

function getRequestSchema(document: OpenApiDocument, route: string, method: 'get' | 'post') {
  return document.paths[route]?.[method]?.requestBody?.content?.['application/json']?.schema as JsonSchema;
}

function getResponseSchema(document: OpenApiDocument, route: string, method: 'get' | 'post', status: string) {
  return document.paths[route]?.[method]?.responses?.[status]?.content?.['application/json']?.schema as JsonSchema;
}

async function main() {
  loadCoordinatorEnv({
    envFile:
      process.env.ZEKO_AI_BUILDER_CONTRACT_ENV_FILE?.trim() ||
      process.env.OPENGRADIENT_BUILDER_CONTRACT_ENV_FILE?.trim() ||
      defaultBuilderEnvFile()
  });

  const document = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'docs', 'builder-api.openapi.json'), 'utf8')
  ) as OpenApiDocument;

  const baseUrl = resolveCoordinatorBaseUrl();
  const client = new CoordinatorClient({
    baseUrl,
    auth: resolveCoordinatorAuth(),
    timeoutMs: Number(process.env.ZEKO_AI_COORDINATOR_TIMEOUT_MS || process.env.OPENGRADIENT_COORDINATOR_TIMEOUT_MS || 20_000)
  });

  const authMe = await client.getAuthMe();
  const routing = await client.getRouting();
  const models = await client.requestJson<Record<string, unknown>>('/api/models', { method: 'GET' });

  assertSchema(document, getResponseSchema(document, '/api/auth/me', 'get', '200'), authMe, '/api/auth/me 200');
  assertSchema(document, getResponseSchema(document, '/api/operators/routing', 'get', '200'), routing, '/api/operators/routing 200');
  assertSchema(document, getResponseSchema(document, '/api/models', 'get', '200'), models, '/api/models 200');

  const nativeInferenceBody = {
    modelId:
      process.env.ZEKO_AI_MODEL_ID?.trim() ||
      process.env.OPENGRADIENT_MODEL_ID?.trim() ||
      ((models as any).models?.[0]?.id as string) ||
      'verifiable-echo',
    prompt: `contract validation native ${Date.now()}`,
    inputs: {
      source: 'validate-builder-contract'
    },
    settlementMode: 'SETTLE_INDIVIDUAL'
  };
  assertSchema(document, getRequestSchema(document, '/api/infer', 'post'), nativeInferenceBody, '/api/infer request');

  const nativeInference = await client.requestJson<Record<string, any>>('/api/infer', {
    method: 'POST',
    body: nativeInferenceBody,
    idempotencyKey: `contract-native-${Date.now()}`
  });
  assertSchema(document, getResponseSchema(document, '/api/infer', 'post', '201'), nativeInference, '/api/infer 201');

  const nativeStatus = await client.getInferenceStatus(String(nativeInference.requestStatus?.token || ''));
  assertSchema(
    document,
    getResponseSchema(document, '/api/request-status/{token}', 'get', '200'),
    nativeStatus,
    '/api/request-status/{token} 200'
  );

  const compatInferenceBody = {
    model: nativeInferenceBody.modelId,
    prompt: `contract validation compat ${Date.now()}`,
    input: {
      source: 'validate-builder-contract'
    }
  };
  assertSchema(
    document,
    getRequestSchema(document, '/api/compat/reference/inference', 'post'),
    compatInferenceBody,
    '/api/compat/reference/inference request'
  );

  const compatInference = await client.createCompatInference(compatInferenceBody, {
    idempotencyKey: `contract-compat-${Date.now()}`
  });
  assertSchema(
    document,
    getResponseSchema(document, '/api/compat/reference/inference', 'post', '201'),
    compatInference,
    '/api/compat/reference/inference 201'
  );

  const compatStatus = await client.getCompatInferenceStatus(compatInference.id);
  assertSchema(
    document,
    getResponseSchema(document, '/api/compat/reference/inference/{id}/status', 'get', '200'),
    compatStatus,
    '/api/compat/reference/inference/{id}/status 200'
  );

  const compatReceipt = await client.getCompatInferenceReceipt(compatInference.id);
  assertSchema(
    document,
    getResponseSchema(document, '/api/compat/reference/inference/{id}/receipt', 'get', '200'),
    compatReceipt,
    '/api/compat/reference/inference/{id}/receipt 200'
  );

  const mcpListRequest = {
    jsonrpc: '2.0',
    id: 'contract-tools-list',
    method: 'tools/list'
  };
  assertSchema(document, getRequestSchema(document, '/api/mcp', 'post'), mcpListRequest, '/api/mcp request');
  const mcpList = await client.mcpListTools();
  assertSchema(document, getResponseSchema(document, '/api/mcp', 'post', '200'), mcpList, '/api/mcp 200');

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        builder: authMe.principal,
        nativeInferenceId: nativeInference.id,
        compatInferenceId: compatInference.id,
        validatedPaths: [
          '/api/auth/me',
          '/api/operators/routing',
          '/api/models',
          '/api/infer',
          '/api/request-status/{token}',
          '/api/compat/reference/inference',
          '/api/compat/reference/inference/{id}/status',
          '/api/compat/reference/inference/{id}/receipt',
          '/api/mcp'
        ]
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[validate-builder-contract] failed', error);
  process.exit(1);
});
