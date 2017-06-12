import log from '../logger';
import { retryInterval } from 'asyncbox';


class TestRunner {
  async waitForStart (startTime) {
    // try to connect once every 0.5 seconds, until `launchTimeout` is up
    log.debug(`Waiting up to ${this.launchTimeout}ms for WebDriverAgent to start`);
    let currentStatus = null;
    try {
      let retries = parseInt(this.launchTimeout / 500, 10);
      await retryInterval(retries, 500, async () => {
        if (this.runner.processExited) {
          // there has been an error elsewhere and we need to short-circuit
          return;
        }
        const proxyTimeout = this.noSessionProxy.timeout;
        this.noSessionProxy.timeout = 1000;
        try {
          currentStatus = await this.noSessionProxy.command('/status', 'GET');
          if (currentStatus && currentStatus.ios && currentStatus.ios.ip) {
            this.agentUrl = currentStatus.ios.ip;
            log.debug(`WebDriverAgent running on ip '${this.agentUrl}'`);
          }
        } catch (err) {
          throw new Error(`Unable to connect to running WebDriverAgent: ${err.message}`);
        } finally {
          this.noSessionProxy.timeout = proxyTimeout;
        }
      });

      if (this.runner.processExited) {
        // there has been an error elsewhere and we need to short-circuit
        return currentStatus;
      }

      let endTime = process.hrtime(startTime);
      // must get [s, ns] array into ms
      let startupTime = parseInt((endTime[0] * 1e9 + endTime[1]) / 1e6, 10);
      log.debug(`WebDriverAgent successfully started after ${startupTime}ms`);
    } catch (err) {
      // at this point, if we have not had any errors from xcode itself (reported
      // elsewhere), we can let this go through and try to create the session
      log.debug(err.message);
      log.warn(`Getting status of WebDriverAgent on device timed out. Continuing`);
    }
    return currentStatus;
  }
}


export default TestRunner;
