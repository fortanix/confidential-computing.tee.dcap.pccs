/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import esmock from 'esmock';
import { expect } from 'chai';

class TestContext {
    constructor() {
        this.config = {
            has: () => false,
            get: () => '',
        };
    }

    setProxyInConfig(url) {
        this.config.has = () => true;
        this.config.get = () => url;
    }

    async getTarget() {
        return await esmock('./proxy.js', {
            config: { 'default': this.config },
        });
    }
}

describe('proxy', () => {

    describe('getEnv', () => {
        /* eslint-disable n/no-process-env */
        afterEach(() => {
            delete process.env.TEST_ENV_VAR;
            delete process.env.test_env_var;
        });

        it('should return value from lowercase env variable', async() => {
            const ctx = new TestContext();
            const { getEnv } = await ctx.getTarget();
            process.env.test_env_var = 'lowercase_value';
            expect(getEnv('test_env_var')).to.equal('lowercase_value');
        });

        it('should return value from uppercase env variable', async() => {
            const ctx = new TestContext();
            const { getEnv } = await ctx.getTarget();
            process.env.TEST_ENV_VAR = 'uppercase_value';
            expect(getEnv('test_env_var')).to.equal('uppercase_value');
        });

        it('should prefer lowercase over uppercase when both are set', async() => {
            const ctx = new TestContext();
            const { getEnv } = await ctx.getTarget();
            process.env.test_env_var = 'lower';
            process.env.TEST_ENV_VAR = 'upper';
            expect(getEnv('test_env_var')).to.equal('lower');
            expect(getEnv('TEST_ENV_VAR')).to.equal('lower');
        });

        it('should return empty string when variable is not set', async() => {
            const ctx = new TestContext();
            const { getEnv } = await ctx.getTarget();
            expect(getEnv('test_env_var')).to.equal('');
        });

        it('should accept uppercase key and match the lowercase env variable', async() => {
            const ctx = new TestContext();
            const { getEnv } = await ctx.getTarget();
            process.env.test_env_var = 'value';
            expect(getEnv('TEST_ENV_VAR')).to.equal('value');
        });
        /* eslint-enable n/no-process-env */
    });

    describe('sanitizeProxyUrlForLogging', () => {
        it('should return "disabled" unchanged', async() => {
            const ctx = new TestContext();
            const { sanitizeProxyUrlForLogging } = await ctx.getTarget();
            expect(sanitizeProxyUrlForLogging('disabled')).to.equal('disabled');
        });

        it('should return empty string unchanged', async() => {
            const ctx = new TestContext();
            const { sanitizeProxyUrlForLogging } = await ctx.getTarget();
            expect(sanitizeProxyUrlForLogging('')).to.equal('');
        });

        it('should return null/undefined unchanged', async() => {
            const ctx = new TestContext();
            const { sanitizeProxyUrlForLogging } = await ctx.getTarget();
            expect(sanitizeProxyUrlForLogging(null)).to.equal(null);
            expect(sanitizeProxyUrlForLogging(undefined)).to.equal(undefined);
        });

        it('should strip username and password from proxy URL', async() => {
            const ctx = new TestContext();
            const { sanitizeProxyUrlForLogging } = await ctx.getTarget();
            const result = sanitizeProxyUrlForLogging('http://user:secret@proxy.example.com:8080');
            expect(result).to.not.include('user');
            expect(result).to.not.include('secret');
            expect(result).to.include('proxy.example.com');
            expect(result).to.include('8080');
        });

        it('should return URL without credentials unchanged', async() => {
            const ctx = new TestContext();
            const { sanitizeProxyUrlForLogging } = await ctx.getTarget();
            const result = sanitizeProxyUrlForLogging('http://proxy.example.com:3128');
            expect(result).to.include('proxy.example.com');
            expect(result).to.include('3128');
        });

        it('should handle https proxy URLs with credentials', async() => {
            const ctx = new TestContext();
            const { sanitizeProxyUrlForLogging } = await ctx.getTarget();
            const result = sanitizeProxyUrlForLogging('https://admin:pass123@corp-proxy.internal:8443');
            expect(result).to.not.include('admin');
            expect(result).to.not.include('pass123');
            expect(result).to.include('corp-proxy.internal');
            expect(result).to.include('8443');
        });

        it('should return error indicator for invalid URL', async() => {
            const ctx = new TestContext();
            const { sanitizeProxyUrlForLogging } = await ctx.getTarget();
            const result = sanitizeProxyUrlForLogging('not-a-valid-url');
            expect(result).to.equal('invalid proxy url');
        });

        it('should handle URL with only username (no password)', async() => {
            const ctx = new TestContext();
            const { sanitizeProxyUrlForLogging } = await ctx.getTarget();
            const result = sanitizeProxyUrlForLogging('http://user@proxy.example.com:8080');
            expect(result).to.not.include('user');
            expect(result).to.include('proxy.example.com');
        });
    });

    describe('httpsProxyAgent', () => {
        /* eslint-disable n/no-process-env */
        beforeEach(() => {
            delete process.env.https_proxy;
            delete process.env.HTTPS_PROXY;
            delete process.env.http_proxy;
            delete process.env.HTTP_PROXY;
            delete process.env.all_proxy;
            delete process.env.ALL_PROXY;
        });

        afterEach(() => {
            delete process.env.https_proxy;
            delete process.env.HTTPS_PROXY;
        });

        it('should be undefined when no proxy is configured', async() => {
            const ctx = new TestContext();
            const { httpsProxyAgent } = await ctx.getTarget();
            expect(httpsProxyAgent).to.be.undefined;
        });

        it('should be undefined when proxy URL from config is invalid', async() => {
            const ctx = new TestContext();
            ctx.setProxyInConfig('not-a-valid-url');
            const { httpsProxyAgent } = await ctx.getTarget();
            expect(httpsProxyAgent).to.be.undefined;
        });

        it('should be undefined when proxy URL from env is invalid', async() => {
            const ctx = new TestContext();
            process.env.https_proxy = 'not-a-valid-url';
            const { httpsProxyAgent } = await ctx.getTarget();
            expect(httpsProxyAgent).to.be.undefined;
        });

        it('should be defined when proxy URL from config is valid', async() => {
            const ctx = new TestContext();
            ctx.setProxyInConfig('http://proxy.example.com:8080');
            const { httpsProxyAgent } = await ctx.getTarget();
            expect(httpsProxyAgent).to.not.be.undefined;
        });

        it('should be defined when proxy URL from env is valid', async() => {
            const ctx = new TestContext();
            process.env.https_proxy = 'http://proxy.example.com:8080';
            const { httpsProxyAgent } = await ctx.getTarget();
            expect(httpsProxyAgent).to.not.be.undefined;
        });

        it('should be undefined when proxy URL from config is "disabled"', async() => {
            const ctx = new TestContext();
            ctx.setProxyInConfig('disabled');
            const { httpsProxyAgent } = await ctx.getTarget();
            expect(httpsProxyAgent).to.be.undefined;
        });
        /* eslint-enable n/no-process-env */
    });
});
