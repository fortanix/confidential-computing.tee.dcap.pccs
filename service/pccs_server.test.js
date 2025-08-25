/* Copyright(c) 2026 Intel Corporation
   SPDX-License-Identifier: BSD-3-Clause */

import esmock from 'esmock';
import sinon from 'sinon';
import request from 'supertest';
import { expect } from 'chai';

const MOUNT = '/sgx/certification/v4';
const ADMIN_TOKEN = 'test-admin-token';
const USER_TOKEN = 'test-user-token';

// Endpoints that must always require authentication, regardless of the path shape.
const PROTECTED_ROUTES = [
    { method: 'get', path: '/platforms', auth: 'admin', controller: ['platformsController', 'getPlatforms'] },
    { method: 'post', path: '/platforms', auth: 'user', controller: ['platformsController', 'postPlatforms'] },
    { method: 'put', path: '/platformcollateral', auth: 'admin', controller: ['platformCollateralController', 'putPlatformCollateral'] },
    { method: 'get', path: '/refresh', auth: 'admin', controller: ['refreshController', 'refreshCache'] },
    { method: 'post', path: '/refresh', auth: 'admin', controller: ['refreshController', 'refreshCache'] },
    { method: 'put', path: '/appraisalpolicy', auth: 'admin', controller: ['appraisalPolicyController', 'putAppraisalPolicy'] },
];

function makeHandler(name) {
    return sinon.spy((req, res) => res.status(200).send(name));
}

function makeControllerStubs() {
    return {
        versionController:            { getVersion: makeHandler('getVersion') },
        platformsController:          { getPlatforms: makeHandler('getPlatforms'), postPlatforms: makeHandler('postPlatforms') },
        platformCollateralController: { putPlatformCollateral: makeHandler('putPlatformCollateral') },
        pckcertController:            { getPckCert: makeHandler('getPckCert') },
        pckcrlController:             { getPckCrl: makeHandler('getPckCrl') },
        tcbinfoController:            { getSgxTcbInfo: makeHandler('getSgxTcbInfo'), getTdxTcbInfo: makeHandler('getTdxTcbInfo') },
        identityController:           { getEcdsaQeIdentity: makeHandler('getEcdsaQeIdentity'), getQveIdentity: makeHandler('getQveIdentity'), getTdQeIdentity: makeHandler('getTdQeIdentity') },
        rootcacrlController:          { getRootCaCrl: makeHandler('getRootCaCrl') },
        refreshController:            { refreshCache: makeHandler('refreshCache') },
        crlController:                { getCrl: makeHandler('getCrl') },
        appraisalPolicyController:    { putAppraisalPolicy: makeHandler('putAppraisalPolicy'), getAppraisalPolicy: makeHandler('getAppraisalPolicy') },
        healthController:             { getLiveness: makeHandler('getLiveness'), getReadiness: makeHandler('getReadiness'), getStartup: makeHandler('getStartup') },
    };
}

function makeAuthStub() {
    return {
        validateTokenHashes: sinon.spy(() => {}),
        validateAdmin:       sinon.spy((req, res, next) => {
            if (req.headers['admin-token'] === ADMIN_TOKEN) {
                return next();
            }
            return res.status(401).send('unauthorized');
        }),
        validateUser: sinon.spy((req, res, next) => {
            if (req.headers['user-token'] === USER_TOKEN) {
                return next();
            }
            return res.status(401).send('unauthorized');
        }),
    };
}

// Dependencies of pccs_server that must not run for real when imported by a test.
function makeServerDependencyMocks() {
    return {
        './utils/apputil.js': {
            getApiVersionFromUrl: () => 4,
            startupCheck:         () => true,
            databaseCheck:        async() => true, // resolves immediately so tests don't block on startup
        },
        'fs': {
            chmod:        () => {},
            readFileSync: () => 'test-pem',
        },
        'http':                                    { createServer: () => ({ on: () => {}, listen: () => {} }) },
        'https':                                   { createServer: () => ({ on: () => {}, listen: () => {} }) },
        'node-cron':                               { 'default': { schedule: () => ({}) } },
        './services/refreshService.js':            { scheduledRefresh: () => {} },
        './services/caching_modes/cachingMode.js': {
            LazyCachingMode:    class {},
            ReqCachingMode:     class {},
            OfflineCachingMode: class {},
        },
    };
}

