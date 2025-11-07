/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import { expect } from 'chai';
import { SequelizeStorage } from 'umzug';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, migrator, clearDatabase } from './migrationUtils.js';

// Historical schemas, not the shipping migrations. An edit to a fixture must update this pin.
const LEGACY_FIXTURE_SHA256 = {
    '06_db_version_6.js': 'ec31800fc431870ad67429599cb3ecd6ddb08a3e2c08199afce3422ae3613ed8',
    '07_db_version_7.js': 'c0dda643f267b8ae8298bf8c44b8813f46e854857b196982d190013959f02470',
    '08_db_version_8.js': '4518dfda17a25fa52ec71b04a910feb9de0f598ba0db3fa9da425c381fbf0f11',
};

const ORIGINAL_SCHEMAS = [
    { state: 6, applied: ['07_db_version_7.js', '08_db_version_8.js'], fmspcRows: 1 },
    { state: 7, applied: ['08_db_version_8.js'], fmspcRows: 2 },
    { state: 8, applied: [], fmspcRows: 2 },
];

const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'legacyMigrations');

describe('populated original Fortanix databases', () => {
    it('pins the historical schema fixtures', () => {
        for (const [name, digest] of Object.entries(LEGACY_FIXTURE_SHA256)) {
            const bytes = fs.readFileSync(path.join(fixtureDirectory, name));
            expect(crypto.createHash('sha256').update(bytes).digest('hex')).to.equal(digest);
        }
    });

    for (const { state, applied, fmspcRows } of ORIGINAL_SCHEMAS) {
        it(`restarts original schema ${state}; PCCS_TEST_DATABASE=mysql ignores options.storage`, async() => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pccs-legacy-'));
            const options = { storage: path.join(directory, 'cache.sqlite') };
            let db = await createDatabase(options);
            try {
                await clearDatabase(db);
                await migrator(db, '05').up();
                await db.query("INSERT INTO fmspc_tcbs VALUES ('001122334455',0,4,'STANDARD',X'010203',1,3,'2025-01-01','2025-01-01')");
                await db.query("INSERT INTO enclave_identities VALUES (0,4,'STANDARD',X'040506',1,3,'2025-01-01','2025-01-01')");
                for (let number = 6; number <= state; number += 1) {
                    const name = `0${number}_db_version_${number}.js`;
                    // Execute the historical fixture and retain its Umzug name so shipping migrations skip it.
                    // eslint-disable-next-line no-await-in-loop
                    await (await import(`./fixtures/legacyMigrations/${name}`)).default.up(db);
                    // eslint-disable-next-line no-await-in-loop
                    await new SequelizeStorage({ sequelize: db, tableName: 'umzug' }).logMigration({ name });
                }
                await db.query("INSERT INTO tcb_eval_data_numbers VALUES (0,X'070809',1,3,'2025-01-01','2025-01-01')");
                if (state >= 7) {
                    await db.query("INSERT INTO fmspc_tcbs VALUES ('001122334455',0,4,'TCBEDN',7,X'0A0B0C',1,3,'2025-01-01','2025-01-01')");
                }
                if (state === 8) {
                    await db.query("INSERT INTO cache_timestamps VALUES ('default',1,'2025-01-01','retained')");
                }

                await db.close();
                db = await createDatabase(options);
                const runner = migrator(db);

                const migrated = await runner.up();

                expect(migrated.map(entry => entry.name)).to.deep.equal(applied);
                const [rows] = await db.query('SELECT tcbedn, tcbinfo FROM fmspc_tcbs ORDER BY tcbedn');
                expect(rows).to.have.length(fmspcRows);
                expect(rows[0].tcbedn).to.equal(-1);
                expect(Buffer.from(rows[0].tcbinfo)).to.deep.equal(Buffer.from([1, 2, 3]));
                if (state >= 7) {
                    expect(Buffer.from(rows[1].tcbinfo)).to.deep.equal(Buffer.from([10, 11, 12]));
                }
                const [identities] = await db.query('SELECT tcbedn, identity FROM enclave_identities');
                expect(identities[0].tcbedn).to.equal(-1);
                expect(Buffer.from(identities[0].identity)).to.deep.equal(Buffer.from([4, 5, 6]));
                const [edn] = await db.query('SELECT contents FROM tcb_eval_data_numbers');
                expect(Buffer.from(edn[0].contents)).to.deep.equal(Buffer.from([7, 8, 9]));
                if (state === 8) {
                    const [timestamps] = await db.query('SELECT error_msg FROM cache_timestamps');
                    expect(timestamps[0].error_msg).to.equal('retained');
                }

                await db.close();
                db = await createDatabase(options);
                expect(await migrator(db).up()).to.deep.equal([]);
            } finally {
                await clearDatabase(db);
                await db.close();
                fs.rmSync(directory, { recursive: true, force: true });
            }
        });
    }
});
