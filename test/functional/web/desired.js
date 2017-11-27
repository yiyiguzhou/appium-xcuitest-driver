import { GENERIC_CAPS, REAL_DEVICE_CAPS, PLATFORM_VERSION } from '../desired';
import _ from 'lodash';


const SAFARI_CAPS = _.defaults({
  browserName: 'Safari',
  showXcodeLog: true,
}, GENERIC_CAPS, REAL_DEVICE_CAPS);

export { SAFARI_CAPS, PLATFORM_VERSION };
