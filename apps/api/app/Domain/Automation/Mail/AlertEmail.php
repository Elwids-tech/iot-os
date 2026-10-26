<?php

declare(strict_types=1);

namespace App\Domain\Automation\Mail;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Services\AlertQuery;
use App\Domain\Shared\Models\Organization;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;
use Illuminate\Support\Str;

/**
 * A plain-text email about one automation alert episode. It names the device and links
 * to the alert and its automation in the portal, so the recipient can act from the email.
 */
final class AlertEmail extends Mailable
{
    public string $title;

    public ?string $deviceName;

    public function __construct(public string $deliveryUuid, public Alert $alert, public Organization $organization, public string $condition)
    {
        $view = app(AlertQuery::class)->views($organization, $alert->newCollection([$alert]))[0];
        $this->deviceName = $view['device_name'];
        $workflowName = $alert->workflow->name;
        // As the portal titles alerts: the device is added unless the automation already names it.
        $this->title = $this->deviceName && ! Str::contains($workflowName, $this->deviceName, ignoreCase: true)
            ? $workflowName.' — '.$this->deviceName
            : $workflowName;
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'IoT alert '.($this->condition === 'activated' ? 'active' : 'cleared').': '.$this->title);
    }

    public function content(): Content
    {
        $occurred = $this->condition === 'activated' ? $this->alert->activated_at : $this->alert->cleared_at;

        return new Content(text: 'automation.alert-email', with: [
            'occurredAt' => $occurred?->utc()->format('j M Y, H:i:s').' UTC',
            'alertLink' => $this->portal('alerts/'.$this->alert->uuid),
            'workflowLink' => $this->portal('automation/'.$this->alert->workflow->uuid),
            'notificationsLink' => $this->portal('settings/notifications'),
        ]);
    }

    public function headers(): Headers
    {
        return new Headers(messageId: $this->deliveryUuid.'@alerts.iot-os.local');
    }

    private function portal(string $path): string
    {
        return rtrim((string) config('app.frontend_url'), '/').'/organizations/'.$this->organization->uuid.'/'.$path;
    }
}
