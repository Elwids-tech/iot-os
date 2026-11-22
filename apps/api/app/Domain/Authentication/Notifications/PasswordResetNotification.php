<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Notifications;

use App\Domain\Branding\Services\MailBrand;
use App\Domain\Branding\Services\PortalLinks;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;

final class PasswordResetNotification extends ResetPassword implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    /**
     * The address the reset was asked for at: the worker that sends this has no request
     * (spec 036, FR-029). Null by default, so a message queued before a release still sends.
     */
    public ?string $origin = null;

    public function __construct(string $token)
    {
        parent::__construct($token);
        $this->origin = app(PortalLinks::class)->origin();
        $this->onConnection('alerts')->onQueue('alerts');
    }

    public function toMail($notifiable): MailMessage
    {
        // URL fragments stay in the browser and out of reverse-proxy access logs.
        $url = app(PortalLinks::class)->at($this->origin, 'reset-password').'#'.http_build_query([
            'token' => $this->token,
            'email' => $notifiable->getEmailForPasswordReset(),
        ]);
        $brand = MailBrand::forHost($this->origin);

        return $brand->apply((new MailMessage)
            ->subject(sprintf('Reset your %s password', $brand->or('ELWIDS')))
            ->line('We received a request to reset your account password.')
            ->action('Reset password', $url)
            ->line('This link expires in '.config('auth.passwords.users.expire').' minutes and can only be used once.')
            ->line('If you did not request this, you can ignore this email.'));
    }
}
