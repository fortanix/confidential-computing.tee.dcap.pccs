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
                '../dao/tcbEvalDataNumbersDao.js': { getTcbEvalDataNumbers: async() => null },
                './caching_modes/cachingModeManager.js': { cachingModeManager: { getTcbEvalDataNumbersFromPCS: fetch } },
            });

            expect(await service.getTcbEvalDataNumbers(type)).to.deep.equal({ contents: 'fresh' });
            expect(fetch.calledOnceWith(type)).to.equal(true);
        });

        it(`preserves a ${label} PCS error from a cache miss`, async() => {
            const error = new Error('PCS down');
            const fetch = sinon.stub().rejects(error);
            const service = await esmock('./tcbEvalDataNumbersService.js', {
                '../dao/tcbEvalDataNumbersDao.js': { getTcbEvalDataNumbers: async() => null },
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
            body: 'list',
            headers: { [CHAIN_HEADER]: 'chain' },
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
