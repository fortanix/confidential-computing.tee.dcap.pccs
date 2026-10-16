/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import pkg from '../../package.json' with { type: 'json' };
import Constants from '../../constants/index.js';
import PccsStatus from '../../constants/pccs_status_code.js';

const mocks = vi.hoisted(() => ({
    getRefreshTimestampsAsObject: vi.fn(),
    getTcb:                       vi.fn(),
    getEnclaveIdentity:           vi.fn(),
    transaction:                  vi.fn(),
}));
vi.mock('../../dao/cacheTimestampDao.js', () => ({ getRefreshTimestampsAsObject: mocks.getRefreshTimestampsAsObject }));
vi.mock('../../pcs_client/pcs_client.js', () => ({ getTcb: mocks.getTcb, getEnclaveIdentity: mocks.getEnclaveIdentity }));
vi.mock('../../dao/models/index.js', () => ({ sequelize: { transaction: mocks.transaction } }));
import { getHealth } from '../../controllers/refreshHealthController.js';
import { getVersion } from '../../controllers/versionController.js';
import { getTcbInfoFromPCS, getEnclaveIdentityFromPCS } from '../../services/logic/commonCacheLogic.js';

beforeEach(() => {
    vi.resetAllMocks();
});

describe('Fortanix health and version contracts', () => {
    test('forwards the DAO refresh payload', async() => {
        const info = {
            'default': { success: null, failure: null },
            'certs':   { success: null, failure: null },
        };
        mocks.getRefreshTimestampsAsObject.mockResolvedValue(info);
        const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };

        await getHealth({}, res, error => {
            throw error;
        });

        expect(mocks.getRefreshTimestampsAsObject).toHaveBeenCalledWith();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith({ refresh_info: info });
    });

    test('forwards a present success and failure payload from the DAO', async() => {
        const info = {
            'default': {
                success: { last_refresh_at: new Date('2026-01-01T00:00:00Z') },
                failure: { last_refresh_at: new Date('2026-01-02T00:00:00Z'), error_msg: 'PCS down' },
            },
            'certs': { success: null, failure: null },
        };
        mocks.getRefreshTimestampsAsObject.mockResolvedValue(info);
        const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };

        await getHealth({}, res, error => {
            throw error;
        });

        expect(mocks.getRefreshTimestampsAsObject).toHaveBeenCalledWith();
        expect(res.send).toHaveBeenCalledWith({ refresh_info: info });
    });

    test('forwards a DAO rejection to next and does not send', async() => {
        const error = new Error('DB down');
        mocks.getRefreshTimestampsAsObject.mockRejectedValue(error);
        const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
        const next = vi.fn();

        await getHealth({}, res, next);

        expect(next).toHaveBeenCalledWith(error);
        expect(res.send).not.toHaveBeenCalled();
    });

    test('reports the upstream package version', () => {
        const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
        getVersion({}, res, error => {
            throw error;
        });
        expect(res.send).toHaveBeenCalledWith({ version: pkg.version });
    });
});

describe('Fortanix retired-collateral mapping', () => {
    for (const { statusCode, expected } of [
        { statusCode: 500, expected: PccsStatus.PCCS_STATUS_NO_CACHE_DATA },
        { statusCode: Constants.HTTP_GONE, expected: PccsStatus.PCCS_STATUS_NO_LONGER_AVAILABLE },
    ]) {
        test(`maps PCS ${statusCode} to status ${expected[0]} and does not write cache`, async() => {
            mocks.getTcb.mockResolvedValue({ statusCode, body: null });
            mocks.getEnclaveIdentity.mockResolvedValue({ statusCode, body: null });

            await expect(getTcbInfoFromPCS(
                Constants.PROD_TYPE_SGX, '001122334455', 4, Constants.UPDATE_TYPE_TCBEDN, 7
            )).rejects.toMatchObject({ status: expected[0], message: expected[1] });
            await expect(getEnclaveIdentityFromPCS(
                Constants.QE_IDENTITY_ID, 4, Constants.UPDATE_TYPE_TCBEDN, 7
            )).rejects.toMatchObject({ status: expected[0], message: expected[1] });
            expect(mocks.transaction).not.toHaveBeenCalled();
        });
    }
});
