<?php
declare(strict_types=1);
namespace App\Domain\Integrations\Services;
class WebhookTransport
{
    public function send(string $url, array $target, string $body, string $id, string $secret): ?int
    {
        $timestamp = (string) time();
        $signature = hash_hmac('sha256', $timestamp.'.'.$id.'.'.$body, $secret);
        $curl = curl_init($url);
        curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => ['Content-Type: application/json','X-Iot-Delivery-Id: '.$id,'X-Iot-Timestamp: '.$timestamp,'X-Iot-Signature: v1='.$signature], CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 5, CURLOPT_FOLLOWLOCATION => false, CURLOPT_MAXREDIRS => 0, CURLOPT_PROXY => '', CURLOPT_PROTOCOLS => $target['local'] ? CURLPROTO_HTTP : CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4, CURLOPT_WRITEFUNCTION => static fn ($handle, $data) => strlen($data)]);
        // Pin validated DNS to the TLS hostname. No second resolution/rebinding.
        if ($target['ip'] !== null) curl_setopt($curl, CURLOPT_RESOLVE, [$target['host'].':'.$target['port'].':'.$target['ip']]);
        $result = curl_exec($curl);
        $status = $result === false ? null : (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        return $status;
    }
}
