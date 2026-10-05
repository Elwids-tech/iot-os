"""Close orphaned service incidents after Alertmanager restarts.

An unavailable or invalid monitoring response never clears event history.
"""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def active_keys(deployment):
    result = deployment.compose('ps', '-q', 'alertmanager', stdout=subprocess.PIPE, text=True)
    container = result.stdout.strip()
    if not container:
        raise RuntimeError('Alertmanager is unavailable')
    result = subprocess.run(['docker', 'inspect', container, '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'], check=True, capture_output=True, text=True)
    with urllib.request.urlopen('http://' + result.stdout.strip() + ':9093/api/v2/alerts', timeout=10) as response:
        rows = json.load(response)
    if not isinstance(rows, list):
        raise RuntimeError('Invalid monitoring response')
    # Include active, silenced and inhibited alerts. Silencing is not recovery.
    keys = []
    for row in rows:
        if not row.get('fingerprint') or not row.get('startsAt'):
            raise RuntimeError('Incomplete monitoring response')
        keys.append(hashlib.sha256(('service:' + row['fingerprint'] + ':' + row['startsAt']).encode()).hexdigest())
    return keys


def reconcile(deployment):
    keys = active_keys(deployment)  # Fail closed before touching the database.
    literal = json.dumps(json.dumps(keys))
    php = """<?php
require 'vendor/autoload.php';$app=require 'bootstrap/app.php';$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();
$keys=json_decode(KEYS,true);
$closed=Illuminate\\Support\\Facades\\DB::transaction(function()use($keys){
 $events=App\\Domain\\Notifications\\Models\\NotificationEvent::where('source','service')->where('active',true)->where('last_seen_at','<',now()->subMinutes(2))->lockForUpdate()->get();
 $closed=0;
 foreach($events as $event){
  if(in_array($event->incident_key,$keys,true))continue;
  $event->update(['active'=>false]);
  App\\Domain\\Notifications\\Models\\NotificationEvent::firstOrCreate(['event_key'=>hash('sha256','service:reconciled:'.$event->uuid)],[
   'uuid'=>(string)Illuminate\\Support\\Str::uuid(),'source'=>'service','incident_key'=>$event->incident_key,'severity'=>$event->severity,
   'status'=>'resolved','active'=>false,'title'=>$event->title,'summary'=>'Monitoring no longer reports this incident. Recovery time was reconstructed during restart reconciliation.',
   'service'=>$event->service,'environment'=>$event->environment,'occurred_at'=>now(),'last_seen_at'=>now(),
  ]);
  $closed++;
 }
 return $closed;
});
echo json_encode(['reconciled'=>$closed]);
""".replace('KEYS', literal)
    result = deployment.compose('exec', '-T', 'api', 'php', input=php, text=True, stdout=subprocess.PIPE)
    print(result.stdout)


def main():
    from manage import Deployment
    try:
        deployment = Deployment('/srv/elwids/private/application.env', '/srv/elwids/private/current-release.json')
        with deployment.lock():
            if (deployment.config / 'DEPLOYMENT_INCOMPLETE').exists():
                return 0
            reconcile(deployment)
        return 0
    except Exception:
        print('Notification reconciliation unavailable; retained incident state.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