describe('auth bypass regression (duplicate slashes)', () => {
    let app;
    let controllers;
    let authStub;

    before(async() => {
        controllers = makeControllerStubs();
        authStub = makeAuthStub();

        const serverModule = await esmock.strict('./pccs_server.js', makeServerDependencyMocks(), {
            './controllers/index.js': controllers,
            './middleware/auth.js':   authStub,
        });
        app = serverModule.default;
    });

    beforeEach(() => {
        sinon.resetHistory();
    });

    after(() => {
        delete global.PCS_VERSION;
    });

    function controllerSpyForRoute(route) {
        return controllers[route.controller[0]][route.controller[1]];
    }

    function authSpyForRoute(route) {
        return route.auth === 'admin' ? authStub.validateAdmin : authStub.validateUser;
    }

    PROTECTED_ROUTES.forEach((route) => {
        const normalPath = `${MOUNT}${route.path}`;
        const doubleSlashPath = `${MOUNT}/${route.path}`; // yields '.../v4//<route>'

        describe(`${route.method.toUpperCase()} ${route.path} (${route.auth} auth)`, () => {
            it('rejects the normal path without credentials', async() => {
                const res = await request(app)[route.method](normalPath);

                expect(res.status).to.equal(401);
                expect(controllerSpyForRoute(route).called).to.equal(false);
            });

            it('duplicate-slash path without credentials results in 404 (no merge of consecutive slashes)', async() => {
                const res = await request(app)[route.method](doubleSlashPath);

                // Express 5's router no longer merges consecutive slashes, so the
                // duplicate-slash path fails to match any route (404) instead of
                // reaching the router/auth middleware. Either way, no bypass occurs.
                expect(res.status).to.equal(404);
                expect(controllerSpyForRoute(route).called).to.equal(false);
                expect(authSpyForRoute(route).called).to.equal(false);
            });
        });
    });
});

describe('strict routing regression (trailing slash)', () => {
    let app;
    let controllers;
    let authStub;

    before(async() => {
        controllers = makeControllerStubs();
        authStub = makeAuthStub();

        const serverModule = await esmock.strict('./pccs_server.js', makeServerDependencyMocks(), {
            './controllers/index.js': controllers,
            './middleware/auth.js':   authStub,
        });
        app = serverModule.default;
    });

    beforeEach(() => {
        sinon.resetHistory();
    });

    after(() => {
        delete global.PCS_VERSION;
    });

    function controllerSpyForRoute(route) {
        return controllers[route.controller[0]][route.controller[1]];
    }

    function authSpyForRoute(route) {
        return route.auth === 'admin' ? authStub.validateAdmin : authStub.validateUser;
    }

    PROTECTED_ROUTES.forEach((route) => {
        const trailingSlashPath = `${MOUNT}${route.path}/`;

        it(`${route.method.toUpperCase()} ${route.path}/ (${route.auth} auth) results in 404 even with valid credentials (strict routing rejects the optional trailing slash)`, async() => {
            const validHeaders = route.auth === 'admin' ?
                { 'admin-token': ADMIN_TOKEN } :
                { 'user-token': USER_TOKEN };

            const res = await request(app)[route.method](trailingSlashPath).set(validHeaders);

            expect(res.status).to.equal(404);
            expect(controllerSpyForRoute(route).called).to.equal(false);
            expect(authSpyForRoute(route).called).to.equal(false);
        });
    });
});

describe('package version route', () => {
    let app;
    let controllers;

    before(async() => {
        controllers = makeControllerStubs();
        const serverModule = await esmock.strict('./pccs_server.js', makeServerDependencyMocks(), {
            './controllers/index.js': controllers,
            './middleware/auth.js':   makeAuthStub(),
        });
        app = serverModule.default;
    });

    beforeEach(() => {
        sinon.resetHistory();
    });

    after(() => {
        delete global.PCS_VERSION;
    });

    for (const path of ['/sgx/certification/v3/version', '/sgx/certification/v4/version']) {
        it(`GET ${path} does not require credentials and calls getVersion`, async() => {
            const res = await request(app).get(path);

            expect(res.status).to.equal(200);
            expect(res.text).to.equal('getVersion');
            expect(controllers.versionController.getVersion.calledOnce).to.equal(true);
        });
    }
});

