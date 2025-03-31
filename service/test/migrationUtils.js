/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import Sequelize from 'sequelize';
import { Umzug, SequelizeStorage } from 'umzug';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createDatabase() {
    const database = process.env.PCCS_TEST_DATABASE;
    if (database && !['sqlite', 'mysql'].includes(database)) {
        throw new Error('PCCS_TEST_DATABASE must be sqlite or mysql');
    }
    if (database === 'mysql') {
        for (const key of ['MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD']) {
            if (!process.env[key]) { throw new Error(`${key} is required for a disposable MySQL test database`); }
        }
        return new Sequelize(process.env.MYSQL_DATABASE, process.env.MYSQL_USER, process.env.MYSQL_PASSWORD, {
            dialect: 'mysql', host: process.env.MYSQL_HOST || '127.0.0.1',
            port: Number(process.env.MYSQL_PORT || 3306), logging: false,
        });
    }
    return new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
}

export function migrator(sequelize, maximum = '99') {
    const directory = path.resolve('migrations');
    const migrations = fs.readdirSync(directory).sort().filter(name => name.slice(0, 2) <= maximum).map(name => ({
        name,
        up: async() => {
            if (name.endsWith('.up.sql')) {
                for (const sql of fs.readFileSync(path.join(directory, name), 'utf8').split(';')) {
                    // eslint-disable-next-line no-await-in-loop
                    if (sql.trim()) { await sequelize.query(sql); }
                }
            } else {
                await (await import(pathToFileURL(path.join(directory, name)).href)).default.up(sequelize);
            }
        },
    }));
    return new Umzug({ migrations, context: sequelize, storage: new SequelizeStorage({ sequelize, tableName: 'umzug' }), logger: undefined });
}

export async function clearDatabase(sequelize) {
    await sequelize.getQueryInterface().dropAllTables();
}
