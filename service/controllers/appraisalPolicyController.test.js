/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import { expect } from 'chai';
import sinon from 'sinon';
import CcsStatus from '../constants/ccs_status_code.js';
import assert from 'assert/strict';
import ControllerTestContext from './ControllerTestContext.js';

class TestContext extends ControllerTestContext {
    constructor() {
        super('./appraisalPolicyController.js');
        this.fmspc = 'abcdabcdabcd';
        this.policies = ['PolicyA', 'PolicyB'];
        this.appraisalPolicyService = {
            getDefaultAppraisalPolicies: sinon.stub(),
            putAppraisalPolicy:          sinon.stub()
        };
        this.serviceStubs['../services/appraisalPolicyService.js'] = this.appraisalPolicyService;
    }

    getAppraisalPolicyRequest() {
        return {
            query: {
                fmspc: this.fmspc,
            }
        };
    }

    mapPolicies() {
        return this.policies.map(policy => ({ policy }));
    }

    expectedPolicies() {
        return this.policies.join(',');
    }
}

describe('appraisalPolicyController', () => {
    describe('getAppraisalPolicy', () => {
        describe('Positive test cases', () => {
            it('positive', async() => {
                const ctx = new TestContext();
                const target = await ctx.getTarget();
                ctx.appraisalPolicyService.getDefaultAppraisalPolicies.resolves(ctx.mapPolicies());

                await target.getAppraisalPolicy(ctx.getAppraisalPolicyRequest(), ctx.response, ctx.next);

                expect(ctx.appraisalPolicyService.getDefaultAppraisalPolicies.calledWith(ctx.fmspc.toUpperCase())).to.be.true;
                expect(ctx.response.status.calledWith(CcsStatus.CCS_STATUS_SUCCESS[0])).to.be.true;
                expect(ctx.response.send.calledWith(ctx.expectedPolicies())).to.be.true;
            });
        });

        describe('Input Validation', async() => {
            it('invalid fmspc', async() => {
                const ctx = new TestContext();
                const target = await ctx.getTarget();
                ctx.fmspc = 'invalidFmspc';
                ctx.appraisalPolicyService.getDefaultAppraisalPolicies.resolves(ctx.mapPolicies());

                await assert.rejects(
                    () => target.getAppraisalPolicy(ctx.getAppraisalPolicyRequest(), ctx.response, ctx.next),
                    (err) => err.status === CcsStatus.CCS_STATUS_INVALID_REQ[0]
                );

                expect(ctx.appraisalPolicyService.getDefaultAppraisalPolicies.notCalled).to.be.true;
            });
        });
    });
});
