<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Device;

use JsonException;
use PHPUnit\Framework\TestCase;

final class ContractVocabularyTest extends TestCase
{
    /**
     * @throws JsonException
     */
    public function test_php_device_vocabulary_matches_the_common_schema(): void
    {
        $schemaPath = dirname(__DIR__, 6).'/contracts/definitions/common/v1/schema.json';
        $contents = file_get_contents($schemaPath);

        self::assertNotFalse($contents, 'The shared Device Domain schema could not be read.');

        /** @var array{$defs: array<string, array{enum?: list<string>}>} $schema */
        $schema = json_decode($contents, true, flags: JSON_THROW_ON_ERROR);

        $phpVocabulary = [
            'DataType' => ['float64', 'int64', 'uint64', 'boolean', 'string', 'bytes', 'state'],
            'PropertyScope' => ['platform', 'desired', 'reported'],
            'EventMode' => ['stateless', 'stateful'],
            'EventSeverity' => ['info', 'notice', 'warning', 'critical'],
            'EventState' => ['opened', 'updated', 'closed'],
            'CommandMode' => ['one_way', 'two_way'],
            'CommandRisk' => ['low', 'medium', 'high'],
            'CommandFieldDirection' => ['input', 'output'],
            'CommandOfflinePolicy' => ['reject', 'queue_until_expiry'],
            'CommandStatus' => ['accepted', 'running', 'succeeded', 'failed'],
            'BindingPurpose' => ['telemetry', 'reported_properties', 'desired_properties', 'event', 'command_request', 'command_response'],
            'BindingDirection' => ['device_to_platform', 'platform_to_device'],
            'PathScope' => ['payload', 'record'],
            'MissingPolicy' => ['reject_message', 'omit_value', 'use_default'],
            'TimestampFormat' => ['rfc3339', 'unix_seconds', 'unix_milliseconds'],
            'DefinitionState' => ['draft', 'published', 'retired'],
            'DeviceLifecycleState' => ['draft', 'registered', 'archived'],
        ];

        $schemaVocabulary = [];

        foreach ($schema['$defs'] as $name => $definition) {
            if (isset($definition['enum'])) {
                $schemaVocabulary[$name] = $definition['enum'];
            }
        }

        ksort($phpVocabulary);
        ksort($schemaVocabulary);

        self::assertSame($schemaVocabulary, $phpVocabulary);
    }
}
