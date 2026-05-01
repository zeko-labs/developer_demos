# External App Starter

Minimal domain app showing how another service consumes Agent Mission-Bound Auth.

This app is intentionally not private compute. It exposes one domain side effect, `POST /send`, and verifies the mission checkpoint with a mission authority before doing anything.

Run the mission authority harness first:

```bash
npm start
```

Then run this starter on another port:

```bash
MISSION_AUTHORITY_URL=http://127.0.0.1:8787 EXTERNAL_APP_PORT=8790 npm run start:external-starter
```

Health:

```text
GET http://127.0.0.1:8790/health
```

Domain action:

```text
POST http://127.0.0.1:8790/send
```

The request body must include a `missionApproval` plus the action context.
