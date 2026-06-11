# Compose integration tests

This is the original two-container test approach from source
`89ae25e64f7b31479447d9c21caa2bdcdf00ee97`, adapted to the standalone layout.
Run it from the repository root:

```bash
./run_docker_compose_test.sh
```

Docker Engine with Compose v2+ and network access to Docker Hub, package sources,
GitHub, crates.io and Intel PCS are required. No host Rust installation is needed.

- `pccs-dev` builds the current local `service/` checkout with Node `24.22.0`,
  installs production dependencies with `npm ci`, and starts PCCS over HTTP.
  `container/pccs/Dockerfile.test` replaces the old monorepo's test stage;
  the production `service/container/Dockerfile` uses Debian 13 (slim runtime) and Node `24.22.0`.
- `container/pccs/test.json` and `test.db` retain the source configuration/data
  (only JSON trailing whitespace is normalized).
  The database is the original production-derived SQLite snapshot. PCCS upgrades
  its disposable image copy on startup; the committed snapshot is not mounted or
  modified. Test user/admin passwords remain `user_password`/`admin_password`.
- The health check now uses upstream `/healthz/ready`.
- `pccs-dev-test` builds and runs the original Rust client at
  `2d035c3cc98d45ada210d071ac64c750ac3d305d`. Its Dockerfile uses Rust `1.85.1`
  on Bookworm because the original Bullseye image's security-package downloads
  returned 404 during migration. The Cargo build uses its committed lockfile.
- `container/test_pccs/test.sh` runs the nine original ignored `pccs::` Cargo
  tests. The fixed-EDN refresh-date shell assertion has moved to a separate
  [live JavaScript test](../service/test/live/README.md), run with
  `cd service && npm run test:live`. Rust client tests remain in Compose.

The runner creates an isolated Compose project, returns the test container's
exit status using `--exit-code-from pccs-dev-test`, saves container logs in
`service/test-reports/compose/containers.log`, and removes containers/networks/
volumes on success or failure. Build caches/images remain available for reruns.
The GitHub Actions Compose job also saves the full run output as `run.log`.

To run Compose directly (clean up afterwards):

```bash
docker compose --file container/compose.yml up --build --abort-on-container-exit --exit-code-from pccs-dev-test
docker compose --file container/compose.yml down --volumes
```

`run_unittest_docker.sh`, its Dockerfile and Jenkins orchestration are not
migrated. Unit tests continue to run directly with npm in GitHub Actions.
