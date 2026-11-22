{{-- Laravel's template (spec 036, research R11): with a brand the header shows its logo or name and the footer its support link; without one nothing differs. --}}
@props(['brand' => null])
<x-mail::layout :title="$brand?->name">
{{-- Header --}}
<x-slot:header>
@if ($brand?->name !== null)
<x-mail::header :url="$brand->homeUrl">
@if ($brand->logoUrl !== null)
<img src="{{ $brand->logoUrl }}" alt="{{ $brand->name }}" style="max-height: 48px; max-width: 240px;">
@else
{{ $brand->name }}
@endif
</x-mail::header>
@else
<x-mail::header :url="config('app.url')">
{{ config('app.name') }}
</x-mail::header>
@endif
</x-slot:header>

{{-- Body --}}
{!! $slot !!}

{{-- Subcopy --}}
@isset($subcopy)
<x-slot:subcopy>
<x-mail::subcopy>
{!! $subcopy !!}
</x-mail::subcopy>
</x-slot:subcopy>
@endisset

{{-- Footer --}}
<x-slot:footer>
<x-mail::footer>
@if ($brand?->name !== null)
© {{ date('Y') }} {{ $brand->name }}. {{ __('All rights reserved.') }}@if ($brand->supportUrl !== null) [{{ __('Support') }}]({{ $brand->supportUrl }})@endif

@else
© {{ date('Y') }} {{ config('app.name') }}. {{ __('All rights reserved.') }}
@endif
</x-mail::footer>
</x-slot:footer>
</x-mail::layout>
