<?php

declare(strict_types=1);

namespace App\Domain\Automation\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;

final class AlertEmail extends Mailable
{
    public function __construct(public string $deliveryUuid, public string $workflowName, public string $alertUuid, public int $episode, public string $condition, public string $occurredAt) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'IoT alert '.($this->condition === 'activated' ? 'active' : 'cleared').': '.$this->workflowName);
    }

    public function content(): Content
    {
        return new Content(text: 'automation.alert-email');
    }

    public function headers(): Headers
    {
        return new Headers(messageId: $this->deliveryUuid.'@alerts.iot-os.local');
    }
}
