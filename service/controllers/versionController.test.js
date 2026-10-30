/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { expect } from 'chai';
import sinon from 'sinon';
import { getVersion } from './versionController.js';
import pkg from '../package.json' with { type: 'json' };

describe('versionController', () => {
    it('reports the checked-out package version', () => {
        const res = { status: sinon.stub().returnsThis(), send: sinon.spy() };
        getVersion({}, res, err => {
            throw err;
        });
        expect(res.status.calledWith(200)).to.equal(true);
        expect(res.send.firstCall.args[0]).to.deep.equal({ version: pkg.version });
    });

    it('passes response failures to the error handler', () => {
        const error = new Error('response failed');
        const next = sinon.spy();
        getVersion({}, {
            status: () => {
                throw error;
            }
        }, next);
        expect(next.calledWith(error)).to.equal(true);
    });
});
