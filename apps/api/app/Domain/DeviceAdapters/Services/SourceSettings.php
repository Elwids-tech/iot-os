<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use App\Domain\DeviceAdapters\Enums\AdapterSourceType;
use Illuminate\Support\Facades\Validator;

/**
 * Validates and normalizes an adapter's source settings (spec 020, data model). Secrets
 * never appear in these settings: they arrive separately and are stored encrypted.
 */
final class SourceSettings
{
    public const RESERVED_PREFIX = 'iot-os/';

    public const PLACEHOLDERS = ['cursor', 'window_start', 'window_end', 'now', 'page_size'];

    private const REFUSED_HEADERS = ['authorization', 'cookie', 'host', 'proxy-authorization', 'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'content-length', 'transfer-encoding', 'connection'];

    public function normalize(array $source): array
    {
        $type = AdapterSourceType::tryFrom((string) ($source['type'] ?? ''));
        abort_unless($type, 422, 'Choose how the adapter receives data.');

        return match ($type) {
            AdapterSourceType::Platform, AdapterSourceType::Vendor => $this->mqtt($source, $type),
            AdapterSourceType::Webhook => $this->webhook($source),
            AdapterSourceType::Poll => $this->poll($source),
        };
    }

    private function mqtt(array $source, AdapterSourceType $type): array
    {
        $v = Validator::make(['source' => $source], ['source' => 'required|array:type,url,topics', 'source.url' => 'required_if:source.type,vendor|nullable|string|max:500', 'source.topics' => 'required|array|min:1|max:32', 'source.topics.*' => 'required|string|max:255'])->validate()['source'];
        if ($type === AdapterSourceType::Vendor) {
            $url = parse_url($v['url']);
            abort_unless($url && in_array($url['scheme'] ?? '', ['mqtt', 'mqtts', 'ssl'], true) && filled($url['host'] ?? null)
                && ! isset($url['user']) && ! isset($url['pass']) && ! isset($url['query']) && ! isset($url['fragment']) && in_array($url['path'] ?? '', ['', '/'], true),
                422, 'Use an MQTT broker URL without embedded credentials. Enter secrets in the connection fields.');
        } else {
            $v['url'] = null;
        }
        foreach ($v['topics'] as $topic) {
            $levels = explode('/', $topic);
            abort_if(str_starts_with($topic, '$') || str_starts_with($topic, 'spBv1.0/') || str_starts_with($topic, self::RESERVED_PREFIX) || in_array($levels[0], ['#', '+']) || str_contains($topic, "\0"), 422, 'Choose a scoped manufacturer topic; reserved and broad subscriptions are unavailable.');
            foreach ($levels as $index => $level) {
                abort_unless(! strpbrk($level, '+#') || $level === '+' || ($level === '#' && $index === count($levels) - 1), 422, 'MQTT wildcards must occupy a complete topic level.');
            }
        }

        return ['type' => $type->value, 'url' => $v['url'], 'topics' => array_values($v['topics'])];
    }

    private function webhook(array $source): array
    {
        abort_unless(filled(config('adapters.webhook_public_url')), 422, 'This deployment does not accept webhooks yet. An operator must configure a public ingest address.');
        // Header names are HTTP tokens; the pattern holds a "|", so rules are arrays, not strings.
        $header = ['nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9!#$%&\'*+.^_`|~-]+$/'];
        $a = Validator::make(['source' => $source], ['source' => 'required|array:type,auth', 'source.auth' => 'required|array:mode,header,scheme,signature_header,encoding,prefix,timestamp_header', 'source.auth.mode' => 'required|in:hmac,header,url',
            'source.auth.header' => $header, 'source.auth.scheme' => 'nullable|in:Bearer', 'source.auth.signature_header' => ['required_if:source.auth.mode,hmac', ...$header], 'source.auth.encoding' => 'nullable|in:hex,base64',
            'source.auth.prefix' => 'nullable|string|max:32|regex:/^[\x21-\x7e]+$/', 'source.auth.timestamp_header' => $header])->validate()['source']['auth'];
        $auth = match ($a['mode']) {
            'hmac' => ['mode' => 'hmac', 'signature_header' => strtolower($a['signature_header']), 'encoding' => $a['encoding'] ?? 'hex', 'prefix' => $a['prefix'] ?? null, 'timestamp_header' => isset($a['timestamp_header']) ? strtolower($a['timestamp_header']) : null],
            'header' => ['mode' => 'header', 'header' => strtolower($a['header'] ?? 'authorization'), 'scheme' => array_key_exists('scheme', $a) ? $a['scheme'] : 'Bearer'],
            'url' => ['mode' => 'url'],
        };

        return ['type' => 'webhook', 'auth' => $auth];
    }

    private function poll(array $source): array
    {
        $pair = ['array', 'max:20'];
        $p = Validator::make(['source' => $source], [
            'source' => 'required|array:type,request,credentials,time_format,interval_seconds,page,records,cursor,initial_lookback_seconds',
            'source.request' => 'required|array:method,url,query,headers,body', 'source.request.method' => 'required|in:GET,POST', 'source.request.url' => 'required|string|max:2000',
            'source.request.query' => ['sometimes', ...$pair], 'source.request.query.*' => 'array:name,value', 'source.request.query.*.name' => 'required|string|max:128', 'source.request.query.*.value' => 'present|nullable|string|max:1000',
            'source.request.headers' => ['sometimes', ...$pair], 'source.request.headers.*' => 'array:name,value', 'source.request.headers.*.name' => ['required', 'string', 'max:128', 'regex:/^[A-Za-z0-9!#$%&\'*+.^_`|~-]+$/'], 'source.request.headers.*.value' => 'present|nullable|string|max:1000',
            'source.request.body' => 'nullable|string|max:16384',
            'source.credentials' => 'sometimes|array:placement,name', 'source.credentials.placement' => 'required_with:source.credentials|in:none,header,query,bearer,basic', 'source.credentials.name' => 'nullable|string|max:128',
            'source.time_format' => 'sometimes|in:iso,epoch_s,epoch_ms', 'source.interval_seconds' => 'sometimes|integer|min:60|max:86400',
            'source.page' => 'sometimes|array:size,size_param,more,max_pages', 'source.page.size' => 'nullable|integer|min:1|max:5000', 'source.page.size_param' => 'nullable|string|max:128', 'source.page.more' => 'nullable|in:full_page,token,none', 'source.page.max_pages' => 'nullable|integer|min:1|max:100',
            'source.records' => 'present|nullable|string|max:500', 'source.cursor' => 'required|array:kind,pointer,lag_seconds', 'source.cursor.kind' => 'required|in:timestamp,token,window', 'source.cursor.pointer' => 'nullable|string|max:500', 'source.cursor.lag_seconds' => 'nullable|integer|min:0|max:3600',
            'source.initial_lookback_seconds' => 'sometimes|integer|min:60|max:2592000',
        ])->validate()['source'];
        $request = $p['request'];
        $url = parse_url($request['url']);
        $private = (bool) config('adapters.allow_private_endpoints');
        $scheme = $url['scheme'] ?? '';
        abort_unless($url && filled($url['host'] ?? null) && ($scheme === 'https' || ($private && $scheme === 'http')), 422, 'Use an HTTPS URL for the vendor API.');
        abort_if(isset($url['user']) || isset($url['pass']), 422, 'Remove credentials from the URL. Enter them in the credentials fields.');
        abort_if(isset($url['fragment']) || str_contains($request['url'], '{') || str_contains($request['url'], '}'), 422, 'Put placeholders in query parameters, not in the URL.');
        $host = trim($url['host'], '[]');
        abort_if(! $private && filter_var($host, FILTER_VALIDATE_IP) && ! filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE), 422, 'The vendor API must be publicly reachable.');
        abort_if(! $private && in_array(strtolower($host), ['localhost', 'localhost.localdomain'], true), 422, 'The vendor API must be publicly reachable.');
        $texts = [...array_column($request['query'] ?? [], 'value'), ...array_column($request['headers'] ?? [], 'value'), $request['body'] ?? ''];
        foreach ($texts as $text) {
            // Only {name} with a lower-case name is a placeholder; JSON braces in a body are not.
            preg_match_all('/\{([a-z_]+)\}/', (string) $text, $matches);
            foreach ($matches[1] as $name) {
                abort_unless(in_array($name, self::PLACEHOLDERS, true), 422, "Unknown placeholder {{$name}}. Use ".implode(', ', array_map(fn ($p) => '{'.$p.'}', self::PLACEHOLDERS)).'.');
            }
        }
        foreach ($request['headers'] ?? [] as $item) {
            abort_if(in_array(strtolower($item['name']), self::REFUSED_HEADERS, true), 422, "The {$item['name']} header is set by the platform. Choose a credential placement instead.");
        }
        abort_if(filled($request['body'] ?? null) && $request['method'] !== 'POST', 422, 'Only POST requests have a body.');
        if (filled($request['body'] ?? null)) {
            $probe = str_replace(array_map(fn ($p) => '{'.$p.'}', self::PLACEHOLDERS), '0', $request['body']);
            json_decode($probe);
            abort_unless(json_last_error() === JSON_ERROR_NONE, 422, 'The body template must be JSON.');
        }
        $placement = $p['credentials']['placement'] ?? 'none';
        abort_if(in_array($placement, ['header', 'query'], true) && blank($p['credentials']['name'] ?? null), 422, 'Name the header or query parameter that carries the API key.');
        $size = $p['page']['size'] ?? null;
        $more = $p['page']['more'] ?? ($size ? 'full_page' : 'none');
        $kind = $p['cursor']['kind'];
        abort_if($more === 'full_page' && ! $size, 422, 'Set a page size to fetch more pages when a page is full.');
        abort_if($kind === 'window' && $more === 'full_page', 422, 'Time windows page with a next-page token or not at all.');
        abort_if($more === 'token' && $kind !== 'token', 422, 'Paging by token needs a next-page token cursor.');
        abort_if($kind !== 'window' && blank($p['cursor']['pointer'] ?? null), 422, 'Choose where the response gives the next cursor.');
        foreach ([$p['records'] ?? '', $p['cursor']['pointer'] ?? ''] as $pointer) {
            abort_unless($pointer === '' || $pointer === null || str_starts_with($pointer, '/'), 422, 'JSON Pointers start with /, for example /data.');
        }
        $pairs = fn ($list) => array_values(array_map(fn ($item) => ['name' => $item['name'], 'value' => (string) ($item['value'] ?? '')], $list ?? []));

        return ['type' => 'poll',
            'request' => ['method' => $request['method'], 'url' => $request['url'], 'query' => $pairs($request['query'] ?? []), 'headers' => $pairs($request['headers'] ?? []), 'body' => $request['method'] === 'POST' ? ($request['body'] ?? null) : null],
            'credentials' => ['placement' => $placement, 'name' => in_array($placement, ['header', 'query'], true) ? $p['credentials']['name'] : null],
            'time_format' => $p['time_format'] ?? 'iso', 'interval_seconds' => $p['interval_seconds'] ?? 300,
            'page' => ['size' => $size, 'size_param' => $size ? ($p['page']['size_param'] ?? null) : null, 'more' => $more, 'max_pages' => $p['page']['max_pages'] ?? 20],
            'records' => $p['records'] ?? '', 'cursor' => ['kind' => $kind, 'pointer' => $kind === 'window' ? null : $p['cursor']['pointer'], 'lag_seconds' => $kind === 'window' ? ($p['cursor']['lag_seconds'] ?? 0) : null],
            'initial_lookback_seconds' => $p['initial_lookback_seconds'] ?? 3600];
    }
}
