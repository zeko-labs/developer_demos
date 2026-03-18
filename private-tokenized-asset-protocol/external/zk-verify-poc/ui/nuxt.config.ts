// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2026-02-19",
  ssr: false,
  nitro: {
    preset: "cloudflare-module",
  },
  routeRules: {
    "/**": { prerender: true },
  },
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  modules: ["./modules/proof-output-sync"],
  proofOutputSync: {
    sourceDir: "../output",
    publicDir: "proof-data",
    includeRootMetadata: true,
  },
});
