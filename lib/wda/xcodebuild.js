import { SubProcess } from 'teen_process';
import { fs, logger } from 'appium-support';
import log from '../logger';
import B from 'bluebird';
import { fixForXcode7, setRealDeviceSecurity, generateXcodeConfigFile,
         updateProjectFile, resetProjectFile, killProcess, checkForDependencies
       } from './utils';
import _ from 'lodash';
import path from 'path';
import TestRunner from './testrunner';


const BOOTSTRAP_PATH = path.resolve(__dirname, '..', '..', '..', 'WebDriverAgent');
const DEFAULT_SIGNING_ID = "iPhone Developer";
const BUILD_TEST_DELAY = 1000;

const xcodeLog = logger.getLogger('Xcode');

class XcodeBuild extends TestRunner {
  constructor (xcodeVersion, device, args = {}) {
    super();

    this.xcodeVersion = xcodeVersion;

    this.device = device;

    this.realDevice = args.realDevice;

    this.setWDAPaths(args.bootstrapPath, args.agentPath);

    this.platformVersion = args.platformVersion;

    this.showXcodeLog = !!args.showXcodeLog;

    this.xcodeConfigFile = args.xcodeConfigFile;
    this.xcodeOrgId = args.xcodeOrgId;
    this.xcodeSigningId = args.xcodeSigningId || DEFAULT_SIGNING_ID;
    this.keychainPath = args.keychainPath;
    this.keychainPassword = args.keychainPassword;

    this.prebuildWDA = args.prebuildWDA;
    this.usePrebuiltWDA = args.usePrebuiltWDA;
    this.useSimpleBuildTest = args.useSimpleBuildTest;

    this.launchTimeout = args.launchTimeout;

    this.wdaRemotePort = args.wdaRemotePort;

    this.updatedWDABundleId = args.updatedWDABundleId;
  }

  async ensureRunPossible () {
    if (!await fs.exists(this.agentPath)) {
      throw new Error(`Trying to use WebDriverAgent project at '${this.agentPath}' but the ` +
                      'file does not exist');
    }
  }

  async init (noSessionProxy) {
    this.noSessionProxy = noSessionProxy;

    if (this.xcodeVersion.major === 7 || (this.xcodeVersion.major === 8 && this.xcodeVersion.minor === 0)) {
      log.debug(`Using Xcode ${this.xcodeVersion.versionString}, so fixing WDA codebase`);
      await fixForXcode7(this.bootstrapPath, true);
    }

    // if necessary, update the bundleId to user's specification
    if (this.realDevice && this.updatedWDABundleId) {
      await updateProjectFile(this.agentPath, this.updatedWDABundleId);
    }

    // make sure that the WDA dependencies have been built
    await checkForDependencies(this.bootstrapPath, this.useCarthageSsl);
  }

  async reset () {
    // if necessary, reset the bundleId to original value
    if (this.realDevice && this.updatedWDABundleId) {
      await resetProjectFile(this.agentPath, this.updatedWDABundleId);
    }
  }

  setWDAPaths (bootstrapPath, agentPath) {
    // allow the user to specify a place for WDA. This is undocumented and
    // only here for the purposes of testing development of WDA
    this.bootstrapPath = bootstrapPath || BOOTSTRAP_PATH;
    log.info(`Using WDA path: '${this.bootstrapPath}'`);

    // for backward compatibility we need to be able to specify agentPath too
    this.agentPath = agentPath || path.resolve(this.bootstrapPath, 'WebDriverAgent.xcodeproj');
    log.info(`Using WDA agent: '${this.agentPath}'`);
  }

  async prebuild () {
    if (this.xcodeVersion.major === 7) {
      log.debug(`Capability 'prebuildWDA' set, but on xcode version ${this.xcodeVersion.versionString} so skipping`);
      return;
    }

    // first do a build phase
    log.debug('Pre-building WDA before launching test');
    this.usePrebuiltWDA = true;
    await this.start(true);

    this.runner = null;

    // pause a moment
    await B.delay(BUILD_TEST_DELAY);
  }

  getCommand (buildOnly = false) {
    let cmd = 'xcodebuild';
    let args;

    // figure out the targets for xcodebuild
    if (this.xcodeVersion.major < 8) {
      args =[
        'build',
        'test',
      ];
    } else {
      let [buildCmd, testCmd] = this.useSimpleBuildTest ? ['build', 'test'] : ['build-for-testing', 'test-without-building'];
      if (buildOnly) {
        args = [buildCmd];
      } else if (this.usePrebuiltWDA) {
        args = [testCmd];
      } else {
        args = [buildCmd, testCmd];
      }
    }

    // add the rest of the arguments for the xcodebuild command
    let genericArgs = [
      '-project', this.agentPath,
      '-scheme', 'WebDriverAgentRunner',
      '-destination', `id=${this.device.udid}`,
      '-configuration', 'Debug'
    ];
    args.push(...genericArgs);

    const versionMatch = new RegExp(/^(\d+)\.(\d+)/).exec(this.platformVersion);
    if (versionMatch) {
      args.push(`IPHONEOS_DEPLOYMENT_TARGET=${versionMatch[1]}.${versionMatch[2]}`);
    } else {
      log.warn(`Cannot parse major and minor version numbers from platformVersion "${this.platformVersion}". ` +
               'Will build for the default platform instead');
    }

    if (this.realDevice && this.xcodeConfigFile) {
      log.debug(`Using Xcode configuration file: '${this.xcodeConfigFile}'`);
      args.push('-xcconfig', this.xcodeConfigFile);
    }

    return {cmd, args};
  }

