# Live refresh tests

From the repository root:

```sh
cd service
npm ci
npm run test:live
cd ..
```

This requires the normal PCCS runtime prerequisites and HTTPS access to Intel PCS.

The tests start isolated PCCS with a temporary copy of `container/pccs/test.db`
and a randomly generated admin token.

The test verifies PCCS initially serves the fixture's cached standard QE
identity, then requires an authenticated refresh to replace it with live PCS
data. The refreshed identity must persist in SQLite and have a strictly newer
issue date than the fixture value. It also verifies the fixed-EDN cache entry
created by refresh matches PCS and is persisted in SQLite.
