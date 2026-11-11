/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { TcbEvalDataNumbers, sequelize } from './models/index.js';
import Constants from '../constants/index.js';

export async function upsertTcbEvalDataNumbers(type, contents) {
    return TcbEvalDataNumbers.upsert({
        type,
        contents,
        root_cert_id:    Constants.ROOT_CERT_ID,
        signing_cert_id: Constants.PROCESSOR_SIGNING_CERT_ID
    });
}

export async function getTcbEvalDataNumbers(type) {
    const rows = await sequelize.query('SELECT a.*, b.cert AS root_cert, c.cert AS signing_cert ' +
        'FROM tcb_eval_data_numbers a JOIN pcs_certificates b ON a.root_cert_id=b.id ' +
        'JOIN pcs_certificates c ON a.signing_cert_id=c.id WHERE a.type=$type', {
        type: sequelize.QueryTypes.SELECT, bind: { type },
    });
    return rows.length === 1 && rows[0].root_cert && rows[0].signing_cert ? rows[0] : null;
}
