/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import esmock from 'esmock';
import { expect } from 'chai';
import sinon from 'sinon';
import Constants from '../constants/index.js';

const {
    PROD_TYPE_SGX,
    PROD_TYPE_TDX,
    UPDATE_TYPE_STANDARD,
    UPDATE_TYPE_EARLY,
    QE_IDENTITY_ID,
    QVE_IDENTITY_ID,
    TDQE_IDENTITY_ID,
} = Constants;

class TestContext {
    constructor() {
        this.configValues = {};
        const defaultConfig = {
            uri:                      'https://api.trustedservices.intel.com/sgx/certification/v4/',
            PcsRequestTimeoutSeconds: 16,
            PcsMaxRetryCount:         2,
        };

        this.config = {
            has: (key) => key in { ...defaultConfig, ...this.configValues },
            get: (key) => ({ ...defaultConfig, ...this.configValues })[key] || '',
        };
        this.logger = {
            info:  () => {},
            error: () => {},
            warn:  () => {},
        };
        this.proxyConfig = {
            sanitizedProxyForLogging: 'http://proxy.example.com:8080',
            httpsProxyAgent:          { agent: true },
        };
        this.testVersion = 4;
        this.eolVersion = 3;
        this.testFmspc = 'fmspc123';
        this.testEncPpid = 'test-enc-ppid';
        this.testPceid = 'test-pceid';
        this.testCa = 'platform';
        this.testUrl = 'https://example.com/file.dat';
        this.gotStub = this.setupGotMock();
    }

    setConfigValues(values) {
        this.configValues = values;
        return this;
    }

    setupGotMock(response = {}) {
        this.gotStub = sinon.stub().returns({
            statusCode: 200,
            headers:    {
                'request-id': 'test-id-12345',
                'warning':    null,
            },
            ...response,
            buffer: sinon.stub().resolves(Buffer.from('test-file-content')),
        });
        return this.gotStub;
    }

    async getTarget() {
        return await esmock('./pcs_client.js', {
            'config':             { 'default': this.config },
            '../utils/Logger.js': { 'default': this.logger, 'parseAndShortenUrlForLogging': url => url },
            './proxy.js':         this.proxyConfig,
            'got':                { 'default': this.gotStub },
        });
    }
}

