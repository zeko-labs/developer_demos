import { oidcProviderConfig, discoverOidcProvider, oidcProviderNames } from "../packages/protocol/oidc.js";
import { loadLocalEnv } from "../packages/protocol/env-local.js";

loadLocalEnv();
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8787";

async function checkProvider(provider) {
  const config = oidcProviderConfig(provider, baseUrl);
  const missing = [];
  if (!config.issuer) missing.push(`${provider.toUpperCase()}_ISSUER`);
  if (!config.clientId) missing.push(`${provider.toUpperCase()}_CLIENT_ID`);
  const secretRequired = provider === "okta";
  if (secretRequired && !config.clientSecret) missing.push(`${provider.toUpperCase()}_CLIENT_SECRET`);

  if (missing.length > 0) {
    return {
      provider,
      ok: false,
      configured: false,
      missing,
      callbackUrl: config.redirectUri
    };
  }

  try {
    const discovery = await discoverOidcProvider(config);
    return {
      provider,
      ok: Boolean(discovery.authorizationEndpoint && discovery.tokenEndpoint && discovery.jwksUri),
      configured: true,
      issuer: discovery.issuer,
      authorizationEndpoint: discovery.authorizationEndpoint,
      tokenEndpoint: discovery.tokenEndpoint,
      jwksUri: discovery.jwksUri,
      callbackUrl: config.redirectUri,
      clientSecret: config.clientSecret ? "set" : "not set"
    };
  } catch (error) {
    return {
      provider,
      ok: false,
      configured: true,
      issuer: config.issuer,
      callbackUrl: config.redirectUri,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

const providerFilter = process.env.OAUTH_PROVIDER;
const providerNames = providerFilter ? [providerFilter] : oidcProviderNames();
const providers = [];
for (const provider of providerNames) {
  providers.push(await checkProvider(provider));
}

console.log(JSON.stringify({
  ok: providers.every((provider) => provider.ok),
  providers
}, null, 2));

process.exit(providers.every((provider) => provider.ok) ? 0 : 1);
