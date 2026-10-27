/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { expect } from 'chai';
import esmock from 'esmock';
import sinon from 'sinon';
import Constants from '../constants/index.js';
import PccsStatus from '../constants/pccs_status_code.js';
import { parseTcbEvalDataNumbersResponse } from '../utils/tcbEvalDataNumbers.js';

const CHAIN_HEADER = Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN.toLowerCase();

describe('TCB evaluation-number lists', () => {
    for (const [label, type] of [['SGX', Constants.PROD_TYPE_SGX], ['TDX', Constants.PROD_TYPE_TDX]]) {
        it(`returns cached ${label} contents and chain without calling PCS`, async() => {
            const contents = Buffer.from('cached');
            const fetch = sinon.stub();
            const service = await esmock('./tcbEvalDataNumbersService.js', {
                '../dao/tcbEvalDataNumbersDao.js': {
                    getTcbEvalDataNumbers: async() => ({ contents, signing_cert: 'signing', root_cert: 'root' }),
                },
                './caching_modes/cachingModeManager.js': { cachingModeManager: { getTcbEvalDataNumbersFromPCS: fetch } },
            });

            const result = await service.getTcbEvalDataNumbers(type);

            expect(result.contents).to.equal(contents);
            expect(result[Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN]).to.equal('signingroot');
            expect(fetch.called).to.equal(false);
        });

        it(`delegates a ${label} cache miss to PCS`, async() => {
            const fetch = sinon.stub().resolves({ contents: 'fresh' });
            const service = await esmock('./tcbEvalDataNumbersService.js', {
                '../dao/tcbEvalDataNumbersDao.js':       { getTcbEvalDataNumbers: async() => null },
                './caching_modes/cachingModeManager.js': { cachingModeManager: { getTcbEvalDataNumbersFromPCS: fetch } },
            });

            expect(await service.getTcbEvalDataNumbers(type)).to.deep.equal({ contents: 'fresh' });
            expect(fetch.calledOnceWith(type)).to.equal(true);
        });

        it(`preserves a ${label} PCS error from a cache miss`, async() => {
            const error = new Error('PCS down');
            const fetch = sinon.stub().rejects(error);
            const service = await esmock('./tcbEvalDataNumbersService.js', {
                '../dao/tcbEvalDataNumbersDao.js':       { getTcbEvalDataNumbers: async() => null },
                './caching_modes/cachingModeManager.js': { cachingModeManager: { getTcbEvalDataNumbersFromPCS: fetch } },
            });

            try {
                await service.getTcbEvalDataNumbers(type);
                expect.fail('expected the PCS error');
            } catch (err) {
                expect(err).to.equal(error);
            }
        });
    }

    it('parses a successful body and its issuer-chain header', () => {
        const value = parseTcbEvalDataNumbersResponse({
            statusCode: 200,
            body:       'list',
            headers:    { [CHAIN_HEADER]: 'chain' },
        });

        expect(value.contents.toString()).to.equal('list');
        expect(value[Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN]).to.equal('chain');
    });

    for (const [why, response] of [
        ['PCS 503', { statusCode: 503, headers: {} }],
        ['missing issuer chain', { statusCode: 200, body: 'list', headers: {} }],
        ['empty body', { statusCode: 200, body: '', headers: { [CHAIN_HEADER]: 'chain' } }],
    ]) {
        it(`rejects ${why} as no cache data`, () => {
            expect(() => parseTcbEvalDataNumbersResponse(response)).to.throw()
                .with.property('status', PccsStatus.PCCS_STATUS_NO_CACHE_DATA[0]);
        });
    }
});

function makeEdnPayload(numbers, nextUpdate) {
    return Buffer.from(JSON.stringify({
        tcbEvaluationDataNumbers: {
            nextUpdate,
            tcbEvalNumbers: numbers.map(n => ({ tcbEvaluationDataNumber: n })),
        },
    }));
}

