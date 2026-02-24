const agentList = document.getElementById('agent-list');
const agentSelect = document.getElementById('agent-select');
const promptInput = document.getElementById('prompt');
const priceEl = document.getElementById('price');
const agentSort = document.getElementById('agent-sort');
const agentPagination = document.getElementById('agent-pagination');
const connectButton = document.getElementById('connect-wallet');
const walletStatus = document.getElementById('wallet-status');
const txHashEl = document.getElementById('tx-hash');
const requestIdEl = document.getElementById('request-id');
const createRequestButton = document.getElementById('create-request');
const attestOutputButton = document.getElementById('attest-output');
const registerAgentButton = document.getElementById('register-agent');
const testAgentButton = document.getElementById('test-agent');
const registerStatus = document.getElementById('register-status');
const registerName = document.getElementById('agent-name');
const registerTagline = document.getElementById('agent-tagline');
const registerTreasury = document.getElementById('agent-treasury');
const registerEndpoint = document.getElementById('agent-endpoint');
const registerHosting = document.getElementById('agent-hosting');
const registerAuth = document.getElementById('agent-auth');
const registerPrice = document.getElementById('agent-price');
const registerDescription = document.getElementById('agent-description');
const outputStatus = document.getElementById('output-status');
const proofPreview = document.getElementById('proof-preview');
const networkPill = document.getElementById('network-pill');
const treasuryPill = document.getElementById('treasury-pill');
const requestHint = document.getElementById('request-hint');
const leaderboardEl = document.getElementById('leaderboard');
const attestHint = document.getElementById('attest-hint');
const proofsFeedEl = document.getElementById('proofs-feed');
const tabTrust = document.getElementById('tab-trust');
const tabRegister = document.getElementById('tab-register');
const panelTrust = document.getElementById('panel-trust');
const panelRegister = document.getElementById('panel-register');
const copyProofButton = document.getElementById('copy-proof');
const modeToggle = document.getElementById('mode-toggle');
const creditsPanel = document.getElementById('credits-panel');
const creditsBalanceEl = document.getElementById('credits-balance');
const creditsRefreshButton = document.getElementById('credits-refresh');
const creditsDepositButton = document.getElementById('credits-deposit');
const creditsAmountInput = document.getElementById('credits-amount');
const creditsHint = document.getElementById('credits-hint');
const relayerIndicator = document.getElementById('relayer-indicator');

localStorage.removeItem('disclaimerAcceptedV3');

let agents = [];
let selectedAgentId = null;
let walletPublicKey = null;
let creditsMode = false;
let creditsMinDeposit = 1;
let lastPayload = null;
let lastRequestId = null;
let lastOutputProof = null;
let lastAccessToken = null;
let currentPage = 1;
const pageSize = 6;
let modelTestPassed = false;


async function testModelEndpoint() {
  const modelEndpoint = registerEndpoint.value.trim();
  const modelAuth = registerAuth.value.trim();
  if (!modelEndpoint) {
    registerStatus.textContent = 'Set a model endpoint to test.';
    return false;
  }
  registerStatus.textContent = 'Testing model endpoint...';
  const res = await fetch('/api/agent-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelEndpoint, modelAuth })
  });
  if (!res.ok) {
    const err = await res.json();
    registerStatus.textContent = err.error || 'Model test failed.';
    modelTestPassed = false;
    return false;
  }
  const data = await res.json();
  registerStatus.textContent = `Model test passed. Sample: ${data.sample?.symbol || 'OK'} ${data.sample?.action || ''}`.trim();
  modelTestPassed = true;
  return true;
}

if (testAgentButton) {
  testAgentButton.addEventListener('click', () => {
    testModelEndpoint().catch((err) => {
      registerStatus.textContent = err.message || 'Model test failed.';
      modelTestPassed = false;
    });
  });
}

if (registerEndpoint) {
  registerEndpoint.addEventListener('input', () => {
    modelTestPassed = false;
  });
}
if (registerAuth) {
  registerAuth.addEventListener('input', () => {
    modelTestPassed = false;
  });
}

async function fetchConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) return;
  const data = await res.json();
  if (networkPill) networkPill.textContent = `Network: ${data.networkId}`;
  if (treasuryPill) treasuryPill.textContent = `Treasury: ${data.treasury || 'unset'}`;
  if (typeof data.creditsMinDeposit === 'number') {
    creditsMinDeposit = data.creditsMinDeposit;
    if (creditsAmountInput && !creditsAmountInput.value) {
      creditsAmountInput.placeholder = `Deposit amount (min ${creditsMinDeposit} MINA)`;
      creditsAmountInput.min = String(creditsMinDeposit);
      creditsAmountInput.value = String(creditsMinDeposit);
    }
  }
}

