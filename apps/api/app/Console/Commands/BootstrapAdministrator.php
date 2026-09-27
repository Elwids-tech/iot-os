<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Domain\Shared\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class BootstrapAdministrator extends Command
{
    protected $signature = 'deployment:administrator {email} {--output= : New private credential file}';

    protected $description = 'Bootstrap the first administrator without demo data or password resets';

    public function handle(): int
    {
        if (! filter_var($this->argument('email'), FILTER_VALIDATE_EMAIL)) {
            $this->error('A valid administrator email is required.');

            return self::FAILURE;
        }
        if (User::where('is_super_admin', true)->exists() || User::where('email', $this->argument('email'))->exists()) {
            $this->error('Administrator already exists, or email belongs to an existing account. No changes made.');

            return self::FAILURE;
        }
        $path = $this->option('output');
        if (! is_string($path) || ! str_starts_with($path, '/') || ! is_dir(dirname($path))) {
            $this->error('Provide an absolute --output path in an existing private directory.');

            return self::FAILURE;
        }
        $mask = umask(0077);
        $file = @fopen($path, 'x');
        umask($mask);
        if (! $file) {
            $this->error('Credential file must not already exist.');

            return self::FAILURE;
        }
        try {
            DB::transaction(function () use ($file): void {
                $password = Str::random(32);
                User::forceCreate(['name' => 'Platform administrator', 'email' => $this->argument('email'), 'password' => $password, 'email_verified_at' => now(), 'is_super_admin' => true]);
                $data = json_encode(['email' => $this->argument('email'), 'password' => $password], JSON_THROW_ON_ERROR);
                if (fwrite($file, $data) !== strlen($data) || ! fflush($file)) {
                    throw new \RuntimeException('Unable to persist administrator credentials.');
                }
            });
        } catch (\Throwable $e) {
            fclose($file);
            unlink($path);
            throw $e;
        }
        fclose($file);
        $this->info('Administrator created. Credentials written to the private output file.');

        return self::SUCCESS;
    }
}
