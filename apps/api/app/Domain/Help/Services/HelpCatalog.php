<?php

declare(strict_types=1);

namespace App\Domain\Help\Services;

use Illuminate\Support\Str;
use League\CommonMark\CommonMarkConverter;
use RuntimeException;

/** The approved, release-local library. No workspace files or tenant data are indexed. */
final class HelpCatalog
{
    private ?array $articles = null;

    public function contexts(): array
    {
        return json_decode(file_get_contents(resource_path('help/contexts.json')), true, 512, JSON_THROW_ON_ERROR);
    }

    public function context(string $key): array
    {
        abort_unless(isset($this->contexts()[$key]), 422, 'Unknown help page context.');

        return $this->contexts()[$key];
    }

    public function all(): array
    {
        if ($this->articles !== null) {
            return $this->articles;
        }
        $articles = [];
        $converter = new CommonMarkConverter(['html_input' => 'strip', 'allow_unsafe_links' => false]);
        foreach (glob(resource_path('help/*.md')) as $path) {
            $source = file_get_contents($path);
            if (! preg_match('/\A---\n(.*?)\n---\n(.*)\z/s', $source, $matches)) {
                throw new RuntimeException('Missing help metadata: '.basename($path));
            }
            $article = json_decode($matches[1], true, 512, JSON_THROW_ON_ERROR);
            $slug = $article['slug'] ?? '';
            if (! preg_match('/^[a-z][a-z0-9-]*$/', $slug) || isset($articles[$slug])) {
                throw new RuntimeException('Invalid or duplicate help slug: '.$slug);
            }
            foreach (['title', 'section', 'summary', 'contexts', 'keywords', 'required_capabilities', 'revision', 'questions'] as $field) {
                if (! array_key_exists($field, $article)) {
                    throw new RuntimeException('Missing help '.$field.': '.$slug);
                }
            }
            if (! is_int($article['revision']) || $article['revision'] < 1 || ! is_string($article['title']) || ! is_string($article['summary'])) {
                throw new RuntimeException('Invalid help revision/title: '.$slug);
            }
            foreach (['contexts', 'keywords', 'required_capabilities', 'questions'] as $field) {
                if (! is_array($article[$field]) || array_filter($article[$field], fn ($value) => ! is_string($value))) {
                    throw new RuntimeException('Invalid help '.$field.': '.$slug);
                }
            }
            $chunks = [];
            preg_match_all('/^## ([^\n]+)\n(.*?)(?=^## |\z)/ms', $matches[2], $sections, PREG_SET_ORDER);
            foreach ($sections as $section) {
                $id = Str::slug($section[1]);
                if ($id === '' || isset($chunks[$id])) {
                    throw new RuntimeException('Invalid or duplicate help heading: '.$slug);
                }
                $chunks[$id] = ['id' => $id, 'title' => $section[1], 'text' => trim($section[2]), 'html' => (string) $converter->convert(trim($section[2]))];
            }
            foreach (['purpose', 'before-you-start', 'steps', 'expected-result', 'troubleshooting', 'related-guides'] as $heading) {
                if (empty($chunks[$heading]['text'])) {
                    throw new RuntimeException('Missing help heading '.$heading.': '.$slug);
                }
            }
            $articles[$slug] = [...$article, 'chunks' => array_values($chunks), 'markdown' => $matches[2]];
        }
        if ($articles === []) {
            throw new RuntimeException('Help library is empty.');
        }
        foreach ($articles as $article) {
            foreach ($article['required_capabilities'] as $capability) {
                if (! in_array($capability, ['devices.view', 'devices.manage', 'profiles.view', 'workflows.view'], true)) {
                    throw new RuntimeException('Unknown help capability: '.$capability);
                }
            }
            foreach ($article['contexts'] as $context) {
                if (! isset($this->contexts()[$context])) {
                    throw new RuntimeException('Unknown article context: '.$context);
                }
            }
            preg_match_all('/\]\(([^)]+)\)/', $article['markdown'], $links);
            foreach ($links[1] as $link) {
                if (! preg_match('~^/help/([a-z][a-z0-9-]*)(?:#([a-z0-9-]+))?$~', $link, $parts) || ! isset($articles[$parts[1]])) {
                    throw new RuntimeException('Invalid help link: '.$link);
                }
                if (isset($parts[2]) && ! in_array($parts[2], array_column($articles[$parts[1]]['chunks'], 'id'), true)) {
                    throw new RuntimeException('Unknown help heading link: '.$link);
                }
            }
        }
        foreach ($this->contexts() as $key => $context) {
            if (! isset($articles[$context['overview']]) || ! in_array($key, $articles[$context['overview']]['contexts'], true)) {
                throw new RuntimeException('Missing help overview mapping: '.$key);
            }
        }

        return $this->articles = $articles;
    }

    public function summary(array $article): array
    {
        return array_intersect_key($article, array_flip(['slug', 'title', 'summary', 'section', 'contexts', 'revision', 'questions']));
    }
}
