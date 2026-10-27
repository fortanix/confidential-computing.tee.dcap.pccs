/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { Sequelize } from 'sequelize';
import CacheTimestamp from '../../dao/models/cache_timestamp.js';
import { beforeAll, afterAll, beforeEach, test, expect, describe } from 'vitest';

describe('CacheTimestamp Model - Unit Tests (composite PK)', () => {
    let sequelize;

    beforeAll(async() => {
        sequelize = new Sequelize({
            dialect: 'sqlite',
            storage: ':memory:',
            logging: false,
        });

        CacheTimestamp.init(sequelize);
        await sequelize.sync({ force: true });
    });

    afterAll(async() => {
        await sequelize.close();
    });

    beforeEach(async() => {
        await CacheTimestamp.destroy({ where: {} });
    });

    test('fails when creating without required "successful"', async() => {
        await expect(
            CacheTimestamp.create({
                cache_key: 'default',
            })
        ).rejects.toThrow();
    });

    test('creates a record when successful is explicitly provided', async() => {
        const row = await CacheTimestamp.create({
            cache_key:  'default',
            successful: true,
        });

        expect(row.cache_key).toBe('default');
        expect(row.successful).toBe(true);
        expect(row.last_refresh_at).toBeInstanceOf(Date);
        expect(row.error_msg).toBeNull();
    });

    test('stores both success and failure for the same cache key', async() => {
        await CacheTimestamp.create({ cache_key: 'certs', successful: false, error_msg: 'failed' });
        await CacheTimestamp.create({ cache_key: 'certs', successful: true, error_msg: null });

        const rows = await CacheTimestamp.findAll({ where: { cache_key: 'certs' } });
        expect(rows.length).toBe(2);

        const failRow = await CacheTimestamp.findOne({ where: { cache_key: 'certs', successful: false } });
        const okRow = await CacheTimestamp.findOne({ where: { cache_key: 'certs', successful: true } });

        expect(failRow.error_msg).toBe('failed');
        expect(okRow.error_msg).toBeNull();
    });

    test('updates error_msg without changing the composite primary key', async() => {
        await CacheTimestamp.create({ cache_key: 'certs', successful: false, error_msg: 'failed' });

        const row = await CacheTimestamp.findOne({ where: { cache_key: 'certs', successful: false } });
        await row.update({ error_msg: 'updated reason' });

        const updated = await CacheTimestamp.findOne({ where: { cache_key: 'certs', successful: false } });
        expect(updated.cache_key).toBe('certs');
        expect(updated.successful).toBe(false);
        expect(updated.error_msg).toBe('updated reason');
    });

    test('returns every stored cache key', async() => {
        await CacheTimestamp.create({ cache_key: 'default', successful: true });
        await CacheTimestamp.create({ cache_key: 'certs', successful: false, error_msg: 'failed' });

        const keys = (await CacheTimestamp.findAll()).map(row => row.cache_key).sort();
        expect(keys).toEqual(['certs', 'default']);
    });
});
