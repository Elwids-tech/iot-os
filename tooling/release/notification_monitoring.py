"""Alertmanager routing into the durable, preference-aware notification center."""


def alertmanager_config(environment):
    token = environment.get("NOTIFICATION_INGEST_TOKEN")
    if token:
        if len(token) < 32 or any(char.isspace() for char in token):
            raise ValueError("NOTIFICATION_INGEST_TOKEN must be at least 32 characters without whitespace")
        receiver = {
            "name": "operator",
            "webhook_configs": [{
                "url": "http://api-web/api/internal/notifications/alertmanager",
                "send_resolved": True,
                "http_config": {"authorization": {"type": "Bearer", "credentials": token}},
            }],
        }
        global_config = {}
    else:
        # Preserve existing releases until their notification-center migration is installed.
        receiver = {"name": "operator", "email_configs": [{"to": environment["ALERT_EMAIL"], "send_resolved": True}]}
        global_config = {
            "smtp_smarthost": "smtp-relay.brevo.com:587",
            "smtp_from": environment.get("ALERT_FROM_ADDRESS") or environment["MAIL_FROM_ADDRESS"],
            "smtp_auth_username": environment.get("ALERT_SMTP_USERNAME") or environment["MAIL_USERNAME"],
            "smtp_auth_password": environment.get("ALERT_SMTP_PASSWORD") or environment["MAIL_PASSWORD"],
            "smtp_require_tls": True,
        }
    return {
        "global": global_config,
        "route": {"receiver": "operator", "group_by": ["alertname", "service"], "group_wait": "30s", "repeat_interval": "4h", "routes": [{"matchers": ['severity="critical"'], "receiver": "operator", "repeat_interval": "30m"}]},
        "receivers": [receiver],
    }
