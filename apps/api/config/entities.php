<?php

// The entity hierarchy (spec 009, research R20).
return [
    // An installation-wide ceiling per organization; no billing plan limits entities (owner, 2026-11-25).
    'max_per_organization' => (int) env('IOT_ENTITIES_MAX_PER_ORGANIZATION', 100000),
    // Levels from the top of the tree to the deepest entity (FR-001).
    'max_depth' => 12,
    'children_page' => 100,
    'search_page' => 25,
    'max_attributes' => 30,
];
