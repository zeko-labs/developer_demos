const state = {
  wallet: null,
  feed: [],
  stats: { total: 0, shared: 0, proofs: 0 },
  viewMode: 'community',
  sortMode: 'prayed',
  searchTerm: '',
  religionFilter: 'all',
  ownerId: null,
  myPrayers: [],
  receipts: [],
  ipfsGateway: 'https://gateway.pinata.cloud/ipfs/',
  adminKey: '',
  prayerStatusPoller: null
};

const elements = {
  connectWallet: document.getElementById('connectWallet'),
  walletStatus: document.getElementById('walletStatus'),
  prayerForm: document.getElementById('prayerForm'),
  shareToggle: document.getElementById('shareToggle'),
  publicTextWrap: document.getElementById('publicTextWrap'),
  publicText: document.getElementById('publicText'),
  prayerText: document.getElementById('prayerText'),
  recipientAlias: document.getElementById('recipientAlias'),
  inspirationOther: document.getElementById('inspirationOther'),
  passphrase: document.getElementById('passphrase'),
  formStatus: document.getElementById('formStatus'),
  generatedKey: document.getElementById('generatedKey'),
  feedList: document.getElementById('feedList'),
  feedSearch: document.getElementById('feedSearch'),
  feedReligion: document.getElementById('feedReligion'),
  statTotal: document.getElementById('statTotal'),
  statShared: document.getElementById('statShared'),
  statProofs: document.getElementById('statProofs'),
  myList: document.getElementById('myList'),
  receiptsList: document.getElementById('receiptsList'),
  communityPanel: document.getElementById('communityPanel'),
  minePanel: document.getElementById('minePanel'),
  feedTitle: document.getElementById('feedTitle'),
  feedSubhead: document.getElementById('feedSubhead'),
  sponsorPanel: document.getElementById('sponsorPanel'),
  pendingList: document.getElementById('pendingList'),
  queueCount: document.getElementById('queueCount'),
  queueFee: document.getElementById('queueFee'),
  queueRoot: document.getElementById('queueRoot'),
  walletPrompt: document.getElementById('walletPrompt'),
  heroLegend: document.getElementById('heroLegend'),
  sponsorBatch: document.getElementById('sponsorBatch'),
  sponsorStatus: document.getElementById('sponsorStatus'),
  adminKey: document.getElementById('adminKey'),
  loadModeration: document.getElementById('loadModeration'),
  moderationStatus: document.getElementById('moderationStatus'),
  moderationList: document.getElementById('moderationList'),
  primaryPrayerAction: document.getElementById('primaryPrayerAction')
};

function setStatus(message, tone = 'info') {
  elements.formStatus.textContent = message;
  elements.formStatus.style.color = tone === 'error' ? '#c74a21' : '#2e5a6f';
}

