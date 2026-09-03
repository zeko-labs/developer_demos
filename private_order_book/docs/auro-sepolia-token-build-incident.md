# Auro Token-Build Failure on Sepolia Zeko

**Status:** Open vendor follow-up
**Observed:** 2026-09-03, approximately 13:42 PT
**Reporter:** ShadowBook integration team

## Summary

Auro's token-build flow failed while preparing a standard sZEKO transfer on Sepolia Zeko. The flow remained on `Start building`, became unresponsive, and eventually returned HTTP `502`. This prevented the wallet from producing a usable transfer request.

The failure was observed in Auro's token-build service, not in ShadowBook's matching or settlement flow. ShadowBook subsequently added a server-prebuilt transfer path so the transaction can be built and proved before Auro is asked to sign it. That is an operational workaround, not a diagnosis or a replacement for Auro's token-build service.

## Reproduction Details

- **Auro service:** [token-build.aurowallet.com](https://token-build.aurowallet.com)
- **Network shown in Auro:** Sepolia Zeko
- **GraphQL endpoint:** [sepolia.zeko.io/graphql](https://sepolia.zeko.io/graphql)
- **Asset:** `sZEKO`
- **Token ID:** `xpAptwG79jEStACsCv9C6yXUBmKbvurUo8GsTPYapn9QWB5zE5`
- **Amount:** `1000 sZEKO`
- **Sender:** `B62qipa4xp6pQKqAm5qoviGoHyKaurHvLZiWf3djDNgrzdERm6AowSQ`
- **Recipient:** `B62qp9tLKDh3HoBjF6fKtK24L7SVrCxDEFHZf4Vd4uyB1uNRiShWpfP`

## Observed Behavior

1. Auro Token Build remained on `Start building`.
2. The Token Build page became unresponsive.
3. Auro displayed: `Request failed with status code 502`.
4. The wallet displayed a network fee of `0.000001696 MINA` while the selected network was Sepolia Zeko, whose native gas asset is sETH.

No successful transfer hash was produced by this attempt.

## Questions for Auro

1. Is Sepolia Zeko enabled in `token-build.aurowallet.com` for token-transfer building?
2. What exact network ID should Auro use for this network? The network endpoint reports `zeko:testnet`; please confirm the value expected by the wallet and token-build service.
3. Is the sZEKO token ID above whitelisted, compiled, and supported by the token-build service?
4. Does the builder create the recipient sZEKO token account automatically when it does not exist?
5. Is the `MINA` fee label incorrect for Sepolia Zeko, or is the transaction actually denominated in the network's native sETH unit?
6. Can Auro provide the server-side request ID, upstream response, or failure reason associated with the HTTP 502?

## Useful Diagnostic Information

Please confirm whether the 502 occurred at one of these stages:

- network configuration or chain selection;
- token metadata or whitelist lookup;
- token-account existence lookup;
- transaction construction or proving;
- fee estimation;
- submission of the built request back to the wallet.

The distinction matters because the same network can successfully handle ordinary wallet signing while the token-build service still fails during token-transfer construction.

## Current Workaround

ShadowBook can build and prove the sZEKO transfer server-side, then request an Auro signature only after construction completes. The transfer remains a normal token transfer and does not mint privacy notes or modify vault collateral. This workaround reduces dependence on the browser-hosted token-build page, but it does not address the underlying Auro 502.

## Requested Vendor Response

Please provide:

- confirmation that Sepolia Zeko is enabled end-to-end;
- the canonical network ID and native fee denomination;
- confirmation of sZEKO support and recipient-account behavior;
- the failing request's correlation ID and server-side error;
- any required Auro-side configuration or allowlisting for this network.
