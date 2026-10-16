/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
async function up(sequelize) {
    await sequelize.transaction(async transaction => {
        await sequelize.query('CREATE TABLE IF NOT EXISTS tcb_eval_data_numbers (' +
            'type INTEGER PRIMARY KEY, contents BLOB NOT NULL, root_cert_id INTEGER NOT NULL, ' +
            'signing_cert_id INTEGER NOT NULL, created_time DATETIME NOT NULL, updated_time DATETIME NOT NULL)',
        { transaction });
    });
}
export default { up };
