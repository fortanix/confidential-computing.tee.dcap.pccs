/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import esmock from 'esmock';
import { expect } from 'chai';
import assert from 'assert/strict';
import sinon from 'sinon';
import PccsStatus from '../../constants/pccs_status_code.js';
import Constants from '../../constants/index.js';
import * as responseBodyUtil from '../../utils/responseBody.js';


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


function makeTcbResponse() {
    const body = JSON.stringify({ tcbInfo: { version: 3 } });
    return {
        statusCode: Constants.HTTP_SUCCESS,
        rawBody:    Buffer.from(body),
        body,
        headers:    { 'TCB-Info-Issuer-Chain': ISSUER_CHAIN }
    };
}

function makeCertResponse(certs = null, statusCode = Constants.HTTP_SUCCESS) {
    const body = JSON.stringify(certs ?? [{ tcbm: TCBM, cert: encodeURIComponent(CERT_PEM) }]);
    return {
        statusCode,
        rawBody: Buffer.from(body),
        body,
        headers: {
            [Constants.SGX_FMSPC]:                        FMSPC,
            [Constants.SGX_PCK_CERTIFICATE_CA_TYPE]:      CA_TYPE,
            [Constants.SGX_PCK_CERTIFICATE_ISSUER_CHAIN]: ISSUER_CHAIN
        }
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
        rawBody: Buffer.from('identity-data'),
        body:    'identity-data',
        headers: { [Constants.SGX_ENCLAVE_IDENTITY_ISSUER_CHAIN]: ISSUER_CHAIN }
    };
}


