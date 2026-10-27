/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import logger from '../../../utils/Logger.js';

async function up(sequelize) {
  await sequelize.transaction(async (t) => {
    logger.info('DB Migration (Ver.6 -> 7) -- Start');

    // update fmspc_tcbs table
    // this is done by 1.Create new table 2.Copy data 3.Drop old table 4.Rename new into old
    logger.debug('DB Migration -- update fmspc_tcbs');
    let sql =
    'CREATE TABLE IF NOT EXISTS fmspc_tcbs_temp (fmspc VARCHAR(255) NOT NULL, type INTEGER NOT NULL, version INTEGER NOT NULL, ' +
    ' update_type VARCHAR(255) NOT NULL, tcbedn INTEGER NOT NULL, tcbinfo BLOB, root_cert_id INTEGER, signing_cert_id INTEGER, ' +
    ' created_time DATETIME NOT NULL, updated_time DATETIME NOT NULL, PRIMARY KEY(fmspc, type, version, update_type, tcbedn));';
    await sequelize.query(sql);

    sql =
    "INSERT INTO fmspc_tcbs_temp (fmspc, type, version, update_type, tcbedn, tcbinfo, root_cert_id, signing_cert_id, created_time, updated_time) " +
    " SELECT fmspc, type, version, update_type, -1 as tcbedn, tcbinfo, root_cert_id, signing_cert_id, created_time, updated_time " +
    " FROM fmspc_tcbs ";
    await sequelize.query(sql);

    sql = 'DROP TABLE fmspc_tcbs';
    await sequelize.query(sql);

    sql = 'ALTER TABLE fmspc_tcbs_temp RENAME TO fmspc_tcbs';
    await sequelize.query(sql);

    // update enclave_identities table
    // this is done by 1.Create new table 2.Copy data 3.Drop old table 4.Rename new into old
    logger.debug('DB Migration -- update enclave_identities');
    sql =
    'CREATE TABLE IF NOT EXISTS enclave_identities_temp (id INTEGER NOT NULL, version INTEGER NOT NULL, update_type VARCHAR(255) NOT NULL, ' +
    ' tcbedn INTEGER NOT NULL, identity BLOB, root_cert_id INTEGER, signing_cert_id INTEGER, created_time DATETIME NOT NULL, ' +
    ' updated_time DATETIME NOT NULL, PRIMARY KEY(id, version, update_type, tcbedn));';
    await sequelize.query(sql);

    sql =
    "INSERT INTO enclave_identities_temp (id, version, update_type, tcbedn, identity, root_cert_id, signing_cert_id, created_time, updated_time) " +
    " SELECT id, version, update_type, -1 as tcbedn, identity, root_cert_id, signing_cert_id, created_time, updated_time " +
    " FROM enclave_identities ";
    await sequelize.query(sql);

    sql = 'DROP TABLE enclave_identities';
    await sequelize.query(sql);

    sql = 'ALTER TABLE enclave_identities_temp RENAME TO enclave_identities';
    await sequelize.query(sql);

    logger.info('DB Migration -- Done.');
  });
}

export default { up };
