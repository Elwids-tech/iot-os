import json
import subprocess
from pathlib import Path

p = Path("/etc/docker/daemon.json")
s = json.loads(p.read_text()) if p.exists() else {}
regs = s.setdefault("insecure-registries", [])
if "elwids-registry.local" not in regs:
    regs.append("elwids-registry.local")
    p.write_text(json.dumps(s, indent=2) + "\n")
    subprocess.run(["systemctl", "restart", "docker"], check=True)
h = Path("/etc/hosts")
line = "172.31.254.2 elwids-registry.local\n"
if line not in h.read_text():
    h.write_text(h.read_text() + line)
if subprocess.run(
    ["docker", "network", "inspect", "elwids-release-import"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
).returncode:
    subprocess.run(
        [
            "docker",
            "network",
            "create",
            "--subnet",
            "172.31.254.0/28",
            "elwids-release-import",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
if subprocess.run(
    ["docker", "container", "inspect", "elwids-release-registry"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
).returncode:
    image = json.loads(
        subprocess.check_output(["docker", "image", "inspect", "registry:3"])
    )[0]["RepoDigests"][0]
    Path("/srv/elwids/state/release-registry").mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--restart",
            "unless-stopped",
            "--name",
            "elwids-release-registry",
            "--network",
            "elwids-release-import",
            "--ip",
            "172.31.254.2",
            "-e",
            "REGISTRY_HTTP_ADDR=0.0.0.0:80",
            "-v",
            "/srv/elwids/state/release-registry:/var/lib/registry",
            image,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
print("Local image registry prepared; no host ports published.")
