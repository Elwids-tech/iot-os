import argparse
import json
import time
import ssl
import socket
import smtplib
import urllib.request
from email.message import EmailMessage
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--drill-firing", action="store_true")
args = parser.parse_args()
e = json.loads(Path("/srv/elwids/private/watchdog.json").read_text())
path = Path("/srv/elwids/private/watchdog-state.json")
state = (
    json.loads(path.read_text())
    if path.exists()
    else {"failures": 0, "active": False, "last_sent": 0}
)
failures = []
for url in [
    "https://app.staging.elwids.xyz/",
    "https://api.staging.elwids.xyz/health/ready",
]:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            assert r.status == 200
    except Exception:
        failures.append(url)
try:
    with socket.create_connection(("mqtt.staging.elwids.xyz", 8883), timeout=10) as raw:
        with ssl.create_default_context().wrap_socket(
            raw, server_hostname="mqtt.staging.elwids.xyz"
        ):
            pass
except Exception:
    failures.append("MQTT TLS")
if args.drill_firing:
    failures = ["Controlled watchdog alert drill"]
    state["failures"] = 2
state["failures"] = state["failures"] + 1 if failures else 0
now = int(time.time())
notify = (
    state["failures"] >= 3 and (not state["active"] or now - state["last_sent"] >= 3600)
) or (not failures and state["active"])
if notify:
    firing = bool(failures)
    m = EmailMessage()
    m["From"] = "Elwids Alerts <alerts@elwids.xyz>"
    m["To"] = e["recipient"]
    m["Subject"] = (
        "[FIRING]" if firing else "[RESOLVED]"
    ) + " Elwids application watchdog"
    m.set_content(
        "Independent watchdog on the database host.\n"
        + (
            "Failed checks: " + ", ".join(failures)
            if firing
            else "Application HTTPS, API/database readiness, and MQTT TLS checks have recovered."
        )
        + "\nThis watchdog can send mail when the application host is unavailable.\n"
    )
    with smtplib.SMTP("smtp-relay.brevo.com", 587, timeout=20) as s:
        s.ehlo()
        s.starttls(context=ssl.create_default_context())
        s.ehlo()
        s.login(e["login"], e["key"])
        assert not s.send_message(m)
    state["active"] = firing
    state["last_sent"] = now
    print(
        "Watchdog firing notification sent."
        if firing
        else "Watchdog recovery notification sent."
    )
path.write_text(json.dumps(state))
path.chmod(0o600)
if failures:
    print("Watchdog detected a failed check; consecutive samples:", state["failures"])
else:
    print("Watchdog HTTPS/API/MQTT checks passed.")
