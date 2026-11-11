/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import Sequelize from 'sequelize';

export default class TcbEvalDataNumbers extends Sequelize.Model {
    static init(sequelize) {
        super.init({
            type:            { type: Sequelize.DataTypes.INTEGER, primaryKey: true },
            contents:        Sequelize.DataTypes.BLOB,
            root_cert_id:    Sequelize.DataTypes.INTEGER,
            signing_cert_id: Sequelize.DataTypes.INTEGER,
        }, {
            tableName:  'tcb_eval_data_numbers',
            timestamps: true,
            createdAt:  'created_time',
            updatedAt:  'updated_time',
            sequelize,
        });
    }
}
