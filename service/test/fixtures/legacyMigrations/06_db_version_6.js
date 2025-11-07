/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import logger from '../../../utils/Logger.js';

async function up(sequelize) {
  await sequelize.transaction(async (t) => {
    logger.info('DB Migration (Ver.5 -> 6) -- Start');

    // create appraisal_policies table
    logger.debug('DB Migration -- create tcb_eval_data_numbers');
    let sql =
      'CREATE TABLE IF NOT EXISTS tcb_eval_data_numbers (type INTEGER PRIMARY KEY, contents BLOB NOT NULL,' +
      ' root_cert_id INTEGER NOT NULL, signing_cert_id INTEGER NOT NULL,' +
      ' created_time DATETIME NOT NULL, updated_time DATETIME NOT NULL)';
    await sequelize.query(sql);

    logger.info('DB Migration -- Done.');
  });
}

export default { up };