class TestContext {
    constructor() {
        global.PCS_VERSION = 4;

        this.pcsClient = {
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
        this.pckCertchainDao = {
            upsertPckCertchain: sinon.stub().resolves()
        };
        this.platformTcbsDao = {
            getPlatformTcbsById:    sinon.stub().resolves([]),
            deletePlatformTcbsById: sinon.stub().resolves(),
            upsertPlatformTcbs:     sinon.stub().resolves()
        };
        this.pcsCertificatesDao = {
            upsertPckCertificateIssuerChain:  sinon.stub().resolves(),
            upsertTcbInfoIssuerChain:         sinon.stub().resolves(),
            upsertEnclaveIdentityIssuerChain: sinon.stub().resolves(),
            upsertPckCrlCertchain:            sinon.stub().resolves(),
            upsertPcsCertificates:            sinon.stub().resolves(),
            getCertificateById:               sinon.stub().resolves(null)
        };
        this.enclaveIdentityDao = {
            upsertEnclaveIdentity: sinon.stub().resolves()
        };
        this.pckcrlDao = {
            upsertPckCrl: sinon.stub().resolves()
        };
        this.fmspcTcbDao = {
            upsertFmspcTcb: sinon.stub().resolves()
        };
        this.platformsDao = {
            upsertPlatform: sinon.stub().resolves()
        };
        this.crlCacheDao = {
            upsertCrl: sinon.stub().resolves()
        };

        // transaction() simply executes the callback synchronously
        this.sequelize = {
            transaction: sinon.stub().callsFake(fn => fn())
        };

        this.cachingModeManager = {
            processNotAvailableTcbs: sinon.stub().resolves(),
            needUpdatePlatformTcbs:  sinon.stub().returns(true)
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
        return esmock.strict('./commonCacheLogic.js', {
            '../../utils/PccsError.js':                   { 'default': MockPccsError },
            '../../constants/pccs_status_code.js':        { 'default': PccsStatus },
            '../../constants/index.js':                   { 'default': Constants },
            '../../utils/Logger.js':                      { 'default': this.logger },
            '../../utils/responseBody.js':                responseBodyUtil,
            '../../x509/x509.js':                         { 'default': this.X509 },
            '../../dao/pckcertDao.js':                    this.pckcertDao,
            '../../dao/pckCertchainDao.js':               this.pckCertchainDao,
            '../../dao/platformTcbsDao.js':               this.platformTcbsDao,
            '../../dao/pcsCertificatesDao.js':            this.pcsCertificatesDao,
            '../../dao/enclaveIdentityDao.js':            this.enclaveIdentityDao,
            '../../dao/pckcrlDao.js':                     this.pckcrlDao,
            '../../dao/fmspcTcbDao.js':                   this.fmspcTcbDao,
            '../../dao/platformsDao.js':                  this.platformsDao,
            '../../dao/crlCacheDao.js':                   this.crlCacheDao,
            '../../pcs_client/pcs_client.js':             this.pcsClient,
            '../../utils/apputil.js':                     this.apputil,
            '../../dao/models/index.js':                  { sequelize: this.sequelize },
            '../caching_modes/cachingModeManager.js':     { cachingModeManager: this.cachingModeManager },
            '../../pckCertSelection/pckCertSelection.js': { selectBestPckCert: this.selectBestPckCert }
        });
    }
}


function rejectsWithStatus(fn, statusTuple) {
    return assert.rejects(fn, err => err.status === statusTuple[0]);
}


describe('commonCacheLogic', () => {

    afterEach(() => {
        delete global.PCS_VERSION;
    });


    describe('getPckCertFromPCS', () => {
        it('throws INVALID_REQ when both enc_ppid and platform_manifest are absent', async() => {
            const c = new TestContext();
            const { getPckCertFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, null, null),
                PccsStatus.PCCS_STATUS_INVALID_REQ
            );
        });

        it('throws NO_CACHE_DATA when enc_ppid is all zeros', async() => {
            const c = new TestContext();
            const { getPckCertFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, '0'.repeat(768), null),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('calls getCertsWithManifest when platform_manifest is provided', async() => {
            const c = new TestContext();
            const { getPckCertFromPCS } = await c.getTarget();

            await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, null, 'MANIFEST');

            expect(c.pcsClient.getCertsWithManifest.calledOnce).to.be.true;
            expect(c.pcsClient.getCerts.notCalled).to.be.true;
        });

        it('calls getCerts when only enc_ppid is provided', async() => {
            const c = new TestContext();
            const { getPckCertFromPCS } = await c.getTarget();

            await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(c.pcsClient.getCerts.calledOnce).to.be.true;
            expect(c.pcsClient.getCertsWithManifest.notCalled).to.be.true;
        });

        it('throws NO_CACHE_DATA when PCS returns non-200 for PCK certs', async() => {
            const c = new TestContext();
            c.pcsClient.getCerts.resolves(makeCertResponse(null, 503));
            const { getPckCertFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('throws NO_CACHE_DATA when all PCK certs are "Not available"', async() => {
            const c = new TestContext();
            const notAvailCerts = [{ tcbm: TCBM, cert: encodeURIComponent('Not available') }];
            c.pcsClient.getCerts.resolves(makeCertResponse(notAvailCerts));
            const { getPckCertFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('filters "Not available" certs and forwards them to cachingModeManager', async() => {
            const c = new TestContext();
            const mixedCerts = [
                { tcbm: TCBM, cert: encodeURIComponent(CERT_PEM) },
                { tcbm: '00'.repeat(18), cert: encodeURIComponent('Not available') }
            ];
            c.pcsClient.getCerts.resolves(makeCertResponse(mixedCerts));
            const { getPckCertFromPCS } = await c.getTarget();

            await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(c.cachingModeManager.processNotAvailableTcbs.calledOnce).to.be.true;
            const notAvail = c.cachingModeManager.processNotAvailableTcbs.firstCall.args[4];
            expect(notAvail).to.have.length(1);
            expect(notAvail[0].pck_cert).to.equal('Not available');
        });

        it('throws NO_CACHE_DATA when sgx_standard TCB info is null', async() => {
            const c = new TestContext();
            c.pcsClient.getTcb.resolves({ statusCode: 503, rawBody: Buffer.from(''), body: '', headers: {} });
            const { getPckCertFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('fetches SGX and TDX TCB infos when PCS_VERSION >= 4', async() => {
            const c = new TestContext();
            global.PCS_VERSION = 4;
            const { getPckCertFromPCS } = await c.getTarget();

            await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(c.pcsClient.getTcb.getCall(0).args).to.deep.equal([Constants.PROD_TYPE_SGX, FMSPC, 4, Constants.UPDATE_TYPE_EARLY]);
            expect(c.pcsClient.getTcb.getCall(1).args).to.deep.equal([Constants.PROD_TYPE_SGX, FMSPC, 4, Constants.UPDATE_TYPE_STANDARD]);
            expect(c.pcsClient.getTcb.getCall(2).args).to.deep.equal([Constants.PROD_TYPE_TDX, FMSPC, 4, Constants.UPDATE_TYPE_EARLY]);
            expect(c.pcsClient.getTcb.getCall(3).args).to.deep.equal([Constants.PROD_TYPE_TDX, FMSPC, 4, Constants.UPDATE_TYPE_STANDARD]);
            expect(c.pcsClient.getTcb.callCount).to.equal(4);
        });

        it('fetches only SGX TCB infos when PCS_VERSION = 3', async() => {
            const c = new TestContext();
            global.PCS_VERSION = 3;
            const { getPckCertFromPCS } = await c.getTarget();

            await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(c.pcsClient.getTcb.getCall(0).args).to.deep.equal([Constants.PROD_TYPE_SGX, FMSPC, 3, Constants.UPDATE_TYPE_EARLY]);
            expect(c.pcsClient.getTcb.getCall(1).args).to.deep.equal([Constants.PROD_TYPE_SGX, FMSPC, 3, Constants.UPDATE_TYPE_STANDARD]);
            expect(c.pcsClient.getTcb.callCount).to.equal(2);
        });

        it('calls platform and cert DAO upsert methods inside a transaction', async() => {
            const c = new TestContext();
            const { getPckCertFromPCS } = await c.getTarget();

            await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
            expect(c.platformsDao.upsertPlatform.calledOnce).to.be.true;
            expect(c.pckcertDao.deleteCerts.calledOnce).to.be.true;
            expect(c.pckcertDao.upsertPckCert.calledOnce).to.be.true;
            expect(c.platformTcbsDao.deletePlatformTcbsById.calledOnce).to.be.true;
            expect(c.pckCertchainDao.upsertPckCertchain.calledOnce).to.be.true;
            expect(c.pcsCertificatesDao.upsertPckCertificateIssuerChain.calledOnce).to.be.true;
            expect(c.pcsCertificatesDao.upsertTcbInfoIssuerChain.calledOnce).to.be.true;
        });

        it('calls upsertFmspcTcb for each non-null TCB info entry', async() => {
            const c = new TestContext();
            global.PCS_VERSION = 4;
            const { getPckCertFromPCS } = await c.getTarget();

            await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(c.fmspcTcbDao.upsertFmspcTcb.calledWithMatch({ type: Constants.PROD_TYPE_SGX, fmspc: FMSPC, version: 4, update_type: Constants.UPDATE_TYPE_EARLY })).to.be.true;
            expect(c.fmspcTcbDao.upsertFmspcTcb.calledWithMatch({ type: Constants.PROD_TYPE_SGX, fmspc: FMSPC, version: 4, update_type: Constants.UPDATE_TYPE_STANDARD })).to.be.true;
            expect(c.fmspcTcbDao.upsertFmspcTcb.calledWithMatch({ type: Constants.PROD_TYPE_TDX, fmspc: FMSPC, version: 4, update_type: Constants.UPDATE_TYPE_EARLY })).to.be.true;
            expect(c.fmspcTcbDao.upsertFmspcTcb.calledWithMatch({ type: Constants.PROD_TYPE_TDX, fmspc: FMSPC, version: 4, update_type: Constants.UPDATE_TYPE_STANDARD })).to.be.true;
        });

        it('re-runs PCK cert selection for all cached platform TCB levels', async() => {
            const c = new TestContext();
            const cachedTcbs = [
                { qe_id: QEID, pce_id: PCEID, cpu_svn: CPUSVN, pce_svn: PCESVN }
            ];
            c.platformTcbsDao.getPlatformTcbsById.resolves(cachedTcbs);
            const { getPckCertFromPCS } = await c.getTarget();

            await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(c.selectBestPckCert.getCall(0).args[0]).to.equal(CPUSVN);
            expect(c.selectBestPckCert.getCall(0).args[1]).to.equal(PCESVN);
            expect(c.selectBestPckCert.getCall(0).args[2]).to.equal(PCEID);
            expect(c.selectBestPckCert.getCall(1).args[0]).to.equal(CPUSVN);
            expect(c.selectBestPckCert.getCall(1).args[1]).to.equal(PCESVN);
            expect(c.selectBestPckCert.getCall(1).args[2]).to.equal(PCEID);
            expect(c.selectBestPckCert.callCount).to.equal(2);
            expect(c.platformTcbsDao.upsertPlatformTcbs.getCall(0).args).to.deep.equal([QEID, PCEID, CPUSVN, PCESVN, TCBM]);
            expect(c.platformTcbsDao.upsertPlatformTcbs.getCall(1).args).to.deep.equal([QEID, PCEID, CPUSVN, PCESVN, TCBM]);
            expect(c.platformTcbsDao.upsertPlatformTcbs.callCount).to.equal(2);
        });

        it('throws NO_CACHE_DATA when selectBestPckCert throws for a cached TCB level', async() => {
            const c = new TestContext();
            c.platformTcbsDao.getPlatformTcbsById.resolves([
                { qe_id: QEID, pce_id: PCEID, cpu_svn: CPUSVN, pce_svn: PCESVN }
            ]);
            c.selectBestPckCert.throws(new Error('selection failed'));
            const { getPckCertFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('throws NO_CACHE_DATA when selectBestPckCert throws for the current raw TCB', async() => {
            const c = new TestContext();
            c.selectBestPckCert.throws(new Error('selection failed'));
            const { getPckCertFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('does not call upsertPlatformTcbs when needUpdatePlatformTcbs returns false', async() => {
            const c = new TestContext();
            c.cachingModeManager.needUpdatePlatformTcbs.returns(false);
            const { getPckCertFromPCS } = await c.getTarget();

            await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(c.platformTcbsDao.upsertPlatformTcbs.notCalled).to.be.true;
        });

        it('returns empty object when cpusvn and pcesvn are not provided', async() => {
            const c = new TestContext();
            const { getPckCertFromPCS } = await c.getTarget();

            const result = await getPckCertFromPCS(QEID, null, null, PCEID, ENC_PPID, null);

            expect(result).to.deep.equal({});
            expect(c.selectBestPckCert.notCalled).to.be.true;
        });

        it('returns cert with all expected fields on success', async() => {
            const c = new TestContext();
            const { getPckCertFromPCS } = await c.getTarget();

            const result = await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(result.cert).to.equal(CERT_PEM);
            expect(result[Constants.SGX_TCBM]).to.equal(TCBM);
            expect(result[Constants.SGX_FMSPC]).to.equal(FMSPC);
            expect(result[Constants.SGX_PCK_CERTIFICATE_CA_TYPE]).to.equal(CA_TYPE);
            expect(result[Constants.SGX_PCK_CERTIFICATE_ISSUER_CHAIN]).to.equal(ISSUER_CHAIN);
        });

        it('handles a Buffer response body from parsePckServerResponseBody', async() => {
            const c = new TestContext();
            const certArray = [{ tcbm: TCBM, cert: encodeURIComponent(CERT_PEM) }];
            const bufBody   = Buffer.from(JSON.stringify(certArray));
            const res = makeCertResponse();
            res.body = bufBody;
            c.pcsClient.getCerts.resolves(res);
            const { getPckCertFromPCS } = await c.getTarget();

            const result = await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(result.cert).to.equal(CERT_PEM);
        });

        it('handles a plain object response body from parsePckServerResponseBody', async() => {
            const c = new TestContext();
            const certArray = [{ tcbm: TCBM, cert: encodeURIComponent(CERT_PEM) }];
            const res = makeCertResponse();
            res.body = certArray;
            c.pcsClient.getCerts.resolves(res);
            const { getPckCertFromPCS } = await c.getTarget();

            const result = await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(result.cert).to.equal(CERT_PEM);
        });

        it('handles an ArrayBuffer response body from parsePckServerResponseBody and rejects null bodies', () => {
            const certArray = [{ tcbm: TCBM, cert: encodeURIComponent(CERT_PEM) }];
            const json = JSON.stringify(certArray);
            const bytes = new TextEncoder().encode(json);

            expect(responseBodyUtil.parsePckServerResponseBody(bytes.buffer)).to.deep.equal(certArray);
            assert.throws(
                () => responseBodyUtil.parsePckServerResponseBody(null),
                err => err.status === PccsStatus.PCCS_STATUS_INTERNAL_ERROR[0]
            );
        });

        it('does not treat empty binary or text bodies as successful responses with content', () => {
            expect(responseBodyUtil.isSuccessfulResponseWithBody({ statusCode: Constants.HTTP_SUCCESS, body: Buffer.alloc(0) })).to.be.false;
            expect(responseBodyUtil.isSuccessfulResponseWithBody({ statusCode: Constants.HTTP_SUCCESS, body: new Uint8Array(0) })).to.be.false;
            expect(responseBodyUtil.isSuccessfulResponseWithBody({ statusCode: Constants.HTTP_SUCCESS, body: '' })).to.be.false;
            expect(responseBodyUtil.isSuccessfulResponseWithBody({ statusCode: Constants.HTTP_SUCCESS, body: 'ok' })).to.be.true;
        });

        it('throws NO_CACHE_DATA for unsupported non-content response bodies', async() => {
            const c = new TestContext();
            const res = makeCertResponse();
            res.body = 12345;
            c.pcsClient.getCerts.resolves(res);
            const { getPckCertFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('throws INTERNAL_ERROR when fmspc header is missing from PCS response', async() => {
            const c = new TestContext();
            const res = makeCertResponse();
            delete res.headers[Constants.SGX_FMSPC];
            c.pcsClient.getCerts.resolves(res);
            const { getPckCertFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null),
                PccsStatus.PCCS_STATUS_INTERNAL_ERROR
            );
        });

        it('uses sgx_standard tcbinfo_str when sgx_early TCB fetch returns null', async() => {
            const c = new TestContext();
            // first getTcb call (sgx_early) returns non-200, second (sgx_standard) returns 200
            c.pcsClient.getTcb
                .onFirstCall().resolves({ statusCode: 503, rawBody: Buffer.from(''), body: '', headers: {} })
                .onSecondCall()
                .resolves(makeTcbResponse());
            const { getPckCertFromPCS } = await c.getTarget();

            const result = await getPckCertFromPCS(QEID, CPUSVN, PCESVN, PCEID, ENC_PPID, null);

            expect(result.cert).to.equal(CERT_PEM);
        });
    });


    describe('getPckCrlFromPCS', () => {
        it('throws NO_CACHE_DATA when PCS returns non-200', async() => {
            const c = new TestContext();
            c.pcsClient.getPckCrl.resolves(makeCrlResponse(404));
            const { getPckCrlFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getPckCrlFromPCS(Constants.CA_PROCESSOR),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('returns pckcrl and issuer chain on success', async() => {
            const c = new TestContext();
            const { getPckCrlFromPCS } = await c.getTarget();

            const result = await getPckCrlFromPCS(Constants.CA_PROCESSOR);

            expect(result.pckcrl).to.deep.equal(CRL_DATA);
            expect(result[Constants.SGX_PCK_CRL_ISSUER_CHAIN]).to.equal(ISSUER_CHAIN);
        });

        it('calls upsertPckCrl and upsertPckCrlCertchain inside a transaction', async() => {
            const c = new TestContext();
            const { getPckCrlFromPCS } = await c.getTarget();

            await getPckCrlFromPCS(Constants.CA_PROCESSOR);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
            expect(c.pckcrlDao.upsertPckCrl.calledOnceWith(Constants.CA_PROCESSOR, CRL_DATA)).to.be.true;
            expect(c.pcsCertificatesDao.upsertPckCrlCertchain.calledOnce).to.be.true;
        });
    });


    describe('getTcbInfoFromPCS', () => {
        it('throws NO_CACHE_DATA when PCS returns non-200', async() => {
            const c = new TestContext();
            c.pcsClient.getTcb.resolves({ statusCode: 500, rawBody: Buffer.from(''), headers: {} });
            const { getTcbInfoFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getTcbInfoFromPCS(Constants.PROD_TYPE_SGX, FMSPC, 4, Constants.UPDATE_TYPE_STANDARD),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('returns tcbinfo buffer and issuer chain header on success', async() => {
            const c = new TestContext();
            const { getTcbInfoFromPCS } = await c.getTarget();

            const result = await getTcbInfoFromPCS(Constants.PROD_TYPE_SGX, FMSPC, 4, Constants.UPDATE_TYPE_STANDARD);

            expect(Buffer.isBuffer(result.tcbinfo)).to.be.true;
            expect(result['TCB-Info-Issuer-Chain']).to.equal(ISSUER_CHAIN);
        });

        it('calls upsertFmspcTcb and upsertTcbInfoIssuerChain inside a transaction', async() => {
            const c = new TestContext();
            const { getTcbInfoFromPCS } = await c.getTarget();

            await getTcbInfoFromPCS(Constants.PROD_TYPE_SGX, FMSPC, 4, Constants.UPDATE_TYPE_STANDARD);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
            expect(c.fmspcTcbDao.upsertFmspcTcb.calledOnce).to.be.true;
            expect(c.pcsCertificatesDao.upsertTcbInfoIssuerChain.calledOnce).to.be.true;
        });

        it('passes correct type, fmspc, version and update_type to upsertFmspcTcb', async() => {
            const c = new TestContext();
            const { getTcbInfoFromPCS } = await c.getTarget();

            await getTcbInfoFromPCS(Constants.PROD_TYPE_TDX, FMSPC, 4, Constants.UPDATE_TYPE_EARLY);

            const arg = c.fmspcTcbDao.upsertFmspcTcb.firstCall.args[0];
            expect(arg.type).to.equal(Constants.PROD_TYPE_TDX);
            expect(arg.fmspc).to.equal(FMSPC);
            expect(arg.version).to.equal(4);
            expect(arg.update_type).to.equal(Constants.UPDATE_TYPE_EARLY);
        });
    });


    describe('getEnclaveIdentityFromPCS', () => {
        it('throws NO_CACHE_DATA when PCS returns non-200', async() => {
            const c = new TestContext();
            c.pcsClient.getEnclaveIdentity.resolves(makeIdentityResponse(404));
            const { getEnclaveIdentityFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getEnclaveIdentityFromPCS(Constants.QE_IDENTITY_ID, 4, Constants.UPDATE_TYPE_STANDARD),
                PccsStatus.PCCS_STATUS_NO_CACHE_DATA
            );
        });

        it('returns identity buffer and issuer chain on success', async() => {
            const c = new TestContext();
            const { getEnclaveIdentityFromPCS } = await c.getTarget();

            const result = await getEnclaveIdentityFromPCS(Constants.QE_IDENTITY_ID, 4, Constants.UPDATE_TYPE_STANDARD);

            expect(Buffer.isBuffer(result.identity)).to.be.true;
            expect(result[Constants.SGX_ENCLAVE_IDENTITY_ISSUER_CHAIN]).to.equal(ISSUER_CHAIN);
        });

        it('calls upsertEnclaveIdentity and upsertEnclaveIdentityIssuerChain inside a transaction', async() => {
            const c = new TestContext();
            const { getEnclaveIdentityFromPCS } = await c.getTarget();

            await getEnclaveIdentityFromPCS(Constants.QE_IDENTITY_ID, 4, Constants.UPDATE_TYPE_STANDARD);

            expect(c.sequelize.transaction.calledOnce).to.be.true;
            expect(c.enclaveIdentityDao.upsertEnclaveIdentity.calledOnce).to.be.true;
            expect(c.pcsCertificatesDao.upsertEnclaveIdentityIssuerChain.calledOnce).to.be.true;
        });

        it('passes correct enclave_id, version and update_type to upsertEnclaveIdentity', async() => {
            const c = new TestContext();
            const { getEnclaveIdentityFromPCS } = await c.getTarget();

            await getEnclaveIdentityFromPCS(Constants.QVE_IDENTITY_ID, 3, Constants.UPDATE_TYPE_EARLY);

            const args = c.enclaveIdentityDao.upsertEnclaveIdentity.firstCall.args;
            expect(args[0]).to.equal(Constants.QVE_IDENTITY_ID);
            expect(args[2]).to.equal(3);
            expect(args[3]).to.equal(Constants.UPDATE_TYPE_EARLY);
        });
    });


    describe('getRootCACrlFromPCS', () => {
        it('returns null when rootca is null and PCS getEnclaveIdentity returns non-200', async() => {
            const c = new TestContext();
            c.pcsClient.getEnclaveIdentity.resolves(makeIdentityResponse(500));
            const { getRootCACrlFromPCS } = await c.getTarget();

            const result = await getRootCACrlFromPCS(null);

            expect(result).to.be.null;
        });

        it('returns null when rootca is still null after successful PCS call', async() => {
            const c = new TestContext();
            // PCS call succeeds but DB still has no root cert
            c.pcsCertificatesDao.getCertificateById.resolves(null);
            const { getRootCACrlFromPCS } = await c.getTarget();

            const result = await getRootCACrlFromPCS(null);

            expect(result).to.be.null;
        });

        it('throws INTERNAL_ERROR when parseCert returns false', async() => {
            const c = new TestContext();
            c.x509Instance.parseCert.returns(false);
            const rootca = { id: Constants.ROOT_CERT_ID, cert: encodeURIComponent(CERT_PEM) };
            const { getRootCACrlFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getRootCACrlFromPCS(rootca),
                PccsStatus.PCCS_STATUS_INTERNAL_ERROR
            );
        });

        it('throws INTERNAL_ERROR when cdpUri is falsy', async() => {
            const c = new TestContext();
            c.x509Instance.cdpUri = null;
            const rootca = { id: Constants.ROOT_CERT_ID, cert: encodeURIComponent(CERT_PEM) };
            const { getRootCACrlFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getRootCACrlFromPCS(rootca),
                PccsStatus.PCCS_STATUS_INTERNAL_ERROR
            );
        });

        it('throws INTERNAL_ERROR when cdpUri fails isValidCrlUri check', async() => {
            const c = new TestContext();
            c.apputil.isValidCrlUri.returns(false);
            const rootca = { id: Constants.ROOT_CERT_ID, cert: encodeURIComponent(CERT_PEM) };
            const { getRootCACrlFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getRootCACrlFromPCS(rootca),
                PccsStatus.PCCS_STATUS_INTERNAL_ERROR
            );
        });

        it('returns CRL on success when rootca is provided directly', async() => {
            const c = new TestContext();
            const rootca = { id: Constants.ROOT_CERT_ID, cert: encodeURIComponent(CERT_PEM) };
            const { getRootCACrlFromPCS } = await c.getTarget();

            const result = await getRootCACrlFromPCS(rootca);

            expect(result).to.deep.equal(CRL_DATA);
        });

        it('persists CRL via upsertPcsCertificates when rootca is provided', async() => {
            const c = new TestContext();
            const rootca = { id: Constants.ROOT_CERT_ID, cert: encodeURIComponent(CERT_PEM) };
            const { getRootCACrlFromPCS } = await c.getTarget();

            await getRootCACrlFromPCS(rootca);

            expect(c.pcsCertificatesDao.upsertPcsCertificates.calledOnce).to.be.true;
            const arg = c.pcsCertificatesDao.upsertPcsCertificates.firstCall.args[0];
            expect(arg.id).to.equal(Constants.ROOT_CERT_ID);
            expect(arg.crl).to.deep.equal(CRL_DATA);
        });

        it('fetches rootca via QE identity when rootca param is null and PCS returns 200', async() => {
            const c = new TestContext();
            const rootca = { id: Constants.ROOT_CERT_ID, cert: encodeURIComponent(CERT_PEM) };
            c.pcsCertificatesDao.getCertificateById.resolves(rootca);
            const { getRootCACrlFromPCS } = await c.getTarget();

            const result = await getRootCACrlFromPCS(null);

            expect(c.pcsClient.getEnclaveIdentity.calledOnce).to.be.true;
            expect(result).to.deep.equal(CRL_DATA);
        });
    });


    describe('getCrlFromPCS', () => {
        it('throws INTERNAL_ERROR when URI fails isValidCrlUri check', async() => {
            const c = new TestContext();
            c.apputil.isValidCrlUri.returns(false);
            const { getCrlFromPCS } = await c.getTarget();

            await rejectsWithStatus(
                () => getCrlFromPCS('http://evil.example.com/crl'),
                PccsStatus.PCCS_STATUS_INTERNAL_ERROR
            );
        });

        it('returns CRL fetched from URL on success', async() => {
            const c = new TestContext();
            const { getCrlFromPCS } = await c.getTarget();

            const result = await getCrlFromPCS(CDP_URI);

            expect(result).to.deep.equal(CRL_DATA);
        });

        it('calls upsertCrl with the URI and fetched CRL data', async() => {
            const c = new TestContext();
            const { getCrlFromPCS } = await c.getTarget();

            await getCrlFromPCS(CDP_URI);

            expect(c.crlCacheDao.upsertCrl.calledOnceWith(CDP_URI, CRL_DATA)).to.be.true;
        });

        it('calls getFileFromUrl with the provided URI', async() => {
            const c = new TestContext();
            const { getCrlFromPCS } = await c.getTarget();

            await getCrlFromPCS(CDP_URI);

            expect(c.pcsClient.getFileFromUrl.calledOnceWith(CDP_URI)).to.be.true;
        });
    });
});


describe('PCS retired-collateral responses', () => {
    afterEach(() => {
        delete global.PCS_VERSION;
    });

    const cases = [
        {
            why:        'reports PCS HTTP_GONE as PCCS_STATUS_NO_LONGER_AVAILABLE and does not write cache',
            statusCode: Constants.HTTP_GONE,
            expected:   PccsStatus.PCCS_STATUS_NO_LONGER_AVAILABLE,
        },
        {
            why:        'keeps PCS HTTP_NOT_FOUND as PCCS_STATUS_NO_CACHE_DATA and does not write cache',
            statusCode: Constants.HTTP_NOT_FOUND,
            expected:   PccsStatus.PCCS_STATUS_NO_CACHE_DATA,
        },
        {
            // 503 has no HTTP constant in Constants.
            why:        'keeps PCS 503 as PCCS_STATUS_NO_CACHE_DATA and does not write cache',
            statusCode: 503,
            expected:   PccsStatus.PCCS_STATUS_NO_CACHE_DATA,
        },
    ];

    for (const method of ['getTcbInfoFromPCS', 'getEnclaveIdentityFromPCS']) {
        for (const { why, statusCode, expected } of cases) {
            it(`${method} ${why}`, async() => {
                const c = new TestContext();
                c.pcsClient.getTcb.resolves({ statusCode, body: null });
                c.pcsClient.getEnclaveIdentity.resolves({ statusCode, body: null });
                const target = await c.getTarget();
                const args = method === 'getTcbInfoFromPCS' ?
                    [Constants.PROD_TYPE_SGX, FMSPC, 4] :
                    [Constants.QE_IDENTITY_ID, 4];

                let caught;
                try {
                    await target[method](...args, Constants.UPDATE_TYPE_TCBEDN, 7);
                } catch (err) {
                    caught = err;
                }

                expect(caught.status).to.equal(expected[0]);
                expect(caught.message).to.equal(expected[1]);
                expect(c.sequelize.transaction.called).to.equal(false);
            });
        }
    }
});
