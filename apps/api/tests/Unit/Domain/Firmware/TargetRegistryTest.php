<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Firmware;

use App\Domain\Firmware\Services\TargetRegistry;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

final class TargetRegistryTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = sys_get_temp_dir().'/iot-registry-'.bin2hex(random_bytes(6));
        mkdir($this->root.'/starters/families', 0700, true);
        mkdir($this->root.'/sdk/examples/linux-app', 0700, true);
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->root));
        parent::tearDown();
    }

    public function test_targets_are_offered_once_their_files_exist(): void
    {
        $this->write([$this->built(), $this->assisted('stm32', 'families/stm32.md', 10), $this->assisted('other', null, 90)]);
        $registry = new TargetRegistry($this->root);
        $this->assertSame(['other'], array_column($registry->available(), 'id'));

        touch($this->root.'/sdk/examples/linux-app/CMakeLists.txt');
        touch($this->root.'/starters/families/stm32.md');
        $this->assertSame(['linux', 'stm32', 'other'], array_column((new TargetRegistry($this->root))->available(), 'id'));
    }

    public static function invalidTargets(): iterable
    {
        yield 'an id with capitals' => [['id' => 'Linux'], 'id must match'];
        yield 'an unknown kind' => [['kind' => 'simulated'], 'kind must be'];
        yield 'no roles' => [['roles' => []], 'roles must be'];
        yield 'an unknown role' => [['roles' => ['broker']], 'roles must be'];
        yield 'a developer path without a slash' => [['developer_paths' => ['app']], 'developer_paths'];
        yield 'a built target without a build command' => [['build' => null], 'a built target needs'];
        yield 'family notes on a built target' => [['family_notes' => 'families/x.md'], 'family_notes is only'];
    }

    /** @param  array<string, mixed>  $change */
    #[DataProvider('invalidTargets')]
    public function test_an_invalid_registry_is_refused(array $change, string $message): void
    {
        $this->write([array_filter([...$this->built(), ...$change], fn ($value) => $value !== null)]);
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage($message);
        (new TargetRegistry($this->root))->all();
    }

    public function test_ids_are_unique_and_the_format_is_checked(): void
    {
        $this->write([$this->built(), $this->built()]);
        $this->expectExceptionMessage('duplicate id linux');
        (new TargetRegistry($this->root))->all();
    }

    public function test_the_repository_registry_is_valid(): void
    {
        $this->assertNotEmpty((new TargetRegistry(base_path('../../firmware')))->all());
    }

    private function built(): array
    {
        return ['id' => 'linux', 'name' => 'Linux', 'kind' => 'built', 'roles' => ['direct', 'gateway'], 'example' => 'linux-app',
            'developer_paths' => ['app/'], 'toolchain' => 'GCC 13', 'build' => 'cmake --build build', 'run' => './build/app', 'order' => 30];
    }

    private function assisted(string $id, ?string $notes, int $order): array
    {
        return ['id' => $id, 'name' => $id, 'kind' => 'ai_assisted', 'roles' => ['direct'], 'developer_paths' => ['app/'], 'family_notes' => $notes, 'order' => $order];
    }

    private function write(array $targets): void
    {
        file_put_contents($this->root.'/starters/targets.json', json_encode(['format' => 1, 'targets' => $targets]));
    }
}
