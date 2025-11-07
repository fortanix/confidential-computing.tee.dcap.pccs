/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import esmock from 'esmock';
import { expect } from 'chai';
import assert from 'assert/strict';
import sinon from 'sinon';
import PccsStatus from '../constants/pccs_status_code.js';
import Constants from '../constants/index.js';
import * as responseBodyUtil from '../utils/responseBody.js';

const FMSPC        = 'AABBCCDDEEFF';
const CA_TYPE      = 'PROCESSOR';
const QEID         = 'A'.repeat(32);
const CPUSVN       = 'B'.repeat(32);
const PCESVN       = 'C'.repeat(4);
const PCEID        = 'D'.repeat(4);
const ENC_PPID     = 'E'.repeat(768);
const TCBM         = 'FF'.repeat(18);
const CERT_PEM     = 'CERT_DATA';
const ISSUER_CHAIN = 'issuer-chain';
const CRL_DATA     = Buffer.from('crl-data');
const CDP_URI      = 'https://certificates.trustedservices.intel.com/IntelSGXRootCA.crl';

class MockPccsError extends Error {
    constructor(obj) {
        super(obj[1]);
        this.status = obj[0];
    }
}

function makePlatformTcb() {
    return { qe_id: QEID, pce_id: PCEID, cpu_svn: CPUSVN, pce_svn: PCESVN, fmspc: FMSPC };
}

function makePlatform({ manifest = null } = {}) {
    return { enc_ppid: ENC_PPID, platform_manifest: manifest };
}

function makeDbTcb() {
    return { type: Constants.PROD_TYPE_SGX, fmspc: FMSPC, version: 4, update_type: Constants.UPDATE_TYPE_STANDARD };
}

function makeRootCa() {
    return { id: Constants.ROOT_CERT_ID, cert: encodeURIComponent(CERT_PEM) };
}

function makeCertResponse(statusCode = Constants.HTTP_SUCCESS) {
    return {
        statusCode,
        body:    JSON.stringify([{ tcbm: TCBM, cert: encodeURIComponent(CERT_PEM) }]),
        headers: {
            [Constants.SGX_PCK_CERTIFICATE_ISSUER_CHAIN]: ISSUER_CHAIN,
            [Constants.SGX_FMSPC]:                        FMSPC,
            [Constants.SGX_PCK_CERTIFICATE_CA_TYPE]:      CA_TYPE
        }
    };
}

function makeTcbResponse(statusCode = Constants.HTTP_SUCCESS) {
    const body = JSON.stringify({ tcbInfo: { version: 3 } });
    return {
        statusCode,
        rawBody: Buffer.from(body),
        body,
        headers: { 'TCB-Info-Issuer-Chain': ISSUER_CHAIN }
    };
}

function makeCrlResponse(statusCode = Constants.HTTP_SUCCESS) {
    return {
        statusCode,
        body:    CRL_DATA,
        rawBody: CRL_DATA,
        headers: { [Constants.SGX_PCK_CRL_ISSUER_CHAIN]: ISSUER_CHAIN }
    };
}

function makeIdentityResponse(statusCode = Constants.HTTP_SUCCESS) {
    return {
        statusCode,
        body:    'identity-data',
        rawBody: Buffer.from('identity-data'),
        headers: { [Constants.SGX_ENCLAVE_IDENTITY_ISSUER_CHAIN]: ISSUER_CHAIN }
    };
}

class TestContext {
    constructor() {
        global.PCS_VERSION = 4;
        this.config = {
            get: sinon.stub().callsFake(key => (key === 'DB_CONFIG' ? 'sqlite' : undefined))
        };

        this.timestampDao = { REFRESH_TYPE: { CERTS: 'certs', DEFAULT: 'default' }, upsertCacheTimestamp: sinon.stub().resolves() };
        this.ednDao = { upsertTcbEvalDataNumbers: sinon.stub().resolves() };
        this.pcsClient = {
            getTcbEvalDataNumbers: sinon.stub().resolves({ statusCode: 200, body: 'edn', headers: { 'tcb-evaluation-data-numbers-issuer-chain': 'edn-issuer-chain' } }),
            getCerts:             sinon.stub().resolves(makeCertResponse()),
            getCertsWithManifest: sinon.stub().resolves(makeCertResponse()),
            getPckCrl:            sinon.stub().resolves(makeCrlResponse()),
            getTcb:               sinon.stub().resolves(makeTcbResponse()),
            getEnclaveIdentity:   sinon.stub().resolves(makeIdentityResponse()),
            getFileFromUrl:       sinon.stub().resolves(CRL_DATA),
            getHeaderValue:       sinon.stub().callsFake((headers, key) => headers[key])
        };

        this.pckcertDao = {
            deleteCerts:   sinon.stub().resolves(),
            upsertPckCert: sinon.stub().resolves()
        };
        this.enclaveIdentityDao = {
            upsertEnclaveIdentity: sinon.stub().resolves()
        };
        this.pckcrlDao = {
            getAllPckCrls: sinon.stub().resolves([{ ca: Constants.CA_PROCESSOR }]),
            upsertPckCrl:  sinon.stub().resolves()
        };
        this.platformTcbsDao = {
            getPlatformTcbs:    sinon.stub().resolves([makePlatformTcb()]),
            upsertPlatformTcbs: sinon.stub().resolves()
        };
        this.platformsDao = {
            getPlatform: sinon.stub().resolves(makePlatform())
        };
        this.fmspcTcbDao = {
            getAllTcbs:        sinon.stub().resolves([makeDbTcb()]),
            upsertFmspcTcb:    sinon.stub().resolves(),
            deleteInvalidTcbs: sinon.stub().resolves()
        };
        this.pckCertchainDao = {
            upsertPckCertchain: sinon.stub().resolves()
        };
        this.pcsCertificatesDao = {
            getCertificateById:               sinon.stub().resolves(makeRootCa()),
            upsertPcsCertificates:            sinon.stub().resolves(),
            upsertPckCrlCertchain:            sinon.stub().resolves(),
            upsertTcbInfoIssuerChain:         sinon.stub().resolves(),
            upsertEnclaveIdentityIssuerChain: sinon.stub().resolves(),
            upsertPckCertificateIssuerChain:  sinon.stub().resolves()
        };
        this.crlCacheDao = {
            getAllCrls: sinon.stub().resolves([{ cdp_url: CDP_URI }]),
            upsertCrl:  sinon.stub().resolves()
        };

        this.sequelize = {
            transaction: sinon.stub().callsFake(fn => fn())
        };

        this.cachingModeManager = {
            isRefreshable: sinon.stub().returns(true)
        };

        this.selectBestPckCert = sinon.stub().returns({ pck_cert: CERT_PEM, tcbm: TCBM });

        this.x509Instance = {
            parseCert: sinon.stub().returns(true),
            cdpUri:    CDP_URI
        };
        this.X509 = sinon.stub().returns(this.x509Instance);

        this.apputil = {
            getTcbInfoIssuerChainName: sinon.stub().returns('TCB-Info-Issuer-Chain'),
            isValidCrlUri:             sinon.stub().returns(true)
        };

        this.logger = {
            error: sinon.stub(),
            info:  sinon.stub(),
            debug: sinon.stub(),
            warn:  sinon.stub()
        };
    }