function shortHash(value, size = 10) {
  return value ? `${value.slice(0, size)}…` : '—';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeInspirationTag(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'unspecified';
  if (['christianity', 'islam', 'buddhism', 'hinduism', 'judaism'].includes(normalized)) {
    return normalized;
  }
  return 'other';
}

function formatReligionLabel(value) {
  const normalized = String(value || 'unspecified');
  switch (normalized) {
    case 'christianity':
      return 'Christianity';
    case 'islam':
      return 'Islam';
    case 'buddhism':
      return 'Buddhism';
    case 'hinduism':
      return 'Hinduism';
    case 'judaism':
      return 'Judaism';
    case 'other':
      return 'Other';
    default:
      return 'Unspecified';
  }
}

async function copyText(value, successMessage = 'Copied.') {
  await navigator.clipboard.writeText(value);
  return successMessage;
}

function mapPrayerStatusLabel(item) {
  switch (item.chainStatus) {
    case 'queued':
      return 'Queued for sponsorship';
    case 'submitted':
      return 'Submitted on-chain';
    case 'confirmed':
      return 'Confirmed on-chain';
    case 'failed':
      return 'On-chain submission failed';
    default:
      return item.batchPending ? 'Pending anchor' : item.batchRoot ? 'Anchored on-chain' : 'Local only';
  }
}

function filterPrayerItems(items) {
  return items.filter((item) => {
    const itemReligion = item.religion || 'unspecified';
    const religionMatch = state.religionFilter === 'all' || itemReligion === state.religionFilter;
    if (!religionMatch) return false;
    if (!state.searchTerm) return true;
    const haystack = [item.publicText, item.recipientAlias, item.religion]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(state.searchTerm);
  });
}

function sortPrayerItems(items) {
  return [...items].sort((a, b) => {
    if (state.sortMode === 'recent') {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    }
    if ((b.prayersCount || 0) !== (a.prayersCount || 0)) {
      return (b.prayersCount || 0) - (a.prayersCount || 0);
    }
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

function renderViewMode() {
  const mine = state.viewMode === 'mine';
  elements.minePanel.classList.toggle('hidden', !mine);
  elements.communityPanel.classList.toggle('hidden', mine);
  elements.feedTitle.textContent = mine ? 'My Prayers' : 'Community Prayers';
  elements.feedSubhead.textContent = mine
    ? 'Track confirmations, IPFS records, and the people praying with you.'
    : 'Search shared prayers, filter by tradition, and join someone in prayer without exposing their identity.';
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.view === state.viewMode);
  });
}

function base64FromBytes(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function bytesFromBase64(base64) {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function encryptText(text, passphrase) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey'
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return {
    ciphertext: base64FromBytes(new Uint8Array(ciphertext)),
    iv: base64FromBytes(iv),
    salt: base64FromBytes(salt)
  };
}

async function decryptText(payload, passphrase) {
  const enc = new TextEncoder();
  const iv = bytesFromBase64(payload.iv);
  const salt = bytesFromBase64(payload.salt);
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey'
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    bytesFromBase64(payload.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

function generatePassphrase() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return base64FromBytes(bytes);
}

function loadOwnerId() {
  const existing = localStorage.getItem('proofPrayerOwnerId');
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem('proofPrayerOwnerId', fresh);
  return fresh;
}

async function connectWallet() {
  try {
    if (!window.mina || typeof window.mina.requestAccounts !== 'function') {
      elements.walletStatus.textContent = 'Auro not detected';
      alert('Auro wallet not found. Please install Auro Wallet to connect.');
      return;
    }
    elements.walletStatus.textContent = 'Connecting...';
    await window.mina.requestAccounts();
    const accounts =
      typeof window.mina.getAccounts === 'function'
        ? await window.mina.getAccounts()
        : [];
    state.wallet = accounts?.[0] || null;
    if (state.wallet) {
      elements.walletPrompt.classList.add('hidden');
    } else {
      elements.walletStatus.textContent = 'Connection not approved';
    }
    renderWallet();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wallet connection failed';
    elements.walletStatus.textContent = 'Connection failed';
    setStatus(message, 'error');
  }
}

function renderWallet() {
  if (state.wallet) {
    elements.walletStatus.textContent = `Connected: ${state.wallet.slice(0, 6)}…${state.wallet.slice(-4)}`;
    elements.connectWallet.textContent = 'Connected';
    elements.primaryPrayerAction.textContent = 'Submit Prayer';
  } else {
    elements.walletStatus.textContent = 'Not connected';
    elements.connectWallet.textContent = 'Connect Auro';
    elements.primaryPrayerAction.textContent = 'Submit Prayer';
  }
  const hasAuro = Boolean(window.mina);
  const isConnected = Boolean(state.wallet);
  if (elements.sponsorBatch) {
    elements.sponsorBatch.classList.toggle('hidden', !hasAuro);
  }
  const hidePrompt = hasAuro || isConnected;
  elements.walletPrompt.classList.toggle('hidden', hidePrompt);
  if (hidePrompt) {
    elements.walletPrompt.style.display = 'none';
  } else {
    elements.walletPrompt.style.display = '';
  }
}

async function loadFeed() {
  try {
    const [feedRes, configRes] = await Promise.all([fetch('/api/feed'), fetch('/config')]);
    const data = await feedRes.json();
    const config = await configRes.json();
    if (!feedRes.ok) {
      throw new Error(data?.error || 'Unable to load prayers feed.');
    }
    if (!configRes.ok) {
      throw new Error(config?.error || 'Unable to load app config.');
    }
    state.feed = data.items || [];
    state.stats = data.stats || state.stats;
    if (config?.ipfsGateway) {
      state.ipfsGateway = config.ipfsGateway;
    }
    renderFeed();
    renderStats();
  } catch (error) {
    elements.feedList.innerHTML = '<div class="feed-item">Unable to load community prayers right now.</div>';
    setStatus(error instanceof Error ? error.message : 'Unable to load feed.', 'error');
  }
}

async function loadPendingQueue() {
  const res = await fetch('/api/batch/pending');
  const data = await res.json();
  if (!res.ok) {
    elements.pendingList.innerHTML = '<div class="feed-item">Unable to load pending prayers right now.</div>';
    return;
  }
  const items = data.items || [];
  const summary = data.summary || { count: 0, estimatedFee: 0.1, nextRoot: null };
  elements.queueCount.textContent = String(summary.count || 0);
  elements.queueFee.textContent = `${Number(summary.estimatedFee || 0).toFixed(3)} MINA`;
  elements.queueRoot.textContent = summary.nextRoot ? shortHash(summary.nextRoot, 16) : '—';
  if (!items.length) {
    elements.pendingList.innerHTML = '<div class="feed-item">No pending prayers right now.</div>';
    return;
  }
  elements.pendingList.innerHTML = items
    .map((item) => {
      const created = new Date(item.createdAt).toLocaleString();
      const title = item.publicText || (item.visibility === 'shared' ? 'Shared prayer' : 'Private prayer');
      const recipient = item.recipientAlias ? `For ${item.recipientAlias}` : 'Waiting for sponsorship';
      const religion = formatReligionLabel(item.religion);
      return `
        <article class="feed-item">
          <div class="badge">Pending</div>
          <h3>${title}</h3>
          <div class="feed-meta">
            <span>${created}</span>
            <span>${recipient}</span>
            <span>${religion}</span>
            <span>Commitment ${shortHash(item.commitment)}</span>
          </div>
        </article>
      `;
    })
    .join('');
}

async function sponsorBatch() {
  try {
    if (!window.mina || !state.wallet) {
      elements.sponsorStatus.textContent = 'Connect Auro to sponsor.';
      return;
    }
    elements.sponsorStatus.textContent = 'Preparing batch transaction...';
    const txData = await buildPrayerTx('/api/batch/tx');
    const sent = await sendPrayerTxWithRetry('/api/batch/tx', txData);
    if (sent?.hash) {
      await fetch('/api/batch/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: txData.batchId, hash: sent.hash, sponsorPublicKey: state.wallet })
      });
      elements.sponsorStatus.textContent = `Batch submitted. Root ${shortHash(txData.root, 16)} • Tx ${shortHash(sent.hash, 12)}`;
      await loadPendingQueue();
      await loadMyPrayers();
      await loadFeed();
      await loadReceipts();
      backgroundWaitForConfirmation(
        sent.hash,
        (status) => {
          elements.sponsorStatus.textContent =
            status === 'UNKNOWN' || status === 'PENDING'
              ? 'Batch submitted. Confirmation pending.'
              : `Batch status: ${status}`;
        },
        async (finalStatus) => {
          if (finalStatus === 'REJECTED') {
            elements.sponsorStatus.textContent = 'Batch submission failed on-chain.';
          } else if (finalStatus === 'UNKNOWN' || finalStatus === 'PENDING') {
            elements.sponsorStatus.textContent = 'Batch submitted. Confirmation pending.';
          } else {
            elements.sponsorStatus.textContent = 'Batch confirmed on-chain. Thank you.';
          }
          await loadMyPrayers();
          await loadFeed();
          await loadReceipts();
        }
      );
    } else {
      elements.sponsorStatus.textContent = 'Transaction submitted in wallet.';
    }
  } catch (error) {
    elements.sponsorStatus.textContent = error instanceof Error ? error.message : 'Sponsor failed.';
  }
}

async function buildPrayerTx(endpoint) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feePayerPublicKey: state.wallet
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to build transaction.');
  }
  return data;
}

