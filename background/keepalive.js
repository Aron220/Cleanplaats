/**
 * Background Firefox keep-alive management.
 */

function setupKeepAlive() {
    if (typeof browser !== 'undefined') {
        console.log('Cleanplaats: Setting up smart Firefox keep-alive mechanism');

        browserAPI.alarms.create('cleanplaats-keepalive', {
            delayInMinutes: 2,
            periodInMinutes: 2
        });

        if (!browserAPI.alarms.onAlarm.hasListener(handleKeepAliveAlarm)) {
            browserAPI.alarms.onAlarm.addListener(handleKeepAliveAlarm);
        }

        if (browserAPI.webNavigation && browserAPI.webNavigation.onBeforeNavigate) {
            browserAPI.webNavigation.onBeforeNavigate.addListener((details) => {
                if (details.frameId === 0 &&
                    (details.url.includes('marktplaats.nl') || details.url.includes('2dehands.be') || details.url.includes('2ememain.be'))) {
                    lastMarktplaatsActivity = Date.now();
                    console.log('Cleanplaats: Marktplaats activity detected, updating timestamp');
                }
            });
        }
    }
}

function handleKeepAliveAlarm(alarm) {
    if (alarm.name === 'cleanplaats-keepalive') {
        const timeSinceActivity = Date.now() - lastMarktplaatsActivity;
        const minutesSinceActivity = timeSinceActivity / (1000 * 60);

        console.log(`Cleanplaats: Keep-alive check - ${minutesSinceActivity.toFixed(1)} minutes since last Marktplaats activity`);

        if (minutesSinceActivity > 30) {
            console.log('Cleanplaats: User inactive for 30+ minutes, switching to low-frequency mode');
            browserAPI.alarms.clear('cleanplaats-keepalive');
            browserAPI.alarms.create('cleanplaats-keepalive', {
                delayInMinutes: 10,
                periodInMinutes: 10
            });
        } else if (minutesSinceActivity > 10) {
            console.log('Cleanplaats: User inactive for 10+ minutes, switching to medium-frequency mode');
            browserAPI.alarms.clear('cleanplaats-keepalive');
            browserAPI.alarms.create('cleanplaats-keepalive', {
                delayInMinutes: 5,
                periodInMinutes: 5
            });
        } else {
            console.log('Cleanplaats: User recently active, maintaining normal frequency');
        }
    }
}

function resetKeepAliveToActiveMode() {
    if (typeof browser !== 'undefined') {
        lastMarktplaatsActivity = Date.now();

        browserAPI.alarms.clear('cleanplaats-keepalive');
        browserAPI.alarms.create('cleanplaats-keepalive', {
            delayInMinutes: 2,
            periodInMinutes: 2
        });

        console.log('Cleanplaats: Reset keep-alive to active mode');
    }
}
