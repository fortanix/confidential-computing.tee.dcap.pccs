/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import sinon from 'sinon';
import esmock from 'esmock';

export default class ControllerTestContext {
    constructor(controllerName) {
        this.response = new ResponseStub();
        this.controllerName = controllerName;
        this.serviceStubs = {
            '../services/platformsRegService.js':       {},
            '../services/platformCollateralService.js': {},
            '../services/pckcertService.js':            {},
            '../services/pckcrlService.js':             {},
            '../services/tcbinfoService.js':            {},
            '../services/identityService.js':           {},
            '../services/rootcacrlService.js':          {},
            '../services/refreshService.js':            {},
            '../services/platformsService.js':          {},
            '../services/crlService.js':                {},
            '../services/appraisalPolicyService.js':    {}
        }; //override me
        this.otherStubs = {}; //override me
        this.globalStubs = {
            '../dao/models/index.js': { sequelize: {} }
        }; //override me
    }

    next(err) {
        throw err;
    }

    async getTarget() {
        const services = await esmock.strict('../services/index.js', this.serviceStubs);
        return await esmock.strict(this.controllerName, {
            ...this.otherStubs,
            '../services/index.js': services
        }, this.globalStubs);
    }
}

export class ResponseStub {
    status = sinon.spy(() => this);
    header = sinon.spy(() => this);
    send = sinon.stub();
}