async function sendPrayerTxWithRetry(endpoint, initialTxData) {
  let txData = initialTxData;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await window.mina.sendTransaction({
        transaction: txData.tx,
        feePayer: { fee: txData.fee }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Account_nonce_precondition_unsatisfied') || attempt === 1) {
        throw error;
      }
      txData = await buildPrayerTx(endpoint);
    }
  }
  return null;
}

async function fetchTxStatus(hash) {
  const res = await fetch('/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hash })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Status check failed.');
  }
  return String(data.status || 'UNKNOWN').toUpperCase();
}

async function waitForTxConfirmation(hash, onUpdate) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = await fetchTxStatus(hash);
    onUpdate?.(status);
    if (status && status !== 'PENDING' && status !== 'UNKNOWN') {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return 'PENDING';
}

function backgroundWaitForConfirmation(hash, onUpdate, onResolved) {
  waitForTxConfirmation(hash, onUpdate)
    .then(async (finalStatus) => {
      await onResolved?.(finalStatus);
    })
    .catch(() => {});
}

async function loadMyPrayers() {
  try {
    const res = await fetch(`/api/my-prayers?ownerId=${encodeURIComponent(state.ownerId)}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Unable to load your prayers.');
    }
    state.myPrayers = data.items || [];
    renderMyPrayers();
    schedulePrayerStatusSync();
  } catch (error) {
    elements.myList.innerHTML = '<div class="feed-item">Unable to load your prayers right now.</div>';
    setStatus(error instanceof Error ? error.message : 'Unable to load your prayers.', 'error');
  }
}

async function loadReceipts() {
  if (!elements.receiptsList) {
    return;
  }
  try {
    const res = await fetch('/api/batches');
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Unable to load batch receipts.');
    }
    state.receipts = data.items || [];
    renderReceipts();
  } catch (error) {
    elements.receiptsList.innerHTML = '<div class="feed-item">Unable to load batch receipts right now.</div>';
  }
}

async function syncPrayerStatuses() {
  const hasTracked = state.myPrayers.some((item) => item.lastTxHash && item.chainStatus !== 'confirmed');
  if (!hasTracked) return;
  try {
    const res = await fetch(`/api/prayers/status-sync?ownerId=${encodeURIComponent(state.ownerId)}`);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Unable to refresh prayer statuses.');
    }
    state.myPrayers = data.items || [];
    renderMyPrayers();
  } catch {
    // keep the last visible state if the network check fails
  }
}

function schedulePrayerStatusSync() {
  if (state.prayerStatusPoller) {
    clearTimeout(state.prayerStatusPoller);
    state.prayerStatusPoller = null;
  }
  const needsPolling = state.myPrayers.some((item) => item.lastTxHash && item.chainStatus !== 'confirmed');
  if (!needsPolling) return;
  state.prayerStatusPoller = window.setTimeout(async () => {
    await syncPrayerStatuses();
    schedulePrayerStatusSync();
  }, 5000);
}

function renderStats() {
  elements.statTotal.textContent = state.stats.total || 0;
  elements.statShared.textContent = state.stats.shared || 0;
  elements.statProofs.textContent = state.stats.proofs || 0;
}

function renderReceipts() {
  if (!elements.receiptsList) {
    return;
  }
  if (!state.receipts.length) {
    elements.receiptsList.innerHTML = '<div class="feed-item">No batch receipts yet. Once a prayer is sponsored or submitted on-chain, it will appear here.</div>';
    return;
  }
  elements.receiptsList.innerHTML = state.receipts
    .map((batch) => {
      const created = new Date(batch.createdAt).toLocaleString();
      const prayers = (batch.prayers || [])
        .map((prayer) => `<span class="badge">${prayer.publicText || prayer.recipientAlias || 'Private prayer'}</span>`)
        .join('');
      return `
        <article class="feed-item">
          <div class="feed-meta-row">
            <div class="badge">${batch.status || 'prepared'}</div>
            <div class="badge">${batch.size} prayers</div>
          </div>
          <h3>Batch ${shortHash(batch.id, 12)}</h3>
          <div class="feed-meta">
            <span>${created}</span>
            <span>Root ${shortHash(batch.root, 16)}</span>
            <span>${batch.txHash ? `Tx ${shortHash(batch.txHash, 12)}` : 'Awaiting transaction'}</span>
            <span>${batch.sponsorPublicKey ? `Sponsor ${shortHash(batch.sponsorPublicKey, 8)}` : 'No sponsor attribution yet'}</span>
          </div>
          <div class="feed-actions">${prayers || '<span class="muted">No prayer previews available.</span>'}</div>
        </article>
      `;
    })
    .join('');
}

async function loadModerationQueue() {
  try {
    state.adminKey = elements.adminKey.value.trim();
    if (!state.adminKey) {
      elements.moderationStatus.textContent = 'Enter the admin key to review flagged prayers.';
      return;
    }
    elements.moderationStatus.textContent = 'Loading flagged prayers...';
    const res = await fetch('/api/moderation/queue', {
      headers: { 'x-admin-key': state.adminKey }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Unable to load moderation queue.');
    }
    const items = data.items || [];
    if (!items.length) {
      elements.moderationList.innerHTML = '<div class="feed-item">No flagged prayers right now.</div>';
      elements.moderationStatus.textContent = 'Queue is clear.';
      return;
    }
    elements.moderationStatus.textContent = `${items.length} flagged prayer${items.length === 1 ? '' : 's'} need review.`;
    elements.moderationList.innerHTML = items
      .map(
        (item) => `
        <article class="feed-item">
          <div class="feed-meta-row">
            <div class="badge">Flagged</div>
            <div class="badge">${item.flags?.join(', ') || 'Needs review'}</div>
          </div>
          <h3>${item.publicText || 'Private prayer'}</h3>
          <div class="feed-meta">
            <span>${new Date(item.createdAt).toLocaleString()}</span>
            <span>${formatReligionLabel(item.religion)}</span>
          </div>
          <div class="feed-actions">
            <button class="btn ghost" data-moderate="${item.id}" data-action="approve">Approve</button>
            <button class="btn ghost" data-moderate="${item.id}" data-action="hide">Hide</button>
          </div>
        </article>
      `
      )
      .join('');

    document.querySelectorAll('[data-moderate]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.moderate;
        const action = button.dataset.action;
        try {
          const actionRes = await fetch(`/api/moderation/${id}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-key': state.adminKey
            },
            body: JSON.stringify({ action })
          });
          const actionData = await actionRes.json();
          if (!actionRes.ok) {
            throw new Error(actionData?.error || 'Moderation action failed.');
          }
          elements.moderationStatus.textContent = `Prayer ${action === 'approve' ? 'approved' : 'hidden'}.`;
          await loadModerationQueue();
          await loadFeed();
        } catch (error) {
          elements.moderationStatus.textContent = error instanceof Error ? error.message : 'Moderation action failed.';
        }
      });
    });
  } catch (error) {
    elements.moderationStatus.textContent = error instanceof Error ? error.message : 'Unable to load moderation queue.';
  }
}