describe('pcs_client', () => {

    describe('isEarlyAccessPortal', () => {
        it('should return true for early access portal URL', async() => {
            const ctx = new TestContext();
            const { isEarlyAccessPortal } = await ctx.getTarget();
            expect(isEarlyAccessPortal('https://validation.api.trustedservices.intel.com/sgx/certification/v4/pckcert')).to.be.true;
        });

        it('should return true for any path under the early access portal base URL', async() => {
            const ctx = new TestContext();
            const { isEarlyAccessPortal } = await ctx.getTarget();
            expect(isEarlyAccessPortal('https://validation.api.trustedservices.intel.com/')).to.be.true;
        });

        it('should return false for the production API URL', async() => {
            const ctx = new TestContext();
            const { isEarlyAccessPortal } = await ctx.getTarget();
            expect(isEarlyAccessPortal('https://api.trustedservices.intel.com/sgx/certification/v4/pckcert')).to.be.false;
        });

        it('should return false for an unrelated URL', async() => {
            const ctx = new TestContext();
            const { isEarlyAccessPortal } = await ctx.getTarget();
            expect(isEarlyAccessPortal('https://example.com/some/path')).to.be.false;
        });

        it('should return false for a URL that contains the early access hostname as a substring but does not start with it', async() => {
            const ctx = new TestContext();
            const { isEarlyAccessPortal } = await ctx.getTarget();
            expect(isEarlyAccessPortal('https://fake.com/redirect?url=https://validation.api.trustedservices.intel.com/')).to.be.false;
        });

        it('should return false for an empty string', async() => {
            const ctx = new TestContext();
            const { isEarlyAccessPortal } = await ctx.getTarget();
            expect(isEarlyAccessPortal('')).to.be.false;
        });
    });

    describe('getHeaderValue', () => {
        it('should return header value for lowercase key', async() => {
            const ctx = new TestContext();
            const { getHeaderValue } = await ctx.getTarget();
            const headers = { 'content-type': 'application/json' };
            expect(getHeaderValue(headers, 'content-type')).to.equal('application/json');
        });

        it('should return header value when querying with uppercase key', async() => {
            const ctx = new TestContext();
            const { getHeaderValue } = await ctx.getTarget();
            const headers = { 'content-type': 'application/json' };
            expect(getHeaderValue(headers, 'Content-Type')).to.equal('application/json');
        });

        it('should return header value for mixed case key', async() => {
            const ctx = new TestContext();
            const { getHeaderValue } = await ctx.getTarget();
            const headers = { 'x-request-id': '12345' };
            expect(getHeaderValue(headers, 'X-Request-ID')).to.equal('12345');
        });

        it('should return undefined for missing header', async() => {
            const ctx = new TestContext();
            const { getHeaderValue } = await ctx.getTarget();
            const headers = { 'content-type': 'application/json' };
            expect(getHeaderValue(headers, 'missing-header')).to.be.undefined;
        });

        it('should return undefined for empty headers object', async() => {
            const ctx = new TestContext();
            const { getHeaderValue } = await ctx.getTarget();
            const headers = {};
            expect(getHeaderValue(headers, 'any-header')).to.be.undefined;
        });
    });

    describe('getCerts', () => {
        it('should make a GET request to pckcerts endpoint with correct parameters', async() => {
            const ctx = new TestContext();
            const { getCerts } = await ctx.getTarget();

            await getCerts(ctx.testEncPpid, ctx.testPceid);

            expect(ctx.gotStub.calledOnce).to.be.true;
            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[0]).to.include('/pckcerts');
            expect(callArgs[1].method).to.equal('GET');
            expect(callArgs[1].searchParams.encrypted_ppid).to.equal(ctx.testEncPpid);
            expect(callArgs[1].searchParams.pceid).to.equal(ctx.testPceid);
        });

        it('should include ApiKey in headers for early access portal', async() => {
            const ctx = new TestContext();
            ctx.setConfigValues({
                uri:    'https://validation.api.trustedservices.intel.com/sgx/certification/v4/',
                ApiKey: 'test-api-key-12345',
            });
            const { getCerts } = await ctx.getTarget();

            await getCerts('encPpidValue', 'pceid123');

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[1].headers['Ocp-Apim-Subscription-Key']).to.equal('test-api-key-12345');
        });

        it('should return response from got', async() => {
            const ctx = new TestContext();
            const { getCerts } = await ctx.getTarget();

            const response = await getCerts(ctx.testEncPpid, ctx.testPceid);

            expect(response.statusCode).to.equal(200);
        });

        it('should use configured timeout and retry values', async() => {
            const ctx = new TestContext().setConfigValues({
                PcsRequestTimeoutSeconds: 6,
                PcsMaxRetryCount:         4,
            });
            const { getCerts } = await ctx.getTarget();

            await getCerts(ctx.testEncPpid, ctx.testPceid);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[1].timeout.request).to.equal(6000);
            expect(callArgs[1].retry.limit).to.equal(4);
        });
    });

    describe('getCertsWithManifest', () => {
        it('should make a POST request to pckcerts endpoint with manifest', async() => {
            const ctx = new TestContext();
            const { getCertsWithManifest } = await ctx.getTarget();

            const manifest = { data: 'manifest-data' };
            await getCertsWithManifest(manifest, ctx.testPceid);

            expect(ctx.gotStub.calledOnce).to.be.true;
            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[0]).to.include('/pckcerts');
            expect(callArgs[1].method).to.equal('POST');
            expect(callArgs[1].json.platformManifest).to.deep.equal(manifest);
            expect(callArgs[1].json.pceid).to.equal(ctx.testPceid);
        });

        it('should include content-type and api key headers', async() => {
            const ctx = new TestContext();
            ctx.setConfigValues({
                uri:    'https://validation.api.trustedservices.intel.com/sgx/certification/v4/',
                ApiKey: 'test-api-key',
            });
            const { getCertsWithManifest } = await ctx.getTarget();

            await getCertsWithManifest({}, ctx.testPceid);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[1].headers['Ocp-Apim-Subscription-Key']).to.equal('test-api-key');
            expect(callArgs[1].headers['Content-Type']).to.equal('application/json');
        });
    });

    describe('getPckCrl', () => {
        it('should make a GET request to pckcrl endpoint with lowercase ca', async() => {
            const ctx = new TestContext();
            const { getPckCrl } = await ctx.getTarget();

            await getPckCrl(ctx.testCa.toUpperCase());

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[0]).to.include('/pckcrl');
            expect(callArgs[1].method).to.equal('GET');
            expect(callArgs[1].searchParams.ca).to.equal(ctx.testCa);
            expect(callArgs[1].searchParams.encoding).to.equal('der');
        });

        it('should return crl response data', async() => {
            const ctx = new TestContext();
            const { getPckCrl } = await ctx.getTarget();
            const ca = 'platform';

            const response = await getPckCrl(ca);

            expect(response.statusCode).to.equal(200);
        });
    });

    describe('getTcb', () => {
        it('should make a GET request to tcb endpoint for SGX type', async() => {
            const ctx = new TestContext();
            ctx.setConfigValues({
                uri: 'https://api.trustedservices.intel.com/sgx/certification/v4/',
            });
            const { getTcb } = await ctx.getTarget();

            await getTcb(PROD_TYPE_SGX, ctx.testFmspc, ctx.testVersion, UPDATE_TYPE_STANDARD);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[0]).to.include('/tcb');
            expect(callArgs[1].method).to.equal('GET');
            expect(callArgs[1].searchParams.fmspc).to.equal('fmspc123');
            expect(callArgs[1].searchParams.update).to.equal('standard');
        });

        it('should convert to TDX URL when type is tdx', async() => {
            const ctx = new TestContext();
            ctx.setConfigValues({
                uri: 'https://api.trustedservices.intel.com/sgx/certification/v4/',
            });
            const { getTcb } = await ctx.getTarget();

            await getTcb(PROD_TYPE_TDX, ctx.testFmspc, ctx.testVersion, UPDATE_TYPE_STANDARD);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[0]).to.equal('https://api.trustedservices.intel.com/tdx/certification/v4/tcb');
        });

        it('should set update to early when updateType is early', async() => {
            const ctx = new TestContext();
            const { getTcb } = await ctx.getTarget();

            await getTcb(PROD_TYPE_SGX, ctx.testFmspc, ctx.testVersion, UPDATE_TYPE_EARLY);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[1].searchParams.update).to.equal('early');
        });

        it('should throw error for EOL v3 version', async() => {
            const ctx = new TestContext();
            const { getTcb } = await ctx.getTarget();

            try {
                await getTcb(PROD_TYPE_SGX, ctx.testFmspc, ctx.eolVersion, UPDATE_TYPE_STANDARD);
                expect.fail('Should have thrown error');
            } catch (err) {
                expect(err.message).to.include('PCS API version 3 reached planned EOL');
            }
        });

        it('should throw error for invalid product type', async() => {
            const ctx = new TestContext();
            const { getTcb } = await ctx.getTarget();

            try {
                await getTcb(999, ctx.testFmspc, ctx.testVersion, UPDATE_TYPE_STANDARD);
                expect.fail('Should have thrown error');
            } catch (err) {
                expect(err.message).to.include('Internal server error');
            }
        });

        it('should throw error for invalid update type', async() => {
            const ctx = new TestContext();
            const { getTcb } = await ctx.getTarget();

            try {
                await getTcb(PROD_TYPE_SGX, ctx.testFmspc, ctx.testVersion, 'INVALID');
                expect.fail('Should have thrown error');
            } catch (err) {
                expect(err.message).to.include('Internal server error');
            }
        });
    });

    describe('getEnclaveIdentity', () => {
        it('should make a GET request to qe/identity endpoint', async() => {
            const ctx = new TestContext();
            const { getEnclaveIdentity } = await ctx.getTarget();

            await getEnclaveIdentity(QE_IDENTITY_ID, ctx.testVersion, UPDATE_TYPE_STANDARD);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[0]).to.include('/qe/identity');
            expect(callArgs[1].method).to.equal('GET');
            expect(callArgs[1].searchParams.update).to.equal('standard');
        });

        it('should use qve/identity endpoint for QVE_IDENTITY', async() => {
            const ctx = new TestContext();
            const { getEnclaveIdentity } = await ctx.getTarget();

            await getEnclaveIdentity(QVE_IDENTITY_ID, ctx.testVersion, UPDATE_TYPE_STANDARD);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[0]).to.include('/qve/identity');
        });

        it('should convert to TDX URL for TDQE_IDENTITY', async() => {
            const ctx = new TestContext();
            const { getEnclaveIdentity } = await ctx.getTarget();

            await getEnclaveIdentity(TDQE_IDENTITY_ID, ctx.testVersion, UPDATE_TYPE_STANDARD);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[0]).to.include('/tdx/');
        });

        it('should set update to early when updateType is early', async() => {
            const ctx = new TestContext();
            const { getEnclaveIdentity } = await ctx.getTarget();

            await getEnclaveIdentity(QE_IDENTITY_ID, ctx.testVersion, UPDATE_TYPE_EARLY);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[1].searchParams.update).to.equal('early');
        });

        it('should throw error for v3 version', async() => {
            const ctx = new TestContext();
            const { getEnclaveIdentity } = await ctx.getTarget();

            try {
                await getEnclaveIdentity(QE_IDENTITY_ID, ctx.eolVersion, UPDATE_TYPE_STANDARD);
                expect.fail('Should have thrown error');
            } catch (err) {
                expect(err.message).to.include('PCS API version 3 reached planned EOL');
            }
        });

        it('should throw error for invalid enclave id', async() => {
            const ctx = new TestContext();
            const { getEnclaveIdentity } = await ctx.getTarget();

            try {
                await getEnclaveIdentity(999, ctx.testVersion, UPDATE_TYPE_STANDARD);
                expect.fail('Should have thrown error');
            } catch (err) {
                expect(err.message).to.include('Internal server error');
            }
        });

        it('should throw error for invalid update type', async() => {
            const ctx = new TestContext();
            const { getEnclaveIdentity } = await ctx.getTarget();

            try {
                await getEnclaveIdentity(QE_IDENTITY_ID, ctx.testVersion, 'INVALID');
                expect.fail('Should have thrown error');
            } catch (err) {
                expect(err.message).to.include('Internal server error');
            }
        });
    });

    describe('getFileFromUrl', () => {
        it('should download file from given URL', async() => {
            const ctx = new TestContext();
            ctx.gotStub = sinon.stub().returns({
                buffer: sinon.stub().resolves(Buffer.from('file-content-data')),
            });
            const { getFileFromUrl } = await ctx.getTarget();

            const result = await getFileFromUrl(ctx.testUrl);

            expect(result).to.deep.equal(Buffer.from('file-content-data'));
            expect(ctx.gotStub.calledOnce).to.be.true;
        });

        it('should call got with correct parameters', async() => {
            const ctx = new TestContext();
            ctx.gotStub = sinon.stub().returns({
                buffer: sinon.stub().resolves(Buffer.from('data')),
            });
            const { getFileFromUrl } = await ctx.getTarget();

            await getFileFromUrl(ctx.testUrl);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[0]).to.equal(ctx.testUrl);
            expect(callArgs[1].agent.https).to.exist;
            expect(callArgs[1].timeout.request).to.equal(16000);
        });

        it('should use configured timeout for file download', async() => {
            const ctx = new TestContext().setConfigValues({
                PcsRequestTimeoutSeconds: 6,
            });
            ctx.gotStub = sinon.stub().returns({
                buffer: sinon.stub().resolves(Buffer.from('data')),
            });
            const { getFileFromUrl } = await ctx.getTarget();

            await getFileFromUrl(ctx.testUrl);

            const callArgs = ctx.gotStub.getCall(0).args;
            expect(callArgs[1].timeout.request).to.equal(6000);
        });

        it('should handle download errors gracefully', async() => {
            const ctx = new TestContext();
            ctx.gotStub = sinon.stub().returns({
                buffer: sinon.stub().rejects(new Error('Download failed')),
            });
            const { getFileFromUrl } = await ctx.getTarget();

            try {
                await getFileFromUrl(ctx.testUrl);
                expect.fail('Should have thrown error');
            } catch (err) {
                expect(err.message).to.equal('Download failed');
            }
        });
    });

    describe('outbound PCS transport security', () => {
        it('does not disable TLS certificate validation on outbound requests to the configured PCS uri', async() => {
            const ctx = new TestContext();
            const { getPckCrl } = await ctx.getTarget();

            await getPckCrl(ctx.testCa);

            expect(ctx.gotStub.calledOnce).to.be.true;
            const [, options] = ctx.gotStub.getCall(0).args;
            expect(options.rejectUnauthorized, 'must not disable certificate validation via rejectUnauthorized:false').to.not.equal(false);
            expect(
                options.https && options.https.rejectUnauthorized,
                'must not disable certificate validation via https.rejectUnauthorized:false'
            ).to.not.equal(false);
        });
    });
});


