# Connection settings

This folder holds the connection settings for one device or gateway: the broker address,
its identity in Sparkplug, its username and password, and the broker's CA certificate.
Starters ship without them.

Get them from IoT OS: on the device's page, choose **Firmware**, then **Download
settings** (for a gateway, open its **Firmware** dialog). Unpack the archive into the
starter's folder, so that these files land here:

- `iotos_settings.h` and `iotos_settings.c`: the settings, compiled into the firmware.
  They work only inside a starter or a full kit, whose build finds them here.
- For a direct device, also `device-config.json`, `ca.crt` and `quickstart.md` at the
  starter's root: the same settings for other Sparkplug libraries.

Keep them private: `.gitignore` keeps them out of version control, and AI coding agents
are told never to open them. They let one device or gateway publish as itself; never
share them between devices.

If the settings leak, register the device again in IoT OS to get new credentials, and
download its settings again.
