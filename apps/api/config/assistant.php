<?php

return [
    'enabled' => (bool) env('IOT_ASSISTANT_ENABLED', false),
    'help_enabled' => (bool) env('IOT_HELP_AI_ENABLED', false),
    // Defaults; super administrators can override provider, model, keys and limits in admin.
    'provider' => env('IOT_ASSISTANT_PROVIDER', 'openai'),
    'model' => env('IOT_ASSISTANT_MODEL') ?: null,
    'queue_connection' => env('IOT_ASSISTANT_QUEUE_CONNECTION', 'assistant'),
    'daily_budget_usd' => (float) env('IOT_ASSISTANT_DAILY_BUDGET_USD', 0.50),
    'run_budget_usd' => (float) env('IOT_ASSISTANT_RUN_BUDGET_USD', 0.04),
    'max_context_characters' => 60000,
    'max_file_kib' => 10240,
    'max_message_files' => 5,
    'max_message_bytes' => 26214400,
    'max_pdf_pages' => 100,

    // Selectable models and their prices in USD per million tokens. Runs are priced
    // with the model that served them; add a model here with its prices.
    'providers' => [
        'openai' => [
            'label' => 'OpenAI',
            'default_model' => 'gpt-5.4-mini-2026-03-17',
            'models' => [
                'gpt-5.4-mini-2026-03-17' => ['label' => 'GPT-5.4 mini', 'input_usd_per_million' => 0.75, 'output_usd_per_million' => 4.50],
            ],
        ],
        'anthropic' => [
            'label' => 'Anthropic',
            'default_model' => 'claude-opus-5-5',
            'models' => [
                'claude-opus-5-5' => ['label' => 'Claude Opus 5.5', 'input_usd_per_million' => 4.00, 'output_usd_per_million' => 20.00],
                'claude-sonnet-5-5' => ['label' => 'Claude Sonnet 5.5', 'input_usd_per_million' => 2.00, 'output_usd_per_million' => 10.00],
                'claude-haiku-5-5' => ['label' => 'Claude Haiku 5.5', 'input_usd_per_million' => 0.10, 'output_usd_per_million' => 0.50,
                    'long_context' => ['above_input_tokens' => 100000, 'input_usd_per_million' => 0.50, 'output_usd_per_million' => 2.50]],
            ],
        ],
    ],
];
