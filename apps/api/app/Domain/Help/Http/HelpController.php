<?php

declare(strict_types=1);

namespace App\Domain\Help\Http;

use App\Domain\Help\Services\HelpCatalog;
use App\Domain\Help\Services\HelpRetrieval;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;

final class HelpController
{
    public function __construct(private readonly HelpRetrieval $retrieval, private readonly HelpCatalog $catalog) {}

    public function page(Request $request, Organization $organization): array
    {
        $values = $request->validate(['context' => 'required|string|max:80']);

        return ['data' => $this->retrieval->page($request->user(), $organization, $values['context'])];
    }

    public function index(Request $request, Organization $organization): array
    {
        $values = $request->validate(['query' => 'nullable|string|max:255', 'context' => 'nullable|string|max:80']);

        return ['data' => $this->retrieval->search($request->user(), $organization, $values['query'] ?? '', $values['context'] ?? null)];
    }

    public function show(Request $request, Organization $organization, string $slug): array
    {
        $article = $this->retrieval->articles($request->user(), $organization)[$slug] ?? null;
        abort_unless($article, 404);

        return ['data' => [...$this->catalog->summary($article), 'chunks' => array_map(fn ($chunk) => array_intersect_key($chunk, array_flip(['id', 'title', 'html'])), $article['chunks'])]];
    }
}
