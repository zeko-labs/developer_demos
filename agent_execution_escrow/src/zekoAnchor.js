import crypto from 'node:crypto';
import { getZekoIntentSyncConfig, syncZekoIntentLifecycle } from './zekoIntentSync.js';

const ZEKO_SUBMIT_MODE = process.env.ZEKO_SUBMIT_MODE || 'record';
const ZEKO_NETWORK_ID = process.env.ZEKO_NETWORK_ID || 'testnet';
const ZEKO_SUBMITTER_URL = process.env.ZEKO_SUBMITTER_URL || '';
const ZEKO_SUBMITTER_TOKEN = process.env.ZEKO_SUBMITTER_TOKEN || '';

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function getAnchorConfig() {
  return {
    mode: ZEKO_SUBMIT_MODE,
    networkId: ZEKO_NETWORK_ID,
    submitterConfigured: Boolean(ZEKO_SUBMITTER_URL),
    zkappSync: getZekoIntentSyncConfig()
  };
}

export async function submitAnchorPayload(anchorPayload, context = {}) {
  const payloadHash = `0x${stableHash(anchorPayload)}`;

  if (ZEKO_SUBMIT_MODE === 'zkapp') {
    const result = await syncZekoIntentLifecycle(context.transaction, anchorPayload);
    return {
      ...result,
      payloadHash: result.payloadHash || payloadHash,
      networkId: result.networkId || ZEKO_NETWORK_ID
    };
  }

  if (ZEKO_SUBMIT_MODE === 'relay') {
    if (!ZEKO_SUBMITTER_URL) {
      const err = new Error('zeko_submitter_not_configured');
      err.statusCode = 503;
      throw err;
    }

    const response = await fetch(ZEKO_SUBMITTER_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ZEKO_SUBMITTER_TOKEN ? { authorization: `Bearer ${ZEKO_SUBMITTER_TOKEN}` } : {})
      },
      body: JSON.stringify({
        networkId: ZEKO_NETWORK_ID,
        anchorPayload
      })
    });

    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = { raw };
    }

    if (!response.ok) {
      const err = new Error(parsed?.error || `zeko_submit_failed:${response.status}`);
      err.statusCode = 502;
      err.details = parsed;
      throw err;
    }

    return {
      mode: 'relay',
      status: parsed?.status || 'submitted',
      payloadHash,
      relay: {
        url: ZEKO_SUBMITTER_URL,
        response: parsed
      },
      txHash: parsed?.txHash ?? null,
      networkId: ZEKO_NETWORK_ID
    };
  }

  return {
    mode: 'record',
    status: 'prepared',
    payloadHash,
    txHash: null,
    networkId: ZEKO_NETWORK_ID
  };
}
