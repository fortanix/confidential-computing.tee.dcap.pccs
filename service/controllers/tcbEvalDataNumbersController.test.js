/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { expect } from 'chai';
import esmock from 'esmock';
import sinon from 'sinon';
import Constants from '../constants/index.js';

describe('evaluation-number controllers', () => {
    for (const [label, name, type] of [
        ['SGX', 'getSgxTcbEvalDataNumbers', Constants.PROD_TYPE_SGX],
        ['TDX', 'getTdxTcbEvalDataNumbers', Constants.PROD_TYPE_TDX],
    ]) {
        async function loadController(service) {
            return esmock('./tcbEvalDataNumbersController.js', {
                '../services/index.js': { tcbEvalDataNumbersService: service },
            }, { '../dao/models/index.js': { sequelize: {} } });
        }

        it(`returns 200 JSON and the ${label} issuer chain`, async() => {
            const service = {
                getTcbEvalDataNumbers: sinon.stub().resolves({
                    contents:                                             'list',
                    [Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN]: 'chain',
                }),
            };
            const controller = await loadController(service);
            const res = { status: sinon.stub().returnsThis(), header: sinon.stub().returnsThis(), send: sinon.spy() };

            await controller[name]({}, res, err => {
                throw err;
            });

            expect(service.getTcbEvalDataNumbers.calledOnceWith(type)).to.equal(true);
            expect(res.status.calledOnceWith(200)).to.equal(true);
            expect(res.header.calledWith('Content-Type', 'application/json')).to.equal(true);
            expect(res.header.calledWith(Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN, 'chain')).to.equal(true);
            expect(res.send.calledOnceWith('list')).to.equal(true);
        });

        it(`forwards a ${label} service error without sending a body`, async() => {
            const error = new Error('PCS down');
            const service = { getTcbEvalDataNumbers: sinon.stub().rejects(error) };
            const controller = await loadController(service);
            const res = { status: sinon.stub().returnsThis(), header: sinon.stub().returnsThis(), send: sinon.spy() };
            const next = sinon.spy();

            await controller[name]({}, res, next);

            expect(next.calledOnceWith(error)).to.equal(true);
            expect(res.send.called).to.equal(false);
        });
    }
});
