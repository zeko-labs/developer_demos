# Deployment

## Render

For demo-scale usage, this repo can run as a single Render web service.

This deployment is intentionally Zeko Ethereum Sepolia-only. There is no second-network runtime, network selector, or multi-network gateway.

### Build command

```bash
pnpm install --frozen-lockfile && pnpm build:zkapp
```

### Start command

```bash
pnpm render:start
```

### Environment profile

Use [`.env.example`](../.env.example) as the Render environment checklist. It is intentionally limited to the Sepolia chain, deployed settlement zkApp, wallet/deposit handling, early access, matching, fees, and the on-chain settlement worker.

The profile intentionally does not include archive endpoints, proof-agent settings, faucet credentials, bot settings, or DA relay bridge credentials. Those belong to separately deployed services, not the Render web process.

### Recommended setup

- one Render web service
- durable disk mounted for `data/`
- do not rely on ephemeral filesystem if you want local JSON state persistence

### What runs inside the single service

- HTTP API + UI
- matcher
- embedded settlement loop

The Render start command does not start `src/da-relay-server.js`. Keep `DA_MODE=disabled` and leave `DA_ENDPOINT` unset unless a separate relay service has been deployed and tested.

### Activity privacy boundary

The hosted app defaults to `ACTIVITY_PRIVACY_MODE=redacted`. Server-side
activity and fairness-audit records retain event type, time, and a commitment,
not order prices, quantities, note hashes, wallet addresses, or settlement
amounts. Detailed order and fill history is kept in the user's browser for the
`Your Activity` view. This reduces operator-accessible records but does not hide
live order inputs from the central matcher; confidential matching still needs a
TEE, MPC, wallet-side matching, or another private execution boundary.

### DA relay boundary

The relay accepts encrypted ShadowBook payloads and can persist a signed receipt locally. Its default `DA_RELAY_FORWARD_MODE=none` is stored-only behavior; it is not proof that data has been anchored to Zeko or Ethereum Sepolia. Actual forwarding requires a separately deployed bridge or command adapter and its own `ZEKO_DA_BRIDGE_URL` or `DA_RELAY_COMMAND`.

When a relay is separately deployed, its payload should identify Sepolia as `network: "zeko:testnet"`. That is the live GraphQL network identifier returned by `https://sepolia.zeko.io/graphql`. For o1js/Auro-signed Sepolia transactions, use the `testnet` signing domain; these identifiers are not interchangeable.

This is the simplest deployment shape for the demo.

## Optional Early Access Gate

If you want a code-gated landing page in front of the app, set:

```env
EARLY_ACCESS_GATE_ENABLED=true
EARLY_ACCESS_CODES=CODE1,CODE2,CODE3
EARLY_ACCESS_COOKIE_SECRET=<strong-random-secret>
```

Behavior:

- `/` stays public and shows the landing page
- `/darkpool`, `/partner`, and `/api/darkpool/*` require access
- each code is one-time use
- the first successful redemption allowlists the caller IP
- the browser also receives a signed cookie so repeat access is smoother on real networks

Important note:

- IP-based allowlists are simple and useful for demos, but they are not perfect under shared networks, NAT, or rotating client IPs
- the signed browser cookie is there to soften that, but this is still a lightweight demo gate, not a full auth system
- to turn the gate off later, set `EARLY_ACCESS_GATE_ENABLED=false`; the stored codes can remain in env without affecting access

## Lean vs Advanced Contracts

The hosted default path now uses the lean settlement contract in `zkapp/contract.ts`.

That contract:
- anchors settlement progression on-chain
- commits the public/private roots needed by the market
- avoids pulling the heavy private-state proof program into normal startup and batch commit

The proof-heavy reference path lives in `zkapp/advanced-contract.ts`.

That version is useful for partner implementations or future research, but it is intentionally not the default hosted contract because it carries substantially higher compile and memory overhead.

## Scaling Proving Later

If proof generation needs more CPU/RAM later:

1. Keep the main Render service as the market + settlement authority
2. Run one or more separate proof machines
3. Point them at the same `DARKPOOL_API`
4. Configure the same `PROOF_WORKER_API_KEY`
5. Run:

```bash
pnpm settlement:worker:proofs:remote
```

The remote proof agent:
- fetches the next pending proof job snapshot
- builds the proof locally
- uploads the proof artifact back

Settlement commit remains single-writer on the main service.

## Why This Shape

For this market, the important constraint is:
- proving must not sit on the hot trading path

So the architecture is:
- off-chain matching
- precomputed proofs
- on-chain batch settlement / root anchoring

That is lean enough for demo-scale deployment while leaving a clean path to horizontal proof scaling later.

## Faucet Options

For the public UI, the funding tab links users to the official Zeko faucet:

- [https://faucet.zeko.io/](https://faucet.zeko.io/)

That keeps faucet policy and GitHub authentication out of the app server.

If you are wiring up internal agents or operator workflows instead, you can also use the official Zeko faucet CLI directly:

- [zeko-labs/faucet-cli](https://github.com/zeko-labs/faucet-cli)

That path is better suited to scripts and bots than the public UI, especially when you want explicit control over faucet claiming behavior outside the browser.
