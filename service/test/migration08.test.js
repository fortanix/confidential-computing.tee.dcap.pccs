/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { expect } from 'chai';
import esmock from 'esmock';
import { createDatabase, migrator, clearDatabase } from './migrationUtils.js';
import CacheTimestamp from '../dao/models/cache_timestamp.js';

describe('migration 08 and refresh timestamps', () => {
    let db;

    before(async() => {
        db = await createDatabase();
    });

    beforeEach(async() => {
        await clearDatabase(db);
    });

    after(async() => {
        await clearDatabase(db);
        await db.close();
    });

    async function loadDao() {
        CacheTimestamp.init(db);
        return esmock('../dao/cacheTimestampDao.js', { '../dao/models/index.js': { CacheTimestamp } });
    }

    it('creates cache_timestamps with cache_key and successful as the primary key', async() => {
        await migrator(db, '08').up();

        const table = await db.getQueryInterface().describeTable('cache_timestamps');

        expect(Object.keys(table).sort()).to.deep.equal([
            'cache_key', 'error_msg', 'last_refresh_at', 'successful',
        ]);
        expect(table.cache_key.primaryKey).to.equal(true);
        expect(table.cache_key.allowNull).to.equal(false);
        expect(table.successful.primaryKey).to.equal(true);
        expect(table.successful.allowNull).to.equal(false);
        expect(table.last_refresh_at.primaryKey).to.equal(false);
        expect(table.last_refresh_at.allowNull).to.equal(false);
        expect(table.error_msg.primaryKey).to.equal(false);
        expect(table.error_msg.allowNull).to.equal(true);
    });

    it('reports an empty table as missing timestamps, then the three upserts', async() => {
        await migrator(db, '08').up();
        const dao = await loadDao();

        expect(await dao.getRefreshTimestampsAsObject()).to.deep.equal({
            'default': { success: null, failure: null },
            'certs':   { success: null, failure: null },
        });

        const timestamp = new Date('2026-01-01T00:00:00Z');
        await dao.upsertCacheTimestamp('default', timestamp, true);
        await dao.upsertCacheTimestamp('default', timestamp, false, 'PCS failed');
        await dao.upsertCacheTimestamp('certs', timestamp, true);

        expect(await CacheTimestamp.count()).to.equal(3);
        expect(await dao.getRefreshTimestampsAsObject()).to.deep.equal({
            'default': {
                success: { last_refresh_at: timestamp },
                failure: { last_refresh_at: timestamp, error_msg: 'PCS failed' },
            },
            'certs': {
                success: { last_refresh_at: timestamp },
                failure: null,
            },
        });
        expect((await dao.getCacheTimestamp('default', false)).error_msg).to.equal('PCS failed');

        await dao.deleteCacheTimestamp('default');

        expect(await CacheTimestamp.count()).to.equal(1);
    });

    it('preserves v7 collateral and does not replay migration 08', async() => {
        await migrator(db, '07').up();
        await db.query("INSERT INTO fmspc_tcbs VALUES ('001122334455',0,4,'STANDARD',-1,X'010203',1,3,'2025-01-01','2025-01-01')");
        const runner = migrator(db);

        await runner.up();

        const [tcbs] = await db.query('SELECT tcbedn, tcbinfo FROM fmspc_tcbs');
        expect(tcbs).to.have.length(1);
        expect(tcbs[0].tcbedn).to.equal(-1);
        expect(Buffer.from(tcbs[0].tcbinfo)).to.deep.equal(Buffer.from([1, 2, 3]));
        expect(await runner.up()).to.deep.equal([]);
        expect((await runner.executed()).map(entry => entry.name)).to.include('08_db_version_8.js');
    });
});
