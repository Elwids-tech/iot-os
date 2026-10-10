from pathlib import Path
import re
import subprocess
import sys

role = sys.argv[1]
# Optional extra public TCP ports for the application host, e.g. "19000:19009" for
# per-tenant adapter brokers (Docker-published ports bypass UFW, so this chain decides).
extra = sys.argv[2] if len(sys.argv) > 2 else ""
assert role in ("application", "database")
assert extra == "" or (role == "application" and re.fullmatch(r"\d{2,5}(:\d{2,5})?(,\d{2,5}(:\d{2,5})?)*", extra))
public_ports = ",".join(filter(None, ["80,443,8883", extra])) if role == "application" else ""
script = "#!/bin/sh\nset -eu\n"
for tool in ["iptables", "ip6tables"]:
    script += f"{tool} -N ELWIDS-INGRESS 2>/dev/null || true\n{tool} -F ELWIDS-INGRESS\n{tool} -A ELWIDS-INGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN\n"
    if public_ports:
        script += f"{tool} -A ELWIDS-INGRESS -i eth0 -p tcp -m multiport --dports {public_ports} -j RETURN\n"
    script += f"{tool} -A ELWIDS-INGRESS -i eth0 -j DROP\n{tool} -A ELWIDS-INGRESS -j RETURN\n"
    # Docker creates IPv6 DOCKER-USER only when IPv6 forwarding is in use.
    script += f"if {tool} -S DOCKER-USER >/dev/null 2>&1; then {tool} -C DOCKER-USER -j ELWIDS-INGRESS 2>/dev/null || {tool} -I DOCKER-USER 1 -j ELWIDS-INGRESS; fi\n"
p = Path("/usr/local/sbin/elwids-docker-firewall")
p.write_text(script)
p.chmod(0o755)
Path("/etc/systemd/system/elwids-firewall.service").write_text(
    "[Unit]\nDescription=Elwids Docker ingress policy\nRequires=docker.service\nAfter=docker.service\nPartOf=docker.service\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/elwids-docker-firewall\nRemainAfterExit=yes\n[Install]\nWantedBy=docker.service\n"
)
subprocess.run(["systemctl", "daemon-reload"], check=True)
subprocess.run(["systemctl", "enable", "elwids-firewall.service"], check=True)
# The unit is oneshot with RemainAfterExit, so `enable --now` would not re-run an
# active policy after its ports change; restart applies the rewritten rules.
subprocess.run(["systemctl", "restart", "elwids-firewall.service"], check=True)
print(role + " Docker forwarding firewall installed.")
