/* Copyright (c) Fortanix, Inc. SPDX-License-Identifier: BSD-3-Clause */
/* eslint-disable n/no-process-env -- Isolated configuration is passed only to the test child. */
/* eslint-disable no-await-in-loop -- Poll the real server's readiness with a deadline. */
import { expect, test } from 'vitest';
import Config from 'config';
import got from 'got';
import sqlite3 from 'sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { configuredProxy, httpsProxyAgent } from '../../pcs_client/proxy.js';

const serviceRoot = fileURLToPath(new URL('../../', import.meta.url));
const pcsIdentityUrl = 'https://api.trustedservices.intel.com/sgx/certification/v4/qe/identity';
const prefix = '/sgx/certification/v4';
const hash = token => createHash('sha512').update(token).digest('hex');

async function intelIdentity(query) {
    const apiKey = String(Config.get('ApiKey') || '').trim();
    const response = await got(pcsIdentityUrl, {
        searchParams: query,
        headers:      apiKey ? { 'Ocp-Apim-Subscription-Key': apiKey } : {},
        agent:        httpsProxyAgent ? { https: httpsProxyAgent } : undefined,
        timeout:      { request: 15000 },
        retry:        { limit: 0 },
        responseType: 'json',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.enclaveIdentity.id).toBe('QE');
    expect(Number.isFinite(Date.parse(response.body.enclaveIdentity.issueDate))).toBe(true);
    return response;
}

async function unusedPort() {
    const listener = net.createServer();
    listener.listen(0, '127.0.0.1');
    try {
        await once(listener, 'listening');
        return listener.address().port;
    } finally {
        await new Promise((resolve, reject) => listener.close(error => (error ? reject(error) : resolve())));
    }
}

async function seedOlderIdentity(storage, number, payload) {
    let database;
    try {
        await new Promise((resolve, reject) => {
            database = new sqlite3.Database(storage, sqlite3.OPEN_READWRITE, error => (error ? reject(error) : resolve()));
        });
        database.configure('busyTimeout', 5000);
        await new Promise((resolve, reject) => database.run(
            "UPDATE enclave_identities SET identity=? WHERE id=1 AND version=4 AND update_type='TCBEDN' AND tcbedn=?",
            [Buffer.from(JSON.stringify(payload)), number],
            error => (error ? reject(error) : resolve())
        ));
        const changed = await new Promise((resolve, reject) => database.get(
            'SELECT changes() AS count', (error, row) => (error ? reject(error) : resolve(row.count))
        ));
        expect(changed).toBe(1);
    } finally {
        if (database) {
            await new Promise((resolve, reject) => database.close(error => (error ? reject(error) : resolve())));
        }
    }
}

test('refresh replaces a stale cached QE identity with live Intel PCS collateral', async() => {
    const reports = path.join(serviceRoot, 'test-reports/live');
    fs.mkdirSync(reports, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pccs-live-refresh-'));
    const evidence = {};
    let child;
    let exited;
    try {
        // Select an active EDN from Intel instead of retaining the retired snapshot's 19.
        const standard = await intelIdentity({ update: 'standard' });
        const number = standard.body.enclaveIdentity.tcbEvaluationDataNumber;
        expect(Number.isSafeInteger(number) && number > 0).toBe(true);
        const reference = await intelIdentity({ tcbEvaluationDataNumber: number });
        expect(reference.body.enclaveIdentity.tcbEvaluationDataNumber).toBe(number);
        evidence.evaluationNumber = number;
        evidence.intelIssueDate = reference.body.enclaveIdentity.issueDate;

        const storage = path.join(temporary, 'cache.db');
        const port = await unusedPort();
        const token = randomUUID();
        const output = fs.openSync(path.join(reports, 'server.log'), 'w');
        try {
            child = spawn(process.execPath, [path.join(serviceRoot, 'pccs_server.js')], {
                cwd:   serviceRoot,
                stdio: ['ignore', output, output],
                env:   {
                    ...process.env,
                    NODE_ENV:        'production',
                    NODE_CONFIG_DIR: path.join(serviceRoot, 'config'),
                    NODE_CONFIG:     JSON.stringify({
                        uri:                      'https://api.trustedservices.intel.com/sgx/certification/v4/',
                        ApiKey:                   String(Config.get('ApiKey') || ''),
                        proxy:                    configuredProxy,
                        USE_HTTPS:                false,
                        HTTP_PORT:                port,
                        hosts:                    '127.0.0.1',
                        DB_CONFIG:                'sqlite',
                        sqlite:                   { options: { storage } },
                        AdminTokenHash:           hash(token),
                        UserTokenHash:            hash(randomUUID()),
                        CachingFillMode:          'LAZY',
                        RefreshSchedule:          '0 0 0 1 1 *',
                        PcsRequestTimeoutSeconds: 10,
                        PcsMaxRetryCount:         0,
                    }),
                },
            });
        } finally {
            fs.closeSync(output);
        }
        let spawnError;
        child.on('error', error => {
            spawnError = error;
        });
        exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
        evidence.childPid = child.pid;
        const url = `http://127.0.0.1:${port}`;
        const local = route => got(url + route, { timeout: { request: 10000 }, retry: { limit: 0 }, responseType: 'json' });
        const deadline = Date.now() + 10000;
        let ready = false;
        while (Date.now() < deadline) {
            if (spawnError) {
                throw spawnError;
            }
            if (child.exitCode !== null || child.signalCode !== null) {
                throw new Error(`PCCS exited before readiness; see ${reports}/server.log`);
            }
            try {
                const probe = await got(`${url}/healthz/ready`, { timeout: { request: 500 }, retry: { limit: 0 } });
                ready = probe.statusCode === 200;
                if (ready) {
                    break;
                }
            } catch {
                // Startup has a bounded polling window; request failures are expected here.
            }
            await delay(100);
        }
        expect(ready, `PCCS startup timeout; see ${reports}/server.log`).toBe(true);

        const route = `${prefix}/qe/identity?tcbEvaluationDataNumber=${number}`;
        const initial = await local(route);
        expect(initial.body.enclaveIdentity.tcbEvaluationDataNumber).toBe(number);
        expect(initial.headers['sgx-enclave-identity-issuer-chain']).toContain('-----BEGIN%20CERTIFICATE-----');
        const stale = structuredClone(initial.body);
        stale.enclaveIdentity.issueDate = new Date(Date.parse(reference.body.enclaveIdentity.issueDate) - 86400000).toISOString();
        evidence.staleIssueDate = stale.enclaveIdentity.issueDate;
        // Test-only stale cache data: signature verification is outside this refresh test.
        await seedOlderIdentity(storage, number, stale);
        expect((await local(route)).body).toEqual(stale);

        const refreshStarted = Date.now();
        const refresh = await got.post(`${url}${prefix}/refresh`, {
            headers: { 'admin-token': token },
            timeout: { request: 60000 },
            retry:   { limit: 0 },
        });
        expect(refresh.statusCode).toBe(200);
        const refreshed = await local(route);
        evidence.refreshedIssueDate = refreshed.body.enclaveIdentity.issueDate;
        expect(refreshed.body.enclaveIdentity.tcbEvaluationDataNumber).toBe(number);
        expect(Date.parse(evidence.refreshedIssueDate)).toBeGreaterThan(Date.parse(evidence.staleIssueDate));
        expect(Date.parse(evidence.refreshedIssueDate)).toBeGreaterThanOrEqual(Date.parse(evidence.intelIssueDate));
        const current = await intelIdentity({ tcbEvaluationDataNumber: number });
        evidence.intelIssueDateAfterRefresh = current.body.enclaveIdentity.issueDate;
        // Accept either observed Intel snapshot if collateral rotates during the run.
        expect([reference.body, current.body]).toContainEqual(refreshed.body);
        expect(refreshed.headers['sgx-enclave-identity-issuer-chain']).toContain('-----BEGIN%20CERTIFICATE-----');
        expect((await local(route)).body).toEqual(refreshed.body);
        const health = (await local('/healthz/health')).body;
        evidence.refreshInfo = health.refresh_info.default;
        expect(Date.parse(evidence.refreshInfo.success.last_refresh_at)).toBeGreaterThanOrEqual(refreshStarted);
        expect(evidence.refreshInfo.failure).toBeNull();
        evidence.passed = true;
    } catch (error) {
        evidence.error = error.message;
        throw error;
    } finally {
        if (child && exited) {
            child.kill('SIGTERM');
            const force = setTimeout(() => child.kill('SIGKILL'), 5000);
            evidence.childExit = await exited;
            clearTimeout(force);
        }
        fs.rmSync(temporary, { recursive: true, force: true });
        evidence.temporaryDirectoryRemoved = !fs.existsSync(temporary);
        fs.writeFileSync(path.join(reports, 'refresh.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    }
});
