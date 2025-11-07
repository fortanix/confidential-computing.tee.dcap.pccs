/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { vi } from 'vitest';
// Keep this mock above the DAO import. Vitest hoists it; the source order should match.
vi.mock('../../dao/models/index.js', async() => ({ CacheTimestamp: (await import('../../dao/models/cache_timestamp.js')).default }));
import { Sequelize } from 'sequelize';
import { beforeEach, beforeAll, afterAll, test, expect, describe } from 'vitest';

import CacheTimestamp from '../../dao/models/cache_timestamp.js';
import * as cacheTimestampDao from '../../dao/cacheTimestampDao.js';

describe('cacheTimestampDao - Unit Tests (composite PK: cache_key + successful)', () => {
  let sequelize;

  beforeAll(async () => {
    sequelize = new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
    });

    // Initialize model
    CacheTimestamp.init(sequelize);
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Truncate all rows
    await CacheTimestamp.destroy({ where: {} });
  });

  test('getCacheTimestamp returns null for missing (cache_key, successful) pair', async () => {
    const row = await cacheTimestampDao.getCacheTimestamp('MISSING', true);
    expect(row).toBeNull();
  });

  test('upsertCacheTimestamp inserts records per (cache_key, successful)', async () => {
    const t1 = new Date('2020-01-01T00:00:00Z');

    // Insert success row
    await cacheTimestampDao.upsertCacheTimestamp('default', t1, true, null);

    let row = await CacheTimestamp.findOne({
      where: { cache_key: 'default', successful: true },
    });
    expect(row).not.toBeNull();
    expect(row.cache_key).toBe('default');
    expect(row.successful).toBe(true);
    expect(row.error_msg).toBeNull();
    expect(row.last_refresh_at).toEqual(t1);

    // Insert failure row (separate PK)
    const t2 = new Date('2021-01-01T00:00:00Z');
    await cacheTimestampDao.upsertCacheTimestamp('default', t2, false, 'fail');

    const ok = await CacheTimestamp.findOne({
      where: { cache_key: 'default', successful: true },
    });
    const fail = await CacheTimestamp.findOne({
      where: { cache_key: 'default', successful: false },
    });

    expect(ok).not.toBeNull();
    expect(fail).not.toBeNull();

    expect(ok.successful).toBe(true);
    expect(ok.error_msg).toBeNull();
    expect(ok.last_refresh_at).toEqual(t1);

    expect(fail.successful).toBe(false);
    expect(fail.error_msg).toBe('fail');
    expect(fail.last_refresh_at).toEqual(t2);
  });

  test('upsertCacheTimestamp updates an existing (cache_key, successful) row', async () => {
    const t1 = new Date('2022-01-01T00:00:00Z');
    const t2 = new Date('2022-02-02T00:00:00Z');

    // Create success row, then update same composite PK
    await cacheTimestampDao.upsertCacheTimestamp('certs', t1, true, null);
    await cacheTimestampDao.upsertCacheTimestamp('certs', t2, true, 'updated');

    const updated = await CacheTimestamp.findOne({
      where: { cache_key: 'certs', successful: true },
    });

    expect(updated).not.toBeNull();
    expect(updated.error_msg).toBe('updated');
    expect(updated.last_refresh_at).toEqual(t2);
  });

  test('deleteCacheTimestamp removes both success and failure rows for a key', async () => {
    await CacheTimestamp.create({ cache_key: 'wipe', successful: true });
    await CacheTimestamp.create({ cache_key: 'wipe', successful: false });

    let rows = await CacheTimestamp.findAll({ where: { cache_key: 'wipe' } });
    expect(rows.length).toBe(2);

    await cacheTimestampDao.deleteCacheTimestamp('wipe');

    rows = await CacheTimestamp.findAll({ where: { cache_key: 'wipe' } });
    expect(rows.length).toBe(0);
  });

  test('getRefreshTimestampsAsObject returns { success, failure } with nulls when missing (includeMissing=true)', async () => {
    const map = await cacheTimestampDao.getRefreshTimestampsAsObject(true);

    // Keys exist with null placeholders
    expect(map).toHaveProperty('default');
    expect(map).toHaveProperty('certs');

    expect(map.default).toEqual({ success: null, failure: null });
    expect(map.certs).toEqual({ success: null, failure: null });
  });

  test('getRefreshTimestampsAsObject returns rows placed into success/failure buckets', async () => {
    const t1 = new Date('2022-01-01T00:00:00Z');
    const t2 = new Date('2022-02-01T00:00:00Z');
    const t3 = new Date('2022-03-01T00:00:00Z');
    const err_msg = "err msg";
    // default: both success and failure
    await CacheTimestamp.create({ cache_key: 'default', successful: true, last_refresh_at: t1, error_msg: "" });
    await CacheTimestamp.create({ cache_key: 'default', successful: false, last_refresh_at: t2, error_msg: err_msg });

    // certs: only failure
    await CacheTimestamp.create({ cache_key: 'certs', successful: false, last_refresh_at: t3, error_msg: err_msg});

    const map = await cacheTimestampDao.getRefreshTimestampsAsObject(true);

    expect(map.default.success).not.toBeNull();
    expect(map.default.failure).not.toBeNull();
    expect(map.default.success.last_refresh_at).toStrictEqual(t1);
    expect(map.default.success.error_msg).toBeUndefined();
    expect(map.default.failure.last_refresh_at).toStrictEqual(t2);
    expect(map.default.failure.error_msg).toBe(err_msg);

    expect(map.certs.success).toBeNull();
    expect(map.certs.failure).not.toBeNull();
    expect(map.certs.failure.last_refresh_at).toStrictEqual(t3);
    expect(map.certs.failure.error_msg).toBe(err_msg);
  });

  test('getRefreshTimestampsAsObject omits missing keys when includeMissing=false', async () => {
    await CacheTimestamp.create({ cache_key: 'default', successful: true });

    const map = await cacheTimestampDao.getRefreshTimestampsAsObject(false);

    expect(map.default).toBeDefined();
    expect(map.default.success).not.toBeNull();
    expect(map.default.failure).toBeNull();

    // 'certs' is missing entirely if no rows for that key
    expect(map.certs).toBeUndefined();
  });

  test('getCacheTimestamp fetches a specific composite row', async () => {
    await CacheTimestamp.create({ cache_key: 'pair', successful: true });
    await CacheTimestamp.create({ cache_key: 'pair', successful: false });

    const ok = await cacheTimestampDao.getCacheTimestamp('pair', true);
    const fail = await cacheTimestampDao.getCacheTimestamp('pair', false);

    expect(ok).not.toBeNull();
    expect(ok.cache_key).toBe('pair');
    expect(ok.successful).toBe(true);

    expect(fail).not.toBeNull();
    expect(fail.cache_key).toBe('pair');
    expect(fail.successful).toBe(false);
  });
});
