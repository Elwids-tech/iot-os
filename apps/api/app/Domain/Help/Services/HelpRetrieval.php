<?php

declare(strict_types=1);

namespace App\Domain\Help\Services;

use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

/** Replaceable retrieval boundary; the initial curated corpus needs no vector service. */
class HelpRetrieval
{
    public function __construct(private readonly HelpCatalog $catalog, private readonly HelpAccess $access) {}

    public function articles(User $user, Organization $organization): array
    {
        $capabilities = $this->access->capabilities($user, $organization);

        return array_filter($this->catalog->all(), fn ($article) => $this->access->permits($article, $capabilities));
    }

    public function page(User $user, Organization $organization, string $context): array
    {
        $page = $this->catalog->context($context);
        $articles = $this->articles($user, $organization);
        abort_unless(isset($articles[$page['overview']]), 403, 'Help for this section requires its viewing permission.');

        return [...$page, 'key' => $context, 'articles' => array_values(array_map($this->catalog->summary(...), array_filter($articles, fn ($article) => in_array($context, $article['contexts'], true))))];
    }

    public function search(User $user, Organization $organization, string $query, ?string $context = null): array
    {
        if ($context !== null) {
            $this->page($user, $organization, $context);
        }
        $results = [];
        foreach ($this->articles($user, $organization) as $article) {
            $score = $this->score($article, $query);
            if (trim($query) !== '' && $score === 0) {
                continue;
            }
            $results[] = ['article' => $article, 'score' => $score + ($context !== null && in_array($context, $article['contexts'], true) ? 8 : 0)];
        }
        usort($results, fn ($a, $b) => ($b['score'] <=> $a['score']) ?: strcmp($a['article']['title'], $b['article']['title']));

        return array_map(fn ($result) => $this->catalog->summary($result['article']), $results);
    }

    public function retrieve(User $user, Organization $organization, string $question, string $context): array
    {
        $page = $this->page($user, $organization, $context);
        $articles = $this->articles($user, $organization);
        $ranked = $this->search($user, $organization, $question, $context);
        $slugs = array_slice(array_unique([$page['overview'], ...array_column($ranked, 'slug')]), 0, 4);
        $chunks = [];
        foreach ($slugs as $slug) {
            $article = $articles[$slug];
            foreach ($article['chunks'] as $chunk) {
                if ($chunk['id'] === 'related-guides') {
                    continue;
                }
                $chunks[] = [...$chunk, 'slug' => $slug, 'article_title' => $article['title'], 'revision' => $article['revision'], 'citation_id' => $slug.'#'.$chunk['id'], 'score' => $this->score($article, $question, $chunk) + ($slug === $page['overview'] ? 8 : 0)];
            }
        }
        usort($chunks, fn ($a, $b) => ($b['score'] <=> $a['score']) ?: strcmp($a['citation_id'], $b['citation_id']));
        // Always include the current page's purpose, then the best task-oriented excerpts.
        $purpose = array_values(array_filter($chunks, fn ($chunk) => $chunk['slug'] === $page['overview'] && $chunk['id'] === 'purpose'))[0];
        $chosen = [$purpose];
        $bytes = strlen($purpose['text']);
        foreach ($chunks as $chunk) {
            if ($chunk['citation_id'] === $purpose['citation_id'] || count($chosen) >= 10 || $bytes + strlen($chunk['text']) > 18000) {
                continue;
            }
            $chosen[] = $chunk;
            $bytes += strlen($chunk['text']);
        }
        if ($ranked === []) {
            logger()->info('Help retrieval had no question match.', ['context' => $context, 'organization_id' => $organization->id]);
        }

        return $chosen;
    }

    private function score(array $article, string $query, ?array $chunk = null): int
    {
        $terms = preg_split('/[^\pL\pN]+/u', mb_strtolower($query), -1, PREG_SPLIT_NO_EMPTY);
        $stop = ['how', 'do', 'does', 'i', 'a', 'an', 'the', 'to', 'is', 'it', 'my', 'in', 'of', 'for', 'and', 'can', 'what', 'why', 'with'];
        $terms = array_unique(array_diff($terms, $stop));
        $score = 0;
        foreach ($terms as $term) {
            if (mb_strlen($term) < 2) {
                continue;
            }
            foreach ([$article['title'] => 6, implode(' ', $article['keywords']) => 5, $chunk['title'] ?? implode(' ', array_column($article['chunks'], 'title')) => 3, $chunk['text'] ?? $article['markdown'] => 1] as $haystack => $weight) {
                if (str_contains(mb_strtolower($haystack), $term)) {
                    $score += $weight;
                }
            }
        }

        return $score;
    }
}
