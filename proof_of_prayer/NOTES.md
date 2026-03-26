# Proof of Prayer: Design Notes

## Goals
- Permanently anchor prayers on-chain while keeping content private by default.
- Allow optional public sharing of a prayer without revealing who submitted it.
- Enable community participation ("pray with") without revealing wallets.
- Provide UI-only moderation for offensive content.

## Data model (high level)
- Prayer payload (client side):
  - `prayerText`
  - `recipientAlias` (optional, non-identifying)
  - `visibility`: `private | shared`
- Client derives:
  - `ciphertext` (encrypted prayer)
  - `commitment` = hash(ciphertext)
- On-chain:
  - store `commitment` (and optional metadata hash for shared public text)
- Off-chain (UI index):
  - public feed records for shared prayers
  - moderation flags

## Privacy rules
- Wallet addresses are never displayed in the UI.
- Private prayers only display a generic placeholder in the public feed.
- Shared prayers display only the public text and a pseudonymous label.

## Proof of Prayer flow
- A "Pray with" action submits a transaction that:
  - commits to the prayer ID (commitment) plus a new `prayerProof` hash
  - increments a counter in the off-chain index
- UI shows total prayers and a timeline, without wallet identities.

## Moderation (backend)
- On submission, run an offensive-content filter.
- If flagged:
  - store `flagStatus = pending` in the off-chain index
  - do not show in the public feed
  - send to admin/community review queue
- Admin/community can mark `approved | hidden` for UI visibility.
- No on-chain deletions (immutability preserved).

## Open questions
- Do we want prayer encryption using the recipient's public key (optional) or a user-chosen passphrase?
- Should shared prayers allow a short "public excerpt" separate from the encrypted full text?
- What moderation provider should we integrate first (open-source filter vs third-party API)?

## Feature backlog (proposed)
- Encrypted prayer storage + on-chain commitment
- Public feed with anonymized identities
- "Pray with" proof-of-prayer submissions
- Moderation queue and admin dashboard
- Rate limits + abuse protections
- Optional donation / gas sponsor flow