    async getTarget() {
        return esmock.strict('./refreshService.js', {
            '../dao/tcbEvalDataNumbersDao.js': this.ednDao,
            '../dao/cacheTimestampDao.js': this.timestampDao,
            '../utils/PccsError.js':                   { 'default': MockPccsError },
            '../constants/pccs_status_code.js':        { 'default': PccsStatus },
            '../constants/index.js':                   { 'default': Constants },
            '../utils/Logger.js':                      { 'default': this.logger },
            '../utils/responseBody.js':                responseBodyUtil,
            '../x509/x509.js':                         { 'default': this.X509 },
            '../dao/pckcertDao.js':                    this.pckcertDao,
            '../dao/enclaveIdentityDao.js':            this.enclaveIdentityDao,
            '../dao/pckcrlDao.js':                     this.pckcrlDao,
            '../dao/platformTcbsDao.js':               this.platformTcbsDao,
            '../dao/platformsDao.js':                  this.platformsDao,
            '../dao/fmspcTcbDao.js':                   this.fmspcTcbDao,
            '../dao/pckCertchainDao.js':               this.pckCertchainDao,
            '../dao/pcsCertificatesDao.js':            this.pcsCertificatesDao,
            '../dao/crlCacheDao.js':                   this.crlCacheDao,
            '../pcs_client/pcs_client.js':             this.pcsClient,
            '../utils/apputil.js':                     this.apputil,
            'config':                                  { 'default': this.config },
            '../dao/models/index.js':                  { sequelize: this.sequelize },
            './caching_modes/cachingModeManager.js':   { cachingModeManager: this.cachingModeManager },
            '../pckCertSelection/pckCertSelection.js': { selectBestPckCert: this.selectBestPckCert }
        });
    }
}

function createDeferred() {
    let resolve;
    const promise = new Promise(res => {
        resolve = res;
    });
    return { promise, resolve };
}

function rejectsWithStatus(fn, statusTuple) {
    return assert.rejects(fn, err => err.status === statusTuple[0]);
}

