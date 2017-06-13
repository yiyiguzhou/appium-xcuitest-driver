import { WebDriverAgent } from '../../lib/wda/webdriveragent';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';


chai.should();
chai.use(chaiAsPromised);

const fakeConstructorArgs = {
  device: {
    udid: 1,
  },
  platformVersion: '9',
  host: 'me',
  port: '5000',
  realDevice: false,
};

describe('launch', () => {
  it('should use webDriverAgentUrl override', async () => {
    let override = "http://mockUrl:8100";
    let args = Object.assign({}, fakeConstructorArgs);
    args.webDriverAgentUrl = override;
    let agent = new WebDriverAgent({}, 'xcodebuild', args);

    (await agent.launch("sessionId")).should.be.equal(override);
  });
});