function setCreditsMode(enabled) {
  creditsMode = enabled;
  if (modeToggle) modeToggle.checked = enabled;
  if (creditsPanel) creditsPanel.classList.toggle('hidden', !enabled);
  if (relayerIndicator) relayerIndicator.classList.toggle('hidden', !enabled);
  if (createRequestButton) {
    createRequestButton.textContent = 'Step 1: Create Request & Pay';
  }
}

async function refreshCreditsBalance() {
  if (!creditsBalanceEl) return;
  if (!walletPublicKey) return;
  const res = await fetch(`/api/credits/balance?ownerPublicKey=${encodeURIComponent(walletPublicKey)}`);
  if (!res.ok) return;
  const data = await res.json();
  creditsBalanceEl.textContent = Number(data.balanceMina || 0).toFixed(2);
}

async function depositCredits() {
  const amount = Number(creditsAmountInput?.value || creditsMinDeposit);
  if (!walletPublicKey && window.mina) {
    await connectWallet();
  }
  if (!walletPublicKey) {
    throw new Error('Auro wallet required to deposit credits.');
  }
  const intentRes = await fetch('/api/credits/deposit-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerPublicKey: walletPublicKey, amountMina: amount })
  });
  if (!intentRes.ok) {
    const err = await intentRes.json();
    throw new Error(err.error || 'Credits deposit intent failed');
  }
  const intent = await intentRes.json();
  const txRes = await fetch('/api/credits-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: intent.payload, feePayer: walletPublicKey })
  });
  if (!txRes.ok) {
    const err = await txRes.json();
    throw new Error(err.error || 'Credits transaction build failed');
  }
  const txData = await txRes.json();
  const sent = await window.mina.sendTransaction({
    transaction: txData.tx,
    feePayer: { fee: txData.fee }
  });
  const hash = sent?.hash || 'submitted';
  if (creditsHint) {
    creditsHint.textContent = `Credits deposit submitted. Tx: ${hash}`;
  }
  try {
    const confirmRes = await fetch('/api/credits/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerPublicKey: walletPublicKey,
        creditsRoot: intent.payload.creditsRoot,
        txHash: hash
      })
    });
    if (!confirmRes.ok) {
      const err = await confirmRes.json();
      if (creditsHint) {
        creditsHint.textContent = err.error || 'Waiting for on-chain confirmation...';
      }
    }
  } catch {
    if (creditsHint) {
      creditsHint.textContent = 'Waiting for on-chain confirmation...';
    }
  }
  await refreshCreditsBalance();
}


async function loadAgents() {
  const res = await fetch('/api/agents');
  const data = await res.json();
  agents = data.agents || [];
  renderAgents();
  populateSelect();
}

async function loadLeaderboard() {
  if (!leaderboardEl) return;
  const res = await fetch('/api/leaderboard');
  if (!res.ok) return;
  const data = await res.json();
  const rows = data.leaderboard || [];
  leaderboardEl.innerHTML = '';
  if (!rows.length) {
    leaderboardEl.textContent = 'No leaderboard data yet.';
    return;
  }
  rows
    .sort((a, b) => (b.cagr30d || 0) - (a.cagr30d || 0))
    .forEach((row) => {
      const item = document.createElement('div');
      item.className = 'leaderboard-row';
      const verifiedBadge = row.eligible ? '<span class="badge">Verified</span>' : '';
      item.innerHTML = `
        <strong>${row.name} ${verifiedBadge}</strong>
        <div class="meta">
          <span>Requests: ${row.totalRequests}</span>
          <span>Outputs attested: ${row.outputAttested}</span>
          <span>Calls (30d): ${row.callsLast30d}</span>
          <span>Real CAGR (30d): ${(row.cagr30d * 100).toFixed(1)}%</span>
          <span>Win rate: ${(row.winRate * 100).toFixed(1)}%</span>
          <span>Price coverage: ${Math.round((row.coverage30d || 0) * 100)}%</span>
        </div>
      `;
      leaderboardEl.appendChild(item);
    });
}