describe('refreshService', () => {

    afterEach(() => {
        delete global.PCS_VERSION;
    });

    describe('refreshCache — type=certs', () => {
        it('throws SERVICE_UNAVAILABLE when not refreshable', async() => {
            const c = new TestContext();
            c.cachingModeManager.isRefreshable.returns(false);
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('certs', FMSPC),
                PccsStatus.PCCS_STATUS_SERVICE_UNAVAILABLE
            );
        });

        it('logs warning and makes no HTTP calls when PCS_VERSION <= 3', async() => {
            const c = new TestContext();
            global.PCS_VERSION = 3;
            const { refreshCache } = await c.getTarget();

            await refreshCache('certs', FMSPC);

            expect(c.pcsClient.getCerts.notCalled).to.be.true;
            expect(c.pcsClient.getCertsWithManifest.notCalled).to.be.true;
            expect(c.logger.warn.calledOnce).to.be.true;
        });

        it('does not leak the coalescing lock when no await in body', async() => {
            const c = new TestContext();
            global.PCS_VERSION = 3;
            const { refreshCache } = await c.getTarget();

            await refreshCache('certs', FMSPC);
            global.PCS_VERSION = 4;
            await refreshCache('certs', FMSPC);

            expect(c.pcsClient.getCerts.calledOnce).to.be.true;
        });

        it('uses getCerts when platform has no manifest', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('certs', FMSPC);

            expect(c.pcsClient.getCerts.calledOnceWith(ENC_PPID, PCEID)).to.be.true;
            expect(c.pcsClient.getCertsWithManifest.notCalled).to.be.true;
        });

        it('uses getCertsWithManifest when platform has a manifest', async() => {
            const c = new TestContext();
            c.platformsDao.getPlatform.resolves(makePlatform({ manifest: 'MANIFEST' }));
            const { refreshCache } = await c.getTarget();

            await refreshCache('certs', FMSPC);

            expect(c.pcsClient.getCertsWithManifest.calledOnceWith('MANIFEST', PCEID)).to.be.true;
            expect(c.pcsClient.getCerts.notCalled).to.be.true;
        });

        it('throws NO_CACHE_DATA when cert server returns non-200', async() => {
            const c = new TestContext();
            c.pcsClient.getCerts.resolves(makeCertResponse(503));
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('certs', FMSPC),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('throws NO_CACHE_DATA when cert body is empty', async() => {
            const c = new TestContext();
            const res = makeCertResponse();
            res.body = JSON.stringify([]);
            c.pcsClient.getCerts.resolves(res);
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('certs', FMSPC),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('throws NO_CACHE_DATA when TCB server returns non-200', async() => {
            const c = new TestContext();
            c.pcsClient.getTcb.resolves(makeTcbResponse(503));
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('certs', FMSPC),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('throws NO_CACHE_DATA when selectBestPckCert throws', async() => {
            const c = new TestContext();
            c.selectBestPckCert.throws(new Error('selection failed'));
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('certs', FMSPC),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('persists deleteCerts, upsertPckCert and upsertPlatformTcbs inside a transaction', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('certs', FMSPC);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
            expect(c.pckcertDao.deleteCerts.calledOnceWith(QEID, PCEID)).to.be.true;
            expect(c.pckcertDao.upsertPckCert.calledOnceWith(QEID, PCEID, TCBM, CERT_PEM)).to.be.true;
            expect(c.platformTcbsDao.upsertPlatformTcbs.calledOnceWith(QEID, PCEID, CPUSVN, PCESVN, TCBM)).to.be.true;
        });

        it('upserts pckCertchain and issuer chain when the header is present', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('certs', FMSPC);

            expect(c.pckCertchainDao.upsertPckCertchain.calledOnceWith(CA_TYPE)).to.be.true;
            expect(c.pcsCertificatesDao.upsertPckCertificateIssuerChain.calledOnceWith(CA_TYPE, ISSUER_CHAIN)).to.be.true;
        });

        it('skips pckCertchain upsert when the issuer-chain header is absent', async() => {
            const c = new TestContext();
            const res = makeCertResponse();
            delete res.headers[Constants.SGX_PCK_CERTIFICATE_ISSUER_CHAIN];
            c.pcsClient.getCerts.resolves(res);
            const { refreshCache } = await c.getTarget();

            await refreshCache('certs', FMSPC);

            expect(c.pckCertchainDao.upsertPckCertchain.notCalled).to.be.true;
            expect(c.pcsCertificatesDao.upsertPckCertificateIssuerChain.notCalled).to.be.true;
        });

        it('coalesces concurrent calls for the same fmspc key', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            const p1 = refreshCache('certs', FMSPC);
            const p2 = refreshCache('certs', FMSPC);

            await Promise.all([p1, p2]);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
        });

        it('does not coalesce calls for different fmspc keys', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('certs', FMSPC);
            await refreshCache('certs', 'FFFFFFFFFFFF');

            expect(c.sequelize.transaction.calledTwice).to.be.true;
        });

        it('removes the coalescing lock after successful completion', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('certs', FMSPC);
            await refreshCache('certs', FMSPC);

            expect(c.sequelize.transaction.calledTwice).to.be.true;
        });

        it('removes the coalescing lock even when an error occurs', async() => {
            const c = new TestContext();
            c.pcsClient.getCerts.resolves(makeCertResponse(503));
            const { refreshCache } = await c.getTarget();

            await assert.rejects(() => refreshCache('certs', FMSPC));

            c.pcsClient.getCerts.resolves(makeCertResponse());
            await refreshCache('certs', FMSPC);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
        });
    });

    describe('refreshCache — SQLite cross-key transaction serialization', () => {
        // Wraps an async implementation with a brief delay and tracks the max number of concurrently
        // in-flight wrapped calls, so overlap is observable even when the real DB stubs resolve instantly.
        function trackConcurrency() {
            let active = 0;
            let maxActive = 0;
            function wrap(impl) {
                return async(...args) => {
                    active++;
                    maxActive = Math.max(maxActive, active);
                    try {
                        await new Promise(resolve => setTimeout(resolve, 10));
                        return await impl(...args);
                    } finally {
                        active--;
                    }
                };
            }
            return { wrap, getMaxActive: () => maxActive };
        }

        it('serializes transactions for different fmspc keys when DB_CONFIG=sqlite', async() => {
            const c = new TestContext();
            const { wrap, getMaxActive } = trackConcurrency();
            c.sequelize.transaction = sinon.stub().callsFake(wrap(fn => fn()));
            const { refreshCache } = await c.getTarget();

            await Promise.all([
                refreshCache('certs', FMSPC),
                refreshCache('certs', 'FFFFFFFFFFFF'),
            ]);

            expect(getMaxActive()).to.equal(1);
            expect(c.sequelize.transaction.calledTwice).to.be.true;
        });

        it('serializes a certs refresh and a collateral refresh when DB_CONFIG=sqlite', async() => {
            const c = new TestContext();
            const { wrap, getMaxActive } = trackConcurrency();
            c.sequelize.transaction = sinon.stub().callsFake(wrap(fn => fn()));
            const { refreshCache } = await c.getTarget();

            await Promise.all([
                refreshCache('certs', FMSPC),
                refreshCache('collateral', undefined),
            ]);

            expect(getMaxActive()).to.equal(1);
        });

        it('logs the queue wait duration for the transaction that had to wait', async() => {
            const c = new TestContext();
            const { wrap, getMaxActive } = trackConcurrency();
            c.sequelize.transaction = sinon.stub().callsFake(wrap(fn => fn()));
            const { refreshCache } = await c.getTarget();

            await Promise.all([
                refreshCache('certs', FMSPC),
                refreshCache('certs', 'FFFFFFFFFFFF'),
            ]);

            expect(getMaxActive()).to.equal(1);
            const queueWaitLogs = c.logger.info.getCalls()
                .map(call => call.args[0])
                .filter(message => message.includes('SQLite write queue wait durationMs='));
            // Two cert FMSPC refreshes. Each queues one certificate transaction and one timestamp write.
            expect(queueWaitLogs.length).to.equal(4);
        });

        it('still serializes the next transaction after one fails', async() => {
            const c = new TestContext();
            const { wrap, getMaxActive } = trackConcurrency();
            let callCount = 0;
            c.sequelize.transaction = sinon.stub().callsFake(wrap(async fn => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('simulated transaction failure');
                }
                return fn();
            }));
            const { refreshCache } = await c.getTarget();

            const failing = refreshCache('certs', FMSPC);
            const succeeding = refreshCache('certs', 'FFFFFFFFFFFF');

            await assert.rejects(() => failing);
            await succeeding;

            expect(getMaxActive()).to.equal(1);
            expect(c.sequelize.transaction.calledTwice).to.be.true;
        });

        it('serializes the collateral cleanupInvalidTcbs write against a concurrent certs transaction when DB_CONFIG=sqlite', async() => {
            const c = new TestContext();
            const { wrap, getMaxActive } = trackConcurrency();
            c.fmspcTcbDao.deleteInvalidTcbs = sinon.stub().callsFake(wrap(async() => {}));
            c.sequelize.transaction = sinon.stub().callsFake(wrap(fn => fn()));
            const { refreshCache } = await c.getTarget();

            await Promise.all([
                refreshCache('certs', FMSPC),
                refreshCache('collateral', undefined),
            ]);

            expect(getMaxActive()).to.equal(1);
            expect(c.fmspcTcbDao.deleteInvalidTcbs.calledOnce).to.be.true;
            expect(c.sequelize.transaction.called).to.be.true;
            // cleanup must still precede the collateral fetch phase even while queued behind the certs transaction
            expect(c.fmspcTcbDao.deleteInvalidTcbs.calledBefore(c.fmspcTcbDao.getAllTcbs)).to.be.true;
        });

        it('does not serialize transactions when DB_CONFIG is not sqlite', async() => {
            const c = new TestContext();
            c.config.get = sinon.stub().callsFake(key => (key === 'DB_CONFIG' ? 'mysql' : undefined));
            const { wrap, getMaxActive } = trackConcurrency();
            c.sequelize.transaction = sinon.stub().callsFake(wrap(fn => fn()));
            const { refreshCache } = await c.getTarget();

            await Promise.all([
                refreshCache('certs', FMSPC),
                refreshCache('certs', 'FFFFFFFFFFFF'),
            ]);

            expect(getMaxActive()).to.equal(2);
        });
    });

    describe('refreshCache — type=collateral (full refresh)', () => {
        it('throws SERVICE_UNAVAILABLE when not refreshable', async() => {
            const c = new TestContext();
            c.cachingModeManager.isRefreshable.returns(false);
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('collateral', undefined),
                PccsStatus.PCCS_STATUS_SERVICE_UNAVAILABLE
            );
        });

        it('calls cleanupInvalidTcbs (deleteInvalidTcbs) before fetching', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.fmspcTcbDao.deleteInvalidTcbs.calledOnce).to.be.true;
            // cleanup must precede any fetch; getTcb is called during fetch phase
            expect(c.fmspcTcbDao.deleteInvalidTcbs.calledBefore(c.pcsClient.getTcb)).to.be.true;
        });

        it('fetches PCK CRLs, TCBs, and enclave identities when PCS_VERSION > 3', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.pckcrlDao.getAllPckCrls.calledOnce).to.be.true;
            expect(c.fmspcTcbDao.getAllTcbs.calledOnce).to.be.true;
            expect(c.pcsClient.getEnclaveIdentity.called).to.be.true;
        });

        it('skips PCK CRL/TCB/identity fetch when PCS_VERSION <= 3', async() => {
            const c = new TestContext();
            global.PCS_VERSION = 3;
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.pckcrlDao.getAllPckCrls.notCalled).to.be.true;
            expect(c.fmspcTcbDao.getAllTcbs.notCalled).to.be.true;
            expect(c.pcsClient.getEnclaveIdentity.notCalled).to.be.true;
            expect(c.logger.warn.called).to.be.true;
        });

        it('always fetches rootca CRL and cached CRLs regardless of PCS_VERSION', async() => {
            const c = new TestContext();
            global.PCS_VERSION = 3;
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.pcsCertificatesDao.getCertificateById.calledOnce).to.be.true;
            expect(c.crlCacheDao.getAllCrls.calledOnce).to.be.true;
        });

        it('throws INTERNAL_ERROR when rootca is not in the database', async() => {
            const c = new TestContext();
            c.pcsCertificatesDao.getCertificateById.resolves(null);
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('collateral', undefined),
                PccsStatus.PCCS_STATUS_INTERNAL_ERROR
            );
        });

        it('throws INTERNAL_ERROR when rootca cert fails parseCert', async() => {
            const c = new TestContext();
            c.x509Instance.parseCert.returns(false);
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('collateral', undefined),
                PccsStatus.PCCS_STATUS_INTERNAL_ERROR
            );
        });

        it('throws INTERNAL_ERROR when parseCert succeeds but cdpUri is falsy', async() => {
            const c = new TestContext();
            c.x509Instance.parseCert.returns(true);
            c.x509Instance.cdpUri = null;
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('collateral', undefined),
                PccsStatus.PCCS_STATUS_INTERNAL_ERROR
            );
        });

        it('throws INTERNAL_ERROR when rootca CDP URI fails isValidCrlUri', async() => {
            const c = new TestContext();
            c.apputil.isValidCrlUri.returns(false);
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('collateral', undefined),
                PccsStatus.PCCS_STATUS_INTERNAL_ERROR
            );
        });

        it('skips cached CRL entries with invalid URIs', async() => {
            const c = new TestContext();
            // isValidCrlUri: false for cdp_url in cached CRL, true for rootca URI
            c.apputil.isValidCrlUri
                .onFirstCall().returns(true)  // rootca
                .returns(false);              // cached CRL entry
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.crlCacheDao.upsertCrl.notCalled).to.be.true;
        });

        it('throws SERVICE_UNAVAILABLE when a PCK CRL download fails', async() => {
            const c = new TestContext();
            c.pcsClient.getPckCrl.resolves(makeCrlResponse(503));
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('collateral', undefined),
                PccsStatus.PCCS_STATUS_SERVICE_UNAVAILABLE
            );
        });

        it('throws SERVICE_UNAVAILABLE when a TCB download fails', async() => {
            const c = new TestContext();
            c.pcsClient.getTcb.resolves(makeTcbResponse(503));
            const { refreshCache } = await c.getTarget();

            await rejectsWithStatus(
                () => refreshCache('collateral', undefined),
                PccsStatus.PCCS_STATUS_SERVICE_UNAVAILABLE
            );
        });

        it('logs warning for version-3 TCBs and excludes them from download', async() => {
            const c = new TestContext();
            c.fmspcTcbDao.getAllTcbs.resolves([
                { type: Constants.PROD_TYPE_SGX, fmspc: FMSPC, version: 3, update_type: Constants.UPDATE_TYPE_STANDARD },
                makeDbTcb()
            ]);
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.logger.warn.called).to.be.true;
            expect(c.pcsClient.getTcb.calledOnce).to.be.true;
        });

        it('persists rootca CRL via upsertPcsCertificates inside transaction', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
            expect(c.pcsCertificatesDao.upsertPcsCertificates.calledOnce).to.be.true;
            const arg = c.pcsCertificatesDao.upsertPcsCertificates.firstCall.args[0];
            expect(arg.id).to.equal(Constants.ROOT_CERT_ID);
            expect(arg.crl).to.deep.equal(CRL_DATA);
        });

        it('persists cached CRLs via upsertCrl inside transaction', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.crlCacheDao.upsertCrl.calledOnceWith(CDP_URI, CRL_DATA)).to.be.true;
        });

        it('persists cached CRLs in parallel for mysql', async() => {
            const c = new TestContext();
            c.config.get.withArgs('DB_CONFIG').returns('mysql');
            c.crlCacheDao.getAllCrls.resolves([
                { cdp_url: CDP_URI },
                { cdp_url: 'https://certificates.trustedservices.intel.com/IntelSGXRootCA2.crl' }
            ]);

            const firstWrite = createDeferred();
            const secondWrite = createDeferred();
            const secondStarted = createDeferred();
            c.crlCacheDao.upsertCrl.onFirstCall().callsFake(async() => await firstWrite.promise);
            c.crlCacheDao.upsertCrl.onSecondCall().callsFake(async() => {
                secondStarted.resolve();
                await secondWrite.promise;
            });

            const { refreshCache } = await c.getTarget();
            const refreshPromise = refreshCache('collateral', undefined);

            await secondStarted.promise;

            expect(c.crlCacheDao.upsertCrl.callCount).to.equal(2);

            firstWrite.resolve();
            secondWrite.resolve();
            await refreshPromise;
        });

        it('persists PCK CRLs via upsertPckCrl and upsertPckCrlCertchain inside transaction', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.pckcrlDao.upsertPckCrl.calledOnceWith(Constants.CA_PROCESSOR, CRL_DATA)).to.be.true;
            expect(c.pcsCertificatesDao.upsertPckCrlCertchain.calledOnce).to.be.true;
        });

        it('persists PCK CRLs in parallel for mysql', async() => {
            const c = new TestContext();
            c.config.get.withArgs('DB_CONFIG').returns('mysql');
            c.pckcrlDao.getAllPckCrls.resolves([
                { ca: Constants.CA_PROCESSOR },
                { ca: Constants.CA_PLATFORM }
            ]);

            const firstWrite = createDeferred();
            const secondWrite = createDeferred();
            const secondStarted = createDeferred();
            c.pckcrlDao.upsertPckCrl.onFirstCall().callsFake(async() => await firstWrite.promise);
            c.pckcrlDao.upsertPckCrl.onSecondCall().callsFake(async() => {
                secondStarted.resolve();
                await secondWrite.promise;
            });

            const { refreshCache } = await c.getTarget();
            const refreshPromise = refreshCache('collateral', undefined);

            await secondStarted.promise;

            expect(c.pckcrlDao.upsertPckCrl.callCount).to.equal(2);

            firstWrite.resolve();
            secondWrite.resolve();
            await refreshPromise;
        });

        it('persists TCB info and issuer chain via upsertFmspcTcb and upsertTcbInfoIssuerChain', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.fmspcTcbDao.upsertFmspcTcb.calledOnce).to.be.true;
            const arg = c.fmspcTcbDao.upsertFmspcTcb.firstCall.args[0];
            expect(arg.type).to.equal(Constants.PROD_TYPE_SGX);
            expect(arg.fmspc).to.equal(FMSPC);
            expect(arg.version).to.equal(4);
            expect(arg.update_type).to.equal(Constants.UPDATE_TYPE_STANDARD);
            const tcbChains = c.pcsCertificatesDao.upsertTcbInfoIssuerChain.getCalls()
                .filter(call => call.args[0] === ISSUER_CHAIN);
            expect(tcbChains).to.have.length(1);
        });

        it('skips upsertEnclaveIdentity for failed identity fetches', async() => {
            const c = new TestContext();
            // first of the 6 identity fetches returns non-200
            c.pcsClient.getEnclaveIdentity
                .onFirstCall().resolves(makeIdentityResponse(500))
                .resolves(makeIdentityResponse());
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.enclaveIdentityDao.upsertEnclaveIdentity.callCount).to.equal(5);
        });

        it('still upserts the identity issuer chain when at least one identity succeeds', async() => {
            const c = new TestContext();
            c.pcsClient.getEnclaveIdentity
                .onFirstCall().resolves(makeIdentityResponse(500))
                .resolves(makeIdentityResponse());
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.pcsCertificatesDao.upsertEnclaveIdentityIssuerChain.calledOnce).to.be.true;
        });

        it('persists enclave identities in parallel for mysql', async() => {
            const c = new TestContext();
            c.config.get.withArgs('DB_CONFIG').returns('mysql');

            const firstWrite = createDeferred();
            const secondWrite = createDeferred();
            const secondStarted = createDeferred();
            c.enclaveIdentityDao.upsertEnclaveIdentity.onFirstCall().callsFake(async() => await firstWrite.promise);
            c.enclaveIdentityDao.upsertEnclaveIdentity.onSecondCall().callsFake(async() => {
                secondStarted.resolve();
                await secondWrite.promise;
            });

            const { refreshCache } = await c.getTarget();
            const refreshPromise = refreshCache('collateral', undefined);

            await secondStarted.promise;

            expect(c.enclaveIdentityDao.upsertEnclaveIdentity.callCount).to.be.greaterThan(1);

            firstWrite.resolve();
            secondWrite.resolve();
            await refreshPromise;
        });

        it('does not upsert identity issuer chain when all identity fetches fail', async() => {
            const c = new TestContext();
            c.pcsClient.getEnclaveIdentity.resolves(makeIdentityResponse(500));
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);

            expect(c.enclaveIdentityDao.upsertEnclaveIdentity.notCalled).to.be.true;
            expect(c.pcsCertificatesDao.upsertEnclaveIdentityIssuerChain.notCalled).to.be.true;
        });

        it('coalesces concurrent calls for the same key', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            const p1 = refreshCache('collateral', undefined);
            const p2 = refreshCache('collateral', undefined);

            await Promise.all([p1, p2]);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
        });

        it('persists PCK cert writes in parallel for mysql after delete', async() => {
            const c = new TestContext();
            c.config.get.withArgs('DB_CONFIG').returns('mysql');
            c.platformTcbsDao.getPlatformTcbs.resolves([
                makePlatformTcb(),
                { ...makePlatformTcb(), qe_id: '1'.repeat(32), pce_id: '2'.repeat(4) }
            ]);

            const firstDelete = createDeferred();
            const secondDelete = createDeferred();
            const secondDeleteStarted = createDeferred();
            c.pckcertDao.deleteCerts.onFirstCall().callsFake(async() => await firstDelete.promise);
            c.pckcertDao.deleteCerts.onSecondCall().callsFake(async() => {
                secondDeleteStarted.resolve();
                await secondDelete.promise;
            });

            const { refreshCache } = await c.getTarget();
            const refreshPromise = refreshCache('certs', FMSPC);

            await secondDeleteStarted.promise;

            expect(c.pckcertDao.deleteCerts.callCount).to.equal(2);

            firstDelete.resolve();
            secondDelete.resolve();
            await refreshPromise;
        });

        it('removes the coalescing lock after successful completion', async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            await refreshCache('collateral', undefined);
            await refreshCache('collateral', undefined);

            expect(c.sequelize.transaction.calledTwice).to.be.true;
        });

        it('removes the coalescing lock even when an error occurs', async() => {
            const c = new TestContext();
            c.pcsCertificatesDao.getCertificateById.resolves(null);
            const { refreshCache } = await c.getTarget();

            await assert.rejects(() => refreshCache('collateral', undefined));

            c.pcsCertificatesDao.getCertificateById.resolves(makeRootCa());
            await refreshCache('collateral', undefined);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
        });
    });

    describe('scheduledRefresh', () => {
        it('returns without doing anything when not refreshable', async() => {
            const c = new TestContext();
            c.cachingModeManager.isRefreshable.returns(false);
            const { scheduledRefresh } = await c.getTarget();

            await scheduledRefresh();

            expect(c.fmspcTcbDao.deleteInvalidTcbs.notCalled).to.be.true;
        });

        it('triggers a full collateral refresh', async() => {
            const c = new TestContext();
            const { scheduledRefresh } = await c.getTarget();

            await scheduledRefresh();

            expect(c.sequelize.transaction.calledOnce).to.be.true;
            expect(c.fmspcTcbDao.deleteInvalidTcbs.calledOnce).to.be.true;
        });

        it('logs success after the refresh completes', async() => {
            const c = new TestContext();
            const { scheduledRefresh } = await c.getTarget();

            await scheduledRefresh();

            expect(c.logger.info.calledWithMatch('Scheduled cache refresh is completed successfully.')).to.be.true;
        });

        it('catches and logs the error without rethrowing', async() => {
            const c = new TestContext();
            c.pcsCertificatesDao.getCertificateById.resolves(null);
            const { scheduledRefresh } = await c.getTarget();

            await scheduledRefresh();

            expect(c.logger.error.calledWithMatch('Scheduled cache refresh failed')).to.be.true;
        });
    });
});


