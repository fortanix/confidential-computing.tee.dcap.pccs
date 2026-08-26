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
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
 * OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT
 * OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS;
 * OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
 * OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 *
 * SPDX-License-Identifier: BSD-3-Clause
 */

import Config from 'config';
import winston from 'winston';
import path from 'path';
import * as fs from 'fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'url';
const scriptDirname = path.dirname(fileURLToPath(import.meta.url));
const { createLogger, format, transports } = winston;
const { combine, timestamp, printf } = format;

const LOGGER_CONTEXT_KEY = Symbol.for('LoggerRequestContext');
const loggerRequestContext = globalThis[LOGGER_CONTEXT_KEY] ?? new AsyncLocalStorage();
globalThis[LOGGER_CONTEXT_KEY] = loggerRequestContext;

export function getCurrentRequestId() {
    return loggerRequestContext.getStore()?.requestId;
}

export function setCurrentRequestId(requestId, callback) {
    loggerRequestContext.run({ requestId }, callback);
}

export function formatLogMessage(tokens, req, res) {
    const url = tokens.url(req, res);
    const status = tokens.status(req, res);
    const ip = tokens['remote-addr'](req, res);
    return `[IP=${ip}][URL=${parseAndShortenUrlForLogging(url)}] -> [Status=${status}]`;
}

const options = {
    file: {
        level:            Config.has('LogLevel') ? Config.get('LogLevel') : 'info',
        filename:         path.join(scriptDirname, '../logs/ccs_server.log'),
        handleExceptions: true,
        json:             false,
        colorize:         true,
    },
    console: {
        level:            Config.has('LogLevel') ? Config.get('LogLevel') : 'info',
        handleExceptions: true,
        json:             false,
        colorize:         true,
    },
};

const LOGGER_PROXY_KEY = Symbol.for('LoggerProxy');

let loggerProxy = globalThis[LOGGER_PROXY_KEY];

if (!loggerProxy) {
    // Ensure file transport path exists before Winston opens the log file.
    fs.mkdirSync(path.join(scriptDirname, '../logs'), { recursive: true });

    let stopped = false;

    const logger = createLogger({
        format: combine(
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
            printf((info) => {
                const requestId = getCurrentRequestId();
                if (!requestId) {
                    return `${info.timestamp} [${info.level}]: ${info.message}`;
                } else {
                    return `${info.timestamp} [${info.level}] [Client Request-ID=${requestId}] ${info.message}`;
                }
            })
        ),
        transports: [
            new transports.File(options.file),
            new transports.Console(options.console),
        ],
        exitOnError: false, // do not exit on handled exceptions
    });

    logger.stream = {
        write: message => {
            if (stopped) {
                return;
            }
            logger.info(String(message).trim());
        },
    };

    logger.on('finish', () => {
        setTimeout(() => process.exit(1), 2000);
    });

    logger.endAndExitProcess = () => {
        logger.end();
    };

    process.on('uncaughtException', exception => {
        logger.error(exception);
    });

    process.on('SIGINT', () => {
        logger.endAndExitProcess();
    });

    // Create a proxy for the logger to check the stopped flag
    loggerProxy = new Proxy(logger, {
        get(target, property) {
            if (property === 'endAndExitProcess') {
                return () => {
                    stopped = true;
                    target.end();
                };
            }
            if (stopped) {
                const value = target[property];
                return typeof value === 'function' ? () => {} : value;
            }
            return target[property];
        }
    });
    globalThis[LOGGER_PROXY_KEY] = loggerProxy;
}

export function parseAndShortenUrlForLogging(url) {
    try {
        if (typeof url !== 'string' || url.length === 0) {
            return String(url ?? '');
        }

        let parsedUrl;
        let queryString = '';

        if (url.startsWith('http://') || url.startsWith('https://')) {
            try {
                parsedUrl = new URL(url);
                queryString = parsedUrl.search.slice(1);
            } catch (error) {
                loggerProxy.warn(`URL parsing error: ${error.message}`);
                return url;
            }
        } else {
            const [pathname, query] = url.split('?', 2);
            parsedUrl = { pathname, search: query ? `?${query}` : '' };
            queryString = query || '';
        }
        if (!queryString) {
            return url;
        }

        const paramsArray = queryString.split('&');
        const modifiedParamsArray = paramsArray.map(param => {
            const separatorIndex = param.indexOf('=');
            if (separatorIndex === -1) {
                return param;
            }

            const key = param.slice(0, separatorIndex);
            const value = param.slice(separatorIndex + 1);
            if (value && value.length > 50) {
                const modifiedValue = `${value.slice(0, 4)}...${value.slice(-4)}`;
                return `${key}=${modifiedValue}`;
            }
            return param;
        });

        const modifiedQueryString = modifiedParamsArray.join('&');
        parsedUrl.search = `?${modifiedQueryString}`;
        const modifiedUrl = parsedUrl.origin ? parsedUrl.origin + parsedUrl.pathname + parsedUrl.search : parsedUrl.pathname + parsedUrl.search;
        return modifiedUrl;
    } catch (error) {
        loggerProxy.warn(`URL modifying error: ${error.message}`);
        return url;
    }
}

export default loggerProxy;
