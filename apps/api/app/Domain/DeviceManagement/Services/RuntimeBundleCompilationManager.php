<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Services;

use App\Domain\DeviceManagement\Models\DeviceDefinitionAssignment;
use App\Domain\DeviceProfile\Data\DefinitionCompileResultData;
use App\Domain\DeviceProfile\Services\DefinitionCompilerClient;
use App\Domain\DeviceProfile\Services\DefinitionDocumentFactory;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\User;

final readonly class RuntimeBundleCompilationManager
{
    public function __construct(
        private DefinitionCompilerClient $compiler,
        private DefinitionDocumentFactory $documents,
        private DeviceRegistrationManager $registration,
    ) {}

    /** @param list<array<string, mixed>> $fixtures */
    public function compile(
        DeviceDefinitionAssignment $assignment,
        array $fixtures,
    ): DefinitionCompileResultData {
        $assignment->loadMissing([
            'organization',
            'device',
            'profileVersion.profile',
            'bindingVersion.binding.profile',
            'gatewayRoute.gateway',
        ]);

        $route = $assignment->gatewayRoute;

        if ($route === null) {
            throw new DomainInvariantViolation('A Gateway Route is required before compiling a Runtime Bundle.');
        }

        return $this->compiler->compile(
            $assignment->organization->uuid,
            $this->documents->profile($assignment->profileVersion->profile, $assignment->profileVersion),
            $this->documents->binding($assignment->bindingVersion->binding, $assignment->bindingVersion),
            $this->documents->gateway($route->gateway),
            $this->documents->route($route),
            $fixtures,
        );
    }

    /**
     * @param  list<array<string, mixed>>  $fixtures
     * @return array{DefinitionCompileResultData, DeviceDefinitionAssignment}
     */
    public function compileAndPin(
        DeviceDefinitionAssignment $assignment,
        array $fixtures,
        ?string $expectedInputHash,
        ?string $expectedEntityTag,
        ?User $actor = null,
    ): array {
        $assignment->assertExpectedEntityTag($expectedEntityTag);
        $result = $this->compile($assignment, $fixtures);

        if ($expectedInputHash !== null && ! hash_equals($expectedInputHash, $result->inputHash)) {
            throw new DomainInvariantViolation('The compile input changed after preview. Run the preview again before pinning.');
        }

        if (! $result->valid) {
            return [$result, $assignment];
        }

        if ($result->runtimeBundle === null) {
            throw new DomainInvariantViolation('A valid compile result must contain a Runtime Bundle.');
        }

        return [
            $result,
            $this->registration->pinRuntimeBundle(
                $assignment,
                $result->runtimeBundle,
                $expectedEntityTag,
                $actor,
            ),
        ];
    }
}
