<?php

declare(strict_types=1);

namespace App\Support\Contract;

use Symfony\Component\Yaml\Exception\ParseException;

/**
 * Merges the hand-written supplements (contracts/openapi/supplements/*.yaml) into the
 * generated document and applies the pending-schema list.
 *
 * A supplement adds components, patches operations keyed `METHOD /path` and adds
 * webhooks. It cannot add operations: a key that matches no generated operation fails
 * the export. Pending operations get open success bodies and `x-schema-status: pending`,
 * and inferred components that nothing references any more are dropped.
 */
final class SupplementTransformer
{
    private const COMPONENT_TYPES = ['schemas', 'responses', 'parameters', 'headers', 'examples', 'requestBodies', 'securitySchemes'];

    /**
     * Problems that do not stop the export (gate G3 reports them).
     *
     * @var list<string>
     */
    public array $warnings = [];

    /**
     * @param  array<string, mixed>  $document
     * @return array<string, mixed>
     */
    public function apply(array $document, PendingSchemas $pending, ?string $directory = null): array
    {
        $this->warnings = [];
        $directory ??= ContractFiles::supplements();
        $files = glob(rtrim($directory, '/').'/*.yaml') ?: [];
        sort($files, SORT_STRING);

        $supplied = [];
        foreach ($files as $file) {
            $supplement = $this->load($file);
            $name = basename($file);

            if (isset($supplement['info'])) {
                if ($name !== 'info.yaml') {
                    throw new ContractException("{$name}: `info` belongs in info.yaml only.");
                }
                $document['info']['version'] = $supplement['info']['version'];
                if (isset($supplement['info']['description'])) {
                    $document['info']['description'] = $supplement['info']['description'];
                }
            }

            foreach ($supplement['components'] ?? [] as $type => $components) {
                if ($type === 'securitySchemes' && $name !== 'shared.yaml') {
                    throw new ContractException("{$name}: security schemes belong in shared.yaml only.");
                }
                foreach (is_array($components) ? $components : [] as $component => $definition) {
                    if (isset($document['components'][$type][$component])) {
                        throw new ContractException("{$name}: components.{$type}.{$component} already exists (inferred or in another supplement); choose another name.");
                    }
                    $document['components'][$type][$component] = $definition;
                    $supplied[$type][$component] = true;
                }
            }

            foreach ($supplement['operations'] ?? [] as $key => $patch) {
                [$method, $path] = explode(' ', (string) $key, 2);
                $method = strtolower($method);
                if (! isset($document['paths'][$path][$method])) {
                    throw new ContractException("{$name}: \"{$key}\" matches no generated operation. A supplement describes existing routes; it cannot add operations.");
                }
                $document['paths'][$path][$method] = $this->patch($document['paths'][$path][$method], is_array($patch) ? $patch : []);
            }

            foreach ($supplement['webhooks'] ?? [] as $webhook => $item) {
                if (isset($document['webhooks'][$webhook])) {
                    throw new ContractException("{$name}: webhooks.{$webhook} is defined twice.");
                }
                foreach (is_array($item) ? $item : [] as $method => $operation) {
                    if (in_array($method, ContractRoutes::METHODS, true) && ($operation['x-audience'] ?? null) !== 'integration') {
                        throw new ContractException("{$name}: webhooks.{$webhook}.{$method} needs `x-audience: integration`.");
                    }
                }
                $document['webhooks'][$webhook] = $item;
            }
        }

        $document = $this->applyPending($document, $pending);

        return $this->dropUnreferencedComponents($document, $supplied);
    }

    /**
     * @return array<string, mixed>
     */
    private function load(string $file): array
    {
        try {
            $raw = ContractJson::parseYamlObjects($file);
        } catch (ParseException $exception) {
            throw new ContractException(basename($file).' is not valid YAML: '.$exception->getMessage());
        }
        if ($raw === null) {
            return [];
        }
        $problems = ContractFiles::validate($raw, 'supplement.schema.json');
        if ($problems !== []) {
            throw new ContractException(basename($file)." does not match meta/supplement.schema.json:\n  ".implode("\n  ", $problems));
        }
        $supplement = ContractJson::fromObjects($raw);

        return is_array($supplement) ? $supplement : [];
    }

    /**
     * Summary and description replace the generated text, each response replaces the
     * response for its status, and each `x-` field replaces the generated value.
     *
     * @param  array<string, mixed>  $operation
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    private function patch(array $operation, array $patch): array
    {
        foreach ($patch as $field => $value) {
            if ($field === 'responses') {
                foreach ($value as $status => $response) {
                    $operation['responses'][$status] = $response;
                }
            } else {
                $operation[$field] = $value;
            }
        }

        return $operation;
    }

    /**
     * @param  array<string, mixed>  $document
     * @return array<string, mixed>
     */
    private function applyPending(array $document, PendingSchemas $pending): array
    {
        foreach ($pending->operations() as $key) {
            [$method, $path] = explode(' ', $key, 2);
            $method = strtolower($method);
            if (! isset($document['paths'][$path][$method])) {
                $this->warnings[] = "pending-schemas.json lists {$key}, which is not an operation.";

                continue;
            }
            $operation = $document['paths'][$path][$method];
            foreach ($operation['responses'] ?? [] as $status => $response) {
                if (! str_starts_with((string) $status, '2') || ! is_array($response) || ! isset($response['content'])) {
                    continue;
                }
                foreach ($response['content'] as $mediaType => $content) {
                    if (str_contains((string) $mediaType, 'json')) {
                        $operation['responses'][$status]['content'][$mediaType] = ['schema' => OpenSchema::pending()];
                    }
                }
            }
            $operation['x-schema-status'] = 'pending';
            $document['paths'][$path][$method] = $operation;
        }

        return $document;
    }

    /**
     * Inferred components that only pending success bodies used describe shapes nobody
     * has checked, so they leave with those bodies. Supplied components always stay.
     *
     * @param  array<string, mixed>  $document
     * @param  array<string, array<string, true>>  $supplied
     * @return array<string, mixed>
     */
    private function dropUnreferencedComponents(array $document, array $supplied): array
    {
        $components = $document['components'] ?? [];
        unset($document['components']);
        $reachable = [];
        $queue = self::references($document);
        while ($queue !== []) {
            $ref = array_pop($queue);
            if (isset($reachable[$ref]) || ! preg_match('#^\#/components/([^/]+)/([^/]+)$#', $ref, $match)) {
                continue;
            }
            $reachable[$ref] = true;
            array_push($queue, ...self::references($components[$match[1]][$match[2]] ?? []));
        }

        foreach (self::COMPONENT_TYPES as $type) {
            if ($type === 'securitySchemes') {
                continue;
            }
            foreach (array_keys($components[$type] ?? []) as $name) {
                if (! isset($supplied[$type][$name]) && ! isset($reachable["#/components/{$type}/{$name}"])) {
                    unset($components[$type][$name]);
                }
            }
            if (isset($components[$type]) && $components[$type] === []) {
                unset($components[$type]);
            }
        }
        $document['components'] = $components;

        return $document;
    }

    /**
     * @return list<string>
     */
    public static function references(mixed $node): array
    {
        if (! is_array($node)) {
            return [];
        }
        $refs = isset($node['$ref']) && is_string($node['$ref']) ? [$node['$ref']] : [];
        foreach ($node as $child) {
            if (is_array($child)) {
                array_push($refs, ...self::references($child));
            }
        }

        return $refs;
    }
}
