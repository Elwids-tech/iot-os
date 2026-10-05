from pathlib import Path
import subprocess

Path("/etc/systemd/system/elwids-watchdog.service").write_text(
    "[Unit]\nDescription=Elwids independent application watchdog\nAfter=network-online.target\nWants=network-online.target\n[Service]\nType=oneshot\nUMask=0077\nExecStart=/usr/bin/python3 /srv/elwids/private/application-watchdog.py\nTimeoutStartSec=75\n"
)
Path("/etc/systemd/system/elwids-watchdog.timer").write_text(
    "[Unit]\nDescription=Elwids application watchdog timer\n[Timer]\nOnBootSec=90\nOnUnitActiveSec=60\nPersistent=true\n[Install]\nWantedBy=timers.target\n"
)
subprocess.run(["systemctl", "daemon-reload"], check=True)
subprocess.run(["systemctl", "enable", "--now", "elwids-watchdog.timer"], check=True)
print("Independent application watchdog timer enabled.")