describe('optional PCS subscription key', () => {
    const portals = [
        ['production', 'https://api.trustedservices.intel.com/sgx/certification/v4/'],
        ['early-access', 'https://validation.api.trustedservices.intel.com/sgx/certification/v4/'],
    ];

    // node-config throws on Config.get of an unset key. The default test double
    // returns '' instead, which would hide a removed Config.has('ApiKey') guard.
    function throwOnMissingKey(ctx) {
        const get = ctx.config.get.bind(ctx.config);
        ctx.config.get = (key) => {
            if (!ctx.config.has(key)) {
                throw new Error(`Configuration property "${key}" is not defined`);
            }
            return get(key);
        };
    }

    async function pckCertHeaders(ctx) {
        const client = await ctx.getTarget();
        await client.getCerts('ppid', '0000');
        await client.getCertsWithManifest('manifest', '0000');
        const byMethod = {};
        for (const call of ctx.gotStub.getCalls()) {
            byMethod[call.args[1].method] = call.args[1].headers;
        }
        return byMethod;
    }

    for (const [portal, uri] of portals) {
        it(`omits Ocp-Apim-Subscription-Key when ApiKey is missing on the ${portal} portal`, async() => {
            const ctx = new TestContext().setConfigValues({ uri });
            throwOnMissingKey(ctx);
            const headers = await pckCertHeaders(ctx);

            expect(headers.GET).to.not.have.property('Ocp-Apim-Subscription-Key');
            expect(headers.GET).to.not.have.property('Content-Type');
            expect(headers.POST).to.not.have.property('Ocp-Apim-Subscription-Key');
            expect(headers.POST['Content-Type']).to.equal('application/json');
        });

        it(`omits Ocp-Apim-Subscription-Key when ApiKey is blank on the ${portal} portal`, async() => {
            const ctx = new TestContext().setConfigValues({ uri, ApiKey: '' });
            throwOnMissingKey(ctx);
            const headers = await pckCertHeaders(ctx);

            expect(headers.GET).to.not.have.property('Ocp-Apim-Subscription-Key');
            expect(headers.POST).to.not.have.property('Ocp-Apim-Subscription-Key');
            expect(headers.POST['Content-Type']).to.equal('application/json');
        });

        it(`sends the configured key on GET and POST pckcerts on the ${portal} portal`, async() => {
            const ctx = new TestContext().setConfigValues({ uri, ApiKey: 'subscription' });
            throwOnMissingKey(ctx);
            const headers = await pckCertHeaders(ctx);

            expect(headers.GET['Ocp-Apim-Subscription-Key']).to.equal('subscription');
            expect(headers.GET).to.not.have.property('Content-Type');
            expect(headers.POST['Ocp-Apim-Subscription-Key']).to.equal('subscription');
            expect(headers.POST['Content-Type']).to.equal('application/json');
        });
    }
});