async function loadProofsFeed() {
  if (!proofsFeedEl) return;
  const res = await fetch('/api/proofs');
  if (!res.ok) return;
  const data = await res.json();
  const proofs = data.proofs || [];
  proofsFeedEl.innerHTML = '';
  if (!proofs.length) {
    proofsFeedEl.textContent = 'No proofs yet.';
    return;
  }
  proofs.forEach((proof) => {
    const item = document.createElement('div');
    item.className = 'leaderboard-row';
    item.innerHTML = `
      <strong>${proof.agentId}</strong>
      <div class="meta">
        <span>Request: ${proof.requestId}</span>
        <span>Request hash: ${proof.requestHash.slice(0, 10)}…</span>
        <span>Output hash: ${proof.outputHash.slice(0, 10)}…</span>
      </div>
      <div class="meta">
        <span>Merkle root: ${proof.merkleRoot.slice(0, 10)}…</span>
        <span>Fulfilled: ${proof.fulfilledAt || 'pending'}</span>
      </div>
    `;
    proofsFeedEl.appendChild(item);
  });
}

function renderAgents() {
  const sortKey = agentSort?.value || 'popularity';
  const sorted = [...agents].sort((a, b) => {
    if (sortKey === 'success') {
      return (b.cagr30d || 0) - (a.cagr30d || 0);
    }
    return (b.callsLast30d || 0) - (a.callsLast30d || 0);
  });
  agentList.innerHTML = '';
  if (!sorted.length) {
    agentList.textContent = 'No agents available.';
    return;
  }
  const topPopularity = Math.max(...agents.map((a) => a.callsLast30d || 0));
  const topSuccess = Math.max(...agents.map((a) => a.cagr30d || 0));

  sorted.forEach((agent) => {
    const card = document.createElement('div');
    card.className = 'agent-card';

    const title = document.createElement('h3');
    title.textContent = agent.name;

    const tagline = document.createElement('div');
    tagline.textContent = agent.tagline;
    tagline.className = 'score';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const statusValue = agent.statusComputed || agent.status;
    const statusTip =
      statusValue === 'LIVE'
        ? 'LIVE: On-chain registration + at least 3 attested outputs.'
        : statusValue === 'BETA'
          ? 'BETA: Limited history or unverified outputs.'
          : 'PENDING: Registration pending or no attested outputs.';
    meta.innerHTML = `
      <span class="pill tooltip" data-tip="${statusTip}">${statusValue}</span>
      ${agent.assetClass ? `<span class="pill">${agent.assetClass}</span>` : ''}
      <span class="pill">${agent.priceMina} MINA</span>
      <span class="pill">${Math.round((agent.cagr30d || 0) * 100)}% CAGR (30d)</span>
      <span class="pill tooltip" data-tip="Calls in the last 30 days.">${agent.callsLast30d ?? 0} calls</span>
    `;

    const badges = document.createElement('div');
    badges.className = 'meta';
    if (agent.isNew) {
      badges.innerHTML += '<span class="pill tooltip" data-tip="Created within the last 30 days.">New</span>';
    }
    if ((agent.callsLast30d || 0) === topPopularity) {
      badges.innerHTML += '<span class="pill tooltip" data-tip="Most calls in the last 30 days.">Most popular</span>';
    }
    if ((agent.cagr30d || 0) === topSuccess) {
      badges.innerHTML += '<span class="pill tooltip" data-tip="Highest 30-day CAGR among visible agents.">Top performer</span>';
    }

    const description = document.createElement('p');
    description.textContent = agent.description;

    const sources = document.createElement('div');
    sources.className = 'score';
    sources.textContent = agent.dataSources ? `Data: ${agent.dataSources}` : 'Data: Custom model';

    const chooseButton = document.createElement('button');
    chooseButton.className = 'ghost';
    chooseButton.textContent = 'Select agent';
    chooseButton.addEventListener('click', () => {
      selectedAgentId = agent.id;
      agentSelect.value = agent.id;
      updatePrice();
      highlightSelectedAgent();
      const requestSection = document.getElementById('request-section');
      requestSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    chooseButton.dataset.agentId = agent.id;
    card.append(title, tagline, meta, badges, description, sources, chooseButton);
    agentList.appendChild(card);
  });
  renderPagination(1);
}

function renderPagination(totalPages) {
  if (!agentPagination) return;
  agentPagination.innerHTML = '';
  if (totalPages <= 1) return;
  for (let i = 1; i <= totalPages; i += 1) {
    const btn = document.createElement('button');
    btn.textContent = String(i);
    btn.className = i === currentPage ? 'active' : '';
    btn.addEventListener('click', () => {
      currentPage = i;
      renderAgents();
    });
    agentPagination.appendChild(btn);
  }
}

function populateSelect() {
  agentSelect.innerHTML = '';
  agents.forEach((agent) => {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = `${agent.name} (${agent.priceMina} MINA)`;
    agentSelect.appendChild(option);
  });
  selectedAgentId = agents[0]?.id || null;
  if (selectedAgentId) {
    agentSelect.value = selectedAgentId;
  }
  updatePrice();
  highlightSelectedAgent();
}

function updatePrice() {
  const agent = agents.find((item) => item.id === selectedAgentId);
  if (!agent) {
    priceEl.textContent = '—';
    return;
  }
  priceEl.textContent = `${agent.priceMina} MINA`;
}

agentSelect.addEventListener('change', () => {
  selectedAgentId = agentSelect.value;
  updatePrice();
  highlightSelectedAgent();
});

function highlightSelectedAgent() {
  const buttons = agentList.querySelectorAll('button.ghost');
  buttons.forEach((btn) => {
    const id = btn.dataset.agentId;
    btn.classList.toggle('pressed', id === selectedAgentId);
    btn.textContent = id === selectedAgentId ? 'Selected' : 'Select agent';
  });
}

agentSort?.addEventListener('change', () => {
  currentPage = 1;
  renderAgents();
});

async function connectWallet() {
  if (!window.mina) {
    walletStatus.textContent = 'Auro not detected';
    return;
  }
  await window.mina.requestAccounts();
  const [publicKey] = await window.mina.getAccounts();
  walletPublicKey = publicKey;
  walletStatus.textContent = `Connected: ${publicKey.slice(0, 6)}…${publicKey.slice(-6)}`;
}

connectButton.addEventListener('click', () => {
  connectWallet().catch((err) => {
    walletStatus.textContent = err.message || 'Wallet connection failed';
  });
});

async function createRequest() {
  const prompt = promptInput.value.trim();
  if (!selectedAgentId) {
    alert('Select an agent first.');
    return;
  }
  if (!prompt) {
    alert('Enter a prompt.');
    return;
  }

  outputStatus.textContent = 'Creating request...';
  outputStatus.className = '';
  if (requestHint) {
    requestHint.textContent = 'Building request intent...';
  }
  if (attestHint) {
    attestHint.textContent = '';
  }
  proofPreview.textContent = '—';
  txHashEl.textContent = '—';
  requestIdEl.textContent = '—';
  const t0 = performance.now();

  const intentRes = await fetch('/api/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: selectedAgentId,
      prompt,
      requester: walletPublicKey,
      useCredits: creditsMode
    })
  });
  console.log('Timing: /api/intent ms', Math.round(performance.now() - t0));

  let intent;
  const rawIntent = await intentRes.text();
  try {
    intent = JSON.parse(rawIntent);
  } catch (parseErr) {
    throw new Error(`Intent response not JSON: ${rawIntent.slice(0, 120)}`);
  }
  if (!intentRes.ok) {
    throw new Error(intent.error || 'Intent creation failed');
  }
  lastPayload = intent.payload;
  lastRequestId = intent.requestId;
  lastAccessToken = intent.accessToken || null;
  if (lastAccessToken && lastRequestId) {
    localStorage.setItem(`accessToken:${lastRequestId}`, lastAccessToken);
  }
  requestIdEl.textContent = intent.requestId;
  proofPreview.textContent = JSON.stringify(intent.payload, null, 2);
  if (requestHint) {
    requestHint.textContent = 'Waiting for wallet signature...';
  }

  if (!window.mina) {
    throw new Error('Auro wallet required to pay on-chain.');
  }

  if (!walletPublicKey && window.mina) {
    await connectWallet();
  }
  if (!walletPublicKey) {
    throw new Error('Auro wallet required to pay on-chain.');
  }

  if (creditsMode) {
    const tCredits = performance.now();
    const spendAmount = Number(intent.priceMina || 0);
    const spendRes = await fetch('/api/credits/spend-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerPublicKey: walletPublicKey,
        requestId: intent.requestId,
        amountMina: spendAmount
      })
    });
    console.log('Timing: /api/credits/spend-intent ms', Math.round(performance.now() - tCredits));
    if (!spendRes.ok) {
      const err = await spendRes.json();
      throw new Error(err.error || 'Credits spend intent failed');
    }
    const spendIntent = await spendRes.json();
    const tRelayer = performance.now();
    const creditsTxRes = await fetch('/api/credits-spend-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: spendIntent.payload })
    });
    console.log('Timing: /api/credits-spend-submit ms', Math.round(performance.now() - tRelayer));
    if (!creditsTxRes.ok) {
      const err = await creditsTxRes.json();
      throw new Error(err.error || 'Credits spend submit failed');
    }
    const creditsTx = await creditsTxRes.json();
    let hash = 'submitted';
    hash = creditsTx?.hash || 'submitted';
    txHashEl.textContent = hash;
    if (requestHint) {
      requestHint.textContent = `Credits update submitted. Tx: ${hash}`;
    }
    if (creditsBalanceEl && spendIntent.balanceMina !== undefined) {
      creditsBalanceEl.textContent = Number(spendIntent.balanceMina || 0).toFixed(2);
    }
    await fulfillRequest(null, hash);
    return;
  }

  const tTxBuild = performance.now();
  const txRes = await fetch('/api/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: lastPayload, feePayer: walletPublicKey })
  });
  console.log('Timing: /api/tx ms', Math.round(performance.now() - tTxBuild));

  if (!txRes.ok) {
    const err = await txRes.json();
    throw new Error(err.error || 'Transaction build failed');
  }

  const txData = await txRes.json();
  const tAuro = performance.now();
  const sent = await window.mina.sendTransaction({
    transaction: txData.tx,
    feePayer: { fee: txData.fee }
  });
  console.log('Timing: Auro sendTransaction ms', Math.round(performance.now() - tAuro));
  const hash = sent?.hash || 'submitted';
  txHashEl.textContent = hash;
  if (requestHint) {
    requestHint.textContent = `Payment submitted. Tx: ${hash}`;
  }

  await fulfillRequest(hash);
}