describe('scheduled evaluation-number refresh', () => {
    afterEach(() => { delete global.PCS_VERSION; });

    it('writes SGX and TDX lists fetched before the collateral transaction', async() => {
        const c = new TestContext();
        const target = await c.getTarget();

        await target.scheduledRefresh();

        expect(c.pcsClient.getTcbEvalDataNumbers.calledWith(Constants.PROD_TYPE_SGX)).to.equal(true);
        expect(c.pcsClient.getTcbEvalDataNumbers.calledWith(Constants.PROD_TYPE_TDX)).to.equal(true);
        expect(c.ednDao.upsertTcbEvalDataNumbers.calledWith(Constants.PROD_TYPE_SGX, Buffer.from('edn'))).to.equal(true);
        expect(c.ednDao.upsertTcbEvalDataNumbers.calledWith(Constants.PROD_TYPE_TDX, Buffer.from('edn'))).to.equal(true);
        const ednChains = c.pcsCertificatesDao.upsertTcbInfoIssuerChain.getCalls()
            .filter(call => call.args[0] === 'edn-issuer-chain');
        expect(ednChains).to.have.length(2);
        expect(c.pcsClient.getTcbEvalDataNumbers.lastCall.calledBefore(c.sequelize.transaction.firstCall)).to.equal(true);
    });

    it('does not open the write transaction when an evaluation-number list returns 503', async() => {
        const c = new TestContext();
        c.pcsClient.getTcbEvalDataNumbers.resolves({ statusCode: 503, headers: {} });
        const target = await c.getTarget();

        await assert.rejects(
            () => target.refreshCache('collateral'),
            err => err.status === PccsStatus.PCCS_STATUS_NO_CACHE_DATA[0] &&
                err.message === PccsStatus.PCCS_STATUS_NO_CACHE_DATA[1]
        );
        expect(c.sequelize.transaction.called).to.equal(false);
        expect(c.ednDao.upsertTcbEvalDataNumbers.called).to.equal(false);
        expect(c.fmspcTcbDao.upsertFmspcTcb.called).to.equal(false);
    });
});


