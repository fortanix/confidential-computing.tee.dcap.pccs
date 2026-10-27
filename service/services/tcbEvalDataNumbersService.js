/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import * as dao from '../dao/tcbEvalDataNumbersDao.js';
import { cachingModeManager } from './caching_modes/cachingModeManager.js';
import Constants from '../constants/index.js';

export async function getTcbEvalDataNumbers(type) {
    const cached = await dao.getTcbEvalDataNumbers(type);
    if (cached) {
        return {
            contents:                                             cached.contents,
            [Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN]: cached.signing_cert + cached.root_cert
        };
    }
    return cachingModeManager.getTcbEvalDataNumbersFromPCS(type);
}