async function fulfillRequest(txHash, creditTxHash) {
  outputStatus.textContent = 'Running model...';
  const res = await fetch('/api/fulfill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: lastRequestId,
      txHash,
      creditTxHash,
      accessToken: lastAccessToken
    })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Fulfillment failed');
  }
  const data = await res.json();
  lastOutputProof = data.outputProof || null;
  if (attestOutputButton) {
    attestOutputButton.disabled = !lastOutputProof;
    attestOutputButton.classList.toggle('attest-highlight', Boolean(lastOutputProof));
  }
  renderOutput(data.output);
  await loadLeaderboard();
}


function renderOutput(output) {
  if (!output) {
    outputStatus.textContent = 'No output returned.';
    return;
  }
  const outputs = Array.isArray(output.outputs) ? output.outputs : [output];
  const labelMap = {
    POSITIVE: 'Positive',
    NEGATIVE: 'Negative',
    NEUTRAL: 'Neutral'
  };
  outputStatus.innerHTML = outputs
    .map((item) => {
      const rationale = Array.isArray(item.rationale) ? item.rationale : [];
      const rawAction = (item.action || 'NEUTRAL').toUpperCase();
      const actionLabel = labelMap[rawAction] || 'Neutral';
      return `
        <div class="output-item">
          <strong>${item.symbol || 'N/A'} — Signal: ${actionLabel}</strong><br />
          Confidence: ${item.confidence ? Math.round(item.confidence * 100) : 0}%<br />
          ${rationale.map((line) => `<div>${line}</div>`).join('')}
        </div>
      `;
    })
    .join('');
}