describe('refresh of cached evaluation-number TCB entries', () => {
    afterEach(() => { delete global.PCS_VERSION; });
    it('keeps the explicit number on PCS requests and cache upserts', async() => {
        const c = new TestContext();
        c.fmspcTcbDao.getAllTcbs.resolves([{ ...makeDbTcb(), update_type: Constants.UPDATE_TYPE_TCBEDN, tcbedn: 7 }]);
        const target = await c.getTarget();
        await target.refreshCache();
        expect(c.pcsClient.getTcb.calledWith(Constants.PROD_TYPE_SGX, FMSPC, 4, Constants.UPDATE_TYPE_TCBEDN, 7)).to.equal(true);
        expect(c.fmspcTcbDao.upsertFmspcTcb.firstCall.args[0].tcbedn).to.equal(7);
    });
    for (const [why, status] of [
        ['not found', Constants.HTTP_NOT_FOUND],
        ['gone', Constants.HTTP_GONE],
    ]) {
        it(`keeps a cached evaluation-number TCB when PCS returns ${why}`, async() => {
            const c = new TestContext();
            c.fmspcTcbDao.getAllTcbs.resolves([{
                ...makeDbTcb(),
                update_type: Constants.UPDATE_TYPE_TCBEDN,
                tcbedn:       7,
            }]);
            c.pcsClient.getTcb.resolves(makeTcbResponse(status));
            const target = await c.getTarget();

            await target.refreshCache();

            expect(c.pcsClient.getTcb.calledWith(
                Constants.PROD_TYPE_SGX, FMSPC, 4, Constants.UPDATE_TYPE_TCBEDN, 7
            )).to.equal(true);
            expect(c.fmspcTcbDao.upsertFmspcTcb.called).to.equal(false);
        });
    }
});


