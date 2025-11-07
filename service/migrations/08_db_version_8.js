/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
async function up(sequelize) {
    await sequelize.transaction(async transaction => {
        await sequelize.query('CREATE TABLE IF NOT EXISTS cache_timestamps (' +
            'cache_key VARCHAR(255) NOT NULL, successful BOOLEAN NOT NULL, last_refresh_at DATETIME NOT NULL, ' +
            'error_msg TEXT, PRIMARY KEY(cache_key, successful))', { transaction });
    });
}
export default { up };
