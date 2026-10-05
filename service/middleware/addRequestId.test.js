/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import esmock from 'esmock';
import { expect } from 'chai';
import sinon from 'sinon';

class TestContext {
    FIXED_UUID = 'aabbccdd-eeff-1122-8899-001122334455';

    constructor() {
        this.req = { headers: {} };
        this.res = { setHeader: sinon.stub() };
        this.next = sinon.stub();
        this.uuidv4 = sinon.stub().returns(this.FIXED_UUID);
        this.setCurrentRequestId = sinon.stub().callsFake((_id, cb) => cb());
    }

    async getTarget() {
        return (await esmock('./addRequestId.js', {
            'uuid':               { v4: this.uuidv4 },
            '../utils/Logger.js': { setCurrentRequestId: this.setCurrentRequestId }
        })).default;
    }
}

describe('addRequestId', () => {
    it('should use provided Request-ID header when present', async() => {
        const c = new TestContext();
        c.req.headers['request-id'] = 'my-custom-id';
        const addRequestId = await c.getTarget();

        addRequestId(c.req, c.res, c.next);

        expect(c.req.requestId).to.equal('my-custom-id');
        expect(c.uuidv4.notCalled).to.be.true;
    });

    it('should generate a UUID without dashes when Request-ID header is absent', async() => {
        const c = new TestContext();
        const addRequestId = await c.getTarget();

        addRequestId(c.req, c.res, c.next);

        expect(c.req.requestId).to.equal(c.FIXED_UUID.replace(/-/g, ''));
        expect(c.uuidv4.calledOnce).to.be.true;
    });

    it('should set the Request-ID response header', async() => {
        const c = new TestContext();
        const addRequestId = await c.getTarget();

        addRequestId(c.req, c.res, c.next);

        expect(c.res.setHeader.calledOnceWith('Request-ID', c.FIXED_UUID.replace(/-/g, ''))).to.be.true;
    });

    it('should set the Request-ID response header to the provided header value', async() => {
        const c = new TestContext();
        c.req.headers['request-id'] = 'existing-id';
        const addRequestId = await c.getTarget();

        addRequestId(c.req, c.res, c.next);

        expect(c.res.setHeader.calledOnceWith('Request-ID', 'existing-id')).to.be.true;
    });

    it('should call setCurrentRequestId with the request ID and next', async() => {
        const c = new TestContext();
        const addRequestId = await c.getTarget();

        addRequestId(c.req, c.res, c.next);

        expect(c.setCurrentRequestId.calledOnceWith(c.FIXED_UUID.replace(/-/g, ''), c.next)).to.be.true;
    });

    it('should call next via setCurrentRequestId', async() => {
        const c = new TestContext();
        const addRequestId = await c.getTarget();

        addRequestId(c.req, c.res, c.next);

        expect(c.next.calledOnce).to.be.true;
    });
});