describe('known evaluation-number validation before caching collateral', () => {
    it('accepts an evaluation number present in the cached list without calling PCS', async() => {
        const fetch = sinon.stub();
        const service = await esmock('./tcbEvalDataNumbersService.js', {
            '../dao/tcbEvalDataNumbersDao.js': {
                getTcbEvalDataNumbers: async() => ({ contents: makeEdnPayload([17, 18, 19]) }),
            },
            './caching_modes/cachingModeManager.js': { cachingModeManager: { getTcbEvalDataNumbersFromPCS: fetch } },
        });

        await service.ensureKnownTcbEvaluationDataNumber(Constants.PROD_TYPE_SGX, 18);
        expect(fetch.called).to.equal(false);
    });

    it('refreshes the list from PCS when the requested number is missing from cache and accepts if now present', async() => {
        const fetch = sinon.stub().resolves({ contents: makeEdnPayload([17, 18, 19, 20]) });
        const service = await esmock('./tcbEvalDataNumbersService.js', {
            '../dao/tcbEvalDataNumbersDao.js': {
                getTcbEvalDataNumbers: async() => ({ contents: makeEdnPayload([17, 18, 19]) }),
            },
            './caching_modes/cachingModeManager.js': { cachingModeManager: { getTcbEvalDataNumbersFromPCS: fetch } },
        });

        await service.ensureKnownTcbEvaluationDataNumber(Constants.PROD_TYPE_SGX, 20);
        expect(fetch.calledOnceWith(Constants.PROD_TYPE_SGX)).to.equal(true);
    });

    it('rejects an unknown evaluation number with PCCS_STATUS_INVALID_REQ and does not allow collateral fetch', async() => {
        const fetchEdn = sinon.stub().resolves({ contents: makeEdnPayload([17, 18, 19]) });
        const fetchTcb = sinon.stub();
        const fetchIdentity = sinon.stub();
        const ednService = await esmock('./tcbEvalDataNumbersService.js', {
            '../dao/tcbEvalDataNumbersDao.js': {
                getTcbEvalDataNumbers: async() => ({ contents: makeEdnPayload([17, 18, 19]) }),
            },
            './caching_modes/cachingModeManager.js': { cachingModeManager: { getTcbEvalDataNumbersFromPCS: fetchEdn } },
        });
        const tcbService = await esmock('./tcbinfoService.js', {
            '../dao/fmspcTcbDao.js':                 { getTcbInfo: async() => null },
            './tcbEvalDataNumbersService.js':        ednService,
            './caching_modes/cachingModeManager.js': { cachingModeManager: { getTcbInfoFromPCS: fetchTcb } },
        });
        const idService = await esmock('./identityService.js', {
            '../dao/enclaveIdentityDao.js':          { getEnclaveIdentity: async() => null },
            './tcbEvalDataNumbersService.js':        ednService,
            './caching_modes/cachingModeManager.js': { cachingModeManager: { getEnclaveIdentityFromPCS: fetchIdentity } },
        });

        for (const fn of [
            () => tcbService.getTcbInfo(Constants.PROD_TYPE_SGX, '001122334455', 4, Constants.UPDATE_TYPE_TCBEDN, 999),
            () => idService.getEnclaveIdentity(Constants.TDQE_IDENTITY_ID, 4, Constants.UPDATE_TYPE_TCBEDN, 999),
        ]) {
            let caught;
            try {
                // eslint-disable-next-line no-await-in-loop
                await fn();
            } catch (err) {
                caught = err;
            }
            expect(caught?.status).to.equal(PccsStatus.PCCS_STATUS_INVALID_REQ[0]);
        }
        expect(fetchEdn.firstCall.args[0]).to.equal(Constants.PROD_TYPE_SGX);
        expect(fetchEdn.secondCall.args[0]).to.equal(Constants.PROD_TYPE_TDX);
        expect(fetchTcb.called).to.equal(false);
        expect(fetchIdentity.called).to.equal(false);
    });

    it('serves already-cached collateral without consulting the evaluation-number list', async() => {
        const ensureStub = sinon.stub();
        const tcbService = await esmock('./tcbinfoService.js', {
            '../dao/fmspcTcbDao.js': {
                getTcbInfo: async() => ({ tcbinfo: Buffer.from('tcb'), signing_cert: 's', root_cert: 'r' }),
            },
            './tcbEvalDataNumbersService.js': { ensureKnownTcbEvaluationDataNumber: ensureStub },
        });

        const res = await tcbService.getTcbInfo(
            Constants.PROD_TYPE_SGX,
            '001122334455',
            4,
            Constants.UPDATE_TYPE_TCBEDN,
            7
        );
        expect(res.tcbinfo.toString()).to.equal('tcb');
        expect(ensureStub.called).to.equal(false);
    });
});


