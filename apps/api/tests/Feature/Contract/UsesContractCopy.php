<?php

declare(strict_types=1);

namespace Tests\Feature\Contract;

use App\Support\Contract\ContractFiles;
use Illuminate\Support\Facades\File;

/**
 * Points the contract commands at a scratch copy of contracts/openapi, so a test can
 * change the files without touching the checkout.
 */
trait UsesContractCopy
{
    private ?string $contractCopy = null;

    /**
     * @return string the copy of contracts/openapi; its parent stands in for contracts/
     */
    protected function useContractCopy(): string
    {
        $source = ContractFiles::directory();
        $this->contractCopy = sys_get_temp_dir().'/contract-test-'.bin2hex(random_bytes(6));
        File::copyDirectory($source, $this->contractCopy.'/openapi');
        config(['scramble.contract.directory' => $this->contractCopy.'/openapi']);

        return $this->contractCopy.'/openapi';
    }

    protected function tearDown(): void
    {
        if ($this->contractCopy !== null) {
            File::deleteDirectory($this->contractCopy);
            $this->contractCopy = null;
        }

        parent::tearDown();
    }
}
