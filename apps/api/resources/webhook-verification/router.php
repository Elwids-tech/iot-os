<?php
// Runs only in the dedicated Docker verification service, never an API route.
if (getenv('APP_ENV') !== 'local' || ($_SERVER['REQUEST_URI'] ?? '') !== '/events' || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(404); exit; }
$body = file_get_contents('php://input');
if (strlen($body) > 1048576) { http_response_code(413); exit; }
$headers = array_change_key_case(getallheaders(), CASE_LOWER);
$id = $headers['x-iot-delivery-id'] ?? '';
if (!preg_match('/^[a-f0-9-]{36}$/D', $id)) { http_response_code(400); exit; }
$file = '/tmp/webhook-'.$id.'.jsonl';
$attempt = file_exists($file) ? count(file($file)) + 1 : 1;
file_put_contents($file,json_encode(['headers'=>$headers,'body'=>$body,'attempt'=>$attempt],JSON_THROW_ON_ERROR)."\n",FILE_APPEND|LOCK_EX);
chmod($file,0600);
// Deliberate transient failure proves delivery is retried with the same ID.
http_response_code($attempt === 1 ? 503 : 204);
