// ./fbsimctl --state=booted \
//            launch_xctest [path]/WebDriverAgentRunner.xctest com.apple.mobilesafari --port 8100 -- \
//            listen
//
// <derived data>/Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app/PlugIns/WebDriverAgentRunner.xctest
import { SubProcess, exec } from 'teen_process';
import { fs, logger } from 'appium-support';
import path from 'path';
import { killProcess } from './utils';
import log from '../logger';
import TestRunner from './testrunner';


const fbsimctlLog = logger.getLogger('FBSimctl');

class FBSimctl extends TestRunner {
  constructor (udid, bundleId, wdaRemotePort) {
    super();

    // NEED TO KNOW:
    //    udid of device
    //    bundle id of the app under test
    //    remote port of WDA
    //    xctest location

    this.udid = udid;
    this.bundleId = bundleId;
    this.wdaRemotePort = wdaRemotePort;

    // TODO: for now
    this.wdaXctestRoot = '/Users/isaac/Library/Developer/Xcode/DerivedData/WebDriverAgent-eoyoecqmiqfeodgstkwbxkfyagll';
    if (process.env.TRAVIS) {
      this.wdaXctestRoot = '/Users/travis/Library/Developer/Xcode/DerivedData/WebDriverAgent-fbkytyigaewuhcfpleblmhjimqxt';
    }

    this.launchTimeout = 30000;
  }

  async init (noSessionProxy) {
    this.noSessionProxy = noSessionProxy;

    // figure out the xctest base for WDA
    if (this.wdaXctestRoot.indexOf('WebDriverAgentRunner.xctest') !== this.wdaXctestRoot.length + 'WebDriverAgentRunner.xctest'.length) {
      // we were not given the actual xctest location
      let possibleLocations = await fs.glob(path.resolve(this.wdaXctestRoot, '**', 'WebDriverAgentRunner.xctest'));
      possibleLocations = possibleLocations.filter((el) => el.indexOf('iphonesimulator') !== -1);
      if (possibleLocations.length !== 1) {
        log.errorAndThrow(`Too many possible locations for the xctest root: ${possibleLocations.join(', ')}`);
      }
      this.wdaXctestRoot = possibleLocations[0];
    }
  }

  async reset () {
  }

  async start () {
    let bundleId = 'com.apple.mobilesafari';
    if (this.bundleId === bundleId) {
      bundleId = 'com.apple.Preferences';
    }

    try {
      await exec('fbsimctl', ['--state=booted', 'terminate', bundleId]);
    } catch (err) {
      log.warn(`Unable to terminate '${bundleId}' process: ${err.message}`);
    }

    let args = [
      '--debug-logging',
      this.udid,
      'launch_xctest', this.wdaXctestRoot,
      bundleId,
      '--port',  this.wdaRemotePort,
      '--', 'listen'
    ];
    log.debug(`Launching test with command: 'fbsimctl ${args.join(' ')}'`);
    this.runner = new SubProcess('fbsimctl', args);

    this.runner.on('output', (stdout, stderr) => {
      let out = stdout || stderr;

      // short circuit for expected output that changes nothing
      if (out.indexOf('is implemented in both') !== -1) return; // eslint-disable-line curly

      for (let line of out.split('\n')) {
        if (!line.trim().length) continue; // eslint-disable-line curly
        fbsimctlLog.debug(line);
      }
    });
    this.runner.on('exit', async (code, signal) => {
      log.info(`fbsimctl exited with code '${code}' and signal '${signal}'`);
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
