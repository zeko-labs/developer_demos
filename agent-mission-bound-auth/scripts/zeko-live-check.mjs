const graphql = process.env.ZEKO_GRAPHQL?.endsWith("/graphql")
  ? process.env.ZEKO_GRAPHQL
  : `${(process.env.ZEKO_GRAPHQL ?? "https://testnet.zeko.io").replace(/\/$/, "")}/graphql`;

const res = await fetch(graphql, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: "query SequencerPK { sequencerPk }" })
});

const body = await res.json();
if (!res.ok || body.errors) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  graphql,
  sequencerPk: body.data?.sequencerPk
}, null, 2));
