<?php

return [
    'enabled' => (bool) env('IOT_ASSISTANT_ENABLED', false),
    'help_enabled' => (bool) env('IOT_HELP_AI_ENABLED', false),
    'model' => env('IOT_ASSISTANT_MODEL', 'gpt-5.4-mini-2026-03-17'),
    'queue_connection' => env('IOT_ASSISTANT_QUEUE_CONNECTION', 'assistant'),
    'daily_budget_usd' => (float) env('IOT_ASSISTANT_DAILY_BUDGET_USD', 0.50),
    'run_budget_usd' => (float) env('IOT_ASSISTANT_RUN_BUDGET_USD', 0.04),
    'max_context_characters' => 60000,
    'max_file_kib' => 10240,
    'max_message_files' => 5,
    'max_message_bytes' => 26214400,
    'max_pdf_pages' => 100,
];
