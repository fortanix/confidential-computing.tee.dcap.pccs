/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import ControllerTestContext from './ControllerTestContext.js';
import sinon from 'sinon';
import { expect } from 'chai';
import assert from 'assert/strict';
import PccsStatus from '../constants/pccs_status_code.js';

class TestContext extends ControllerTestContext {
    constructor() {
        super('./refreshController.js');
        this.fmspc = 'abcdabcdabcd';
        this.type = undefined;
        this.refreshService = {
            refreshCache: sinon.stub()
        };
        this.serviceStubs['../services/refreshService.js'] = this.refreshService;
    }

    getRequest() {
        const query = { fmspc: this.fmspc };
        if (this.type !== undefined) {
            query.type = this.type;
        }

        return { query };
    }
}

describe('refreshController', () => {
    describe('Positive test cases', () => {
        it('positive refresh cache with default type', async() => {
            const ctx = new TestContext();
            const target = await ctx.getTarget();
            ctx.refreshService.refreshCache.resolves();

            await target.refreshCache(ctx.getRequest(), ctx.response, ctx.next);

            expect(ctx.refreshService.refreshCache.calledWith(undefined, ctx.fmspc)).to.be.true;
            expect(ctx.response.status.calledWith(PccsStatus.PCCS_STATUS_SUCCESS[0])).to.be.true;
            expect(ctx.response.send.calledWith(PccsStatus.PCCS_STATUS_SUCCESS[1])).to.be.true;
        });

        it('positive refresh certs type', async() => {
            const ctx = new TestContext();
            const target = await ctx.getTarget();
            ctx.type = 'certs';
            ctx.refreshService.refreshCache.resolves();

            await target.refreshCache(ctx.getRequest(), ctx.response, ctx.next);

            expect(ctx.refreshService.refreshCache.calledWith('certs', ctx.fmspc.toUpperCase())).to.be.true;
            expect(ctx.response.status.calledWith(PccsStatus.PCCS_STATUS_SUCCESS[0])).to.be.true;
            expect(ctx.response.send.calledWith(PccsStatus.PCCS_STATUS_SUCCESS[1])).to.be.true;
        });
    });

    describe('Input validation', () => {
        it('invalid fmspc', async() => {
            const ctx = new TestContext();
            const target = await ctx.getTarget();
            ctx.type = 'certs';
            ctx.fmspc = 'invalidFmspc';

            await assert.rejects(
                () => target.refreshCache(ctx.getRequest(), ctx.response, ctx.next),
                (err) => err.status === PccsStatus.PCCS_STATUS_INVALID_REQ[0]
            );

            expect(ctx.refreshService.refreshCache.notCalled).to.be.true;
        });

        it('invalid refresh type', async() => {
            const ctx = new TestContext();
            const target = await ctx.getTarget();
            ctx.type = 'all';

            await assert.rejects(
                () => target.refreshCache(ctx.getRequest(), ctx.response, ctx.next),
                (err) => err.status === PccsStatus.PCCS_STATUS_INVALID_REQ[0]
            );

            expect(ctx.refreshService.refreshCache.notCalled).to.be.true;
        });
    });
});


describe('certificate refresh FMSPC compatibility', () => {
    const accepted = [
        { why: 'a missing filter', value: undefined, expected: '' },
        { why: 'a null filter', value: null, expected: '' },
        { why: 'an empty filter', value: '', expected: '' },
        { why: 'one FMSPC', value: 'abcdabcdabcd', expected: 'ABCDABCDABCD' },
        { why: 'a comma-separated list', value: 'abcdabcdabcd,112233445566', expected: 'ABCDABCDABCD,112233445566' },
        { why: 'duplicate FMSPCs', value: 'abcdabcdabcd,abcdabcdabcd', expected: 'ABCDABCDABCD,ABCDABCDABCD' },
    ];
    for (const { why, value, expected } of accepted) {
        it(`accepts ${why} as ${JSON.stringify(expected)}`, async() => {
            const ctx = new TestContext();
            ctx.type = 'certs';
            ctx.fmspc = value;
            ctx.refreshService.refreshCache.resolves();
            const target = await ctx.getTarget();

            await target.refreshCache(ctx.getRequest(), ctx.response, ctx.next);

            expect(ctx.refreshService.refreshCache.calledWith('certs', expected)).to.be.true;
            expect(ctx.response.status.calledWith(PccsStatus.PCCS_STATUS_SUCCESS[0])).to.be.true;
            expect(ctx.response.send.calledWith(PccsStatus.PCCS_STATUS_SUCCESS[1])).to.be.true;
        });
    }

    const rejected = [
        { why: 'an empty entry', value: ',' },
        { why: 'a trailing empty entry', value: 'abcdabcdabcd,' },
        { why: 'a leading empty entry', value: ',abcdabcdabcd' },
        { why: 'whitespace in an entry', value: 'abcdabcdabcd,   ' },
        { why: 'whitespace before an FMSPC', value: 'abcdabcdabcd, 112233445566' },
        { why: 'a non-hex entry', value: 'abcdabcdabcd,invalid' },
        { why: 'a non-string filter', value: ['abcdabcdabcd'] },
        { why: 'the literal all', value: 'all' },
        { why: 'the literal ALL', value: 'ALL' },
    ];
    for (const { why, value } of rejected) {
        it(`rejects ${why}`, async() => {
            const ctx = new TestContext();
            ctx.type = 'certs';
            ctx.fmspc = value;
            const target = await ctx.getTarget();

            await assert.rejects(
                () => target.refreshCache(ctx.getRequest(), ctx.response, ctx.next),
                err => err.status === PccsStatus.PCCS_STATUS_INVALID_REQ[0] &&
                    err.message === PccsStatus.PCCS_STATUS_INVALID_REQ[1]
            );

            expect(ctx.refreshService.refreshCache.called).to.be.false;
            expect(ctx.response.send.called).to.be.false;
        });
    }
});