function renderMyPrayers() {
  const filtered = sortPrayerItems(filterPrayerItems(state.myPrayers));
  if (!filtered.length) {
    elements.myList.innerHTML = state.myPrayers.length
      ? '<div class="feed-item">No prayers match the current search or tradition filter.</div>'
      : '<div class="feed-item">No prayers yet. Your private and shared prayers will appear here with their chain status and receipts.</div>';
    return;
  }
  elements.myList.innerHTML = filtered
    .map((item) => {
      const created = new Date(item.createdAt).toLocaleString();
      const status = mapPrayerStatusLabel(item);
      const ipfsUrl = item.ipfsCid ? `${state.ipfsGateway}${item.ipfsCid}` : null;
      return `
        <article class="feed-item">
          <div class="badge">${status}</div>
          <h3>${item.publicText || 'Private prayer'}</h3>
          <div class="feed-meta">
            <span>${created}</span>
            <span>${item.prayersCount} people praying with you</span>
            ${item.lastTxHash ? `<span>Tx: ${shortHash(item.lastTxHash)}</span>` : ''}
            <span>${item.batchRoot ? `Root: ${shortHash(item.batchRoot, 16)}` : 'Root: not anchored yet'}</span>
            <span>${item.ipfsCid ? `IPFS: ${shortHash(item.ipfsCid)}` : 'IPFS: not pinned'}</span>
          </div>
          <div class="feed-actions">
            <input class="decrypt-key" data-key="${item.id}" type="text" placeholder="Enter encryption key" />
            <button class="btn ghost" data-decrypt="${item.id}">Decrypt</button>
            ${item.ipfsCid ? `<button class="btn ghost" data-copy-cid="${item.id}">Copy CID</button>` : ''}
            ${ipfsUrl ? `<a class="pill" href="${ipfsUrl}" target="_blank" rel="noreferrer">View IPFS</a>` : ''}
            ${item.batchRoot ? `<button class="btn ghost" data-verify-root="${item.id}">Verify Root</button>` : ''}
          </div>
          <div class="muted" data-output="${item.id}"></div>
        </article>
      `;
    })
    .join('');

  document.querySelectorAll('[data-decrypt]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.decrypt;
      const item = state.myPrayers.find((entry) => entry.id === id);
      const keyInput = document.querySelector(`[data-key="${id}"]`);
      const output = document.querySelector(`[data-output="${id}"]`);
      if (!item || !keyInput || !output) return;
      const key = keyInput.value.trim();
      if (!key) {
        output.textContent = 'Enter your encryption key first.';
        return;
      }
      try {
        const text = await decryptText(item, key);
        output.textContent = text;
      } catch {
        output.textContent = 'Unable to decrypt. Check the key.';
      }
    });
  });

  document.querySelectorAll('[data-copy-cid]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.copyCid;
      const item = state.myPrayers.find((entry) => entry.id === id);
      const output = document.querySelector(`[data-output="${id}"]`);
      if (!item?.ipfsCid || !output) return;
      try {
        output.textContent = await copyText(item.ipfsCid, 'CID copied.');
      } catch {
        output.textContent = 'Unable to copy CID.';
      }
    });
  });

  document.querySelectorAll('[data-verify-root]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.verifyRoot;
      const item = state.myPrayers.find((entry) => entry.id === id);
      const output = document.querySelector(`[data-output="${id}"]`);
      if (!item?.batchRoot || !output) return;
      if (!state.receipts.length) {
        await loadReceipts();
      }
      const match = state.receipts.find((batch) => batch.root === item.batchRoot);
      output.textContent = match
        ? `Verified in batch ${shortHash(match.id, 12)} with status ${match.status || 'prepared'}.`
        : 'No matching batch receipt found yet.';
    });
  });
}

