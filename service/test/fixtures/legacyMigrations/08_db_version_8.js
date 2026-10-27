/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import logger from '../../../utils/Logger.js';

async function up(sequelize) {
  await sequelize.transaction(async (t) => {
    logger.info('DB Migration (Ver.7 -> 8) -- Start');

    // create cache_timestamps table
    logger.debug('DB Migration -- create cache_timestamps');
    let sql =
      'CREATE TABLE IF NOT EXISTS `cache_timestamps` (`cache_key` VARCHAR(255) NOT NULL, `successful` BOOLEAN NOT NULL, `last_refresh_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `error_msg` TEXT DEFAULT NULL, PRIMARY KEY (`cache_key`, `successful`));';
    await sequelize.query(sql);

    logger.info('DB Migration -- Done.');
  });
}

export default { up };
