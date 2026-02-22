# ACP Non-Financial Use-Case Examples

ACP supports any domain where buyers need private output delivery and public verification of work.

## 1) Compliance policy checking

- Input: internal policy package hash + prompt
- Output: pass/fail findings with confidence and rationale
- Payment: per document or credits for continuous compliance scans
- Trust: output commitment anchored on-chain for auditability

## 2) Code review / security triage agents

- Input: repo diff metadata + rule profile
- Output: findings list (`positive` risk, `negative` no-risk, `neutral` inconclusive)
- Payment: per pull request or batched credits
- Trust: attested outputs provide immutable review trail

## 3) Enterprise document extraction

- Input: private doc reference + extraction schema
- Output: structured fields with confidence
- Payment: per extraction job
- Trust: optional zkTLS source proofs for upstream data provenance

## 4) Shared inference between organizations

- Input: encrypted task payload pointers
- Output: model inference package
- Payment: per inference call
- Trust: output and source commitments support inter-org verification without data sharing

## 5) Autonomous procurement agents

- Input: purchasing constraints + supplier endpoints
- Output: ranked options with confidence/rationale
- Payment: micro-fees per ranking request
- Trust: verifiable outputs prevent silent post-hoc modification claims

## OpenClaw-oriented expansion opportunities

These are high-fit ACP patterns for OpenClaw-style autonomous orchestration where one agent calls
many specialized providers.

## 6) Multi-agent incident response

- Input: incident summary + logs snapshot + remediation policy
- Output: triage severity, likely root cause, and response plan
- Payment: per escalation step (detector agent -> diagnosis agent -> remediation agent)
- Trust: each handoff is attested, creating an auditable incident timeline across providers

## 7) Autonomous QA release gates

- Input: build artifact reference + test policy + risk threshold
- Output: release verdict with test/risk rationale
- Payment: per release gate invocation in CI/CD
- Trust: attested output prevents post-release rewriting of gate decisions

## 8) RFP and contract analysis marketplace

- Input: private RFP or contract text + scoring rubric
- Output: clause risks, negotiation priorities, and compliance checklist
- Payment: per document or per section
- Trust: commitment history proves exactly when analysis output was produced

## 9) KYC / KYB pre-screen orchestration

- Input: entity profile hash + sanctions/document source references
- Output: risk classification and verification status
- Payment: per screening call
- Trust: optional zkTLS source commitments can prove origin integrity of registry/web lookups

## 10) Autonomous research copilot mesh

- Input: research question + source constraints + quality policy
- Output: ranked evidence summaries from multiple independent agents
- Payment: split across specialist agents (retrieval, synthesis, fact-check)
- Trust: independent attestation from each agent supports cross-check and consensus scoring

## 11) Operations optimization agents

- Input: private ops metrics + optimization objective (cost, latency, reliability)
- Output: recommended action plan with confidence
- Payment: per optimization cycle or scheduled credit burn
- Trust: immutable output commitments support before/after performance attribution

## 12) Customer support resolution agents

- Input: ticket context + product docs + policy set
- Output: response draft, escalation class, and compliance-safe action
- Payment: per resolved ticket
- Trust: attested outputs help prove support action lineage for disputes and QA