  async createSubProcess (buildOnly = false) {
    if (this.realDevice) {
      if (this.keychainPath && this.keychainPassword) {
        await setRealDeviceSecurity(this.keychainPath, this.keychainPassword);
      }
      if (this.xcodeOrgId && this.xcodeSigningId && !this.xcodeConfigFile) {
        this.xcodeConfigFile = await generateXcodeConfigFile(this.xcodeOrgId, this.xcodeSigningId);
      }
    }
    let {cmd, args} = this.getCommand(buildOnly);
    log.debug(`Beginning ${buildOnly ? 'build' : 'test'} with command '${cmd} ${args.join(' ')}' ` +
              `in directory '${this.bootstrapPath}'`);
    let xcodebuild = new SubProcess(cmd, args, {cwd: this.bootstrapPath, env: {USE_PORT: this.wdaRemotePort}});

    let logXcodeOutput = this.showXcodeLog;
    log.debug(`Output from xcodebuild ${logXcodeOutput ? 'will' : 'will not'} be logged`);
    xcodebuild.on('output', (stdout, stderr) => {
      let out = stdout || stderr;
      // we want to pull out the log file that is created, and highlight it
      // for diagnostic purposes
      if (out.indexOf('Writing diagnostic log for test session to') !== -1) {
        // pull out the first line that begins with the path separator
        // which *should* be the line indicating the log file generated
        xcodebuild.logLocation = _.first(_.remove(out.trim().split('\n'), (v) => v.indexOf(path.sep) === 0));
        log.debug(`Log file for xcodebuild test: ${xcodebuild.logLocation}`);
      }

      // if we have an error we want to output the logs
      // otherwise the failure is inscrutible
      // but do not log permission errors from trying to write to attachments folder
      if (out.indexOf('Error Domain=') !== -1 && out.indexOf('Error writing attachment data to file') === -1) {
        logXcodeOutput = true;

        // terrible hack to handle case where xcode return 0 but is failing
        xcodebuild._wda_error_occurred = true;
      }

      if (logXcodeOutput) {
        // do not log permission errors from trying to write to attachments folder
        if (out.indexOf('Error writing attachment data to file') === -1) {
          for (let line of out.split('\n')) {
            xcodeLog.info(line);
          }
        }
      }
    });

    return xcodebuild;
  }

  async start (buildOnly = false) {
    this.runner = await this.createSubProcess(buildOnly);

    // wrap the start procedure in a promise so that we can catch, and report,
    // any startup errors that are thrown as events
    return await new B((resolve, reject) => {
      this.xcodebuild.on('exit', async (code, signal) => {
        log.info(`xcodebuild exited with code '${code}' and signal '${signal}'`);
        // print out the xcodebuild file if users have asked for it
        if (this.showXcodeLog && this.xcodebuild.logLocation) {
          xcodeLog.info(`Contents of xcodebuild log file '${this.runner.logLocation}':`);
          try {
            let data = await fs.readFile(this.runner.logLocation, 'utf-8');
            for (let line of data.split('\n')) {
              xcodeLog.info(line);
            }
          } catch (err) {
            log.debug(`Unable to access xcodebuild log file: '${err.message}'`);
          }
        }
        this.runner.processExited = true;
        if (this.runner._wda_error_occurred || (!signal && code !== 0)) {
          return reject(new Error(`xcodebuild failed with code ${code}`));
        }
        // in the case of just building, the process will exit and that is our finish
        if (buildOnly) {
          return resolve();
        }
      });

      return (async () => {
        try {
          let startTime = process.hrtime();
          await this.runner.start();
          if (!buildOnly) {
            let status = await this.waitForStart(startTime);
            resolve(status);
          }
        } catch (err) {
          let msg = `Unable to start WebDriverAgent: ${err}`;
          log.error(msg);
          reject(new Error(msg));
        }
      })();
    });
  }

  async quit () {
    await killProcess('xcodebuild', this.runner);
  }

  get derivedDataPath () {
    if (!this._derivedDataPath && this.runner) {
      // https://regex101.com/r/PqmX8I/1
      const folderRegexp = /(.+\/WebDriverAgent-[^\/]+)/;
      let match = folderRegexp.exec(this.runner.logLocation);
      if (!match) {
        return;
      }
      this._derivedDataPath = match[1];
    }
    return this._derivedDataPath;
  }
}

export { XcodeBuild, BOOTSTRAP_PATH };
export default XcodeBuild;
