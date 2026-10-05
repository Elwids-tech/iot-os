import subprocess
from pathlib import Path

base = "/srv/elwids"
common = (
    " --env "
    + base
    + "/private/application.env --manifest "
    + base
    + "/private/current-release.json"
)
for name, command, schedule, extra, jitter in [
    ("metrics", "metrics", "*-*-* *:*:00", "", 0),
    (
        "backup",
        "backup",
        "*-*-* 08:00:00 UTC",
        " --backup-env " + base + "/private/backup.env",
        300,
    ),
    ("certificates", "certificates", "*-*-* 09,21:00:00 UTC", "", 300),
]:
    service = (
        "[Unit]\nDescription=Elwids "
        + name
        + "\nAfter=docker.service network-online.target\nRequires=docker.service\nConditionPathExists="
        + base
        + "/private/current-release.json\n[Service]\nType=oneshot\nUMask=0077\nExecStart=/usr/bin/python3 "
        + base
        + "/source/tooling/release/manage.py "
        + command
        + common
        + extra
        + "\n"
    )
    timer = (
        "[Unit]\nDescription=Elwids "
        + name
        + " timer\n[Timer]\nOnCalendar="
        + schedule
        + "\nPersistent=true\nRandomizedDelaySec="
        + str(jitter)
        + "\n[Install]\nWantedBy=timers.target\n"
    )
    Path("/etc/systemd/system/elwids-" + name + ".service").write_text(service)
    Path("/etc/systemd/system/elwids-" + name + ".timer").write_text(timer)
subprocess.run(["systemctl", "daemon-reload"], check=True)
subprocess.run(
    [
        "systemctl",
        "enable",
        "--now",
        "elwids-metrics.timer",
        "elwids-backup.timer",
        "elwids-certificates.timer",
    ],
    check=True,
)
print("Metrics, encrypted checkpoint and MQTT certificate renewal timers enabled.")