function renderFeed() {
  if (!state.feed.length) {
    elements.feedList.innerHTML = '<div class="feed-item">No public prayers yet. Be the first to share.</div>';
    return;
  }

  const filtered = filterPrayerItems(state.feed);

  if (!filtered.length) {
    elements.feedList.innerHTML = '<div class="feed-item">No prayers match your search right now.</div>';
    return;
  }

  const sorted = sortPrayerItems(filtered);

  elements.feedList.innerHTML = sorted
    .map((item) => {
      const rank = sorted.indexOf(item) + 1;
      const created = new Date(item.createdAt).toLocaleString();
      const recipient = item.recipientAlias ? `For ${item.recipientAlias}` : 'For someone you love';
      const religion = formatReligionLabel(item.religion);
      const reportPopover = item.canReport
        ? `
          <div class="inline-help-wrap">
            <button class="inline-help" type="button" aria-label="Community guidelines">i</button>
            <div class="help-popover">
              <p class="muted">Community guidelines prohibit hate, discrimination, or harassment based on religion, race, gender, or identity.</p>
              <button class="command-link" type="button" data-report="${item.id}">Flag for moderator</button>
            </div>
          </div>
        `
        : '';
      return `
      <article class="feed-item">
        <div class="feed-rank">Rank #${rank}</div>
        <div class="feed-meta-row">
          <div class="badge">${recipient}</div>
          <div class="badge">${religion}</div>
        </div>
        <h3>${item.publicText || 'A shared prayer'}</h3>
        <div class="feed-meta">
          <span>Shared ${created}</span>
          <span>${item.prayersCount} prayers with you</span>
        </div>
        <div class="feed-actions">
          <button class="btn primary" data-pray="${item.id}">Pray with</button>
          ${reportPopover}
          <span class="badge">${item.commitment.slice(0, 10)}…</span>
        </div>
      </article>
      `;
    })
    .join('');

  document.querySelectorAll('[data-pray]').forEach((button) => {
    button.addEventListener('click', () => prayWith(button.dataset.pray));
  });
  document.querySelectorAll('[data-report]').forEach((button) => {
    button.addEventListener('click', () => reportPrayer(button.dataset.report));
  });
}

