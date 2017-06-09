// ./fbsimctl --state=booted \
//            launch_xctest [path]/WebDriverAgentRunner.xctest com.apple.mobilesafari --port 8100 -- \
//            listen
//
// <derived data>/Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app/PlugIns/WebDriverAgentRunner.xctest
import { SubProcess, exec } from 'teen_process';
import { logger } from 'appium-support';
import { killProcess } from './utils';
import log from '../logger';
import TestRunner from './testrunner';


const fbsimctlLog = logger.getLogger('FBSimctl');

class FBSimctl extends TestRunner {
  constructor (bundleId, wdaRemotePort) {
    super();

    this.bundleId = bundleId;
    this.wdaRemotePort = wdaRemotePort;

    this.launchTimeout = 30000;
  }

  async init (noSessionProxy) {
    this.noSessionProxy = noSessionProxy;
  }

  async reset () {
  }

  async start () {
    try {
      await exec('fbsimctl', ['--state=booted', 'terminate', 'com.apple.mobilesafari']);
    } catch (err) {
      log.warn(`Unable to terminate Safari process: ${err.message}`);
    }

    // TODO: for now
    let derivedBase = '/Users/isaac/Library/Developer/Xcode/DerivedData/WebDriverAgent-eoyoecqmiqfeodgstkwbxkfyagll';
    if (process.env.TRAVIS) {
      derivedBase = '/Users/travis/Library/Developer/Xcode/DerivedData/WebDriverAgent-fbkytyigaewuhcfpleblmhjimqxt';
    }

    let bundleId = 'com.apple.mobilesafari';
    if (this.bundleId === bundleId) {
      bundleId = 'com.apple.Preferences';
    }

    let args = [
      '--debug-logging',
      '--state=booted',
      'launch_xctest', `${derivedBase}/Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app/PlugIns/WebDriverAgentRunner.xctest`,
      bundleId,
      '--port',  this.wdaRemotePort,
      '--', 'listen'
    ];
    log.debug(`Launching test with command: 'fbsimctl ${args.join(' ')}'`);
    this.runner = new SubProcess('fbsimctl', args);

    this.runner.on('output', (stdout, stderr) => {
      let out = stdout || stderr;

      // short circuit for expected output
      if (out.indexOf('is implemented in both') !== -1) return; // eslint-disable-line curly

      for (let line of out.split('\n')) {
        if (!line.trim().length) continue; // eslint-disable-line curly
        fbsimctlLog.debug(line);
      }
    });
    this.runner.on('exit', async (code, signal) => {
      log.debug('FBSIMCTL EXIT:', code, signal);
    });

    let startTime = process.hrtime();
    await this.runner.start();
    let status = await this.waitForStart(startTime);
    return status;
  }

  async quit () {
    await killProcess('fbsimctl', this.runner);
  }

  get derivedDataPath () {
    return '';
  }
}

export { FBSimctl };
export default FBSimctl;
