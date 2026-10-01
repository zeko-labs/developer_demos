import 'reflect-metadata';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';
import { fetch } from 'undici';
import { Bool, Field, Mina, PrivateKey, PublicKey, Signature, UInt32, fetchAccount, fetchTransactionStatus } from 'o1js';
import { detectAiImage } from './detector.js';
import { AiVerdictProgram, VerdictInput } from './zk/aiVerdict.js';
import { AiVerdictContract } from './zk/zekoContract.js';
const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));
let compiled = false;
let oracleKey = null;
let contractCompiled = false;
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
function extractImageUrls(html, baseUrl, maxImages = 5) {
    const $ = cheerio.load(html);
    const urls = [];
    $('img').each((_, el) => {
        const src = $(el).attr('src');
        if (!src)
            return;
        try {
            const abs = new URL(src, baseUrl).toString();
            if (abs.startsWith('http'))
                urls.push(abs);
        }
        catch {
            // ignore invalid urls
        }
    });
    const unique = Array.from(new Set(urls));
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
async function generateProof(imageHash, verdict) {
    await ensureCompiled();
    const oraclePriv = getOracleKey();
    const oraclePub = oraclePriv.toPublicKey();
    const input = new VerdictInput({ imageHash, verdict: new Bool(verdict) });
    const signature = Signature.create(oraclePriv, [input.imageHash, input.verdict.toField()]);
    const proof = await AiVerdictProgram.verifyOracle(input, oraclePub, signature);
    return { proof, oraclePub, signature, input };
}
async function submitProofToZeko(payload) {
    if (!process.env.ZEKO_GRAPHQL) {
        throw new Error('ZEKO_GRAPHQL env var not set');
    }
    if (!process.env.SUBMITTER_PRIVATE_KEY) {
        throw new Error('SUBMITTER_PRIVATE_KEY env var not set');
    }
    if (!process.env.ZKAPP_PUBLIC_KEY) {
        throw new Error('ZKAPP_PUBLIC_KEY env var not set');
    }
    if (!process.env.ZKAPP_PRIVATE_KEY) {
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
    const submitter = PrivateKey.fromBase58(process.env.SUBMITTER_PRIVATE_KEY);
    const zkappKey = PrivateKey.fromBase58(process.env.ZKAPP_PRIVATE_KEY);
    const zkappAddress = PublicKey.fromBase58(process.env.ZKAPP_PUBLIC_KEY);
    const zkapp = new AiVerdictContract(zkappAddress);
    const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
    if (zkappAccount.error) {
        throw new Error('ZkApp account not found on-chain');
    }
    const zkappNonce = zkappAccount.account.nonce;
    if (!payload?.imageHash || payload.verdict === undefined || !payload.oraclePublicKey || !payload.signature) {
        throw new Error('Missing payload fields for submission');
    }
    const imageHash = Field.fromJSON(payload.imageHash);
    const verdict = new Bool(payload.verdict);
    const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
    const signature = Signature.fromJSON(payload.signature);
    const txFee = Number(process.env.TX_FEE ?? '100000000'); // 0.1 MINA in nanomina
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
            await zkapp.submitSignedVerdict(imageHash, verdict, oraclePk, signature);
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
    return { hash };
}
async function buildUnsignedTx(payload, feePayer) {
    if (!process.env.ZEKO_GRAPHQL) {
        throw new Error('ZEKO_GRAPHQL env var not set');
    }
    if (!process.env.ZKAPP_PUBLIC_KEY) {
        throw new Error('ZKAPP_PUBLIC_KEY env var not set');
    }
    if (!process.env.ZKAPP_PRIVATE_KEY) {
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
    const zkappAddress = PublicKey.fromBase58(process.env.ZKAPP_PUBLIC_KEY);
    const zkapp = new AiVerdictContract(zkappAddress);
    const zkappAccount = await fetchAccount({ publicKey: zkappAddress });
    if (zkappAccount.error) {
        throw new Error('ZkApp account not found on-chain');
    }
    const zkappNonce = zkappAccount.account.nonce;
    if (!payload?.imageHash || payload.verdict === undefined || !payload.oraclePublicKey || !payload.signature) {
        throw new Error('Missing payload fields for transaction');
    }
    const imageHash = Field.fromJSON(payload.imageHash);
    const verdict = new Bool(payload.verdict);
    const oraclePk = PublicKey.fromBase58(payload.oraclePublicKey);
    const signature = Signature.fromJSON(payload.signature);
    try {
        const ok = signature.verify(oraclePk, [imageHash, verdict.toField()]).toBoolean();
        console.log('[tx] signature verifies:', ok);
    }
    catch (err) {
        console.log('[tx] signature verify threw:', err);
    }
    const feePayerPk = PublicKey.fromBase58(feePayer);
    const zkappKey = PrivateKey.fromBase58(process.env.ZKAPP_PRIVATE_KEY);
    const tx = await Mina.transaction({ sender: feePayerPk, fee }, async () => {
        zkapp.account.nonce.requireEquals(zkappNonce);
        await zkapp.submitSignedVerdict(imageHash, verdict, oraclePk, signature);
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
    if (typeof txJson === 'string') {
        try {
            const parsed = JSON.parse(txJson);
            console.log('[tx] tx JSON nonce:', parsed?.feePayer?.body?.nonce);
        }
        catch {
            console.log('[tx] tx JSON nonce: (parse failed)');
        }
    }
    else {
        console.log('[tx] tx JSON nonce:', txJson?.feePayer?.body?.nonce);
    }
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
        const classification = await detectAiImage(imageData.buffer, selectedImage, imageData.contentType);
        const { proof, oraclePub, signature, input } = await generateProof(imageHash, classification.verdict);
        const proofJson = proof.toJSON();
        res.status(200).json({
            url: inputUrl,
            images: imageUrls,
            verdict: classification.verdict,
            confidence: classification.confidence,
            method: classification.method,
            zk: {
                imageHash: imageHash.toString(),
                oraclePublicKey: oraclePub.toBase58(),
                signature: signature.toJSON(),
                verdict: classification.verdict,
                publicInput: {
                    imageHash: input.imageHash.toString(),
                    verdict: input.verdict.toBoolean()
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
        const imageUrls = extractImageUrls(html, inputUrl, 4);
        const filtered = skipSvg ? imageUrls.filter((url) => !url.toLowerCase().endsWith('.svg')) : imageUrls;
        res.status(200).json({ url: inputUrl, images: filtered });
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
            !payload.signature && 'signature'
        ].filter(Boolean);
        if (missing.length) {
            console.log('[tx] missing payload fields:', missing);
            return res.status(400).json({ error: `Missing payload fields for transaction: ${missing.join(', ')}` });
        }
        console.log('[tx] payload keys:', Object.keys(payload || {}));
        const result = await buildUnsignedTx(payload, feePayer);
        res.status(200).json(result);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(400).json({ error: message });
    }
});
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
