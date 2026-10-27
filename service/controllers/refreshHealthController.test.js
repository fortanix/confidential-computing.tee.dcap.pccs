/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';

async function loadController(dao) {
    return esmock('./refreshHealthController.js', { '../dao/cacheTimestampDao.js': dao });
}

function response() {
    return { status: sinon.stub().returnsThis(), send: sinon.spy() };
}

describe('refreshHealthController', () => {
    it('reports missing default and certs timestamps', async() => {
        const info = {
            'default': { success: null, failure: null },
            'certs':   { success: null, failure: null },
        };
        const dao = { getRefreshTimestampsAsObject: sinon.stub().resolves(info) };
        const target = await loadController(dao);
        const res = response();

        await target.getHealth({}, res, (err) => {
            throw err;
        });

        expect(res.status.calledWith(200)).to.equal(true);
        expect(res.send.calledOnce).to.equal(true);
        expect(res.send.firstCall.args[0]).to.deep.equal({ refresh_info: info });
    });

    it('returns a present success and redacts error_msg from a present failure', async() => {
        const info = {
            'default': {
                success: { last_refresh_at: new Date('2026-01-01T00:00:00Z') },
                failure: { last_refresh_at: new Date('2026-01-02T00:00:00Z'), error_msg: 'PCS failed' },
            },
            'certs': {
                success: null,
                failure: null,
            },
        };
        const dao = { getRefreshTimestampsAsObject: sinon.stub().resolves(info) };
        const target = await loadController(dao);
        const res = response();

        await target.getHealth({}, res, (err) => {
            throw err;
        });

        expect(res.status.calledWith(200)).to.equal(true);
        expect(res.send.firstCall.args[0]).to.deep.equal({
            refresh_info: {
                'default': {
                    success: { last_refresh_at: new Date('2026-01-01T00:00:00Z') },
                    failure: { last_refresh_at: new Date('2026-01-02T00:00:00Z') },
                },
                'certs': {
                    success: null,
                    failure: null,
                },
            },
        });
    });

    it('passes a DAO rejection to next and does not send', async() => {
        const error = new Error('DB unavailable');
        const dao = { getRefreshTimestampsAsObject: sinon.stub().rejects(error) };
        const target = await loadController(dao);
        const res = response();
        const next = sinon.spy();

        await target.getHealth({}, res, next);

        expect(next.calledOnceWith(error)).to.equal(true);
        expect(res.send.called).to.equal(false);
    });
});
