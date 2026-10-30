/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import Constants from '../../constants/index.js';
import PccsStatus from '../../constants/pccs_status_code.js';

const mocks = vi.hoisted(() => ({
    getTcb:             vi.fn(),
    getEnclaveIdentity: vi.fn(),
    transaction:        vi.fn(),
}));
vi.mock('../../pcs_client/pcs_client.js', () => ({ getTcb: mocks.getTcb, getEnclaveIdentity: mocks.getEnclaveIdentity }));
vi.mock('../../dao/models/index.js', () => ({ sequelize: { transaction: mocks.transaction } }));
import { getTcbInfoFromPCS, getEnclaveIdentityFromPCS } from '../../services/logic/commonCacheLogic.js';

beforeEach(() => {
    vi.resetAllMocks();
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
