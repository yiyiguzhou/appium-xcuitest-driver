import _ from 'lodash';
import url from 'url';
import { JWProxy } from 'appium-base-driver';
import log from '../logger';
import { NoSessionProxy } from "./no-session-proxy";
import { killAppUsingAppName } from './utils';
import XcodeBuild from './xcodebuild';
import iProxy from './iproxy';
import FBSimctl from './fbsimctl';


const WDA_BUNDLE_ID = 'com.apple.test.WebDriverAgentRunner-Runner';
const WDA_LAUNCH_TIMEOUT = 60 * 1000;
const WDA_AGENT_PORT = 8100;
const WDA_BASE_URL = 'http://localhost';

class WebDriverAgent {
  constructor (xcodeVersion, launchSystem = 'xcodebuild', args = {}) {
    this.xcodeVersion = xcodeVersion;

    this.device = args.device;
    this.platformVersion = args.platformVersion;
    this.host = args.host;
    this.realDevice = !!args.realDevice;

    this.wdaLocalPort = args.wdaLocalPort;

    this.prebuildWDA = args.prebuildWDA;

    this.webDriverAgentUrl = args.webDriverAgentUrl;

    this.started = false;

    this.wdaConnectionTimeout = args.wdaConnectionTimeout;

    this.useCarthageSsl = _.isBoolean(args.useCarthageSsl) && args.useCarthageSsl;

    this.opts = args;

    this.launchSystem = launchSystem;

    this.runnerOpts =  {
      xcodeVersion,
      launchSystem,
      udid: this.device.udid,
      platformVersion: this.platformVersion,
      agentPath: args.agentPath,
      bootstrapPath: args.bootstrapPath,
      realDevice: this.realDevice,
      showXcodeLog: !!args.showXcodeLog,
      xcodeConfigFile: args.xcodeConfigFile,
      xcodeOrgId: args.xcodeOrgId,
      xcodeSigningId: args.xcodeSigningId,
      keychainPath: args.keychainPath,
      keychainPassword: args.keychainPassword,
      useSimpleBuildTest: args.useSimpleBuildTest,
      usePrebuiltWDA: args.usePrebuiltWDA,
      updatedWDABundleId: args.updatedWDABundleId,
      launchTimeout: args.wdaLaunchTimeout || WDA_LAUNCH_TIMEOUT,
      wdaRemotePort: this.realDevice ? WDA_AGENT_PORT : (this.wdaLocalPort || WDA_AGENT_PORT),
    };
  }

  async uninstall () {
    log.debug(`Removing WDA application from device`);
    await this.device.removeApp(WDA_BUNDLE_ID);
  }

  async launch (sessionId) {
    if (this.webDriverAgentUrl) {
      log.info(`Using provided WebdriverAgent at '${this.webDriverAgentUrl}'`);
      this.url = this.webDriverAgentUrl;
      this.setupProxies(sessionId);
      return this.webDriverAgentUrl;
    }

    log.info('Launching WebDriverAgent on the device');

    this.setupProxies(sessionId);

    this.testrunner = await this.createTestRunner(this.noSessionProxy, this.runnerOpts);

    //kill all hanging processes
    await this.killHangingProcesses();

    if (this.realDevice) {
      this.iproxy = new iProxy(this.device.udid, this.url.port, WDA_AGENT_PORT);
      await this.iproxy.start();
    }

    if (this.prebuildWDA && _.isFunction(this.testrunner.prebuild)) {
      await this.testrunner.prebuild();
    }

    // start the xcodebuild process
    // return await this.xcodebuild.start();
    return await this.testrunner.start();
  }

  setupProxies (sessionId) {
    const proxyOpts = {
      server: this.url.hostname,
      port: this.url.port,
      base: '',
      timeout: this.wdaConnectionTimeout,
    };

    this.jwproxy = new JWProxy(proxyOpts);
    this.jwproxy.sessionId = sessionId;
    this.proxyReqRes = this.jwproxy.proxyReqRes.bind(this.jwproxy);

    this.noSessionProxy = new NoSessionProxy(proxyOpts);
    this.noSessionProxyReqRes = this.noSessionProxy.proxyReqRes.bind(this.noSessionProxy);
  }

  async killHangingProcesses () {
    log.debug('Killing hanging processes');
    await killAppUsingAppName(this.device.udid, `xcodebuild`);
    let procNames = this.realDevice ? ['iproxy'] : ['XCTRunner'];
    for (let proc of procNames) {
      await killAppUsingAppName(this.device.udid, proc);
    }
  }

  async quit () {
    log.info('Shutting down sub-processes');

    if (this.iproxy) {
      await this.iproxy.quit();
    }

    await this.testrunner.quit();
    await this.testrunner.reset();

    if (this.jwproxy) {
      this.jwproxy.sessionId = null;
    }

    this.started = false;
  }

  get url () {
    if (!this._url) {
      let port = this.wdaLocalPort || WDA_AGENT_PORT;
      this._url = url.parse(`${WDA_BASE_URL}:${port}`);
    }
    return this._url;
  }

  set url (_url) {
    this._url = url.parse(_url);
  }

  get fullyStarted () {
    return this.started;
  }

  set fullyStarted (started = false) {
    // before WDA is started we expect errors from iproxy, since it is not
    // communicating with anything yet
    this.started = started;
    if (this.iproxy) {
      this.iproxy.expectIProxyErrors = !started;
    }
  }

  get derivedDataPath () {
    return this.testrunner.derivedDataPath;
  }

  async createTestRunner (proxy, opts = {}) {
    let testrunner;
    if (opts.launchSystem === 'xcodebuild') {
      testrunner = new XcodeBuild(opts.xcodeVersion, opts);
    } else {
      testrunner = new FBSimctl(opts.udid, opts.bundleId, opts.wdaRemotePort);
    }

    if (_.isFunction(testrunner.ensureRunPossible)) {
      await testrunner.ensureRunPossible();
    }

    try {
      await testrunner.init(proxy);
    } catch (err) {
      if (opts.launchSystem === 'fbsimctl') {
        await testrunner.build(opts);
        await testrunner.init(proxy);
      } else {
        throw err;
      }
    }

    return testrunner;
  }
}

export default WebDriverAgent;
export { WebDriverAgent, WDA_BUNDLE_ID };
