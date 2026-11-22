@props(['brand' => null])
<x-mail::layout>
    {{-- Header --}}
    <x-slot:header>
        @if ($brand?->name !== null)
        <x-mail::header :url="$brand->homeUrl">
            {{ $brand->name }}
        </x-mail::header>
        @else
        <x-mail::header :url="config('app.url')">
            {{ config('app.name') }}
        </x-mail::header>
        @endif
    </x-slot:header>

    {{-- Body --}}
    {{ $slot }}

    {{-- Subcopy --}}
    @isset($subcopy)
        <x-slot:subcopy>
            <x-mail::subcopy>
                {{ $subcopy }}
            </x-mail::subcopy>
        </x-slot:subcopy>
    @endisset

    {{-- Footer --}}
    <x-slot:footer>
        <x-mail::footer>
            @if ($brand?->name !== null)
            © {{ date('Y') }} {{ $brand->name }}. @lang('All rights reserved.')@if ($brand->supportUrl !== null) @lang('Support'): {{ $brand->supportUrl }}@endif

            @else
            © {{ date('Y') }} {{ config('app.name') }}. @lang('All rights reserved.')
            @endif
        </x-mail::footer>
    </x-slot:footer>
</x-mail::layout>
