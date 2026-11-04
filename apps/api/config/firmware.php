<?php

return [
    // firmware/sdk and firmware/starters: the repository checkout locally, /var/firmware in images (spec 027 R15).
    'path' => env('IOT_FIRMWARE_PATH', is_dir(base_path('../../firmware')) ? base_path('../../firmware') : '/var/firmware'),
];