createRequestButton.addEventListener('click', () => {
  createRequest().catch((err) => {
    outputStatus.textContent = err.message || 'Request failed';
    if (requestHint) {
      requestHint.textContent = err.message || 'Request failed';
    }
    alert(err.message || 'Request failed');
  });
});

if (modeToggle) {
  modeToggle.addEventListener('change', () => {
    setCreditsMode(Boolean(modeToggle.checked));
    if (modeToggle.checked) {
      refreshCreditsBalance();
    }
  });
}
if (creditsRefreshButton) {
  creditsRefreshButton.addEventListener('click', () => {
    refreshCreditsBalance().catch(() => {});
  });
}
if (creditsDepositButton) {
  creditsDepositButton.addEventListener('click', () => {
    depositCredits().catch((err) => {
      if (creditsHint) {
        creditsHint.textContent = err.message || 'Credits deposit failed';
      }
      alert(err.message || 'Credits deposit failed');
    });
  });
}

attestOutputButton.addEventListener('click', async () => {
  if (!lastOutputProof) {
    alert('No output proof available yet.');
    return;
  }
  if (attestHint) {
    attestHint.textContent = 'Generating attestation transaction...';
  }
  if (creditsMode) {
    const txRes = await fetch('/api/output-attest-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: lastOutputProof })
    });
    if (!txRes.ok) {
      const err = await txRes.json();
      alert(err.error || 'Output attestation failed');
      return;
    }
    const sent = await txRes.json();
    if (attestHint) {
      attestHint.textContent = `Attestation submitted. Tx: ${sent?.hash || 'submitted'}`;
    }
    return;
  }

  if (!window.mina) {
    alert('Auro wallet required to attest on-chain.');
    return;
  }
  if (!walletPublicKey && window.mina) {
    await connectWallet();
  }
  if (!walletPublicKey) {
    alert('Auro wallet required to attest on-chain.');
    return;
  }

  const txRes = await fetch('/api/output-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: lastOutputProof, feePayer: walletPublicKey })
  });
  if (!txRes.ok) {
    const err = await txRes.json();
    alert(err.error || 'Output attestation failed');
    return;
  }
  const txData = await txRes.json();
  const sent = await window.mina.sendTransaction({
    transaction: txData.tx,
    feePayer: { fee: txData.fee }
  });
  const hash = sent?.hash || 'submitted';
  if (attestHint) {
    attestHint.textContent = `Attestation submitted. Tx: ${hash}`;
  }
});