describe('evaluation-number list freshness and refresh coalescing', () => {
    afterEach(() => sinon.restore());

    async function load(cached, fetch) {
        return esmock('./tcbEvalDataNumbersService.js', {
            '../dao/tcbEvalDataNumbersDao.js':       { getTcbEvalDataNumbers: async() => cached },
            './caching_modes/cachingModeManager.js': { cachingModeManager: { getTcbEvalDataNumbersFromPCS: fetch } },
        });
    }

    async function unknownRequests(service, number = 999) {
        const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
            service.ensureKnownTcbEvaluationDataNumber(Constants.PROD_TYPE_SGX, number)));
        for (const result of results) {
            expect(result.status).to.equal('rejected');
            expect(result.reason.status).to.equal(PccsStatus.PCCS_STATUS_INVALID_REQ[0]);
        }
    }

    it('rejects concurrent unknown numbers from a fresh cached list without PCS traffic', async() => {
        const fetch = sinon.stub();
        const service = await load({ contents: makeEdnPayload([22], new Date(Date.now() + 3600000)) }, fetch);

        await unknownRequests(service);

        expect(fetch.called).to.equal(false);
    });

    for (const [label, cached] of [
        ['missing', null],
        ['expired', { contents: makeEdnPayload([22], '2000-01-01T00:00:00Z') }],
        ['unparseable', { contents: Buffer.from('invalid JSON') }],
    ]) {
        it(`coalesces concurrent misses for a ${label} list and enforces a 60-second cooldown`, async() => {
            const clock = sinon.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
            const fetch = sinon.stub().callsFake(async() => {
                await new Promise(resolve => setImmediate(resolve));
                return { contents: makeEdnPayload([22]) };
            });
            const service = await load(cached, fetch);

            await unknownRequests(service);
            expect(fetch.calledOnceWithExactly(Constants.PROD_TYPE_SGX)).to.equal(true);
            clock.tick(59999);
            await unknownRequests(service, 998);
            expect(fetch.callCount).to.equal(1);
            clock.tick(1);
            await unknownRequests(service);
            expect(fetch.callCount).to.equal(2);
        });
    }

    it('accepts a newly published number after one shared refresh of an expired list', async() => {
        const fetch = sinon.stub().callsFake(async() => {
            await new Promise(resolve => setImmediate(resolve));
            return { contents: makeEdnPayload([22, 23]) };
        });
        const service = await load({ contents: makeEdnPayload([22], '2000-01-01T00:00:00Z') }, fetch);

        await Promise.all(Array.from({ length: 10 }, () =>
            service.ensureKnownTcbEvaluationDataNumber(Constants.PROD_TYPE_SGX, 23)));

        expect(fetch.calledOnce).to.equal(true);
    });

    it('shares a failed refresh and cools down independently for each product type', async() => {
        const error = new Error('PCS unavailable');
        const fetch = sinon.stub().rejects(error);
        const service = await load(null, fetch);
        const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
            service.ensureKnownTcbEvaluationDataNumber(Constants.PROD_TYPE_SGX, 999)));
        expect(results.every(result => result.status === 'rejected' && result.reason === error)).to.equal(true);
        expect(fetch.callCount).to.equal(1);

        await unknownRequests(service);
        expect(fetch.callCount).to.equal(1);
        fetch.resolves({ contents: makeEdnPayload([23]) });
        await service.ensureKnownTcbEvaluationDataNumber(Constants.PROD_TYPE_TDX, 23);
        expect(fetch.callCount).to.equal(2);
        service.resetListRefreshStateForTests();
        await service.ensureKnownTcbEvaluationDataNumber(Constants.PROD_TYPE_SGX, 23);
        expect(fetch.callCount).to.equal(3);
    });
});
