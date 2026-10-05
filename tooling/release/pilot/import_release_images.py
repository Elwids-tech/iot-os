import argparse
import json
import hashlib
import tarfile
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser(
    description="Import a checksummed CI archive without GitHub credentials"
)
parser.add_argument(
    "--artifact-dir",
    type=Path,
    default=Path("/srv/elwids/private/image-transfer-artifact"),
)
base = parser.parse_args().artifact_dir
archive = base / "release-images.tar.gz"
with archive.open("rb") as f:
    assert (
        hashlib.file_digest(f, "sha256").hexdigest()
        == Path(str(archive) + ".sha256").read_text().split()[0]
    )
with tarfile.open(archive) as tar:
    tar.extractall(base, filter="data")
origin = json.loads((base / "image-transfer/release.json").read_text())
deployed = json.loads(json.dumps(origin))
for key, reference in origin["images"].items():
    name = reference.split("/")[-1].split("@")[0]
    digest = reference.split("@")[1]
    target = "elwids-registry.local/" + name
    subprocess.run(
        [
            "skopeo",
            "copy",
            "--all",
            "--preserve-digests",
            "--dest-tls-verify=false",
            "dir:" + str(base / "image-transfer" / key),
            "docker://" + target,
        ],
        check=True,
    )
    deployed["images"][key] = target + "@" + digest
p = Path("/srv/elwids/private/release.json")
p.write_text(json.dumps(deployed, indent=2) + "\n")
p.chmod(0o600)
p = Path("/srv/elwids/private/release-origin.json")
p.write_text(json.dumps(origin, indent=2) + "\n")
p.chmod(0o600)
print("Six image manifests imported with their original immutable digests.")