async function reportPrayer(prayerId) {
  try {
    const res = await fetch(`/api/prayers/${prayerId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'community-report' })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Unable to report prayer.');
    }
    await loadFeed();
    elements.moderationStatus.textContent = 'Prayer reported for review.';
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Unable to report prayer.');
  }
}

async function prayWith(prayerId) {
  try {
    if (!state.wallet) {
      alert('Connect a wallet to use Pray with (Pro feature).');
      return;
    }
    const payload = { walletPublicKey: state.wallet || null, signature: null };
    if (state.wallet && window.mina?.signMessage) {
      const message = `Proof of Prayer:${prayerId}:${Date.now()}`;
      const signed = await window.mina.signMessage({ message });
      payload.signature = signed?.signature || null;
    }
    const res = await fetch(`/api/prayers/${prayerId}/pray`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to submit proof');
    await loadFeed();
  } catch (error) {
    alert(error instanceof Error ? error.message : 'Failed to pray with');
  }
}

async function submitPrayer(event) {
  event.preventDefault();
  setStatus('Encrypting prayer...');
  elements.generatedKey.classList.add('hidden');
  const requestedAction = event.submitter?.dataset?.action || 'submit';
  const action = requestedAction === 'submit' && state.wallet ? 'sign' : requestedAction;

  try {
    if (action === 'sponsor') {
      await loadPendingQueue();
      setStatus('Showing pending prayers to sponsor.');
      return;
    }

    const prayerText = elements.prayerText.value.trim();
    if (!prayerText) {
      setStatus('Prayer cannot be empty.', 'error');
      return;
    }

    const visibility = elements.shareToggle.checked ? 'shared' : 'private';
    const publicText = elements.publicText.value.trim();
    if (visibility === 'shared' && !publicText) {
      setStatus('Please add a public version for the community.', 'error');
      return;
    }

    let passphrase = elements.passphrase.value.trim();
    let generated = false;
    if (!passphrase) {
      passphrase = generatePassphrase();
      generated = true;
    }

    const encrypted = await encryptText(prayerText, passphrase);

    if (action === 'sign' && !state.wallet) {
      setStatus('Connect a wallet to submit on-chain right away.', 'error');
      return;
    }

    setStatus(action === 'sign' ? 'Preparing wallet transaction...' : 'Submitting prayer...');

    const payload = {
      visibility,
      religion: normalizeInspirationTag(elements.inspirationOther?.value),
      recipientAlias: elements.recipientAlias.value.trim() || null,
      publicText: visibility === 'shared' ? publicText : null,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      salt: encrypted.salt,
      walletPublicKey: state.wallet || null,
      ownerId: state.ownerId,
      anchorNow: action === 'sign'
    };

    const res = await fetch('/api/prayers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      setStatus(data?.error || 'Submission failed.', 'error');
      return;
    }

    if (action === 'sign') {
      if (!window.mina?.sendTransaction) {
        setStatus('Auro wallet sendTransaction not available.', 'error');
        return;
      }
      const txEndpoint = `/api/prayers/${data.id}/tx`;
      const txData = await buildPrayerTx(txEndpoint);
      const sent = await sendPrayerTxWithRetry(txEndpoint, txData);
      if (sent?.hash) {
        await fetch(`/api/prayers/${data.id}/tx/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hash: sent.hash })
        });
        setStatus(`Prayer sent on-chain. Tx ${shortHash(sent.hash, 12)}.`);
        await loadMyPrayers();
        await loadFeed();
        await loadReceipts();
        backgroundWaitForConfirmation(
          sent.hash,
          (status) => {
            setStatus(
              status === 'UNKNOWN' || status === 'PENDING'
                ? 'Prayer submitted. Confirmation pending.'
                : `Prayer status: ${status}`
            );
          },
          async (finalStatus) => {
            if (finalStatus === 'REJECTED') {
              setStatus('Prayer submission failed on-chain.', 'error');
            } else if (finalStatus === 'UNKNOWN' || finalStatus === 'PENDING') {
              setStatus('Prayer submitted. Confirmation pending.');
            } else {
              setStatus('Prayer confirmed on-chain.');
            }
            await loadMyPrayers();
            await loadFeed();
            await loadReceipts();
          }
        );
      } else {
        setStatus('Transaction opened in wallet.', 'info');
      }
    } else if (data?.status === 'flagged') {
      setStatus('Prayer queued and flagged for review. It will stay off the public feed until approved.');
    } else {
      setStatus('Prayer saved privately and added to the sponsorship queue.');
    }

    if (generated) {
      elements.generatedKey.textContent = `Save this encryption key to decrypt later: ${passphrase}`;
      elements.generatedKey.classList.remove('hidden');
    }

    elements.prayerForm.reset();
    elements.publicTextWrap.classList.add('hidden');
    await loadFeed();
    await loadMyPrayers();
    await loadPendingQueue();
    await loadReceipts();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transaction failed.';
    if (message.toLowerCase().includes('cancel')) {
      setStatus('Transaction was cancelled in the wallet.', 'error');
    } else {
      setStatus(message, 'error');
    }
  }
}