describe('enclave-identity evaluation-number refresh', () => {
    afterEach(() => { delete global.PCS_VERSION; });

    const ENCLAVE_IDS = [
        Constants.QE_IDENTITY_ID,
        Constants.QVE_IDENTITY_ID,
        Constants.TDQE_IDENTITY_ID,
    ];
    const ENDPOINT_REQUESTS = ENCLAVE_IDS.flatMap(id => [
        [id, Constants.UPDATE_TYPE_STANDARD],
        [id, Constants.UPDATE_TYPE_EARLY],
    ]);

    function rangesForAll(standard, early) {
        return {
            [Constants.QE_IDENTITY_ID]:   { standard, early },
            [Constants.QVE_IDENTITY_ID]:  { standard, early },
            [Constants.TDQE_IDENTITY_ID]: { standard, early },
        };
    }

    function withRanges(rangesById, respond) {
        const c = new TestContext();
        c.pcsClient.getEnclaveIdentity.callsFake(async(id, version, updateType, tcbedn) => {
            if (respond) {
                const overridden = respond(id, updateType, tcbedn);
                if (overridden) {
                    return overridden;
                }
            }
            const range = rangesById[id];
            let number = tcbedn;
            if (updateType === Constants.UPDATE_TYPE_STANDARD) {
                number = range.standard;
            } else if (updateType === Constants.UPDATE_TYPE_EARLY) {
                number = range.early;
            }
            return { ...makeIdentityResponse(), body: JSON.stringify({ enclaveIdentity: { tcbEvaluationDataNumber: number } }) };
        });
        return c;
    }

    function evaluationNumberPairs(calls, numberIndex, updateIndex) {
        return calls
            .filter(call => call.args[updateIndex] === Constants.UPDATE_TYPE_TCBEDN)
            .map(call => [call.args[0], call.args[numberIndex]]);
    }

    function requestedEvaluationNumbers(c) {
        return evaluationNumberPairs(c.pcsClient.getEnclaveIdentity.getCalls(), 3, 2);
    }

    function storedEvaluationNumbers(c) {
        return evaluationNumberPairs(c.enclaveIdentityDao.upsertEnclaveIdentity.getCalls(), 4, 3);
    }

    function endpointRequests(c) {
        return c.pcsClient.getEnclaveIdentity.getCalls()
            .filter(call => call.args[2] !== Constants.UPDATE_TYPE_TCBEDN)
            .map(call => [call.args[0], call.args[2]]);
    }

    it('stores each enclave\'s own numbers, skipping an inverted range', async() => {
        const c = withRanges({
            [Constants.QE_IDENTITY_ID]:   { standard: 9, early: 7 },
            [Constants.QVE_IDENTITY_ID]:  { standard: 7, early: 7 },
            [Constants.TDQE_IDENTITY_ID]: { standard: 2, early: 4 },
        });
        const target = await c.getTarget();

        await target.refreshCache();

        const expected = [
            [Constants.QVE_IDENTITY_ID, 7],
            [Constants.TDQE_IDENTITY_ID, 2],
            [Constants.TDQE_IDENTITY_ID, 3],
            [Constants.TDQE_IDENTITY_ID, 4],
        ];
        expect(endpointRequests(c)).to.deep.equal(ENDPOINT_REQUESTS);
        expect(requestedEvaluationNumbers(c)).to.deep.equal(expected);
        expect(storedEvaluationNumbers(c)).to.deep.equal(expected);
        expect(c.pcsClient.getEnclaveIdentity.lastCall.calledBefore(c.sequelize.transaction.firstCall)).to.equal(true);
        expect(c.logger.warn.getCalls().map(call => call.args[0]).filter(
            message => String(message).startsWith('Invalid identity evaluation-number range')
        )).to.deep.equal(['Invalid identity evaluation-number range: 9..7']);
    });

    for (const [why, standard, early] of [
        ['missing', null, 9],
        ['not an integer', 1.5, 9],
    ]) {
        it(`does not request evaluation numbers when the standard endpoint number is ${why}`, async() => {
            const c = withRanges(rangesForAll(standard, early));

            await (await c.getTarget()).refreshCache();

            expect(endpointRequests(c)).to.deep.equal(ENDPOINT_REQUESTS);
            expect(requestedEvaluationNumbers(c)).to.deep.equal([]);
            expect(storedEvaluationNumbers(c)).to.deep.equal([]);
            expect(c.logger.warn.calledWithMatch('Invalid identity evaluation-number range')).to.equal(false);
        });
    }

    it('keeps the rest of a 7..9 range when PCS reports QE evaluation number 8 gone', async() => {
        const c = withRanges(rangesForAll(7, 9), (id, updateType, tcbedn) => {
            if (id === Constants.QE_IDENTITY_ID && updateType === Constants.UPDATE_TYPE_TCBEDN && tcbedn === 8) {
                return makeIdentityResponse(Constants.HTTP_GONE);
            }
            return null;
        });

        await (await c.getTarget()).refreshCache();

        const requested = ENCLAVE_IDS.flatMap(id => [
            [id, 7],
            [id, 8],
            [id, 9],
        ]);
        const stored = requested.filter(pair => pair[0] !== Constants.QE_IDENTITY_ID || pair[1] !== 8);
        expect(requestedEvaluationNumbers(c)).to.deep.equal(requested);
        expect(storedEvaluationNumbers(c)).to.deep.equal(stored);
    });
});


