/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import * as cacheTimestampDao from '../dao/cacheTimestampDao.js';

function redactRefreshInfo(info) {
    const redacted = {};
    for (const [key, entry] of Object.entries(info)) {
        redacted[key] = {
            success: entry?.success ? { last_refresh_at: entry.success.last_refresh_at } : null,
            failure: entry?.failure ? { last_refresh_at: entry.failure.last_refresh_at } : null,
        };
    }
    return redacted;
}

export async function getHealth(req, res, next) {
    try {
        res.status(200).send({ refresh_info: redactRefreshInfo(await cacheTimestampDao.getRefreshTimestampsAsObject()) });
    } catch (error) {
        next(error);
    }
}
