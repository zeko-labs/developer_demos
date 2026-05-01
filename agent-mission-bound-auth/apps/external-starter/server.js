import http from "node:http";
import { ZkMissionAuthClient } from "../../packages/sdk/client.js";
import { sha256Hex } from "../../packages/protocol/digest.js";

const host = process.env.EXTERNAL_APP_HOST ?? "127.0.0.1";
const port = Number(process.env.EXTERNAL_APP_PORT ?? "8790");
const missionAuthorityUrl = process.env.MISSION_AUTHORITY_URL ?? "http://127.0.0.1:8787";
const client = new ZkMissionAuthClient({ baseUrl: missionAuthorityUrl });

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function route(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);

    if (req.method === "GET" && url.pathname === "/health") {
      const discovery = await client.discover();
      sendJson(res, 200, {
        ok: true,
        service: "external-domain-starter",
        missionAuthority: missionAuthorityUrl,
        protocol: discovery.protocol
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/send") {
      const body = await readJson(req);
      const check = await client.verifyCheckpoint({
        checkpoint: "before_external_side_effect",
        approval: body.missionApproval,
        context: {
          agentId: body.agentId,
          datasetId: body.datasetId,
          operation: body.operation,
          action: "email.send",
          toDomain: String(body.to ?? "").split("@").pop() ?? "unknown"
        }
      });

      const domainReceipt = {
        version: "external-domain-receipt-v1",
        action: "email.send",
        sent: false,
        simulated: true,
        outputHash: sha256Hex({
          to: body.to,
          subject: body.subject,
          body: body.body
        }),
        enforcementReceipt: check.enforcementReceipt
      };

      sendJson(res, 200, {
        ok: true,
        message: "Mission checkpoint verified. No real email was sent.",
        domainReceipt
      });
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, {
      error: "external_app_error",
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

export function createServer() {
  return http.createServer(route);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(port, host, () => {
    console.log(`external-domain-starter listening on http://${host}:${port}`);
    console.log(`mission authority: ${missionAuthorityUrl}`);
  });
}
