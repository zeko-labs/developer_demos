# Design Brief: zkVerify Proof Visualization

## What This Is

A zero-knowledge proof pipeline verifies someone's employment eligibility (salary, tenure, employment status) **without revealing the actual data**. The proof flows through 7 stages: data attestation via TLSNotary → field extraction → cryptographic commitment → ZK circuit proving → local verification → on-chain settlement.

The audience is **non-technical stakeholders** — lenders, regulators, executives — who need to look at a screen and immediately feel: "this is verified, this is trustworthy, I understand what happened."

## The Ask

Create **3 static HTML files**. No JavaScript. No frameworks. No external dependencies. Just HTML + a `<style>` block. Use `<details>/<summary>` for any expand/collapse behavior.

### File 1: `index.html` — The Proof Directory

The homepage of the application. Think of it as a **file explorer or inbox** for proof certificates. It displays a list of all generated proofs — each entry is a row or card showing enough at a glance to identify and assess the proof.

Each proof entry should surface:
- Verification status (verified / failed / pending)
- Proof type or circuit name (e.g., `employment-eligibility`)
- Date generated
- Proof hash (truncated)
- Network it was settled on

Include **3 hardcoded proof entries** to make the directory feel populated:

| # | Status | Circuit | Date | Network | Proof Hash (truncated) |
|---|--------|---------|------|---------|------------------------|
| 1 | Verified | `employment-eligibility` | 2026-02-19 | Zeko Testnet | `12343576052138...7492356` |
| 2 | Verified | `employment-eligibility` | 2026-02-17 | Zeko Testnet | `98271034856123...1038472` |
| 3 | Failed | `employment-eligibility` | 2026-02-15 | Zeko Testnet | `55019283746501...6639281` |

The first entry (most recent, verified) should link to `proof-overview.html`. The other entries are non-functional but should look clickable.

The directory should also have:
- A header/title bar identifying this as the zkVerify proof explorer
- Some indication of total proof count and how many are verified vs. failed
- A sense of spatial hierarchy — the list is the main content, with navigation or context around it

### File 2: `proof-overview.html` — The Certificate

A single-screen view that functions like a **digital verification certificate**. At a glance, the viewer should understand:

- This person's employment eligibility is **verified**
- The verification is backed by **three trust layers**: data attestation (TLSNotary witnessed it), a zero-knowledge proof (eligibility proven without exposing data), and an on-chain record (proof is permanently settled)
- When it was generated and where to find the full details

Link back to `index.html` (the directory) and forward to `proof-detail.html`.

### File 3: `proof-detail.html` — The Full Record

An expanded view showing everything about the proof, organized into logical sections (use `<details>/<summary>` — collapsed by default except the top status section):

1. **Certificate Status** — The verification result, eligibility outcome (`true`), evaluation date
2. **Data Attestation** — TLSNotary details: notary public key, signature components, session info, attested server
3. **Disclosed Fields** — What was proven vs. what stays hidden. This is the privacy story: salary meets threshold, tenure meets threshold, status is active — but actual values are never shown
4. **ZK Computation** — Circuit name, public inputs/outputs, verification key, proof size, and the policy parameters (thresholds) used
5. **On-Chain Settlement** — Network, zkApp address, transaction hash, contract state, matching events
6. **Pipeline Timeline** — All 7 stages in order with timestamps showing the progression
7. **Raw Artifacts** — List of output files (attestation.json, disclosed-fields.json, proof.json, verification-key.json)

Link back to `index.html` and to `proof-overview.html`.

## Navigation

All three pages should share a consistent navigation pattern so the user always knows where they are:

`Directory (index.html)` → `Certificate (proof-overview.html)` → `Full Details (proof-detail.html)`

Breadcrumbs, a nav bar, or back-links — your call on the pattern. Just make sure every page links to the others where it makes sense.

## Creative Direction

Go bold. This is a cryptographic certificate system — it should feel like looking at something **important and trustworthy**. Think about what makes a viewer trust a document: is it the weight of a seal, the precision of the layout, the confidence of the typography?

