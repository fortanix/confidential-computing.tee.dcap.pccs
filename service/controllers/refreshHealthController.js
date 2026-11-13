/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import * as cacheTimestampDao from '../dao/cacheTimestampDao.js';
import { isAdminRequest } from '../middleware/auth.js';

export async function getHealth(req, res, next) {
    try {
        const omitErrorInfo = !isAdminRequest(req);
        res.status(200).send({ refresh_info: await cacheTimestampDao.getRefreshTimestampsAsObject(true, omitErrorInfo) });
    } catch (error) {
        next(error);
    }
}