fetchConfig();
setCreditsMode(false);
loadAgents();
loadLeaderboard();
loadProofsFeed();

tabTrust?.addEventListener('click', () => {
  tabTrust.classList.add('active');
  tabRegister?.classList.remove('active');
  panelTrust?.classList.remove('hidden');
  panelRegister?.classList.add('hidden');
});

tabRegister?.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabTrust?.classList.remove('active');
  panelRegister?.classList.remove('hidden');
  panelTrust?.classList.add('hidden');
});

copyProofButton?.addEventListener('click', async () => {
  if (!proofPreview) return;
  const text = proofPreview.textContent || '';
  if (!text || text === '—') {
    alert('No proof payload to copy yet.');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    alert('Proof payload copied.');
  } catch {
    alert('Copy failed. Select and copy manually.');
  }
});


registerAgentButton.addEventListener('click', async () => {
  const name = registerName.value.trim();
  const tagline = registerTagline.value.trim();
  const priceMina = Number(registerPrice.value || 0.1);
  const description = registerDescription.value.trim();
  const treasuryPublicKey = registerTreasury.value.trim();
  const modelEndpoint = registerEndpoint.value.trim();
  const hostingType = registerHosting?.value || 'custom';
  const modelAuth = registerAuth.value.trim();

  if (!name || !tagline) {
    registerStatus.textContent = 'Name and tagline are required.';
    return;
  }
  if (modelEndpoint && !modelTestPassed) {
    registerStatus.textContent = 'Please test the model endpoint before registering.';
    return;
  }
  if (!window.mina) {
    registerStatus.textContent = 'Auro wallet required to register on-chain.';
    return;
  }

  await window.mina.requestAccounts();
  const [publicKey] = await window.mina.getAccounts();
  walletPublicKey = publicKey;

  registerStatus.textContent = 'Preparing on-chain registration...';
  const intentRes = await fetch('/api/agent-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      tagline,
      priceMina,
      description,
      ownerPublicKey: publicKey,
      treasuryPublicKey: treasuryPublicKey || null,
      modelEndpoint: modelEndpoint || null,
      hostingType,
      modelAuth: modelAuth || null
    })
  });
  if (!intentRes.ok) {
    const err = await intentRes.json();
    registerStatus.textContent = err.error || 'Registration intent failed.';
    return;
  }
  const intent = await intentRes.json();

  const txRes = await fetch('/api/agent-stake-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: intent.payload, feePayer: publicKey })
  });
  if (!txRes.ok) {
    const err = await txRes.json();
    registerStatus.textContent = err.error || 'Stake transaction failed.';
    return;
  }
  const txData = await txRes.json();
  const sent = await window.mina.sendTransaction({
    transaction: txData.tx,
    feePayer: { fee: txData.fee }
  });

  registerStatus.textContent = `Registration submitted. Tx: ${sent?.hash || 'submitted'}`;
  registerName.value = '';
  registerTagline.value = '';
  registerTreasury.value = '';
  registerEndpoint.value = '';
  if (registerHosting) registerHosting.value = 'custom';
  registerAuth.value = '';
  registerPrice.value = '0.1';
  registerDescription.value = '';
  await loadAgents();
});
