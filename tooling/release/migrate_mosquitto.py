#!/usr/bin/env python3
"""Guarded EMQX -> Mosquitto migration with an encrypted checkpoint and rollback.

Run only after isolated MQTT and full Sparkplug acceptance. Refuses to silently
discard retained application messages; broker-internal $SYS topics are excluded.
No database schema downgrade/restore is attempted on rollback.
"""
import argparse
import json
from pathlib import Path
import secrets
import shutil
import subprocess
import time

from manage import Deployment, WRITERS, private_write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--backup-env', required=True)
    args = parser.parse_args()
    live = Path(args.env).resolve()
    current_manifest = Deployment(live, None).config/'current-release.json'
    old = Deployment(live, current_manifest)
    if old.broker != 'emqx':
        raise ValueError('Migration requires an existing EMQX deployment')
    if (old.config/'RESTORE_QUARANTINE').exists() or (old.config/'DEPLOYMENT_INCOMPLETE').exists():
        raise ValueError('Reconcile recovery/deployment state before broker migration')
    marker = old.config/'BROKER_MIGRATION_INCOMPLETE'
    if marker.exists():
        raise ValueError('Previous migration needs recovery review')
    with old.lock():
        old.validate()
        # Read through the running old API. HTTP secrets are read from Laravel
        # configuration inside the container, never inserted into argv/logs.
        php = '''require "vendor/autoload.php"; $app=require "bootstrap/app.php";
        $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
        $r=Illuminate\\Support\\Facades\\Http::baseUrl(config("devices.emqx_url"))
        ->withBasicAuth(config("devices.emqx_key"),config("devices.emqx_secret"))
        ->get("/mqtt/retainer/messages",["limit"=>100]);
        if (!$r->successful()) { exit(1); }
        echo json_encode(["meta"=>$r->json("meta"),"topics"=>array_column($r->json("data"),"topic")]);'''
        inventory = json.loads(old.compose('exec','-T','api','php','-r',php,stdout=subprocess.PIPE,text=True).stdout)
        if inventory['meta'].get('hasnext') or any(not topic.startswith('$SYS/') for topic in inventory['topics']):
            raise ValueError('Retained application messages require a reviewed export/import before migration')
        recovery = old.config/('broker-migration-'+str(int(time.time())))
        recovery.mkdir(mode=0o700)
        shutil.copy2(live, recovery/'environment')
        shutil.copy2(current_manifest, recovery/'release.json')
        private_write(recovery/'inventory.json',json.dumps(inventory))
        candidate_env = dict(old.env)
        # Image overrides come exclusively from the candidate manifest.
        for key in old.images['images']:
            candidate_env.pop(key,None)
        candidate_env.update(DEVICE_BROKER_PROVIDER='mosquitto',DEVICE_BROKER_ADMIN_TOKEN=secrets.token_hex(32),MOSQUITTO_ADMIN_PASSWORD=secrets.token_hex(32))
        private_write(recovery/'candidate.env',''.join(k+'='+json.dumps(v)+'\n' for k,v in candidate_env.items()))
        candidate = Deployment(recovery/'candidate.env',args.manifest)
        candidate.validate()
        # Pull while the current broker is still serving devices.
        candidate.compose('pull',stdout=subprocess.DEVNULL)
        old.backup(args.backup_env)
        private_write(marker,str(recovery))
        try:
            old.compose('stop','caddy','simulator','gps-simulator','emqx',*WRITERS,stdout=subprocess.DEVNULL)
            private_write(live,(recovery/'candidate.env').read_text())
            candidate = Deployment(live,args.manifest)
            # The checkpoint was made with the original provider/environment.
            candidate.deploy(args.backup_env,checkpoint_current=False)
            candidate.wait('http://broker-admin:8082/health/ready')
            candidate.backup(args.backup_env)
            marker.unlink()
            private_write(recovery/'result.json',json.dumps({'migrated':True,'commit':candidate.images['commit'],'at':time.time()}))
            print('Mosquitto migration and first encrypted checkpoint completed. Rollback inputs: '+str(recovery))
        except Exception:
            # Both release variants remain supported by the installed tooling.
            # The broker's old files and exact old application images survive.
            candidate.compose('stop','caddy','mqtt','broker-admin',*WRITERS,stdout=subprocess.DEVNULL)
            private_write(live,(recovery/'environment').read_text())
            incomplete = old.config/'DEPLOYMENT_INCOMPLETE'
            if incomplete.exists(): incomplete.unlink()
            rollback = Deployment(live,recovery/'release.json')
            rollback.deploy(args.backup_env,checkpoint_current=False)
            marker.unlink()
            raise RuntimeError('Migration failed; original broker and application release restored') from None


if __name__ == '__main__':
    main()
