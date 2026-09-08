/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import esmock from 'esmock';
import { expect } from 'chai';
import sinon from 'sinon';

class TestContext {
    constructor() {
        this.configValues = {
            uri: 'https://api.trustedservices.intel.com/sgx/certification/v4/',
        };
        this.logger = {
            error: sinon.stub(),
        };
    }

    async getTarget() {
        return await esmock.strict('./apputil.js', {
            'config': {
                'default': {
                    get: key => this.configValues[key],
                    has: key => key in this.configValues,
                },
            },
            './Logger.js':            { 'default': this.logger },
            '../dao/models/index.js': { sequelize: {} },
        });
    }
}

describe('apputil', () => {
    describe('startupCheck', () => {
        afterEach(() => {
            delete global.PCS_VERSION;
        });

        it('fails closed and logs an error when the configured PCS uri is not https', async() => {
            global.PCS_VERSION = 4;
            const ctx = new TestContext();
            ctx.configValues.uri = 'http://insecure.example.com/sgx/certification/v4/';
            const { startupCheck } = await ctx.getTarget();

            expect(startupCheck()).to.be.false;
            expect(ctx.logger.error.calledOnce).to.be.true;
        });

        it('succeeds when the configured PCS uri is https and the API version is supported', async() => {
            global.PCS_VERSION = 4;
            const ctx = new TestContext();
            const { startupCheck } = await ctx.getTarget();

            expect(startupCheck()).to.be.true;
            expect(ctx.logger.error.called).to.be.false;
        });

        it('still fails when the API version is unsupported, even with a valid https uri', async() => {
            global.PCS_VERSION = 5;
            const ctx = new TestContext();
            const { startupCheck } = await ctx.getTarget();

            expect(startupCheck()).to.be.false;
        });

        it('fails closed and logs an error, rather than throwing, when the PCS uri is missing from config entirely', async() => {
            global.PCS_VERSION = 4;
            const ctx = new TestContext();
            delete ctx.configValues.uri;
            const { startupCheck } = await ctx.getTarget();

            let result;
            expect(() => {
                result = startupCheck();
            }).to.not.throw();
            expect(result).to.be.false;
            expect(ctx.logger.error.calledOnce).to.be.true;
        });
    });
});
