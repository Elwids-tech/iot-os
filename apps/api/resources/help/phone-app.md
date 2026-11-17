---
{
  "slug": "phone-app",
  "title": "Get alerts on your phone",
  "section": "Alerts",
  "contexts": [
    "settings.my-notifications"
  ],
  "keywords": [
    "phone",
    "mobile",
    "app",
    "install",
    "home screen",
    "push",
    "push notification",
    "notification",
    "iphone",
    "ipad",
    "android",
    "lock screen",
    "my notifications",
    "device",
    "levels"
  ],
  "required_capabilities": [
    "devices.view"
  ],
  "revision": 1,
  "summary": "Install the app on your phone, turn on push, and get the alerts from your bell as notifications, even while the app is closed. Choose which levels and organizations reach your devices.",
  "questions": [
    "How do I get alerts on my phone?",
    "Why does my iPhone not offer push notifications?",
    "How do I stop notifications from one organization?",
    "How do I remove a lost phone?"
  ]
}
---
## Purpose
Push notifications bring the alerts in your bell to your phone or computer as they happen, even while the app is closed. Tapping one opens the alert, ready to acknowledge. The web app installs like any other app, with its own icon, and needs no app store.

## Before you start
Push follows your bell: you get a push only for alerts an automation sends to you as a recipient, in organizations where you can view devices. Ask someone who manages automations to add you as a recipient.

On iPhone and iPad, push needs iOS or iPadOS 16.4 or later and works only in the app added to the Home Screen, not in a browser tab. On Android and computers, Chrome, Edge, Firefox and Samsung Internet support push in the browser and in the installed app.

## Steps
1. **Install on Android.** Open the web app in Chrome, open your user menu and choose **Install app**, then confirm. You can also use the browser menu's **Install app** or **Add to Home screen**.
2. **Install on iPhone and iPad.** Open the web app in Safari, tap **Share**, then **Add to Home Screen** and **Add**. Open the app from your Home Screen and sign in there once: it keeps its own sign-in, separate from Safari's. Turn on **Keep me signed in** so it stays signed in for 30 days.
3. **Turn on push.** In the app, open your user menu and choose **My notifications**, then **Turn on push on this device**, and allow notifications when asked. A test notification arrives within seconds. You can also turn it on from the button at the bottom of the bell.
4. **Choose levels and organizations.** Under **What gets pushed**, choose which levels reach your devices (**Critical**, **Warning**, **Info** and **Cleared**) and switch off any organization you don't want pushes from, then select **Save changes**. **Turn off push everywhere** stops every push and keeps your choices and devices for later.
5. **Manage your devices.** The device list shows each phone or browser with push, when it was added and when a push last reached it. **Send test** checks one; **Remove** stops push there and signs that device out, which is how you deal with a lost phone.

## Expected result
New alerts that reach your bell arrive as notifications on every device with push, with their level, automation, device and organization. A cleared alert replaces its earlier notification. When many alerts arrive within a minute from one organization, you get the first three and then one summary, such as **7 more alerts**, that opens the active alerts. The bell still lists every alert, whatever your push choices.

## Troubleshooting
- **No push option on iPhone or iPad.** Push works only in the app opened from the Home Screen. Add it to the Home Screen, open it from there, sign in and turn on push in **My notifications**.
- **Notifications are blocked.** If you chose **Don't Allow**, the page can't ask again. Allow notifications for the site in the browser's site settings, or on a phone in **Settings → Notifications** for the app, then reload and turn on push.
- **Notifications don't show their text on the lock screen.** The phone decides what the lock screen shows. Check the notification preview setting for the app in the phone's settings.
- **Push stopped on this device.** A browser can end its push registration, for example after its data was cleared. The app tells you on the next start; select **Turn on again**.
- **A push didn't arrive.** Check that the alert is in your bell, that its level and organization are switched on under **What gets pushed**, and that **Send test** reaches the device. A phone that stays offline for more than a day misses pushes from that time; the bell still has them.

## Related guides
[Review and respond to alerts](/help/alerts) · [Configure notification recipients](/help/alert-notifications)
