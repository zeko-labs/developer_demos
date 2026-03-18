# mock-server

HTTPS fixture server that simulates an employer API endpoint over TLS 1.2. Serves deterministic employee records that the TLSNotary prover connects to during attestation.

## Tasks

```bash
moon run mock-server:serve  # start the HTTPS server on localhost:4443
moon run mock-server:test   # run tests
```
