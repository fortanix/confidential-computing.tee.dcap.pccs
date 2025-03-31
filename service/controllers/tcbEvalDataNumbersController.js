/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { tcbEvalDataNumbersService } from '../services/index.js';
import Constants from '../constants/index.js';

async function getNumbers(type, req, res, next) {
    try {
        const value = await tcbEvalDataNumbersService.getTcbEvalDataNumbers(type);
        res.status(200).header('Content-Type', 'application/json')
            .header(Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN,
                value[Constants.TCB_EVALUATION_DATA_NUMBERS_ISSUER_CHAIN]).send(value.contents);
    } catch (err) {
        next(err);
    }
}
export function getSgxTcbEvalDataNumbers(req, res, next) {
    return getNumbers(Constants.PROD_TYPE_SGX, req, res, next);
}
export function getTdxTcbEvalDataNumbers(req, res, next) {
    return getNumbers(Constants.PROD_TYPE_TDX, req, res, next);
}