describe('programmatic refresh FMSPC validation', () => {
    afterEach(() => { delete global.PCS_VERSION; });

    async function refreshTwice(value) {
        const c = new TestContext();
        c.platformTcbsDao.getPlatformTcbs.resolves([]);
        const { refreshCache } = await c.getTarget();
        const args = value === undefined ? ['certs'] : ['certs', value];
        await Promise.all([refreshCache(...args), refreshCache(...args)]);
        return c;
    }

    for (const { why, value, expected } of [
        { why: 'an omitted filter', value: undefined, expected: '' },
        { why: 'one FMSPC', value: 'abcdabcdabcd', expected: 'ABCDABCDABCD' },
        { why: 'a comma-separated list', value: 'abcdabcdabcd,112233445566', expected: 'ABCDABCDABCD,112233445566' },
        { why: 'duplicate FMSPCs', value: 'abcdabcdabcd,abcdabcdabcd', expected: 'ABCDABCDABCD,ABCDABCDABCD' },
    ]) {
        it(`stores ${why} as ${JSON.stringify(expected)} in coalescing key certs:${expected}`, async() => {
            const c = await refreshTwice(value);

            expect(c.platformTcbsDao.getPlatformTcbs.calledOnceWith(expected)).to.be.true;
            expect(c.logger.info.calledWith(
                `[refreshCache] Refresh for key=certs:${expected} already in progress, awaiting shared result`
            )).to.be.true;
        });
    }

    for (const { why, value } of [
        { why: 'a trailing empty entry', value: '001122334455,' },
        { why: 'whitespace around a comma', value: '001122334455, 112233445566' },
        { why: 'the literal all', value: 'all' },
    ]) {
        it(`rejects ${why} before fetching platforms`, async() => {
            const c = new TestContext();
            const { refreshCache } = await c.getTarget();

            try {
                await refreshCache('certs', value);
                expect.fail('expected an invalid request');
            } catch (err) {
                expect(err.status).to.equal(PccsStatus.PCCS_STATUS_INVALID_REQ[0]);
                expect(err.message).to.equal(PccsStatus.PCCS_STATUS_INVALID_REQ[1]);
            }

            expect(c.platformTcbsDao.getPlatformTcbs.called).to.be.false;
            expect(c.pcsClient.getCerts.called).to.be.false;
        });
    }
});


