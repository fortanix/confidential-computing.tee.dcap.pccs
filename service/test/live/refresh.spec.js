/* Copyright (c) Fortanix, Inc. SPDX-License-Identifier: BSD-3-Clause */
/* eslint-disable n/no-process-env -- Isolated configuration is passed only to the test child. */
/* eslint-disable no-await-in-loop -- Poll the real server's health endpoint with a deadline. */
import { afterAll, beforeAll, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Sequelize, QueryTypes } from 'sequelize';

const serviceRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixture = path.resolve(serviceRoot, '../container/pccs/test.db');
const pcsUri = 'https://api.trustedservices.intel.com/sgx/certification/v4/';
const adminToken = randomBytes(32).toString('hex');
let directory;
let database;
let server;
let serverClosed;
let serverOutput = '';
let serverError;
let pccsUri;

async function unusedPort() {
    const listener = createServer();
    await new Promise((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', resolve);
    });
    const { port } = listener.address();
    await new Promise((resolve, reject) => {
        listener.close(error => (error ? reject(error) : resolve()));
    });
    return port;
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(150000),
    });
    if (!response.ok) {
        throw new Error(`${url} returned HTTP ${response.status}: ${await response.text()}`);
    }
    return response;
}

async function cachedIdentity(updateType, edn = -1) {
    const rows = await database.query(
        `SELECT identity FROM enclave_identities
         WHERE id=1 AND version=4 AND update_type=$updateType AND tcbedn=$edn`,
        { bind: { updateType, edn }, type: QueryTypes.SELECT },
    );
    expect(rows).toHaveLength(1);
    return JSON.parse(rows[0].identity.toString());
}

async function retiredQeIdentityRows() {
    return database.query(
        `SELECT tcbedn FROM enclave_identities
         WHERE id=1 AND version=4 AND update_type='TCBEDN' AND tcbedn IN (17, 18, 19)
         ORDER BY tcbedn`,
        { type: QueryTypes.SELECT },
    );
}

beforeAll(async() => {
    directory = await mkdtemp(path.join(tmpdir(), 'pccs-refresh-live-'));
    const storage = path.join(directory, 'cache.db');
    await copyFile(fixture, storage);
    // PCCS resolves migrations relative to its working directory.
    await symlink(path.join(serviceRoot, 'migrations'), path.join(directory, 'migrations'), 'dir');
    const port = await unusedPort();
    pccsUri = `http://127.0.0.1:${port}/sgx/certification/v4/`;
    const config = {
        USE_HTTPS:         false,
        HTTP_PORT:         port,
        hosts:             '127.0.0.1',
        uri:               pcsUri,
        ApiKey:            '',
        proxy:             '',
        CachingFillMode:   'LAZY',
        OPENSSL_FIPS_MODE: false,
        RefreshSchedule:   '0 0 1 1 *',
        AdminTokenHash:    createHash('sha512').update(adminToken).digest('hex'),
        UserTokenHash:     createHash('sha512').update(randomBytes(32)).digest('hex'),
        DB_CONFIG:         'sqlite',
        sqlite:            { options: { dialect: 'sqlite', storage, logging: false } },
        LogLevel:          'error',
    };
    server = spawn(process.execPath, [path.join(serviceRoot, 'pccs_server.js')], {
        cwd:   directory,
        stdio: ['ignore', 'pipe', 'pipe'],
        env:   {
            ...process.env,
            NODE_ENV:        'production',
            NODE_CONFIG_DIR: path.join(serviceRoot, 'config'),
            NODE_CONFIG:     JSON.stringify(config),
        },
    });
    serverClosed = new Promise(resolve => server.once('close', resolve));
    server.on('error', error => {
        serverError = error;
    });
    const appendOutput = data => {
        serverOutput = (serverOutput + data).slice(-16000);
    };
    for (const stream of [server.stdout, server.stderr]) {
        stream.on('data', appendOutput);
    }

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        if (serverError || server.exitCode !== null || server.signalCode !== null) {
            throw new Error(`PCCS startup failed: ${serverError || serverOutput}`);
        }
        try {
            const response = await fetch(`${pccsUri}health`, { signal: AbortSignal.timeout(1000) });
            if (response.ok) {
                database = new Sequelize({ dialect: 'sqlite', storage, logging: false });
                return;
            }
        } catch {
            // Retry while the child process initializes its database and listener.
        }
        await delay(100);
    }
    throw new Error(`PCCS did not become ready:\n${serverOutput}`);
});

afterAll(async() => {
    try {
        if (server && server.exitCode === null && server.signalCode === null) {
            const forceKill = setTimeout(() => server.kill('SIGKILL'), 5000);
            try {
                server.kill('SIGTERM');
                await serverClosed;
            } finally {
                clearTimeout(forceKill);
            }
        }
    } finally {
        try {
            await database?.close();
        } finally {
            if (directory) {
                await rm(directory, { recursive: true, force: true });
            }
        }
    }
});

test('refresh updates live identities and health timestamps and removes retired cached QE EDNs', async() => {
    const endpoint = 'qe/identity?update=standard';
    const original = await cachedIdentity('STANDARD');
    expect(Number.isFinite(Date.parse(original.enclaveIdentity.issueDate))).toBe(true);
    const cached = await (await request(pccsUri + endpoint)).json();
    expect(cached).toEqual(original);

    expect((await retiredQeIdentityRows()).map(row => row.tcbedn)).toEqual([17, 18, 19]);
    const refreshStarted = Date.now();
    await request(`${pccsUri}refresh`, { headers: { 'admin-token': adminToken } });
    expect(await retiredQeIdentityRows()).toEqual([]);
    const health = await (await request(`${pccsUri}health`)).json();
    const refreshedAt = Date.parse(health.refresh_info.default.success.last_refresh_at);
    expect(refreshedAt).toBeGreaterThanOrEqual(refreshStarted);
    expect(refreshedAt).toBeLessThanOrEqual(Date.now());
    const refreshed = await (await request(pccsUri + endpoint)).json();
    const upstream = await (await request(pcsUri + endpoint)).json();
    expect(refreshed).toEqual(upstream);
    expect(Date.parse(refreshed.enclaveIdentity.issueDate)).toBeGreaterThan(
        Date.parse(original.enclaveIdentity.issueDate),
    );
    expect(await cachedIdentity('STANDARD')).toEqual(refreshed);

    const edn = refreshed.enclaveIdentity.tcbEvaluationDataNumber;
    const fixedEndpoint = `qe/identity?tcbEvaluationDataNumber=${edn}`;
    const fixedIdentity = await (await request(pccsUri + fixedEndpoint)).json();
    const fixedUpstream = await (await request(pcsUri + fixedEndpoint)).json();
    expect(fixedIdentity).toEqual(fixedUpstream);
    expect(await cachedIdentity('TCBEDN', edn)).toEqual(fixedIdentity);
});
