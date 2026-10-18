{!! $lead !!}
@if ($excerpt !== '')

{!! $excerpt !!}
@endif
@if ($attachments > 0)

({{ $attachments }} {{ $attachments === 1 ? 'attachment' : 'attachments' }} on the ticket)
@endif
@if ($status)

{!! $status !!}.
@endif

Open the ticket: {!! $link !!}

{!! $footer !!}
