{{ $workflowName }}

Condition: {{ $condition === 'activated' ? 'Active' : 'Cleared' }}
Occurred at: {{ $occurredAt }}
Alert: {{ $alertUuid }}
Episode: {{ $episode }}

Condition clearing and operator acknowledgement are separate. This email does not acknowledge the alert.
