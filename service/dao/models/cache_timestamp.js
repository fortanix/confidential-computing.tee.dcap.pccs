/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import Sequelize from 'sequelize';

export default class CacheTimestamp extends Sequelize.Model {
    static init(sequelize) {
        super.init({
            cache_key: { type: Sequelize.DataTypes.STRING, primaryKey: true, allowNull: false },
            successful: { type: Sequelize.DataTypes.BOOLEAN, primaryKey: true, allowNull: false },
            last_refresh_at: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.DataTypes.NOW },
            error_msg: { type: Sequelize.DataTypes.TEXT, allowNull: true, defaultValue: null },
        }, { sequelize, modelName: 'CacheTimestamp', tableName: 'cache_timestamps', timestamps: false });
    }
}
