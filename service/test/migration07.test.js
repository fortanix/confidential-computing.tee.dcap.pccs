/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { expect } from 'chai';
import esmock from 'esmock';
import { createDatabase, migrator, clearDatabase } from './migrationUtils.js';
import FmspcTcbs from '../dao/models/fmspc_tcbs.js';
import EnclaveIdentities from '../dao/models/enclave_identities.js';
import migration07 from '../migrations/07_db_version_7.js';

describe('migration 07 and composite cache keys', () => {
    let db;
    before(async() => {
        db = await createDatabase();
    });
    beforeEach(async() => {
        await clearDatabase(db);
        await migrator(db, '06').up();
        await db.query("INSERT INTO fmspc_tcbs VALUES ('001122334455',0,4,'STANDARD',X'010203',1,3,'2025-01-01','2025-01-01')");
        await db.query("INSERT INTO enclave_identities VALUES (0,4,'STANDARD',X'040506',1,3,'2025-01-01','2025-01-01')");
    });
    after(async() => {
        await clearDatabase(db); await db.close();
    });
    it('preserves legacy collateral, adds -1 keys and isolates model/DAO writes by EDN', async() => {
        const runner = migrator(db, '07');
        await runner.up();
        FmspcTcbs.init(db); EnclaveIdentities.init(db);
        const legacy = await FmspcTcbs.findOne();
        expect(legacy.tcbedn).to.equal(-1);
        expect(Buffer.from(legacy.tcbinfo)).to.deep.equal(Buffer.from([1, 2, 3]));
        const models = { FmspcTcbs, EnclaveIdentities, sequelize: db };
        const tcbs = await esmock('../dao/fmspcTcbDao.js', { '../dao/models/index.js': models });
        const identities = await esmock('../dao/enclaveIdentityDao.js', { '../dao/models/index.js': models });
        for (const tcbedn of [7, 8]) {
            // eslint-disable-next-line no-await-in-loop
            await tcbs.upsertFmspcTcb({ type: 0, fmspc: '001122334455', version: 4, update_type: 'TCBEDN', tcbedn, tcbinfo: Buffer.from(`tcb-${tcbedn}`) });
            // eslint-disable-next-line no-await-in-loop
            await identities.upsertEnclaveIdentity(0, Buffer.from(`identity-${tcbedn}`), 4, 'TCBEDN', tcbedn);
        }
        expect(await FmspcTcbs.count()).to.equal(3);
        expect(await EnclaveIdentities.count()).to.equal(3);
        await db.query("INSERT INTO pcs_certificates (id,cert,created_time,updated_time) VALUES (1,'root','2025-01-01','2025-01-01'),(3,'signing','2025-01-01','2025-01-01')");
        expect((await tcbs.getTcbInfo(0, '001122334455', 4, 'TCBEDN', 7)).tcbinfo.toString()).to.equal('tcb-7');
        expect((await tcbs.getTcbInfo(0, '001122334455', 4, 'TCBEDN', 8)).tcbinfo.toString()).to.equal('tcb-8');
        expect((await identities.getEnclaveIdentity(0, 4, 'TCBEDN', 7)).identity.toString()).to.equal('identity-7');
        expect((await identities.getEnclaveIdentity(0, 4, 'STANDARD')).identity).to.deep.equal(Buffer.from([4, 5, 6]));
        expect(await runner.up()).to.deep.equal([]);
        await migration07.up(db);
        expect(await FmspcTcbs.count()).to.equal(3);
    });

    async function renameTable(from, to) {
        const sql = db.getDialect() === 'mysql' ?
            `RENAME TABLE ${from} TO ${to}` :
            `ALTER TABLE ${from} RENAME TO ${to}`;
        await db.query(sql);
    }

    it('deletes a specific TCB or enclave-identity row by its composite key', async() => {
        const runner = migrator(db, '07');
        await runner.up();
        FmspcTcbs.init(db);
        EnclaveIdentities.init(db);
        const models = { FmspcTcbs, EnclaveIdentities, sequelize: db };
        const tcbs = await esmock('../dao/fmspcTcbDao.js', { '../dao/models/index.js': models });
        const identities = await esmock('../dao/enclaveIdentityDao.js', { '../dao/models/index.js': models });
        await tcbs.upsertFmspcTcb({ type: 0, fmspc: '001122334455', version: 4, update_type: 'TCBEDN', tcbedn: 7, tcbinfo: Buffer.from('tcb-7') });
        await identities.upsertEnclaveIdentity(0, Buffer.from('qe-7'), 4, 'TCBEDN', 7);
        await db.query("INSERT INTO pcs_certificates (id,cert,created_time,updated_time) VALUES (1,'root','2025-01-01','2025-01-01'),(3,'signing','2025-01-01','2025-01-01')");
        expect(await tcbs.getTcbInfo(0, '001122334455', 4, 'TCBEDN', 7)).to.not.be.null;
        expect(await identities.getEnclaveIdentity(0, 4, 'TCBEDN', 7)).to.not.be.null;
        await tcbs.deleteFmspcTcb(0, '001122334455', 4, 'TCBEDN', 7);
        await identities.deleteEnclaveIdentity(0, 4, 'TCBEDN', 7);
        expect(await tcbs.getTcbInfo(0, '001122334455', 4, 'TCBEDN', 7)).to.be.null;
        expect(await identities.getEnclaveIdentity(0, 4, 'TCBEDN', 7)).to.be.null;
    });

    it('restores a legacy backup when the source table is already gone', async() => {
        await renameTable('fmspc_tcbs', 'fmspc_tcbs_backup');
        await renameTable('enclave_identities', 'enclave_identities_backup');

        await migration07.up(db);

        const [rows] = await db.query('SELECT tcbedn, tcbinfo FROM fmspc_tcbs');
        expect(rows).to.have.length(1);
        expect(rows[0].tcbedn).to.equal(-1);
        expect(Buffer.from(rows[0].tcbinfo)).to.deep.equal(Buffer.from([1, 2, 3]));
        expect(await db.getQueryInterface().tableExists('fmspc_tcbs_backup')).to.equal(false);
        expect(await db.getQueryInterface().tableExists('enclave_identities_backup')).to.equal(false);
    });

    it('adopts a staged temp table that already has tcbedn', async() => {
        await db.query('DROP TABLE fmspc_tcbs');
        await db.query('DROP TABLE enclave_identities');
        await db.query('CREATE TABLE fmspc_tcbs_temp (' +
            'fmspc VARCHAR(255) NOT NULL, type INTEGER NOT NULL, version INTEGER NOT NULL, ' +
            'update_type VARCHAR(255) NOT NULL, tcbedn INTEGER NOT NULL, tcbinfo BLOB, ' +
            'root_cert_id INTEGER, signing_cert_id INTEGER, created_time DATETIME NOT NULL, ' +
            'updated_time DATETIME NOT NULL, PRIMARY KEY(fmspc, type, version, update_type, tcbedn))');
        await db.query("INSERT INTO fmspc_tcbs_temp VALUES ('001122334455',0,4,'STANDARD',7,X'010203',1,3,'2025-01-01','2025-01-01')");
        await db.query('CREATE TABLE enclave_identities_temp (' +
            'id INTEGER NOT NULL, version INTEGER NOT NULL, update_type VARCHAR(255) NOT NULL, ' +
            'tcbedn INTEGER NOT NULL, identity BLOB, root_cert_id INTEGER, signing_cert_id INTEGER, ' +
            'created_time DATETIME NOT NULL, updated_time DATETIME NOT NULL, ' +
            'PRIMARY KEY(id, version, update_type, tcbedn))');
        await db.query("INSERT INTO enclave_identities_temp VALUES (0,4,'STANDARD',7,X'040506',1,3,'2025-01-01','2025-01-01')");

        await migration07.up(db);

        const [rows] = await db.query('SELECT tcbedn, tcbinfo FROM fmspc_tcbs');
        expect(rows).to.have.length(1);
        expect(rows[0].tcbedn).to.equal(7);
        expect(Buffer.from(rows[0].tcbinfo)).to.deep.equal(Buffer.from([1, 2, 3]));
        expect(await db.getQueryInterface().tableExists('fmspc_tcbs_temp')).to.equal(false);
        const [identities] = await db.query('SELECT tcbedn, identity FROM enclave_identities');
        expect(identities[0].tcbedn).to.equal(7);
        expect(Buffer.from(identities[0].identity)).to.deep.equal(Buffer.from([4, 5, 6]));
    });
});
