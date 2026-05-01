# Architecture

## Protocol Flow

```mermaid
sequenceDiagram
    participant IdP as Enterprise IdP (SAML/OIDC)
    participant Auth as Mission Authority
    participant Agent as Agent
    participant App as Domain App
    participant X402 as x402 Rail
    participant Zeko as Zeko zkApp

    IdP->>Auth: Verified enterprise identity / claims
    Auth->>Agent: Agent Passport (JWS)
    Agent->>Auth: Mission proposal
    Auth->>Agent: Mission Approval (JWS)
    Auth->>Zeko: Anchor approval commitment
    Agent->>App: Request action + mission approval
    App->>Auth: Verify checkpoint
    App->>X402: Require / verify payment
    App->>App: Execute domain action
    App->>Zeko: Anchor execution receipt
    App->>Agent: Result + portable bundle
```

## Approval Before / Receipt After

```mermaid
flowchart LR
  A["Mission approval"] --> B["approvalHash"]
  B --> C["Zeko authRoot"]
  C --> D["Checkpoint allows action"]
  D --> E["Domain execution"]
  E --> F["outputHash + paymentContextDigest"]
  F --> G["Zeko receiptRoot"]
```

## Where Domain Apps Plug In

```mermaid
flowchart TD
  P["Agent Mission-Bound Auth"] -->|"verify-checkpoint"| D1["Private Compute"]
  P -->|"verify-checkpoint"| D2["Email / Calendar"]
  P -->|"verify-checkpoint"| D3["Trading / Procurement"]
  P -->|"verify-checkpoint"| D4["Code Execution"]

  D1 --> R["Domain receipt"]
  D2 --> R
  D3 --> R
  D4 --> R
  R --> Z["Zeko receipt root"]
```

The bundled private-compute UI is one reference domain adapter. Replace it with any app that can call `verify-checkpoint` before work or side effects.
