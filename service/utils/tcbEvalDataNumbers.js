/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import Constants from '../constants/index.js';
import PccsError from './PccsError.js';
import PccsStatus from '../constants/pccs_status_code.js';
import { getBodyBuffer, isSuccessfulResponseWithBody } from './responseBody.js';

export function parseTcbEvalDataNumbersResponse(response) {
    const chain = response.headers?.[Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN.toLowerCase()];
    if (!isSuccessfulResponseWithBody(response) || !chain) {
        throw new PccsError(PccsStatus.PCCS_STATUS_NO_CACHE_DATA);
    }
    return { contents: getBodyBuffer(response), [Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN]: chain };
}