async function triggerPrayerAction(action) {
  await submitPrayer({
    preventDefault() {},
    submitter: { dataset: { action } }
  });
}

function handleShareToggle() {
  if (elements.shareToggle.checked) {
    elements.publicTextWrap.classList.remove('hidden');
  } else {
    elements.publicTextWrap.classList.add('hidden');
  }
}

function init() {
  state.ownerId = loadOwnerId();
  elements.connectWallet.addEventListener('click', connectWallet);
  elements.prayerForm.addEventListener('submit', submitPrayer);
  elements.shareToggle.addEventListener('change', handleShareToggle);
  elements.sponsorBatch.addEventListener('click', sponsorBatch);
  elements.loadModeration?.addEventListener('click', loadModerationQueue);
  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-sort]').forEach((btn) => btn.classList.remove('is-active'));
      button.classList.add('is-active');
      state.sortMode = button.dataset.sort;
      renderMyPrayers();
      renderFeed();
    });
  });
  elements.feedSearch?.addEventListener('input', (event) => {
    state.searchTerm = event.target.value.trim().toLowerCase();
    renderMyPrayers();
    renderFeed();
  });
  elements.feedReligion?.addEventListener('change', (event) => {
    state.religionFilter = event.target.value;
    renderMyPrayers();
    renderFeed();
  });
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.viewMode = button.dataset.view === 'mine' ? 'mine' : 'community';
      renderViewMode();
      if (state.viewMode === 'mine') {
        loadMyPrayers();
      } else {
        loadFeed();
      }
    });
  });
  renderViewMode();
  renderWallet();
  let attempts = 0;
  const detectInterval = setInterval(() => {
    attempts += 1;
    if (window.mina || attempts > 10) {
      renderWallet();
      clearInterval(detectInterval);
    }
  }, 500);
  if (window.mina?.on) {
    window.mina.on('accountsChanged', (accounts) => {
      state.wallet = accounts?.[0] || null;
      renderWallet();
    });
  }
  loadFeed();
  loadMyPrayers();
  loadPendingQueue();
  loadReceipts();
}

init();
