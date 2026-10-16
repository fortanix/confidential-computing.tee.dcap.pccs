/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import * as cacheTimestampDao from '../dao/cacheTimestampDao.js';

export async function getHealth(req, res, next) {
    try {
        res.status(200).send({ refresh_info: await cacheTimestampDao.getRefreshTimestampsAsObject() });
    } catch (error) {
        next(error);
    }
}
