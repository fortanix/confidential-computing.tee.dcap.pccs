/*
 * Copyright (C) 2011-2026 Intel Corporation
 *
 * Redistribution and use in source and binary forms, with or without modification,
 * are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */
/*
 * Source-Commit: a68b1d5edfd859689cc2f5f10bf2b76b36136ed1
 * Migration-Step: 5
 * Adaptation: Preserve tcbedn=-1 for legacy rows and stage table rebuilds so failed MySQL DDL can resume without discarding the source table.
 * Verification: service/test/migration07.test.js exercises data, primary keys, restart, and injected DDL failures on SQLite and MySQL.
 */
import logger from '../utils/Logger.js';

const tableMigrations = [
    {
        name:      'fmspc_tcbs',
        createSql: 'CREATE TABLE fmspc_tcbs_temp (' +
            'fmspc VARCHAR(255) NOT NULL, type INTEGER NOT NULL, version INTEGER NOT NULL, ' +
            'update_type VARCHAR(255) NOT NULL, tcbedn INTEGER NOT NULL, tcbinfo BLOB, ' +
            'root_cert_id INTEGER, signing_cert_id INTEGER, created_time DATETIME NOT NULL, ' +
            'updated_time DATETIME NOT NULL, PRIMARY KEY(fmspc, type, version, update_type, tcbedn))',
        insertSql: 'INSERT INTO fmspc_tcbs_temp ' +
            '(fmspc, type, version, update_type, tcbedn, tcbinfo, root_cert_id, signing_cert_id, created_time, updated_time) ' +
            'SELECT fmspc, type, version, update_type, -1, tcbinfo, root_cert_id, signing_cert_id, created_time, updated_time ' +
            'FROM fmspc_tcbs',
        temp:   'fmspc_tcbs_temp',
        backup: 'fmspc_tcbs_backup',
    },
    {
        name:      'enclave_identities',
        createSql: 'CREATE TABLE enclave_identities_temp (' +
            'id INTEGER NOT NULL, version INTEGER NOT NULL, update_type VARCHAR(255) NOT NULL, ' +
            'tcbedn INTEGER NOT NULL, identity BLOB, root_cert_id INTEGER, signing_cert_id INTEGER, ' +
            'created_time DATETIME NOT NULL, updated_time DATETIME NOT NULL, ' +
            'PRIMARY KEY(id, version, update_type, tcbedn))',
        insertSql: 'INSERT INTO enclave_identities_temp ' +
            '(id, version, update_type, tcbedn, identity, root_cert_id, signing_cert_id, created_time, updated_time) ' +
            'SELECT id, version, update_type, -1, identity, root_cert_id, signing_cert_id, created_time, updated_time ' +
            'FROM enclave_identities',
        temp:   'enclave_identities_temp',
        backup: 'enclave_identities_backup',
    },
];

function queryOptions(transaction) {
    return transaction ? { transaction } : undefined;
}

async function hasTable(sequelize, name, transaction) {
    return sequelize.getQueryInterface().tableExists(name, queryOptions(transaction));
}

async function hasTcbedn(sequelize, name, transaction) {
    const columns = await sequelize.getQueryInterface().describeTable(name, queryOptions(transaction));
    return Object.keys(columns).some((column) => column.toLowerCase() === 'tcbedn');
}

async function renameTable(sequelize, from, to, transaction) {
    const sql = sequelize.getDialect() === 'mysql' ?
        `RENAME TABLE ${from} TO ${to}` :
        `ALTER TABLE ${from} RENAME TO ${to}`;
    await sequelize.query(sql, queryOptions(transaction));
}

async function dropTable(sequelize, name, transaction) {
    await sequelize.query(`DROP TABLE ${name}`, queryOptions(transaction));
}

async function finishStagedRename(sequelize, spec, transaction) {
    if (sequelize.getDialect() === 'mysql') {
        // MySQL DDL commits implicitly; renaming both names in one statement prevents a missing target table.
        await sequelize.query(
            `RENAME TABLE ${spec.name} TO ${spec.backup}, ${spec.temp} TO ${spec.name}`,
            queryOptions(transaction)
        );
    } else {
        await renameTable(sequelize, spec.name, spec.backup, transaction);
        await renameTable(sequelize, spec.temp, spec.name, transaction);
    }
}

async function migrateTable(sequelize, spec, transaction) {
    let sourceExists = await hasTable(sequelize, spec.name, transaction);
    let tempExists = await hasTable(sequelize, spec.temp, transaction);
    let backupExists = await hasTable(sequelize, spec.backup, transaction);

    if (!sourceExists && tempExists && await hasTcbedn(sequelize, spec.temp, transaction)) {
        // Recover a complete staged table left by the historical drop-then-rename migration.
        if (backupExists && await hasTcbedn(sequelize, spec.backup, transaction)) {
            throw new Error(`Cannot recover ${spec.name}: both staged and backup tables have tcbedn`);
        }
        await renameTable(sequelize, spec.temp, spec.name, transaction);
        sourceExists = true;
        tempExists = false;
    }

    if (!sourceExists && backupExists) {
        // Restore the original if a prior non-atomic attempt moved it before staging was complete.
        await renameTable(sequelize, spec.backup, spec.name, transaction);
        sourceExists = true;
        backupExists = false;
    }

    if (!sourceExists) {
        throw new Error(`Cannot migrate ${spec.name}: source, stage, and backup tables are all missing`);
    }

    if (await hasTcbedn(sequelize, spec.name, transaction)) {
        if (tempExists) {
            throw new Error(`Cannot migrate ${spec.name}: unexpected staging table ${spec.temp} remains`);
        }
        if (backupExists) {
            if (await hasTcbedn(sequelize, spec.backup, transaction)) {
                throw new Error(`Cannot migrate ${spec.name}: backup table ${spec.backup} is already upgraded`);
            }
            await dropTable(sequelize, spec.backup, transaction);
        }
        return;
    }

    if (backupExists) {
        throw new Error(`Cannot migrate ${spec.name}: legacy source and backup both exist; preserving both tables`);
    }

    if (tempExists) {
        // The legacy source remains authoritative until the swap, so an incomplete prior stage is disposable.
        await dropTable(sequelize, spec.temp, transaction);
    }

    await sequelize.query(spec.createSql, queryOptions(transaction));
    await sequelize.query(spec.insertSql, queryOptions(transaction));
    await finishStagedRename(sequelize, spec, transaction);

    if (!await hasTcbedn(sequelize, spec.name, transaction)) {
        throw new Error(`Migration did not add tcbedn to ${spec.name}`);
    }
    await dropTable(sequelize, spec.backup, transaction);
}

async function migrateAll(sequelize, transaction) {
    for (const spec of tableMigrations) {
        logger.debug(`DB Migration -- add tcbedn to ${spec.name}`);
        // eslint-disable-next-line no-await-in-loop
        await migrateTable(sequelize, spec, transaction);
    }
}

async function up(sequelize) {
    logger.info('DB Migration (Ver.6 -> 7) -- Start');
    if (sequelize.getDialect() === 'mysql') {
        // MySQL DDL is not rolled back with a transaction; each table is resumable by inspecting table state.
        await migrateAll(sequelize);
    } else {
        await sequelize.transaction(async(transaction) => migrateAll(sequelize, transaction));
    }
    logger.info('DB Migration -- Done.');
}

export default { up };
