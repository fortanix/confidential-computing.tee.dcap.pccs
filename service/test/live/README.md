# Live Intel PCS refresh test

From the repository root:

```bash
cd service
npm ci
npm run test:live
cd ..
```

This test requires Node matching the production Dockerfile (currently `24.22.0`),
local loopback sockets and HTTPS access to Intel PCS and its root-CRL host.
Docker and Rust are not required. It uses the configured PCS subscription key
when present and the existing proxy configuration/environment handling. Intel
unavailability fails this check; the ordinary `npm run test:all` suite remains
independent of live PCS access.

The test calls Intel SGX PCS directly to discover the current standard QE
evaluation number and obtain reference collateral. It starts the real PCCS
entrypoint on localhost with temporary SQLite and test token hashes, retrieves
that numbered identity through PCCS, and changes only the cached copy's issue
date to one day earlier. An HTTP request must return that seeded older copy.
Authenticated refresh must then replace it with a newer identity whose complete
payload matches Intel's response before or after refresh. Using both reference
responses permits Intel to publish updated collateral during the run.

This replaces the Compose shell check that pinned EDN 19 and expected live data
to become newer than the committed snapshot. It does not wait for Intel to
publish a new issue date: only the temporary cache is made stale. The modified
cached payload is test setup and is not used to test signature verification.
There are no mocked PCS responses, Nock dependency, IPC controls or production
code changes. The original Rust client tests continue to run in Compose:

```bash
./run_docker_compose_test.sh
```

Startup, network and shutdown waits are bounded. Cleanup stops the PCCS child,
closes the test's SQLite handle and removes the temporary database even on
failure. Reports remain in `service/test-reports/live/`: `server.log` and
`refresh.json`, with selected EDN, observed dates, refresh timestamps and cleanup
status. CI also retains Vitest JSON, install logs and run output.

The GitHub Actions `live-pcs` job runs this command separately from unit and
Compose checks. All three must pass before the non-PR image job runs.

Validation on 2026-10-15: the ordinary suite passed 21 Vitest checks including
434 Mocha cases; Compose passed all nine Rust PCCS
tests and exited 0. The live test selected EDN 20 and replaced
`2026-10-14T21:32:02.000Z` with Intel's `2026-10-15T21:32:02Z`.
