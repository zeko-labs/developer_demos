# OAuth Provider Setup

The sidecar supports OIDC Authorization Code + PKCE with Auth0, Okta, and arbitrary customer OIDC providers.

For hosted deployments, set:

```bash
PUBLIC_BASE_URL=https://auth-sidecar.example.com
```

Provider callback URL:

```text
https://auth-sidecar.example.com/api/oauth/callback
```

Local callback URL:

```text
http://127.0.0.1:8787/api/oauth/callback
```

## Auth0

Set:

```bash
AUTH0_ISSUER=https://your-auth0-tenant.us.auth0.com/
AUTH0_DOMAIN=your-auth0-tenant.us.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_AUDIENCE=
```

For the browser harness Auth0 SPA panel, configure the Auth0 application as a Single Page Application:

```text
Allowed Callback URLs: http://127.0.0.1:8787
Allowed Logout URLs: http://127.0.0.1:8787
Allowed Web Origins: http://127.0.0.1:8787
```

For the server-side sidecar flow, also allow:

```text
http://127.0.0.1:8787/api/oauth/callback
```

## Okta

Set:

```bash
OKTA_ISSUER=https://your-okta-domain.okta.com
OKTA_CLIENT_ID=...
OKTA_CLIENT_SECRET=...
OKTA_SCOPE=openid profile email
```

Use the Okta org issuer above for general SSO. If you use:

```text
https://your-okta-domain.okta.com/oauth2/default
```

you must configure an authorization-server access policy and rule for the OIDC app, otherwise Okta may return:

```text
Policy evaluation failed for this request
```

## Additional Providers

Use `OIDC_PROVIDERS_JSON` for customer IdPs:

```bash
OIDC_PROVIDERS_JSON='[
  {
    "provider": "customer-a",
    "issuer": "https://idp.customer-a.example",
    "clientId": "...",
    "clientSecret": "...",
    "scope": "openid profile email"
  }
]'
```

Then start login with:

```text
/api/oauth/login?provider=customer-a
```

## What The Flow Proves

The sidecar:

- discovers `.well-known/openid-configuration`
- redirects with Authorization Code + PKCE
- exchanges the code at the token endpoint
- requires an ID token and verifies it against provider JWKS
- checks issuer, client-id audience, expiry, and nonce
- normalizes claims into canonical protocol claims
- creates the auth commitment used by Agent Mission-Bound Auth

Access tokens are not treated as agent identity tokens. Use them only for
provider/resource API calls after the agent identity has been established by the
ID token.

Map verified subjects into internal agents with `AGENT_MAPPINGS_JSON`:

```bash
AGENT_MAPPINGS_JSON='[
  {
    "subjectKey": "okta:https://your-okta-domain.okta.com/:00u123",
    "agentId": "agent-research-001",
    "represents": { "type": "organization", "id": "Acme" }
  }
]'
```

Production profile is fail-closed for agent mapping: if a verified
`provider:issuer:subject` does not map to an internal agent, the sidecar rejects
the token. Production commitment construction also uses configured provider
trust roots only; callers cannot supply their own issuer, audience, or JWKS URL.

Run:

```bash
npm run oauth:sandbox-doctor
npm run test:oauth-sandbox
```
