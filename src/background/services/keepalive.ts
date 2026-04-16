import { WAKEUP_NAVIGATION_FILTERS } from '@/shared/constants/domains';
import type { BackgroundRuntimeState } from '@/background/types';

type BrowserApi = typeof browser;
type WebNavigationDetails = Parameters<
  BrowserApi['webNavigation']['onBeforeNavigate']['addListener']
>[0] extends (details: infer Details) => unknown
  ? Details
  : never;
type AlarmDetails = Parameters<BrowserApi['alarms']['onAlarm']['addListener']>[0] extends (
  alarm: infer Alarm,
) => unknown
  ? Alarm
  : never;

export class KeepAliveService {
  private readonly browserApi = browser;

  private alarmName = 'cleanplaats-keepalive';

  constructor(private readonly state: BackgroundRuntimeState) {}

  setup(): void {
    if (typeof browser === 'undefined') {
      return;
    }

    this.browserApi.alarms.create(this.alarmName, {
      delayInMinutes: 2,
      periodInMinutes: 2,
    });

    if (!this.browserApi.alarms.onAlarm.hasListener(this.handleAlarm)) {
      this.browserApi.alarms.onAlarm.addListener(this.handleAlarm);
    }

    if (this.browserApi.webNavigation?.onBeforeNavigate) {
      this.browserApi.webNavigation.onBeforeNavigate.addListener(
        this.handleNavigationActivity,
        { url: [...WAKEUP_NAVIGATION_FILTERS] },
      );
    }
  }

  resetToActiveMode = (): void => {
    if (typeof browser === 'undefined') {
      return;
    }

    this.state.lastMarketplaceActivity = Date.now();
    this.browserApi.alarms.clear(this.alarmName);
    this.browserApi.alarms.create(this.alarmName, {
      delayInMinutes: 2,
      periodInMinutes: 2,
    });
  };

  private handleNavigationActivity = (
    details: WebNavigationDetails,
  ): void => {
    if (details.frameId !== 0) {
      return;
    }
    this.state.lastMarketplaceActivity = Date.now();
  };

  private handleAlarm = (alarm: AlarmDetails): void => {
    if (alarm.name !== this.alarmName) {
      return;
    }

    const minutesSinceActivity = (Date.now() - this.state.lastMarketplaceActivity) / (1000 * 60);

    if (minutesSinceActivity > 30) {
      this.browserApi.alarms.clear(this.alarmName);
      this.browserApi.alarms.create(this.alarmName, {
        delayInMinutes: 10,
        periodInMinutes: 10,
      });
      return;
    }

    if (minutesSinceActivity > 10) {
      this.browserApi.alarms.clear(this.alarmName);
      this.browserApi.alarms.create(this.alarmName, {
        delayInMinutes: 5,
        periodInMinutes: 5,
      });
    }
  };
}
