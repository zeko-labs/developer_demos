const env = process.env;

function graphqlUrl(value, fallback) {
  const url = value ?? fallback;
  return url.endsWith("/graphql") ? url : `${url.replace(/\/$/, "")}/graphql`;
}

function evmRail(input) {
  return {
    id: input.id,
    settlementRail: "evm",
    network: input.network,
    chainName: input.chainName,
    asset: input.asset,
    amount: input.amount,
    payTo: input.payTo,
    settlementModel: input.settlementModel,
    description: input.description,
    preview: input.preview ?? false,
    extensions: {
      evm: {
        chainId: input.chainId,
        chainName: input.chainName,
        eip712Name: input.eip712Name,
        transferMethod: input.transferMethod ?? "EIP-3009",
        ...(input.rpcUrl ? { rpcUrl: input.rpcUrl } : {}),
        ...(input.explorer ? { explorer: input.explorer } : {}),
        ...(input.extrapolated ? { extrapolated: true } : {})
      }
    }
  };
}

export const RAILS = {
  zeko: {
    id: "zeko",
    settlementRail: "zeko",
    network: "zeko:testnet",
    chainName: "Zeko Testnet",
    asset: { symbol: "tMINA", decimals: 9, standard: "native" },
    amount: env.ZEKO_AMOUNT ?? "0.015",
    payTo: env.ZEKO_PAY_TO ?? "B62qpBXMbrKVJwcS9wQN7SpFb6jkrXn2xrntCoM6D461qL2sYZarPHi",
    settlementModel: "x402-exact-settlement-zkapp-v1",
    description: "Zeko-native settlement for ZK-authorized private compute.",
    preview: false,
    extensions: {
      zeko: {
        primitive: "zeko-exact-settlement-zkapp-v1",
        contractAddress: env.ZEKO_PAY_TO ?? "B62qpBXMbrKVJwcS9wQN7SpFb6jkrXn2xrntCoM6D461qL2sYZarPHi",
        beneficiaryAddress: env.ZEKO_BENEFICIARY ?? "B62qjxFhBZ2W1jzMyAppBkD22gGN66gTRYpX9AyaC4Kwga1kbC8zLBN",
        graphql: graphqlUrl(env.ZEKO_GRAPHQL, "https://testnet.zeko.io/graphql"),
        archive: graphqlUrl(env.ZEKO_ARCHIVE, "https://archive.testnet.zeko.io/graphql"),
        explorer: "https://zekoscan.io/testnet",
        programmablePrivacy: {
          auth: "zk-oauth-v1",
          data: "private-compute-commitment-v1",
          disclosure: "aggregate-output-only"
        },
        kernelPath: ["privateCompute.authorize", "x402Settlement.settleExact"]
      }
    }
  },
  ethereum: evmRail({
    id: "ethereum",
    network: "eip155:1",
    chainId: 1,
    chainName: "Ethereum",
    asset: {
      symbol: "USDC",
      decimals: 6,
      standard: "erc20",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    },
    amount: env.ETHEREUM_AMOUNT ?? "0.050000",
    payTo: env.ETHEREUM_PAY_TO ?? "0x2222222222222222222222222222222222222222",
    settlementModel: "x402-exact-eip3009-v1",
    description: "Ethereum mainnet USDC payment through x402 EIP-3009 authorization.",
    eip712Name: "USD Coin"
  }),
  base: evmRail({
    id: "base",
    network: "eip155:8453",
    chainId: 8453,
    chainName: "Base",
    asset: {
      symbol: "USDC",
      decimals: 6,
      standard: "erc20",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    },
    amount: env.BASE_AMOUNT ?? "0.050000",
    payTo: env.BASE_PAY_TO ?? "0x1111111111111111111111111111111111111111",
    settlementModel: "x402-exact-eip3009-v1",
    description: "Base USDC payment through x402 EIP-3009 authorization.",
    eip712Name: "USD Coin"
  }),
  arc: evmRail({
    id: "arc",
    network: "eip155:5042002",
    chainId: 5042002,
    chainName: "Arc Testnet",
    asset: { symbol: "USDC", decimals: 6, standard: "native-or-erc20" },
    amount: env.ARC_AMOUNT ?? "0.050000",
    payTo: env.ARC_PAY_TO ?? "0x3333333333333333333333333333333333333333",
    settlementModel: "x402-exact-arc-usdc-v1",
    description: "Arc testnet USDC rail extrapolated from the EVM x402 facilitator path.",
    rpcUrl: "https://rpc.testnet.arc.network",
    explorer: "https://testnet.arcscan.app",
    extrapolated: true,
    preview: true
  }),
  tempo: evmRail({
    id: "tempo",
    network: "eip155:42431",
    chainId: 42431,
    chainName: "Tempo Moderato",
    asset: { symbol: "USD", decimals: 6, standard: "native-or-erc20" },
    amount: env.TEMPO_AMOUNT ?? "0.050000",
    payTo: env.TEMPO_PAY_TO ?? "0x4444444444444444444444444444444444444444",
    settlementModel: "x402-exact-tempo-usd-v1",
    description: "Tempo rail extrapolated from the EVM x402 facilitator path.",
    rpcUrl: "https://rpc.moderato.tempo.xyz",
    explorer: "https://explore.tempo.xyz",
    extrapolated: true,
    preview: true
  })
};

export function enabledRails() {
  return [RAILS.zeko, RAILS.ethereum, RAILS.base, RAILS.arc, RAILS.tempo];
}

export function findRail(idOrNetwork) {
  return enabledRails().find((rail) => rail.id === idOrNetwork || rail.network === idOrNetwork);
}
