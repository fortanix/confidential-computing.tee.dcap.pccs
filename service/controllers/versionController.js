/* Copyright (c) Fortanix, Inc.
 * SPDX-License-Identifier: BSD-3-Clause */
import pkg from '../package.json' with { type: 'json' };

export function getVersion(req, res, next) {
    try {
        res.status(200).send({ version: pkg.version });
    } catch (err) {
        next(err);
    }
}
