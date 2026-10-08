<?php

declare(strict_types=1);

namespace App\Domain\Help\Services;

use App\Domain\Assistant\Models\AssistantRun;

final class HelpAnswers
{
    public const UNSUPPORTED = 'The approved guides do not contain enough information to answer that question. You can read the related guides below or ask a more specific usage question.';

    public function __construct(private readonly HelpRetrieval $retrieval, private readonly HelpCatalog $catalog) {}

    public function prepare(AssistantRun $run): array
    {
        $conversation = $run->conversation;
        $chunks = $this->retrieval->retrieve($conversation->user, $conversation->organization, $run->prompt, $run->help_context['key']);
        $run->update(['help_sources' => array_map($this->reference(...), $chunks)]);

        return array_map(fn ($chunk) => array_intersect_key($chunk, array_flip(['citation_id', 'article_title', 'title', 'text', 'revision'])), $chunks);
    }

    public function normalize(AssistantRun $run, array $response): array
    {
        $allowed = [];
        $articles = $this->retrieval->articles($run->conversation->user, $run->conversation->organization);
        foreach ($run->help_sources ?? [] as $source) {
            if (isset($articles[$source['slug']]) && $articles[$source['slug']]['revision'] === $source['revision']) {
                $allowed[$source['citation_id']] = $source;
            }
        }
        $ids = $response['citation_ids'] ?? [];
        $valid = is_array($ids) && $ids !== [] && count($ids) <= 8;
        foreach (is_array($ids) ? $ids : [] as $id) {
            if (! is_string($id) || ! isset($allowed[$id])) {
                $valid = false;
            }
        }
        $supported = ($response['supported'] ?? false) === true && $valid && is_string($response['answer'] ?? null) && trim($response['answer']) !== '';
        $citations = $supported ? array_values(array_intersect_key($allowed, array_flip($ids))) : array_slice(array_values($allowed), 0, 3);
        // Arbitrary model links and unverified citation identifiers are never rendered.
        $answer = $supported ? mb_substr(preg_replace('~\[([^\]]+)\]\([^)]+\)|https?://\S+|/help/\S+~u', '$1', $response['answer']), 0, 10000) : self::UNSUPPORTED;

        return ['answer' => $answer, 'supported' => $supported, 'citations' => $citations];
    }

    public function visible(AssistantRun $run): array
    {
        $articles = $this->retrieval->articles($run->conversation->user, $run->conversation->organization);
        $page = $this->catalog->context($run->help_context['key']);
        $accessible = isset($articles[$page['overview']]);
        foreach ($run->help_answer['citations'] ?? [] as $citation) {
            if (! isset($articles[$citation['slug']]) || $articles[$citation['slug']]['revision'] !== $citation['revision']) {
                $accessible = false;
            }
        }

        return [
            'help_context' => $accessible ? $run->help_context : ['key' => 'getting-started', 'title' => 'Unavailable section'],
            'help_answer' => $accessible ? $run->help_answer : null,
            'answer' => $accessible ? $run->answer : 'This answer is unavailable because guide access or the guide revision changed. Ask again using the current guides.',
        ];
    }

    private function reference(array $chunk): array
    {
        return ['citation_id' => $chunk['citation_id'], 'slug' => $chunk['slug'], 'heading' => $chunk['id'], 'title' => $chunk['article_title'], 'heading_title' => $chunk['title'], 'revision' => $chunk['revision']];
    }
}
