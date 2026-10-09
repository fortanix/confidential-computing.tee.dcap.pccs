/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import { expect } from 'chai';
import sinon from 'sinon';
import rejectUnexpectedBody from './rejectUnexpectedBody.js';

class TestContext {
    constructor(method, path, headers = {}) {
        this.req = { method, path, headers };
        this.res = {};
        this.next = sinon.stub();
    }

    call() {
        return rejectUnexpectedBody(this.req, this.res, this.next);
    }
}

describe('rejectUnexpectedBody', () => {
    it('calls next without a body present', () => {
        const c = new TestContext('GET', '/sgx/certification/v4/pckcert');

        c.call();

        expect(c.next.calledOnce).to.be.true;
    });

    it('calls next when Content-Length is 0', () => {
        const c = new TestContext('GET', '/sgx/certification/v4/pckcert', { 'content-length': '0' });

        c.call();

        expect(c.next.calledOnce).to.be.true;
    });

    it('calls next for an allowed endpoint carrying a body', () => {
        const c = new TestContext('POST', '/sgx/certification/v4/platforms', { 'content-length': '100' });

        c.call();

        expect(c.next.calledOnce).to.be.true;
    });

    it('allows a v3 endpoint as well as v4', () => {
        const c = new TestContext('POST', '/sgx/certification/v3/platforms', { 'content-length': '100' });

        c.call();

        expect(c.next.calledOnce).to.be.true;
    });

    it('rejects a body on a non-body endpoint with 413', () => {
        const c = new TestContext('GET', '/sgx/certification/v4/pckcert', { 'content-length': '100' });

        expect(() => c.call()).to.throw().with.property('status', 413);
    });

    it('rejects a chunked body on a non-body endpoint even without Content-Length', () => {
        const c = new TestContext('POST', '/sgx/certification/v4/refresh', { 'transfer-encoding': 'chunked' });

        expect(() => c.call()).to.throw().with.property('status', 413);
    });

    it('rejects a body sent to a non-existent endpoint', () => {
        const c = new TestContext('POST', '/sgx/certification/v4/does-not-exist', { 'content-length': '100' });

        expect(() => c.call()).to.throw().with.property('status', 413);
    });

    it('rejects an unmatched path that merely ends with an allowed suffix', () => {
        const c = new TestContext('POST', '/does-not-exist/platforms', { 'content-length': '100' });

        expect(() => c.call()).to.throw().with.property('status', 413);
    });

    it('rejects a body on an allowed path with the wrong method', () => {
        const c = new TestContext('GET', '/sgx/certification/v4/platforms', { 'content-length': '100' });

        expect(() => c.call()).to.throw().with.property('status', 413);
    });

    describe('when only the v3 API is enabled', () => {
        afterEach(() => {
            delete global.PCS_VERSION;
        });

        it('rejects a body on a v4 endpoint since v4 is not mounted', () => {
            global.PCS_VERSION = 3;
            const c = new TestContext('POST', '/sgx/certification/v4/platforms', { 'content-length': '100' });

            expect(() => c.call()).to.throw().with.property('status', 413);
        });

        it('still allows the same endpoint on v3', () => {
            global.PCS_VERSION = 3;
            const c = new TestContext('POST', '/sgx/certification/v3/platforms', { 'content-length': '100' });

            c.call();

            expect(c.next.calledOnce).to.be.true;
        });
    });
});
