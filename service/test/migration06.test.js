/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { expect } from 'chai';
import Sequelize from 'sequelize';
import { createDatabase, migrator, clearDatabase } from './migrationUtils.js';

function defineList(db) {
    return db.define('TcbEvalDataNumbersTest', {
        type:            { type: Sequelize.INTEGER, primaryKey: true },
        contents:        Sequelize.BLOB,
        root_cert_id:    Sequelize.INTEGER,
        signing_cert_id: Sequelize.INTEGER,
    }, {
        tableName:  'tcb_eval_data_numbers',
        timestamps: true,
        createdAt:  'created_time',
        updatedAt:  'updated_time',
    });
}

describe('migration 06', () => {
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

    it('creates tcb_eval_data_numbers with a type primary key and required contents', async() => {
        await migrator(db, '06').up();

        const table = await db.getQueryInterface().describeTable('tcb_eval_data_numbers');

        expect(table.type.primaryKey).to.equal(true);
        expect(table.contents.allowNull).to.equal(false);
        expect(table.root_cert_id.allowNull).to.equal(false);
        expect(table.signing_cert_id.allowNull).to.equal(false);
        expect(table).to.include.keys('created_time', 'updated_time');
        const [versions] = await db.query('SELECT db_version, api_version FROM pcs_version');
        expect(versions).to.deep.equal([{ db_version: 6, api_version: 4 }]);
    });

    it('keeps separate SGX and TDX rows', async() => {
        await migrator(db, '06').up();
        const list = defineList(db);

        await list.upsert({ type: 0, contents: Buffer.from('sgx'), root_cert_id: 1, signing_cert_id: 3 });
        await list.upsert({ type: 1, contents: Buffer.from('tdx'), root_cert_id: 1, signing_cert_id: 3 });

        expect(await list.count()).to.equal(2);
        expect((await list.findByPk(0)).contents.toString()).to.equal('sgx');
        expect((await list.findByPk(1)).contents.toString()).to.equal('tdx');
    });

    it('records 06_db_version_6.js and does not replay it', async() => {
        const runner = migrator(db, '06');

        await runner.up();

        expect(await runner.up()).to.deep.equal([]);
        expect((await runner.executed()).map(entry => entry.name)).to.include('06_db_version_6.js');
    });
});
