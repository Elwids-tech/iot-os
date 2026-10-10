"""Independent checks with cached email preferences and durable event replay."""

import argparse
from datetime import datetime, timezone
import fcntl
import http.client
import ipaddress
import json
from pathlib import Path
import smtplib
import socket
import ssl
import time
import urllib.request
import urllib.parse
import uuid
from email.message import EmailMessage


def domain(config):
    """Base domain of the watched deployment; set "domain" in watchdog.json after a rename."""
    return config.get("domain", "staging.elwids.xyz")


def api_request(config, path, payload=None):
    token = config.get("notifications_token")
    if not token:
        raise RuntimeError("Notification center is not configured")
    url = config.get("notifications_url", "https://api." + domain(config) + "/api/internal/notifications") + path
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json"}, data=json.dumps(payload).encode() if payload is not None else None)
    private_host = config.get("notifications_private_host")
    if not private_host:
        with urllib.request.urlopen(request, timeout=8) as response:
            return json.load(response)
    address = ipaddress.ip_address(private_host)
    if not address.is_private:
        raise ValueError("Notification transport must use the private tunnel")
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("Private notification transport requires verified TLS")
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port or 443, timeout=8, context=ssl.create_default_context())
    # Pin only the connection address. HTTPSConnection still checks the
    # certificate and SNI against the public API hostname through the tunnel.
    connection._create_connection = lambda destination, timeout, source_address: socket.create_connection((str(address), parsed.port or 443), timeout, source_address)
    try:
        connection.request("POST" if payload is not None else "GET", parsed.path, body=json.dumps(payload).encode() if payload is not None else None, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json"})
        response = connection.getresponse()
        if response.status != 200:
            raise RuntimeError("Private notification API returned " + str(response.status))
        return json.loads(response.read())
    finally:
        connection.close()


def probe(config):
    failures = []
    base = domain(config)
    for url in ["https://app." + base + "/", "https://api." + base + "/health/ready"]:
        try:
            with urllib.request.urlopen(url, timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError("Unhealthy")
        except Exception:
            failures.append(url)
    try:
        with socket.create_connection(("mqtt." + base, 8883), timeout=10) as raw:
            with ssl.create_default_context().wrap_socket(raw, server_hostname="mqtt." + base):
                pass
    except Exception:
        failures.append("MQTT TLS")
    return failures


def send_email(config, event):
    message = EmailMessage()
    message["From"] = "Elwids Alerts <alerts@elwids.xyz>"
    message["To"] = config["recipient"]
    message["Subject"] = "[" + event["status"].upper() + "] Elwids application watchdog"
    message.set_content(event["summary"] + "\n\nView events: https://app." + domain(config) + "/notifications\n")
    with smtplib.SMTP("smtp-relay.brevo.com", 587, timeout=20) as smtp:
        smtp.ehlo()
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(config["login"], config["key"])
        if smtp.send_message(message):
            raise RuntimeError("SMTP rejected a recipient")


def save_state(path, state):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state))
    temporary.chmod(0o600)
    temporary.replace(path)


def run(config, path, drill=False):
    state = json.loads(path.read_text()) if path.exists() else {"failures": 0, "active": False, "last_sent": 0}
    # Default to no email when provisioning or when no preference cache exists.
    prefs = state.get("preferences", {"email_enabled": False, "grid": {"critical": False, "recovery": False}})
    try:
        prefs = api_request(config, "/watchdog-preferences")
        state["preferences"] = prefs
        state["preferences_checked_at"] = int(time.time())
    except Exception:
        print("Preferences endpoint unavailable; retained the last saved settings.")
    failures = ["Controlled watchdog alert drill"] if drill else probe(config)
    state["failures"] = (2 if drill else state.get("failures", 0)) + 1 if failures else 0
    active = bool(state.get("active"))
    transition = (state["failures"] >= 3 and not active) or (not failures and active)
    pending = state.setdefault("pending_events", [])
    now = int(time.time())
    if transition:
        firing = bool(failures)
        incident = str(uuid.uuid4()) if firing else state.get("incident_id", "legacy-outage")
        status = "firing" if firing else "resolved"
        event = {
            "event_id": incident + ":" + status, "incident_id": incident, "status": status,
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "summary": "Failed checks: " + ", ".join(failures) if firing else "Application HTTPS, API/database readiness, and MQTT TLS checks recovered.",
        }
        pending.append(event)
        state.update(active=firing, incident_id=incident, latest_event=event, last_sent=0)
        save_state(path, state)
    latest = state.get("latest_event")
    level = "critical" if failures else "recovery"
    should_email = latest and (transition or (failures and state.get("active") and now - state.get("last_sent", 0) >= 3600))
    if should_email and prefs.get("email_enabled") is True and prefs.get("grid", {}).get(level) is True:
        try:
            send_email(config, latest)
            state["last_sent"] = now
            print("Watchdog email accepted.")
        except Exception:
            print("Watchdog SMTP delivery failed; event retained.")
    # Replay persisted outage/recovery transitions after the API comes back.
    # The API deduplicates by incident and status and never sends watchdog mail twice.
    for event in list(pending)[:5]:
        try:
            api_request(config, "/watchdog", event)
        except Exception:
            print("Notification API unavailable; event retained for replay.")
            break
        pending.remove(event)
        save_state(path, state)
    save_state(path, state)
    print("Watchdog detected failed checks." if failures else "Watchdog HTTPS/API/MQTT checks passed.")
    return state


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--drill-firing", action="store_true")
    args = parser.parse_args()
    path = Path("/srv/elwids/private/watchdog-state.json")
    with path.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        config = json.loads(Path("/srv/elwids/private/watchdog.json").read_text())
        run(config, path, args.drill_firing)


if __name__ == "__main__":
    main()
