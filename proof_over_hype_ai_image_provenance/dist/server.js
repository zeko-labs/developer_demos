import 'reflect-metadata';
import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as cheerio from 'cheerio';
import { fetch } from 'undici';
import { Bool, Field, Mina, PrivateKey, PublicKey, Signature, UInt32, MerkleTree, Poseidon, fetchAccount, fetchTransactionStatus } from 'o1js';
import { detectAiImage } from './detector.js';
import { AiVerdictProgram, VerdictInput } from './zk/aiVerdict.js';
import { AiVerdictContract } from './zk/zekoContract.js';
const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const merklePath = path.join(process.cwd(), 'data', 'merkle.json');
const proofPath = path.join(process.cwd(), 'data', 'proofs.json');
const merkleHeight = 20;
const demoDailyLimit = 3;
const demoCounts = new Map();
async function verifyCaptcha(token) {
    const secret = process.env.HCAPTCHA_SECRET;
    if (!secret)
        return true;
    if (!token)
        return false;
    const body = new URLSearchParams({ response: token, secret }).toString();
    const res = await fetch('https://hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const json = (await res.json());
    return Boolean(json?.success);
}
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
let compiled = false;
let oracleKey = null;
let contractCompiled = false;
function getKeychainSecret(service) {
    try {
        const out = execSync(`security find-generic-password -a \"$USER\" -s \"${service}\" -w`, {
            stdio: ['ignore', 'pipe', 'ignore']
        });
        const value = out.toString().trim();
        return value || null;
    }
    catch {
        return null;
    }
}
function getSecret(envKey, service) {
    return process.env[envKey] || getKeychainSecret(service);
}
function redactKey(value) {
    if (!value)
        return 'missing';
    const trimmed = value.trim();
    if (trimmed.length <= 12)
        return `${trimmed} (len=${trimmed.length})`;
    return `${trimmed.slice(0, 6)}…${trimmed.slice(-6)} (len=${trimmed.length})`;
}
function getZkappPublicKey() {
    if (process.env.ZKAPP_PUBLIC_KEY)
        return process.env.ZKAPP_PUBLIC_KEY;
    const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY', 'AIImageVerdictZK_ZKAPP_PRIVATE_KEY');
    if (!zkappPrivateKey)
        return null;
    try {
        return PrivateKey.fromBase58(zkappPrivateKey).toPublicKey().toBase58();
    }
    catch {
        return null;
    }
}
function getOracleKey() {
    if (oracleKey)
        return oracleKey;
    if (process.env.ORACLE_PRIVATE_KEY) {
        oracleKey = PrivateKey.fromBase58(process.env.ORACLE_PRIVATE_KEY);
    }
    else {
        oracleKey = PrivateKey.random();
    }
    return oracleKey;
}
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
        return forwarded[0];
    }
    return req.socket.remoteAddress || 'unknown';
}
function isLocalRequest(req) {
    const host = req.headers.host || '';
    const hostname = req.hostname || '';
    return (hostname.includes('localhost') ||
        hostname.startsWith('127.0.0.1') ||
        host.includes('localhost') ||
        host.startsWith('127.0.0.1') ||
        process.env.NODE_ENV === 'development');
}
function checkDemoLimit(req) {
    if (isLocalRequest(req)) {
        return { allowed: true, remaining: demoDailyLimit, resetAt: Date.now() + 24 * 60 * 60 * 1000 };
    }
    const ip = getClientIp(req);
    const now = Date.now();
    const entry = demoCounts.get(ip);
    if (!entry || entry.resetAt <= now) {
        demoCounts.set(ip, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
        return { allowed: true, remaining: demoDailyLimit - 1, resetAt: now + 24 * 60 * 60 * 1000 };
    }
    if (entry.count >= demoDailyLimit) {
        return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }
    entry.count += 1;
    demoCounts.set(ip, entry);
    return { allowed: true, remaining: demoDailyLimit - entry.count, resetAt: entry.resetAt };
}
async function ensureCompiled() {
    if (!compiled) {
        await AiVerdictProgram.compile();
        compiled = true;
    }
}
async function ensureContractCompiled() {
    if (!contractCompiled) {
        await AiVerdictContract.compile();
        contractCompiled = true;
    }
}
function normalizeUrl(input) {
    const trimmed = input.trim();
    if (!trimmed)
        throw new Error('Missing URL');
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return url.toString();
}
async function fetchHtml(url) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Failed to fetch page: ${res.status}`);
    return await res.text();
}
function normalizeImageUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        const dropParams = [
            'width',
            'w',
            'height',
            'h',
            'dpr',
            'quality',
            'q',
            'crop',
            'fit',
            'auto',
            'format',
            'fm',
            'ixlib',
            'ixid',
            'rect',
            'cs'
        ];
        dropParams.forEach((p) => url.searchParams.delete(p));
        // Remove common resize path markers
        url.pathname = url.pathname.replace(/\/resize\/[^/]+/g, '');
        return url.toString();
    }
    catch {
        return rawUrl;
    }
}
function extractImageUrls(html, baseUrl, maxImages = 8) {
    const $ = cheerio.load(html);
    const normalized = new Map();
    const pushUrl = (src, score = 0) => {
        if (!src)
            return;
        try {
            const abs = new URL(src, baseUrl).toString();
            if (!abs.startsWith('http'))
                return;
            const key = normalizeImageUrl(abs);
            const existing = normalized.get(key);
            if (!existing || score > existing.score) {
                normalized.set(key, { url: abs, score });
            }
        }
        catch {
            // ignore invalid urls
        }
    };
    const parseSrcset = (srcset) => {
        if (!srcset)
            return;
        const parts = srcset.split(',').map((part) => part.trim());
        parts.forEach((part) => {
            const [url, sizeToken] = part.split(' ');
            const score = sizeToken && sizeToken.endsWith('w') ? Number(sizeToken.replace('w', '')) : 0;
            pushUrl(url, Number.isFinite(score) ? score : 0);
        });
    };
    $('img').each((_, el) => {
        const src = $(el).attr('src');
        const dataSrc = $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original');
        const srcset = $(el).attr('srcset') || $(el).attr('data-srcset');
        pushUrl(src);
        pushUrl(dataSrc);
        parseSrcset(srcset);
    });
    $('source').each((_, el) => {
        const srcset = $(el).attr('srcset');
        parseSrcset(srcset);
    });
    // Extract image URLs from embedded JSON (e.g., Next.js __NEXT_DATA__)
    $('script').each((_, el) => {
        const id = $(el).attr('id');
        const type = $(el).attr('type');
        if (id !== '__NEXT_DATA__' && type !== 'application/ld+json')
            return;
        const raw = $(el).text();
        if (!raw)
            return;
        const urlPattern = new RegExp('https?:\\\\/\\\\/[^"\\s]+?\\\\.(?:jpg|jpeg|png|webp|avif)(?:\\\\?[^"\\s]*)?', 'gi');
        const matches = raw.match(urlPattern);
        if (matches) {
            matches.forEach((url) => pushUrl(url));
        }
    });
    const unique = Array.from(new Set(Array.from(normalized.values()).map((entry) => entry.url)));
    const preferred = unique.filter((url) => !url.toLowerCase().endsWith('.svg'));
    const merged = preferred.length ? preferred : unique;
    return merged.slice(0, maxImages);
}
async function fetchImageData(url) {
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`Failed to fetch image: ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
        throw new Error(`Image fetch did not return an image (content-type: ${contentType || 'unknown'})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return { buffer, contentType, size: buffer.length };
}
function hashToField(buffer) {
    const hex = crypto.createHash('sha256').update(buffer).digest('hex');
    const truncated = hex.slice(0, 62);
    const asBigInt = BigInt(`0x${truncated}`);
    return new Field(asBigInt);
}
async function loadProofStore() {
    try {
        const raw = await fs.readFile(proofPath, 'utf8');
        const parsed = JSON.parse(raw);
        return { proofs: parsed.proofs ?? {} };
    }
    catch {
        return { proofs: {} };
    }
}
async function saveProofStore(store) {
    await fs.mkdir(path.dirname(proofPath), { recursive: true });
    await fs.writeFile(proofPath, JSON.stringify(store, null, 2), 'utf8');
}
async function loadMerkleStore() {
    try {
        const raw = await fs.readFile(merklePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            height: parsed.height ?? merkleHeight,
            nextIndex: parsed.nextIndex ?? 0,
            leaves: parsed.leaves ?? []
        };
    }
    catch {
        return { height: merkleHeight, nextIndex: 0, leaves: [] };
    }
}
async function saveMerkleStore(store) {
    await fs.mkdir(path.dirname(merklePath), { recursive: true });
    await fs.writeFile(merklePath, JSON.stringify(store, null, 2), 'utf8');
}
function buildTree(store) {
    const tree = new MerkleTree(store.height);
    store.leaves.forEach((leaf, index) => {
        tree.setLeaf(BigInt(index), Field.fromJSON(leaf));
    });
    return tree;
}
function leafFrom(imageHash, verdict) {
    return Poseidon.hash([imageHash, verdict.toField()]);
}
function buildSingleLeafProof(imageHash, verdict) {
    const tree = new MerkleTree(merkleHeight);
    const leaf = leafFrom(imageHash, verdict);
    tree.setLeaf(0n, leaf);
    return { root: tree.getRoot(), index: 0, witness: tree.getWitness(0n) };
}
function computeRootFromWitness(imageHash, verdict, witness) {
    let hash = leafFrom(imageHash, verdict);
    for (const node of witness) {
        const sibling = Field.fromJSON(node.sibling);
        hash = Poseidon.hash(node.isLeft ? [hash, sibling] : [sibling, hash]);
    }
    return hash;
}
async function prepareLeaf(imageHash, verdict) {
    const store = await loadMerkleStore();
    if (store.nextIndex >= 2 ** store.height) {
        throw new Error('Merkle tree is full');
    }
    const leaf = leafFrom(imageHash, verdict);
    const tree = buildTree(store);
    const index = store.nextIndex;
    tree.setLeaf(BigInt(index), leaf);
    const witness = tree.getWitness(BigInt(index)).map((node) => ({
        isLeft: Boolean(node.isLeft),
        sibling: node.sibling.toString()
    }));
    return { root: tree.getRoot(), index, witness };
}
async function commitLeaf(imageHash, verdict, index, expectedRoot) {
    const store = await loadMerkleStore();
    if (store.nextIndex !== index) {
        throw new Error(`Merkle index mismatch (expected ${store.nextIndex}, got ${index})`);
    }
    if (store.nextIndex >= 2 ** store.height) {
        throw new Error('Merkle tree is full');
    }
    const leaf = leafFrom(imageHash, verdict);
    const tree = buildTree(store);
    tree.setLeaf(BigInt(index), leaf);
    const root = tree.getRoot();
    if (expectedRoot && root.toString() !== expectedRoot.toString()) {
        throw new Error('Merkle root mismatch for commit');
    }
    store.leaves[index] = leaf.toString();
    store.nextIndex += 1;
    await saveMerkleStore(store);
    const witness = tree.getWitness(BigInt(index)).map((node) => ({
        isLeft: Boolean(node.isLeft),
        sibling: node.sibling.toString()
    }));
    return { root, index, witness };
}
async function findLeaf(imageHash, verdict) {
    const store = await loadMerkleStore();
    const leaf = leafFrom(imageHash, verdict).toString();
    const index = store.leaves.findIndex((item) => item === leaf);
    if (index === -1)
        return null;
    const tree = buildTree(store);
    const witness = tree.getWitness(BigInt(index));
    return { root: tree.getRoot(), index, witness };
}
async function fetchOnChainState() {
    if (!process.env.ZEKO_GRAPHQL) {
        throw new Error('ZEKO_GRAPHQL env var not set');
    }
    const zkappPublicKey = getZkappPublicKey();
    if (!zkappPublicKey) {
        throw new Error('ZKAPP_PUBLIC_KEY env var not set');
    }
    const networkId = process.env.ZEKO_NETWORK_ID ?? 'testnet';
    const network = Mina.Network({
        networkId: networkId,
        mina: process.env.ZEKO_GRAPHQL,
        archive: process.env.ZEKO_GRAPHQL
    });
    Mina.setActiveInstance(network);
    let zkappAddress;
    try {
        zkappAddress = PublicKey.fromBase58(zkappPublicKey);
    }
    catch (err) {
        throw new Error(`Invalid ZKAPP_PUBLIC_KEY: ${redactKey(zkappPublicKey)}`);
    }
    const account = await fetchAccount({ publicKey: zkappAddress });
    if (account.error) {
        throw new Error('ZkApp account not found on-chain');
    }
    const appState = account.account.zkapp?.appState;
    if (!appState || appState.length < 3) {
        throw new Error('ZkApp appState not available');
    }
    const lastImageHash = appState[0].toString();
    const lastVerdictField = appState[1].toString();
    const lastVerdict = lastVerdictField === '1';
    const merkleRoot = appState[2].toString();
    return { lastImageHash, lastVerdict, merkleRoot };
}
async function generateProof(imageHash, verdict, merkleRoot) {
    await ensureCompiled();
    const oraclePriv = getOracleKey();
    const oraclePub = oraclePriv.toPublicKey();
    const input = new VerdictInput({ imageHash, verdict: new Bool(verdict), merkleRoot });
    const signature = Signature.create(oraclePriv, [
        input.imageHash,
        input.verdict.toField(),
        input.merkleRoot
    ]);
    const proof = await AiVerdictProgram.verifyOracle(input, oraclePub, signature);
    return { proof, oraclePub, signature, input };
}
async function submitProofToZeko(payload) {
    if (!process.env.ZEKO_GRAPHQL) {
        throw new Error('ZEKO_GRAPHQL env var not set');
    }
    const submitterKey = getSecret('SUBMITTER_PRIVATE_KEY', 'AIImageVerdictZK_SUBMITTER_PRIVATE_KEY');
    const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY', 'AIImageVerdictZK_ZKAPP_PRIVATE_KEY');
    if (!submitterKey) {
        throw new Error('SUBMITTER_PRIVATE_KEY env var not set');
    }
    const zkappPublicKey = getZkappPublicKey();
    if (!zkappPublicKey) {
        throw new Error('ZKAPP_PUBLIC_KEY env var not set');
    }
    if (!zkappPrivateKey) {
        throw new Error('ZKAPP_PRIVATE_KEY env var not set');
    }
    await ensureContractCompiled();
    const networkId = process.env.ZEKO_NETWORK_ID ?? 'testnet';
    const network = Mina.Network({
        networkId: networkId,
        mina: process.env.ZEKO_GRAPHQL,
        archive: process.env.ZEKO_GRAPHQL
    });
    Mina.setActiveInstance(network);
    const submitter = PrivateKey.fromBase58(submitterKey);
    const zkappKey = PrivateKey.fromBase58(zkappPrivateKey);
    let zkappAddress;
    try {
        zkappAddress = PublicKey.fromBase58(zkappPublicKey);
    }
    catch (err) {
        throw new Error(`Invalid ZKAPP_PUBLIC_KEY: ${redactKey(zkappPublicKey)}`);
    }
    const zkapp = new AiVerdictContract(zkappAddress);
    const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
    if (zkappAccount.error) {
        throw new Error('ZkApp account not found on-chain');
    }
    const zkappNonce = zkappAccount.account.nonce;
    if (!payload?.imageHash ||
        payload.verdict === undefined ||
        !payload.oraclePublicKey ||
        !payload.signature ||
        !payload.merkleRoot) {
        throw new Error('Missing payload fields for submission');
    }
    const imageHash = Field.fromJSON(payload.imageHash);
    const verdict = new Bool(payload.verdict);
    let oraclePk;
    try {
        oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
    }
    catch (err) {
        throw new Error(`Invalid oraclePublicKey: ${redactKey(payload.oraclePublicKey)}`);
    }
    const signature = Signature.fromJSON(payload.signature);
    const newRoot = Field.fromJSON(payload.merkleRoot);
    const merkleIndex = typeof payload.merkleIndex === 'number' ? payload.merkleIndex : Number(payload.merkleIndex ?? 0);
    const txFee = Number(process.env.TX_FEE ?? '100000000'); // 0.1 sETH in sETH base units
    const submitterPk = submitter.toPublicKey();
    const attemptSend = async (overrideNonce) => {
        const submitterAccount = await fetchAccount({ publicKey: submitterPk });
        if (submitterAccount.error) {
            throw new Error('Submitter account not found on-chain');
        }
        const chainNonce = Number(submitterAccount.account.nonce.toString());
        const submitterNonce = overrideNonce ?? chainNonce;
        console.log('[submit] chain nonce:', chainNonce, 'using nonce:', submitterNonce);
        const tx = await Mina.transaction({ sender: submitterPk, fee: txFee, nonce: submitterNonce }, async () => {
            zkapp.account.nonce.requireEquals(zkappNonce);
            await zkapp.submitSignedVerdict(imageHash, verdict, oraclePk, signature, newRoot);
        });
        // Non-magic fee payer handling: remove nonce precondition and require full commitment
        const feePayerUpdate = tx.feePayer;
        if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
            feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
        }
        if (feePayerUpdate?.body) {
            feePayerUpdate.body.useFullCommitment = Bool(true);
        }
        await tx.sign([submitter, zkappKey]);
        return await tx.send();
    };
    let sent;
    try {
        sent = await attemptSend();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('Account_nonce_precondition_unsatisfied')) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
            const submitterAccount = await fetchAccount({ publicKey: submitterPk });
            if (submitterAccount.error)
                throw err;
            const chainNonce = Number(submitterAccount.account.nonce.toString());
            sent = await attemptSend(chainNonce + 1);
        }
        else {
            throw err;
        }
    }
    const hash = sent?.hash?.toString?.() ??
        sent?.hash ??
        sent?.transactionHash ??
        null;
    const committed = await commitLeaf(imageHash, verdict, merkleIndex, newRoot);
    const proofStore = await loadProofStore();
    if (payload.merkleWitness?.length) {
        proofStore.proofs[imageHash.toString()] = {
            imageHash: imageHash.toString(),
            verdict: verdict.toBoolean(),
            merkleRoot: newRoot.toString(),
            merkleIndex: merkleIndex,
            merkleWitness: payload.merkleWitness
        };
    }
    else if (committed.witness?.length) {
        proofStore.proofs[imageHash.toString()] = {
            imageHash: imageHash.toString(),
            verdict: verdict.toBoolean(),
            merkleRoot: newRoot.toString(),
            merkleIndex: committed.index,
            merkleWitness: committed.witness
        };
    }
    await saveProofStore(proofStore);
    return { hash };
}
async function buildUnsignedTx(payload, feePayer) {
    if (!process.env.ZEKO_GRAPHQL) {
        throw new Error('ZEKO_GRAPHQL env var not set');
    }
    const zkappPrivateKey = getSecret('ZKAPP_PRIVATE_KEY', 'AIImageVerdictZK_ZKAPP_PRIVATE_KEY');
    const zkappPublicKey = getZkappPublicKey();
    if (!zkappPublicKey) {
        throw new Error('ZKAPP_PUBLIC_KEY env var not set');
    }
    if (!zkappPrivateKey) {
        throw new Error('ZKAPP_PRIVATE_KEY env var not set');
    }
    await ensureContractCompiled();
    const networkId = process.env.ZEKO_NETWORK_ID ?? 'testnet';
    const network = Mina.Network({
        networkId: networkId,
        mina: process.env.ZEKO_GRAPHQL,
        archive: process.env.ZEKO_GRAPHQL
    });
    Mina.setActiveInstance(network);
    const fee = process.env.TX_FEE ?? '100000000';
    const zkappAddress = PublicKey.fromBase58(zkappPublicKey);
    const zkapp = new AiVerdictContract(zkappAddress);
    const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
    if (zkappAccount.error) {
        throw new Error('ZkApp account not found on-chain');
    }
    const zkappNonce = zkappAccount.account.nonce;
    if (!payload?.imageHash ||
        payload.verdict === undefined ||
        !payload.oraclePublicKey ||
        !payload.signature ||
        !payload.merkleRoot) {
        throw new Error('Missing payload fields for transaction');
    }
    const imageHash = Field.fromJSON(payload.imageHash);
    const verdict = new Bool(payload.verdict);
    let oraclePk;
    try {
        oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
    }
    catch (err) {
        throw new Error(`Invalid oraclePublicKey: ${redactKey(payload.oraclePublicKey)}`);
    }
    let signature;
    try {
        signature = Signature.fromJSON(payload.signature);
    }
    catch (err) {
        throw new Error('Invalid signature payload (base58 parse failed)');
    }
    const newRoot = Field.fromJSON(payload.merkleRoot);
    try {
        signature.verify(oraclePk, [imageHash, verdict.toField(), newRoot]).toBoolean();
    }
    catch {
        // ignore signature verification logging here
    }
    let feePayerPk;
    try {
        feePayerPk = PublicKey.fromBase58(feePayer);
    }
    catch (err) {
        throw new Error(`Invalid feePayer public key: ${redactKey(feePayer)}`);
    }
    let zkappKey;
    try {
        zkappKey = PrivateKey.fromBase58(zkappPrivateKey);
    }
    catch (err) {
        throw new Error(`Invalid ZKAPP_PRIVATE_KEY: ${redactKey(zkappPrivateKey)}`);
    }
    const tx = await Mina.transaction({ sender: feePayerPk, fee }, async () => {
        zkapp.account.nonce.requireEquals(zkappNonce);
        await zkapp.submitSignedVerdict(imageHash, verdict, oraclePk, signature, newRoot);
    });
    // Non-magic fee payer handling: remove nonce precondition and require full commitment
    const feePayerUpdate = tx.feePayer;
    if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
        feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
    }
    if (feePayerUpdate?.body) {
        feePayerUpdate.body.useFullCommitment = Bool(true);
    }
    await tx.sign([zkappKey]);
    const txJson = tx.toJSON();
    // keep tx JSON opaque to avoid noisy logs
    const netId = process.env.ZEKO_NETWORK_ID ?? 'testnet';
    return { tx: txJson, fee, networkId: netId };
}
app.post('/analyze', async (req, res) => {
    try {
        const inputUrl = normalizeUrl(req.body?.url ?? '');
        const skipSvg = req.body?.skipSvg !== false;
        const requestedImageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : null;
        const html = await fetchHtml(inputUrl);
        const imageUrls = extractImageUrls(html, inputUrl, 5);
        if (imageUrls.length === 0) {
            return res.status(200).json({
                url: inputUrl,
                images: [],
                verdict: null,
                confidence: null,
                message: 'No images found on the page.'
            });
        }
        let selectedImage = null;
        let imageData = null;
        const candidates = requestedImageUrl ? [requestedImageUrl] : imageUrls;
        for (const imageUrl of candidates) {
            try {
                const data = await fetchImageData(imageUrl);
                if (skipSvg && data.contentType.includes('svg'))
                    continue;
                if (data.size > 10 * 1024 * 1024)
                    continue;
                selectedImage = imageUrl;
                imageData = data;
                break;
            }
            catch {
                // skip invalid images
            }
        }
        if (!selectedImage || !imageData) {
            return res.status(200).json({
                url: inputUrl,
                images: imageUrls,
                verdict: null,
                confidence: null,
                message: requestedImageUrl
                    ? 'Selected image could not be analyzed (SVG/oversized/invalid).'
                    : 'No suitable raster images found (skipped SVG/oversized images).'
            });
        }
        console.log('[detect] image url:', selectedImage);
        console.log('[detect] content-type:', imageData.contentType, 'size:', imageData.size);
        const imageHash = hashToField(imageData.buffer);
        const override = req.body?.apiUser || req.body?.apiSecret
            ? {
                provider: 'sightengine',
                apiUser: req.body?.apiUser,
                apiSecret: req.body?.apiSecret
            }
            : undefined;
        let remaining = null;
        let resetAt = null;
        if (!override) {
            const limit = checkDemoLimit(req);
            remaining = limit.remaining;
            resetAt = limit.resetAt;
            if (!limit.allowed) {
                return res.status(429).json({
                    error: 'Daily demo limit reached. Add your own API key to continue.',
                    remaining,
                    resetAt
                });
            }
            const captchaOk = await verifyCaptcha(req.body?.captchaToken);
            if (!captchaOk) {
                return res.status(429).json({
                    error: 'Captcha required for public demo usage.',
                    remaining,
                    resetAt
                });
            }
        }
        const classification = await detectAiImage(imageData.buffer, selectedImage, imageData.contentType, override);
        const merkleAppend = await prepareLeaf(imageHash, new Bool(classification.verdict));
        const { proof, oraclePub, signature, input } = await generateProof(imageHash, classification.verdict, merkleAppend.root);
        const proofJson = proof.toJSON();
        const proofStore = await loadProofStore();
        proofStore.proofs[imageHash.toString()] = {
            imageHash: imageHash.toString(),
            verdict: classification.verdict,
            merkleRoot: merkleAppend.root.toString(),
            merkleIndex: merkleAppend.index,
            merkleWitness: merkleAppend.witness
        };
        await saveProofStore(proofStore);
        res.status(200).json({
            url: inputUrl,
            images: imageUrls,
            verdict: classification.verdict,
            confidence: classification.confidence,
            method: classification.method,
            demo: remaining !== null ? { remaining, resetAt, limit: demoDailyLimit } : null,
            zk: {
                imageHash: imageHash.toString(),
                oraclePublicKey: oraclePub.toBase58(),
                signature: signature.toJSON(),
                merkleRoot: merkleAppend.root.toString(),
                merkleIndex: merkleAppend.index,
                merkleWitness: merkleAppend.witness,
                verdict: classification.verdict,
                publicInput: {
                    imageHash: input.imageHash.toString(),
                    verdict: input.verdict.toBoolean(),
                    merkleRoot: input.merkleRoot.toString()
                },
                proof: proofJson
            }
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.post('/images', async (req, res) => {
    try {
        const inputUrl = normalizeUrl(req.body?.url ?? '');
        const skipSvg = req.body?.skipSvg !== false;
        const html = await fetchHtml(inputUrl);
        const imageUrls = extractImageUrls(html, inputUrl, 8);
        const filtered = skipSvg ? imageUrls.filter((url) => !url.toLowerCase().endsWith('.svg')) : imageUrls;
        res.status(200).json({ url: inputUrl, images: filtered });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.post('/verify-url', async (req, res) => {
    try {
        const inputUrl = normalizeUrl(req.body?.url ?? '');
        const requestedImageUrl = typeof req.body?.imageUrl === 'string' ? normalizeUrl(req.body.imageUrl) : null;
        let imageUrl = requestedImageUrl ?? inputUrl;
        let imageData = null;
        try {
            imageData = await fetchImageData(imageUrl);
        }
        catch (err) {
            // If the URL isn't a direct image, try extracting from the page.
            const html = await fetchHtml(inputUrl);
            const imageUrls = extractImageUrls(html, inputUrl, 4);
            if (!imageUrls.length) {
                throw err;
            }
            imageUrl = requestedImageUrl ?? imageUrls[0];
            imageData = await fetchImageData(imageUrl);
        }
        const imageHashField = hashToField(imageData.buffer);
        const imageHash = imageHashField.toString();
        const chain = await fetchOnChainState();
        const proofStore = await loadProofStore();
        const storedProof = proofStore.proofs[imageHash];
        let matches = false;
        let verified = false;
        let anchored = false;
        let merkle = null;
        let finalVerdict = null;
        let note = null;
        if (storedProof?.merkleWitness?.length) {
            const verdictBool = new Bool(storedProof.verdict);
            const reconstructed = computeRootFromWitness(imageHashField, verdictBool, storedProof.merkleWitness);
            verified = reconstructed.toString() === storedProof.merkleRoot;
            anchored = verified && storedProof.merkleRoot === chain.merkleRoot;
            matches = anchored;
            if (verified) {
                finalVerdict = storedProof.verdict;
                merkle = {
                    root: storedProof.merkleRoot,
                    index: storedProof.merkleIndex,
                    witness: storedProof.merkleWitness
                };
                note = anchored
                    ? 'Verified from stored proof and current on-chain root.'
                    : 'Verified from stored proof, but on-chain root has advanced since submission.';
            }
        }
        if (!verified) {
            const matchTrue = await findLeaf(imageHashField, new Bool(true));
            const matchFalse = await findLeaf(imageHashField, new Bool(false));
            const match = matchTrue ?? matchFalse;
            const verdict = matchTrue ? true : matchFalse ? false : null;
            matches = Boolean(match && match.root.toString() === chain.merkleRoot);
            verified = matches;
            anchored = matches;
            merkle = match;
            finalVerdict = matches ? verdict : null;
        }
        if (!matches && chain.lastImageHash === imageHash) {
            const chainVerdict = chain.lastVerdict;
            const reconstructed = buildSingleLeafProof(imageHashField, new Bool(chainVerdict));
            if (reconstructed.root.toString() === chain.merkleRoot) {
                matches = true;
                finalVerdict = chainVerdict;
                merkle = reconstructed;
                note = 'Recovered from on-chain lastImageHash; local merkle store out of sync.';
            }
        }
        res.status(200).json({
            imageHash,
            imageUrl,
            onChain: chain,
            matches,
            verified,
            anchored,
            verdict: verified ? finalVerdict : null,
            merkle,
            note
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.post('/verify-upload', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file?.buffer) {
            return res.status(400).json({ error: 'Missing file' });
        }
        const imageHashField = hashToField(file.buffer);
        const imageHash = imageHashField.toString();
        const chain = await fetchOnChainState();
        const proofStore = await loadProofStore();
        const storedProof = proofStore.proofs[imageHash];
        let matches = false;
        let verified = false;
        let anchored = false;
        let merkle = null;
        let finalVerdict = null;
        let note = null;
        if (storedProof?.merkleWitness?.length) {
            const verdictBool = new Bool(storedProof.verdict);
            const reconstructed = computeRootFromWitness(imageHashField, verdictBool, storedProof.merkleWitness);
            verified = reconstructed.toString() === storedProof.merkleRoot;
            anchored = verified && storedProof.merkleRoot === chain.merkleRoot;
            matches = anchored;
            if (verified) {
                finalVerdict = storedProof.verdict;
                merkle = {
                    root: storedProof.merkleRoot,
                    index: storedProof.merkleIndex,
                    witness: storedProof.merkleWitness
                };
                note = anchored
                    ? 'Verified from stored proof and current on-chain root.'
                    : 'Verified from stored proof, but on-chain root has advanced since submission.';
            }
        }
        if (!verified) {
            const matchTrue = await findLeaf(imageHashField, new Bool(true));
            const matchFalse = await findLeaf(imageHashField, new Bool(false));
            const match = matchTrue ?? matchFalse;
            const verdict = matchTrue ? true : matchFalse ? false : null;
            matches = Boolean(match && match.root.toString() === chain.merkleRoot);
            verified = matches;
            anchored = matches;
            merkle = match;
            finalVerdict = matches ? verdict : null;
        }
        if (!matches && chain.lastImageHash === imageHash) {
            const chainVerdict = chain.lastVerdict;
            const reconstructed = buildSingleLeafProof(imageHashField, new Bool(chainVerdict));
            if (reconstructed.root.toString() === chain.merkleRoot) {
                matches = true;
                finalVerdict = chainVerdict;
                merkle = reconstructed;
                note = 'Recovered from on-chain lastImageHash; local merkle store out of sync.';
            }
        }
        res.status(200).json({
            imageHash,
            onChain: chain,
            matches,
            verified,
            anchored,
            verdict: verified ? finalVerdict : null,
            merkle,
            note
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.post('/verify-proof', async (req, res) => {
    try {
        let proofPayload = req.body?.proof ?? req.body;
        if (typeof proofPayload === 'string') {
            proofPayload = JSON.parse(proofPayload);
        }
        const imageHash = proofPayload?.imageHash ?? proofPayload?.publicInput?.imageHash;
        const verdictRaw = proofPayload?.verdict ?? proofPayload?.publicInput?.verdict;
        const merkle = proofPayload?.merkle ?? proofPayload?.proof?.merkle;
        const witness = merkle?.witness;
        if (!imageHash || verdictRaw === undefined || !witness) {
            return res
                .status(400)
                .json({ error: 'Proof JSON must include imageHash, verdict, and merkle.witness' });
        }
        const verdictBoolValue = typeof verdictRaw === 'boolean'
            ? verdictRaw
            : verdictRaw === 'false'
                ? false
                : Boolean(verdictRaw);
        const imageHashField = Field.fromJSON(imageHash);
        const verdictBool = new Bool(verdictBoolValue);
        const normalizedWitness = witness.map((node) => {
            const sibling = typeof node?.sibling === 'string' ? node.sibling : node?.sibling?.toString?.();
            if (!sibling) {
                throw new Error('Invalid witness format: missing sibling');
            }
            return { isLeft: Boolean(node.isLeft), sibling };
        });
        const reconstructedRoot = computeRootFromWitness(imageHashField, verdictBool, normalizedWitness);
        const chain = await fetchOnChainState();
        const merkleRoot = merkle?.root ?? merkle?.merkleRoot ?? proofPayload?.merkleRoot;
        const verified = merkleRoot
            ? reconstructedRoot.toString() === merkleRoot
            : reconstructedRoot.toString() === chain.merkleRoot;
        const anchored = verified && reconstructedRoot.toString() === chain.merkleRoot;
        res.status(200).json({
            imageHash: imageHashField.toString(),
            onChain: chain,
            matches: anchored,
            verified,
            anchored,
            verdict: verified ? verdictBool.toBoolean() : null,
            merkle: {
                root: merkleRoot ?? reconstructedRoot.toString(),
                witness: normalizedWitness
            }
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.post('/submit', async (req, res) => {
    try {
        const result = await submitProofToZeko(req.body?.payload);
        res.status(200).json({ status: 'submitted', hash: result.hash });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[submit] error:', message);
        res.status(400).json({ error: message });
    }
});
app.post('/commit', async (req, res) => {
    try {
        const payload = req.body?.payload ?? req.body;
        if (!payload?.imageHash || payload.verdict === undefined || payload.merkleIndex === undefined) {
            return res.status(400).json({ error: 'Missing payload fields for commit' });
        }
        const imageHash = Field.fromJSON(payload.imageHash);
        const verdict = new Bool(payload.verdict);
        const merkleIndex = typeof payload.merkleIndex === 'number' ? payload.merkleIndex : Number(payload.merkleIndex);
        const expectedRoot = payload.merkleRoot ? Field.fromJSON(payload.merkleRoot) : undefined;
        const committed = await commitLeaf(imageHash, verdict, merkleIndex, expectedRoot);
        const proofStore = await loadProofStore();
        const witness = payload.merkleWitness?.length ? payload.merkleWitness : committed.witness;
        if (witness?.length) {
            proofStore.proofs[imageHash.toString()] = {
                imageHash: imageHash.toString(),
                verdict: verdict.toBoolean(),
                merkleRoot: (expectedRoot ?? committed.root).toString(),
                merkleIndex: committed.index,
                merkleWitness: witness
            };
            await saveProofStore(proofStore);
        }
        res.status(200).json({
            committed: true,
            root: committed.root.toString(),
            index: committed.index
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.post('/status', async (req, res) => {
    try {
        const hash = req.body?.hash;
        if (!hash) {
            return res.status(400).json({ error: 'Missing tx hash' });
        }
        if (!process.env.ZEKO_GRAPHQL) {
            return res.status(400).json({ error: 'ZEKO_GRAPHQL env var not set' });
        }
        const status = await fetchTransactionStatus(hash, process.env.ZEKO_GRAPHQL);
        res.status(200).json({ status });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.post('/nonce', async (req, res) => {
    try {
        const publicKey = req.body?.publicKey;
        if (!publicKey) {
            return res.status(400).json({ error: 'Missing publicKey' });
        }
        if (!process.env.ZEKO_GRAPHQL) {
            return res.status(400).json({ error: 'ZEKO_GRAPHQL env var not set' });
        }
        const networkId = process.env.ZEKO_NETWORK_ID ?? 'testnet';
        const network = Mina.Network({
            networkId: networkId,
            mina: process.env.ZEKO_GRAPHQL,
            archive: process.env.ZEKO_GRAPHQL
        });
        Mina.setActiveInstance(network);
        const result = await fetchAccount({ publicKey });
        if (result.error) {
            return res.status(400).json({ error: result.error.statusText || 'Account not found' });
        }
        const nonce = result.account.nonce.toString();
        res.status(200).json({ nonce });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.post('/mempool', async (req, res) => {
    try {
        const publicKey = req.body?.publicKey;
        if (!publicKey) {
            return res.status(400).json({ error: 'Missing publicKey' });
        }
        if (!process.env.ZEKO_GRAPHQL) {
            return res.status(400).json({ error: 'ZEKO_GRAPHQL env var not set' });
        }
        const query = `query {
      pooledZkappCommands { feePayer { publicKey } }
      pooledUserCommands { feePayer { publicKey } }
    }`;
        const resp = await fetch(process.env.ZEKO_GRAPHQL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const json = (await resp.json());
        const pooled = json?.data?.pooledZkappCommands ?? [];
        const pooledUser = json?.data?.pooledUserCommands ?? [];
        const pendingZk = pooled.filter((cmd) => cmd?.feePayer?.publicKey === publicKey);
        const pendingUser = pooledUser.filter((cmd) => cmd?.feePayer?.publicKey === publicKey);
        res.status(200).json({
            count: pendingZk.length + pendingUser.length,
            pendingZk,
            pendingUser
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.get('/zkapp-info', async (_req, res) => {
    try {
        const zkappPublicKey = getZkappPublicKey();
        if (!zkappPublicKey) {
            return res.status(400).json({ error: 'ZKAPP_PUBLIC_KEY env var not set' });
        }
        if (!process.env.ZEKO_GRAPHQL) {
            return res.status(400).json({ error: 'ZEKO_GRAPHQL env var not set' });
        }
        const networkId = process.env.ZEKO_NETWORK_ID ?? 'testnet';
        const network = Mina.Network({
            networkId: networkId,
            mina: process.env.ZEKO_GRAPHQL,
            archive: process.env.ZEKO_GRAPHQL
        });
        Mina.setActiveInstance(network);
        const account = await fetchAccount({ publicKey: zkappPublicKey });
        if (account.error) {
            return res.status(400).json({ error: account.error.statusText || 'Account not found' });
        }
        res.status(200).json({
            publicKey: zkappPublicKey,
            permissions: account.account.permissions,
            zkappState: account.account.zkapp?.appState?.map((x) => x.toString()) ?? []
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.post('/tx', async (req, res) => {
    try {
        const payload = req.body?.payload;
        const feePayer = req.body?.feePayer;
        if (!payload || !feePayer) {
            return res.status(400).json({ error: 'Missing payload or feePayer' });
        }
        const missing = [
            !payload.imageHash && 'imageHash',
            payload.verdict === undefined && 'verdict',
            !payload.oraclePublicKey && 'oraclePublicKey',
            !payload.signature && 'signature',
            !payload.merkleRoot && 'merkleRoot'
        ].filter(Boolean);
        if (missing.length) {
            return res.status(400).json({ error: `Missing payload fields for transaction: ${missing.join(', ')}` });
        }
        const result = await buildUnsignedTx(payload, feePayer);
        res.status(200).json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.get('/config', (req, res) => {
    res.json({
        demoDailyLimit,
        hcaptchaSiteKey: process.env.HCAPTCHA_SITE_KEY || null
    });
});
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
