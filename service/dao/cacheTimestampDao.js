/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { CacheTimestamp } from './models/index.js';
import { Op } from 'sequelize';

export const REFRESH_TYPE = Object.freeze({ CERTS: 'certs', DEFAULT: 'default' });

export function getCacheTimestamp(cache_key, successful) {
    return CacheTimestamp.findOne({ where: { cache_key, successful } });
}

export function upsertCacheTimestamp(cache_key, last_refresh_at = new Date(), successful = true, error_msg = null) {
    return CacheTimestamp.upsert({ cache_key, last_refresh_at, successful, error_msg });
}

export function deleteCacheTimestamp(cache_key) {
    return CacheTimestamp.destroy({ where: { cache_key } });
}

export async function getRefreshTimestampsAsObject(includeMissing = true) {
    const keys = [REFRESH_TYPE.DEFAULT, REFRESH_TYPE.CERTS];
    const result = Object.create(null);
    if (includeMissing) {
        for (const key of keys) { result[key] = { success: null, failure: null }; }
    }
    const rows = await CacheTimestamp.findAll({ where: { cache_key: { [Op.in]: keys } } });
    for (const row of rows) {
        result[row.cache_key] ??= { success: null, failure: null };
        result[row.cache_key][row.successful ? 'success' : 'failure'] = row.successful ?
            { last_refresh_at: row.last_refresh_at } :
            { last_refresh_at: row.last_refresh_at, error_msg: row.error_msg };
    }
    return result;
}
