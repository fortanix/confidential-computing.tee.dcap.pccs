/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import esmock from 'esmock';
import { expect } from 'chai';
import sinon from 'sinon';

describe('logRealIp', () => {
    async function load(info) {
        return (await esmock('./logRealIp.js', {
            '../utils/Logger.js': { info },
        })).default;
    }

    it('logs the proxy x-real-ip header and continues', async() => {
        const info = sinon.stub();
        const next = sinon.stub();
        const logRealIp = await load(info);

        logRealIp({ headers: { 'x-real-ip': '203.0.113.10' } }, {}, next);

        expect(info.calledOnceWith('Client X-Real-IP : 203.0.113.10')).to.be.true;
        expect(next.calledOnce).to.be.true;
    });

    it('logs the first address when the proxy repeats the header', async() => {
        const info = sinon.stub();
        const next = sinon.stub();
        const logRealIp = await load(info);

        logRealIp({ headers: { 'x-real-ip': ['203.0.113.10', '198.51.100.8'] } }, {}, next);

        expect(info.calledOnceWith('Client X-Real-IP : 203.0.113.10')).to.be.true;
        expect(next.calledOnce).to.be.true;
    });

    it('does not log when the header is missing or blank', async() => {
        const info = sinon.stub();
        const next = sinon.stub();
        const logRealIp = await load(info);

        logRealIp({ headers: {} }, {}, next);
        logRealIp({ headers: { 'x-real-ip': '  \n' } }, {}, next);
        logRealIp({ headers: { 'X-Real-IP': '203.0.113.10' } }, {}, next);

        expect(info.notCalled).to.be.true;
        expect(next.calledThrice).to.be.true;
    });
});