Some vibes to consider (pick one, blend several, or ignore entirely and bring your own):
- **Vault door / bank note** — engraved precision, institutional authority
- **Mission control dashboard** — clean data density, operational confidence
- **Luxury product certificate** — premium materials, restrained elegance
- **Scientific paper** — rigorous structure, typographic clarity

Dark mode is strongly preferred but not mandatory if you have a compelling light-mode concept.

You have **full creative freedom** on: color palette, typography choices, layout structure, visual metaphors, iconography approach (Unicode, CSS shapes, whatever works), spacing, card styles, animations (CSS-only), decorative elements. Make it visually striking — this should be something people screenshot and share.

The three pages should feel like they belong to the same application — a consistent design language across all of them, while letting each page serve its distinct purpose.

## Constraints (non-negotiable)

- Each file: complete self-contained HTML document, all CSS in `<head>` `<style>` block
- **No JavaScript**
- **No external resources** — no CDN, no Google Fonts, no images, no icon libraries
- **No frameworks** — no Tailwind, no Bootstrap
- `<details>/<summary>` for collapsible sections in the detail page
- Semantic HTML5 (`<main>`, `<header>`, `<section>`, `<details>`, `<time>`, etc.)
- Monospace font for all cryptographic values (hashes, keys, addresses, field elements)
- Privacy: actual salary and hire date values must NEVER appear — only threshold checks shown
- Responsive enough to not break, but desktop is the primary target

## Sample Data

Use these exact values as hardcoded placeholders throughout the files.

```
Proof Hash:              1234357605213887681571516522283666890866308643784466339214911188889297492356
Verification Key Hash:   19799624995673262779815068765230060142035202290799234618982691134662891875997
zkApp Address:           B62qqS3PJStdtX1sELtKTpji7fPk1XencfmnMw5VSiUQhPkKiotCgpr
Settlement Tx Hash:      5JuRS6XRuDgAaVptnxJ47FwiXKaLFatqhDvMdzbftUs4rZ6irk8Z
Notary Public Key X:     fac7d8ab2d097d429f572a77ce324add36ccad426425b68cd54777b6f261ca14
Notary Public Key Y:     0f0e1b6a6998bc97e853edd33c919ff3028b9cc1da02bd7236079e74847ba0b2
Signature R:             6f3c04ea572853bbaef3cee4af2abfade21062bc
Signature S:             6e32c3f92a83cf6082e44619c29caed38ee72c7bcc
Session Header Hash:     58f36583f790effc09...
Data Commitment:         1234357605213887681...
Attestation Timestamp:   2026-02-19T04:24:17Z
Evaluation Date:         2026-02-18
Network:                 Zeko Testnet
Circuit Name:            employment-eligibility
Proof Size:              ~32 KB
Attested Server:         localhost:4443
Signature Algorithm:     secp256k1 ECDSA
Fee Payer Nonce:         1 → 2
Matching Events:         1
```

**Privacy-preserving display for disclosed fields:**
- Salary: show as `≥ $50,000 ✓` (actual value: 85,000 — never display this)
- Tenure: show as `≥ 12 months ✓` (actual hire date: 2023-06-15 — never display this)
- Status: show as `Active ✓` (verified via Poseidon hash)

**Policy parameters (the thresholds):**
- Minimum Salary: $50,000
- Minimum Tenure: 12 months
- Required Status: active

**Pipeline stages (for timeline):**

| # | Stage | Description | Time |
|---|-------|-------------|------|
| 1 | Mock Server Started | HTTPS fixture server with employment data | 04:24:00 |
| 2 | TLSNotary Attestation | Notary witnessed TLS session with employer API | 04:24:05 |
| 3 | Field Extraction | Disclosed fields extracted from attestation | 04:24:10 |
| 4 | Data Commitment | Poseidon hash computed over field elements | 04:24:12 |
| 5 | ZK Proof Generation | Employment eligibility circuit compiled and proved | 04:24:15 |
| 6 | Proof Verification | Proof verified against verification key | 04:24:16 |
| 7 | On-Chain Settlement | Proof and result settled to Zeko testnet | 04:24:17 |

## File Placement

- `/ui/index.html`
- `/ui/proof-overview.html`
- `/ui/proof-detail.html`