describe('refresh success and failure timestamps', () => {
    afterEach(() => { sinon.restore(); delete global.PCS_VERSION; });

    it('records success once for coalesced refreshes after the collateral transaction', async() => {
        const clock = sinon.useFakeTimers({ now: new Date('2026-01-02T03:04:05Z'), toFake: ['Date'] });
        const c = new TestContext();
        const target = await c.getTarget();

        await Promise.all([target.refreshCache(), target.refreshCache()]);

        expect(c.timestampDao.upsertCacheTimestamp.calledOnce).to.equal(true);
        expect(c.timestampDao.upsertCacheTimestamp.firstCall.args).to.deep.equal([
            'default', new Date(clock.now), true, null,
        ]);
        expect(c.timestampDao.upsertCacheTimestamp.firstCall.calledAfter(c.sequelize.transaction.lastCall)).to.equal(true);
    });

    it('records a failure outside the rejected transaction and retains the original error', async() => {
        const c = new TestContext();
        const error = new Error('write failed');
        c.sequelize.transaction.rejects(error);
        const target = await c.getTarget();

        let caught;
        try {
            await target.refreshCache();
        } catch (err) {
            caught = err;
        }

        expect(caught).to.equal(error);
        expect(c.timestampDao.upsertCacheTimestamp.calledOnce).to.equal(true);
        expect(c.timestampDao.upsertCacheTimestamp.calledWith(
            'default', sinon.match.date, false, String(error)
        )).to.equal(true);
    });

    it('preserves the PCS error when recording the failure also fails', async() => {
        const c = new TestContext();
        const error = new Error('PCS down');
        c.pcsClient.getTcb.rejects(error);
        c.timestampDao.upsertCacheTimestamp.rejects(new Error('DB down'));
        const target = await c.getTarget();

        let caught;
        try {
            await target.refreshCache();
        } catch (err) {
            caught = err;
        }

        expect(caught).to.equal(error);
        expect(c.timestampDao.upsertCacheTimestamp.calledOnce).to.equal(true);
        expect(c.timestampDao.upsertCacheTimestamp.calledWith(
            'default', sinon.match.date, false, String(error)
        )).to.equal(true);
        expect(c.logger.error.calledWithMatch('Failed to record refresh failure')).to.equal(true);
    });

    it('records certificate refresh under the certs key', async() => {
        const c = new TestContext();
        const target = await c.getTarget();

        await target.refreshCache('certs', FMSPC);

        expect(c.timestampDao.upsertCacheTimestamp.calledOnce).to.equal(true);
        expect(c.timestampDao.upsertCacheTimestamp.calledWith(
            'certs', sinon.match.date, true, null
        )).to.equal(true);
    });
});
