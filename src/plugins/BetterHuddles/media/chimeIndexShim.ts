// Stands in for the Chime SDK's package index where its own meeting code
// imports it (task/PromoteToPrimaryMeetingTask.js does `require("..")`), so the
// SDK's messaging client and AWS SDK dependencies never reach the bundle.
// See `chimeMeetingOnly` in scripts/lib/plugin.ts; `cjsDefault` is explained in cjsDefault.ts.

import { cjsDefault } from './cjsDefault.ts';
import MeetingSessionStatusModule from 'amazon-chime-sdk-js/build/meetingsession/MeetingSessionStatus.js';
import MeetingSessionStatusCodeModule from 'amazon-chime-sdk-js/build/meetingsession/MeetingSessionStatusCode.js';

export const MeetingSessionStatus = cjsDefault(MeetingSessionStatusModule);
export const MeetingSessionStatusCode = cjsDefault(MeetingSessionStatusCodeModule);
