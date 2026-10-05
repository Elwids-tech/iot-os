from pathlib import Path
import subprocess
import sys

role = sys.argv[1]
assert role in ("application", "database")
public_ports = "80,443,8883" if role == "application" else ""
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
subprocess.run(["systemctl", "enable", "--now", "elwids-firewall.service"], check=True)
print(role + " Docker forwarding firewall installed.")