describe('HTTP and HTTPS listener configuration', () => {
    function listenerConfig(useHttps) {
        return {
            uri:                    'https://example.com/sgx/certification/v4/',
            USE_HTTPS:              useHttps,
            HTTP_PORT:              8080,
            HTTPS_PORT:             8081,
            hosts:                  '127.0.0.1',
            DB_CONFIG:              'sqlite',
            sqlite:                 { options: { storage: '/tmp/listener-test.db' } },
            CachingFillMode:        'LAZY',
            RefreshSchedule:        '0 0 * * *',
            RequestTimeoutSeconds:  42,
            HeadersTimeoutSeconds:  23,
            KeepAliveTimeoutSeconds: 17,
        };
    }

    async function loadServer(useHttps) {
        const values = listenerConfig(useHttps);
        const httpServer = { on: sinon.spy(), listen: sinon.spy() };
        const httpsServer = { on: sinon.spy(), listen: sinon.spy() };
        const httpCreate = sinon.stub().returns(httpServer);
        const httpsCreate = sinon.stub().returns(httpsServer);
        const readFileSync = sinon.stub().returns('test-pem');
        const mocks = makeServerDependencyMocks();
        mocks.config = { default: { has: key => key in values, get: key => values[key] } };
        mocks.http = { createServer: httpCreate };
        mocks.https = { createServer: httpsCreate };
        mocks.fs = { chmod: () => {}, readFileSync };
        await esmock.strict('./pccs_server.js', mocks, {
            './controllers/index.js': makeControllerStubs(),
            './middleware/auth.js':   makeAuthStub(),
        });
        // main() resolves its startup promise on a later turn.
        await new Promise(resolve => setImmediate(resolve));
        return { httpServer, httpsServer, httpCreate, httpsCreate, readFileSync };
    }

    it('starts HTTP on HTTP_PORT without reading TLS files when USE_HTTPS is false', async() => {
        const { httpServer, httpCreate, httpsCreate, readFileSync } = await loadServer(false);

        expect(httpCreate.calledOnce).to.equal(true);
        expect(httpCreate.firstCall.args).to.have.length(1);
        expect(httpCreate.firstCall.args[0]).to.be.a('function');
        expect(httpsCreate.called).to.equal(false);
        expect(readFileSync.callCount).to.equal(0);
        expect(httpServer.listen.firstCall.args.slice(0, 2)).to.deep.equal([8080, '127.0.0.1']);
        expect(httpServer.requestTimeout).to.equal(42000);
        expect(httpServer.headersTimeout).to.equal(23000);
        expect(httpServer.keepAliveTimeout).to.equal(17000);
    });

    it('starts HTTPS on HTTPS_PORT with the certificate options when USE_HTTPS is true', async() => {
        const { httpsServer, httpCreate, httpsCreate, readFileSync } = await loadServer(true);

        expect(httpsCreate.calledOnce).to.equal(true);
        expect(httpCreate.called).to.equal(false);
        expect(readFileSync.callCount).to.equal(2);
        expect(httpsCreate.firstCall.args[0].key).to.equal('test-pem');
        expect(httpsCreate.firstCall.args[0].cert).to.equal('test-pem');
        expect(httpsCreate.firstCall.args[0].ciphers).to.include('TLS_AES_256_GCM_SHA384');
        expect(httpsCreate.firstCall.args[1]).to.be.a('function');
        expect(httpsServer.listen.firstCall.args.slice(0, 2)).to.deep.equal([8081, '127.0.0.1']);
        expect(httpsServer.requestTimeout).to.equal(42000);
        expect(httpsServer.headersTimeout).to.equal(23000);
        expect(httpsServer.keepAliveTimeout).to.equal(17000);
    });

    after(() => { delete global.PCS_VERSION; });
});
