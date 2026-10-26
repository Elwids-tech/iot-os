{!! $title !!}

{{ $condition === 'activated' ? 'Active since' : 'Cleared at' }} {{ $occurredAt }}
Organization: {!! $organization->name !!}
@if ($deviceName)
Device: {!! $deviceName !!}
@endif

Open this alert: {!! $alertLink !!}
Open the automation: {!! $workflowLink !!}

Condition clearing and operator acknowledgement are separate. This email does not acknowledge the alert; acknowledge it on the alert page.

Reference: alert {{ $alert->uuid }}, episode {{ $alert->episode }}.
You receive this because you are a recipient of this automation's alerts. Change recipients in Settings → Notifications ({!! $notificationsLink !!}) or switch these emails off in Settings → Email.