describe('PCS evaluation-number list URLs', () => {
    for (const [type, prefix] of [[PROD_TYPE_SGX, 'sgx'], [PROD_TYPE_TDX, 'tdx']]) {
        it(`uses the v4 ${prefix} list endpoint`, async() => {
            const ctx = new TestContext();
            const client = await ctx.getTarget();
            await client.getTcbEvalDataNumbers(type);
            expect(ctx.gotStub.firstCall.args[0]).to.equal(`https://api.trustedservices.intel.com/${prefix}/certification/v4/tcbevaluationdatanumbers`);
        });
    }
});


describe('PCS evaluation-number selection', () => {
    for (const method of ['getTcb', 'getEnclaveIdentity']) {
        it(`sends only the explicit evaluation number for ${method}`, async() => {
            const ctx = new TestContext();
            const client = await ctx.getTarget();
            const args = method === 'getTcb' ? [PROD_TYPE_SGX, ctx.testFmspc, 4] : [QE_IDENTITY_ID, 4];
            await client[method](...args, Constants.UPDATE_TYPE_TCBEDN, 7);
            const query = ctx.gotStub.firstCall.args[1].searchParams;
            expect(query.tcbEvaluationDataNumber).to.equal(7);
            expect(query).not.to.have.property('update');
        });
    }
});
