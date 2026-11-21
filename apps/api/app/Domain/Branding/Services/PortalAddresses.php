<?php

declare(strict_types=1);

namespace App\Domain\Branding\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Contracts\DnsResolver;
use App\Domain\Branding\Enums\PortalAddressKind;
use App\Domain\Branding\Enums\PortalAddressState;
use App\Domain\Branding\Exceptions\BrandingRefusal;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Shared\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Throwable;

/**
 * Portal addresses (spec 036, ADR-050, research R4 and R7): the hosts a billing
 * account's branded portal is served on: a name under the platform's domain, and a
 * custom domain the account proves it controls with a CNAME record.
 */
final class PortalAddresses
{
    /** How long a host's answer is remembered. A change clears it at once (FR-017). */
    public const CACHE_SECONDS = 30;

    private const CACHE_PREFIX = 'portal-address:';

    /** A custom domain's states that the scheduled check looks at. */
    private const CHECKED = [PortalAddressState::WaitingDns, PortalAddressState::Active, PortalAddressState::Unreachable];

    public function __construct(private readonly DnsResolver $dns) {}

    /** Whether this deployment serves addresses at all: the switch and a domain to put names under. */
    public function enabled(): bool
    {
        return (bool) config('branding.addresses_enabled') && $this->domain() !== null;
    }

    /** The platform's domain, lower case, or null. */
    public function domain(): ?string
    {
        $domain = strtolower(trim((string) config('branding.domain'), " \t\n."));

        return $domain === '' ? null : $domain;
    }

    /**
     * The claimable name in a host under the platform's domain: `acme` for
     * `acme.example.com`. Null for the domain itself, a deeper name, a reserved name such
     * as the portal's own, and any other host.
     */
    public function nameIn(string $host): ?string
    {
        $domain = $this->domain();
        $host = self::host($host);
        if ($domain === null || ! str_ends_with($host, '.'.$domain)) {
            return null;
        }
        $name = substr($host, 0, -strlen('.'.$domain));

        return $name === '' || str_contains($name, '.') || $this->reserved($name) ? null : $name;
    }

    /** A host as it is stored: lower case, without a port or a trailing dot. */
    public static function host(string $host): string
    {
        $host = strtolower(trim($host));
        // A bracketed IPv6 literal is never an address; leave it whole.
        if (! str_starts_with($host, '[')) {
            $host = explode(':', $host, 2)[0];
        }

        return rtrim($host, '.');
    }

    /**
     * The address that serves the portal on a host, or null. Remembered for 30 seconds,
     * so an address suspended, released or left without its allowance stops within a
     * minute (FR-017).
     */
    public function resolve(string $host): ?PortalAddress
    {
        if (! $this->enabled()) {
            return null;
        }
        $host = self::host($host);
        if ($host === '' || strlen($host) > 253) {
            return null;
        }

        /** @var array<string, mixed>|false $attributes */
        $attributes = Cache::remember(self::CACHE_PREFIX.$host, self::CACHE_SECONDS, static function () use ($host): array|false {
            $address = PortalAddress::query()->with('billingAccount')->where('host', $host)->first();

            return $address !== null && $address->serves() ? $address->getAttributes() : false;
        });

        return $attributes === false ? null : (new PortalAddress)->newFromBuilder($attributes);
    }

    /**
     * Where a renamed name sends its visitors, for 30 days after the rename.
     */
    public function redirectFor(string $host): ?PortalAddress
    {
        if (! $this->enabled()) {
            return null;
        }
        $old = PortalAddress::query()->with('redirectTo.billingAccount')
            ->where('host', self::host($host))
            ->where('state', PortalAddressState::Released)
            ->whereNotNull('redirect_to_id')
            ->where('released_at', '>', now()->subDays((int) config('branding.hold_days')))
            ->first();

        return $old?->redirectTo !== null && $old->redirectTo->serves() ? $old->redirectTo : null;
    }

    /**
     * The account's live addresses, the name first.
     *
     * @return Collection<int, PortalAddress>
     */
    public function for(BillingAccount $account): Collection
    {
        return PortalAddress::query()
            ->where('billing_account_id', $account->getKey())
            ->whereNotIn('state', [PortalAddressState::Released, PortalAddressState::Lapsed])
            ->orderByRaw("CASE kind WHEN 'name' THEN 0 ELSE 1 END")
            ->get()
            ->each(fn (PortalAddress $address) => $address->setRelation('billingAccount', $account));
    }

    /**
     * Claims a name under the platform's domain for the account, or renames the one it
     * holds. The old name is released and redirects to the new one for 30 days.
     */
    public function claimName(BillingAccount $account, string $name, ?User $actor): PortalAddress
    {
        if (! $this->enabled()) {
            throw new BrandingRefusal(409, 'addresses_unavailable', 'Portal addresses are not available on this deployment.');
        }
        $name = strtolower(trim($name));
        if (preg_match('/^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/', $name) !== 1 || str_contains($name, '--')) {
            throw new BrandingRefusal(422, 'name_invalid', 'Use 3 to 40 letters, numbers and single hyphens, starting and ending with a letter or number.', 'name');
        }
        if ($this->reserved($name)) {
            throw new BrandingRefusal(409, 'name_reserved', 'This name is reserved. Choose another.');
        }
        $host = $name.'.'.$this->domain();

        $forget = [$host];
        try {
            $address = $this->claim($account, $host, $actor, $forget);
        } catch (UniqueConstraintViolationException) {
            // Two accounts asked for one name at the same moment.
            throw new BrandingRefusal(409, 'name_taken', 'This name is taken. Choose another.');
        }
        $this->forget(...$forget);

        return $address->setRelation('billingAccount', $account);
    }

    /**
     * @param  list<string>  $forget
     */
    private function claim(BillingAccount $account, string $host, ?User $actor, array &$forget): PortalAddress
    {
        return DB::transaction(function () use ($account, $host, $actor, &$forget): PortalAddress {
            // The account row serialises its claims; the unique host settles two accounts.
            BillingAccount::query()->whereKey($account->getKey())->lockForUpdate()->firstOrFail();
            $current = PortalAddress::query()
                ->where('billing_account_id', $account->getKey())
                ->where('kind', PortalAddressKind::Name)
                ->whereNotIn('state', [PortalAddressState::Released, PortalAddressState::Lapsed])
                ->lockForUpdate()->first();
            if ($current?->host === $host) {
                return $current;
            }
            if ($current?->state === PortalAddressState::Suspended) {
                throw new BrandingRefusal(409, 'suspended', 'This address is suspended. Contact support to change it.');
            }

            $held = PortalAddress::query()->where('host', $host)->lockForUpdate()->first();
            if ($held !== null && $held->billing_account_id !== $account->getKey()) {
                $free = ! $held->state->isLive() && ($held->released_at === null || $held->released_at->lte(now()->subDays((int) config('branding.hold_days'))));
                if (! $free) {
                    throw new BrandingRefusal(409, 'name_taken', 'This name is taken. Choose another.');
                }
                $held->delete();
                $held = null;
            }

            $now = now();
            if ($current !== null) {
                // Released before the new row takes the account's one live name.
                $current->forceFill(['state' => PortalAddressState::Released, 'released_at' => $now, 'redirect_to_id' => null])->save();
                $forget[] = $current->host;
            }
            $values = [
                'billing_account_id' => $account->getKey(),
                'kind' => PortalAddressKind::Name,
                'host' => $host,
                'state' => PortalAddressState::Active,
                'claimed_by' => $actor?->getKey(),
                'claimed_at' => $now,
                'activated_at' => $now,
                'suspended_at' => null,
                'suspended_by' => null,
                'released_at' => null,
                'redirect_to_id' => null,
            ];
            // The account taking back a name it released keeps the row.
            $address = $held ?? new PortalAddress;
            $address->forceFill($values)->save();
            if ($current !== null) {
                // The old name, and any name renamed before it, now lead to the new one.
                PortalAddress::query()->where('redirect_to_id', $current->getKey())->update(['redirect_to_id' => $address->getKey()]);
                $current->forceFill(['redirect_to_id' => $address->getKey()])->save();
            }

            ActivityLog::record('portal_address.claimed', null, $actor, $account, [
                'host' => $host,
                'kind' => PortalAddressKind::Name->value,
                ...($current === null ? [] : ['replaced' => $current->host]),
            ]);

            return $address;
        });
    }

    /**
     * Claims a custom domain for the account (FR-011). It waits for the CNAME record
     * {@see record()} names, and serves once {@see check()} finds it.
     */
    public function claimDomain(BillingAccount $account, string $host, ?User $actor): PortalAddress
    {
        if (! $this->enabled()) {
            throw new BrandingRefusal(409, 'addresses_unavailable', 'Portal addresses are not available on this deployment.');
        }
        $host = $this->domainHost($host);

        try {
            $address = DB::transaction(function () use ($account, $host, $actor): PortalAddress {
                BillingAccount::query()->whereKey($account->getKey())->lockForUpdate()->firstOrFail();
                $current = PortalAddress::query()
                    ->where('billing_account_id', $account->getKey())
                    ->where('kind', PortalAddressKind::Domain)
                    ->whereNotIn('state', [PortalAddressState::Released, PortalAddressState::Lapsed])
                    ->lockForUpdate()->first();
                if ($current?->host === $host) {
                    return $current;
                }
                if ($current !== null) {
                    throw new BrandingRefusal(409, 'domain_exists', 'This billing account already has a domain. Remove it before adding another.');
                }

                $held = PortalAddress::query()->where('host', $host)->lockForUpdate()->first();
                if ($held !== null && $held->billing_account_id !== $account->getKey()) {
                    if ($held->state->isLive()) {
                        throw new BrandingRefusal(409, 'host_taken', 'This domain is already in use.');
                    }
                    // Only a domain that served is held: a request that never found its record frees the name at once.
                    if ($held->activated_at !== null && $held->released_at !== null && $held->released_at->gt(now()->subDays((int) config('branding.hold_days')))) {
                        throw new BrandingRefusal(409, 'host_held', 'This domain was used by another account recently. Try again later, or contact support.');
                    }
                    $held->delete();
                    $held = null;
                }

                $address = $held ?? new PortalAddress;
                $address->forceFill([
                    'billing_account_id' => $account->getKey(),
                    'kind' => PortalAddressKind::Domain,
                    'host' => $host,
                    'state' => PortalAddressState::WaitingDns,
                    'claim_token' => bin2hex(random_bytes(10)),
                    'claimed_by' => $actor?->getKey(),
                    'claimed_at' => now(),
                    'activated_at' => null,
                    'last_checked_at' => null,
                    'last_reachable_at' => null,
                    'failed_checks' => 0,
                    'unreachable_since' => null,
                    'suspended_at' => null,
                    'suspended_by' => null,
                    'released_at' => null,
                    'redirect_to_id' => null,
                ])->save();

                ActivityLog::record('portal_address.claimed', null, $actor, $account, ['host' => $host, 'kind' => PortalAddressKind::Domain->value]);

                return $address;
            });
        } catch (UniqueConstraintViolationException) {
            throw new BrandingRefusal(409, 'host_taken', 'This domain is already in use.');
        }
        $this->forget($host);

        return $address->setRelation('billingAccount', $account);
    }

    /**
     * The DNS record that proves control of a custom domain and points it here: a CNAME
     * to a name only this claim knows, under the platform's domain.
     *
     * @return array{type: 'CNAME', name: string, value: string}|null
     */
    public function record(PortalAddress $address): ?array
    {
        if ($address->kind !== PortalAddressKind::Domain || $address->claim_token === null || $this->domain() === null) {
            return null;
        }

        return ['type' => 'CNAME', 'name' => $address->host, 'value' => config('branding.claim_prefix').$address->claim_token.'.'.$this->domain()];
    }

    /** When a domain still waiting for its record lapses. */
    public function lapsesAt(PortalAddress $address): ?Carbon
    {
        return $address->state === PortalAddressState::WaitingDns && $address->claimed_at !== null
            ? $address->claimed_at->copy()->addDays((int) config('branding.claim_days'))
            : null;
    }

    /**
     * Looks a custom domain's record up and moves the address between its states
     * (data-model.md "States"): waiting → active or, after 7 days, lapsed; active →
     * unreachable after three failed checks; unreachable → active on one good check.
     * An unreachable address keeps serving; only links fall back to the name.
     */
    public function check(PortalAddress $address): PortalAddress
    {
        if ($address->kind !== PortalAddressKind::Domain || ! in_array($address->state, self::CHECKED, true)) {
            return $address;
        }
        $found = $this->pointsHere($address);
        $now = now();
        $before = $address->state;
        $event = null;
        $changes = ['last_checked_at' => $now];

        if ($found) {
            $changes += ['last_reachable_at' => $now, 'failed_checks' => 0, 'unreachable_since' => null, 'state' => PortalAddressState::Active];
            if ($before === PortalAddressState::WaitingDns) {
                // A new activation: sessions from an earlier one do not carry over.
                $changes['activated_at'] = $now;
                $event = 'portal_address.activated';
            } elseif ($before === PortalAddressState::Unreachable) {
                $event = 'portal_address.recovered';
            }
        } elseif ($before === PortalAddressState::WaitingDns) {
            if ($address->claimed_at === null || $address->claimed_at->lte($now->copy()->subDays((int) config('branding.claim_days')))) {
                $changes += ['state' => PortalAddressState::Lapsed, 'released_at' => $now];
                $event = 'portal_address.lapsed';
            }
        } elseif ($before === PortalAddressState::Active) {
            $changes['failed_checks'] = $address->failed_checks + 1;
            if ($changes['failed_checks'] >= (int) config('branding.unreachable_after')) {
                $changes += ['state' => PortalAddressState::Unreachable, 'unreachable_since' => $now];
                $event = 'portal_address.unreachable';
            }
        } else {
            $changes['failed_checks'] = $address->failed_checks + 1;
        }

        $address->forceFill($changes)->save();
        if ($event !== null) {
            $this->forget($address->host);
            // Recorded with no actor: the scheduled check, or the owner's **Check now**, only read DNS.
            ActivityLog::record($event, null, null, $address->billingAccount, ['host' => $address->host]);
        }

        return $address;
    }

    /** {@see check()} for a person who asked, at most once a minute for each address. */
    public function checkNow(PortalAddress $address): PortalAddress
    {
        $key = 'portal-address-check:'.$address->getKey();
        if (RateLimiter::tooManyAttempts($key, 1)) {
            $wait = RateLimiter::availableIn($key);
            throw new HttpResponseException(response()->json(
                ['message' => 'This address was checked a moment ago. Try again in a minute.', 'code' => 'checked_recently'],
                429,
                ['Retry-After' => (string) $wait],
            ));
        }
        RateLimiter::hit($key, 60);

        return $this->check($address);
    }

    /**
     * The custom domains due a check: each one still waiting, and each serving one not
     * looked at for 15 minutes.
     *
     * @return Collection<int, PortalAddress>
     */
    public function due(): Collection
    {
        $recheck = now()->subMinutes((int) config('branding.recheck_minutes'));

        return PortalAddress::query()->with('billingAccount')
            ->where('kind', PortalAddressKind::Domain)
            ->where(fn ($query) => $query
                ->where('state', PortalAddressState::WaitingDns)
                ->orWhere(fn ($serving) => $serving
                    ->whereIn('state', [PortalAddressState::Active, PortalAddressState::Unreachable])
                    ->where(fn ($checked) => $checked->whereNull('last_checked_at')->orWhere('last_checked_at', '<=', $recheck))))
            ->orderBy('id')
            ->get();
    }

    /** The account's last domain request that lapsed, shown until it asks again. */
    public function lapsedFor(BillingAccount $account): ?PortalAddress
    {
        return PortalAddress::query()
            ->where('billing_account_id', $account->getKey())
            ->where('kind', PortalAddressKind::Domain)
            ->where('state', PortalAddressState::Lapsed)
            ->latest('released_at')
            ->first()
            ?->setRelation('billingAccount', $account);
    }

    private function pointsHere(PortalAddress $address): bool
    {
        // Development has no DNS for a made-up domain.
        if (! config('branding.dns_check')) {
            return true;
        }
        $target = $this->record($address)['value'] ?? null;
        if ($target === null) {
            return false;
        }
        try {
            return in_array(strtolower($target), $this->dns->cnames($address->host), true);
        } catch (Throwable) {
            return false;
        }
    }

    /** A custom domain as it is stored, or the refusal that explains what is wrong with it. */
    private function domainHost(string $host): string
    {
        $host = self::host((string) preg_replace('#^[a-z][a-z0-9+.-]*://#i', '', trim($host)));
        $host = explode('/', $host, 2)[0];
        if (preg_match('/[^\x20-\x7e]/', $host) === 1 && function_exists('idn_to_ascii')) {
            $host = (string) idn_to_ascii($host, IDNA_DEFAULT, INTL_IDNA_VARIANT_UTS46);
        }
        $label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
        if (strlen($host) > 253 || preg_match('/^'.$label.'(?:\.'.$label.')*$/', $host) !== 1 || filter_var($host, FILTER_VALIDATE_IP) !== false || preg_match('/\.[0-9]+$/', $host) === 1) {
            throw new BrandingRefusal(422, 'host_invalid', 'Enter a domain name such as portal.example.org.', 'host');
        }
        $domain = (string) $this->domain();
        if ($host === $domain || str_ends_with($host, '.'.$domain)) {
            // Development only: with the DNS check off, a deeper name under `localhost`
            // stands in for a customer's domain, which no local resolver could find.
            $standIn = ! config('branding.dns_check') && substr_count(substr($host, 0, -strlen('.'.$domain)), '.') >= 1;
            if (! $standIn) {
                throw new BrandingRefusal(422, 'platform_domain', 'This name is under the platform\'s own domain. Choose a name there instead.', 'host');
            }
        }
        if (substr_count($host, '.') < 2) {
            throw new BrandingRefusal(422, 'bare_domain', 'Use a subdomain such as portal.'.$host.'. A bare domain cannot point here with a CNAME record.', 'host');
        }

        return $host;
    }

    /** Gives an address up. Its host is held for 30 days, and whoever is signed in there loses the portal. */
    public function release(PortalAddress $address, ?User $actor, string $reason = 'removed'): void
    {
        if (! $address->state->isLive()) {
            return;
        }
        $address->forceFill(['state' => PortalAddressState::Released, 'released_at' => now(), 'redirect_to_id' => null])->save();
        $this->forget($address->host);
        ActivityLog::record('portal_address.released', null, $actor, $address->billingAccount, ['host' => $address->host, 'reason' => $reason]);
    }

    /** Releases every address of an account that is deleted or has no organization left. */
    public function releaseAll(BillingAccount $account, ?User $actor, string $reason): void
    {
        $this->for($account)->each(fn (PortalAddress $address) => $this->release($address, $actor, $reason));
    }

    /** Staff stop an address. Its owner sees it suspended and cannot change or remove it. */
    public function suspend(PortalAddress $address, User $actor): PortalAddress
    {
        if ($address->state->isLive() && $address->state !== PortalAddressState::Suspended) {
            $address->forceFill(['state' => PortalAddressState::Suspended, 'suspended_at' => now(), 'suspended_by' => $actor->getKey()])->save();
            $this->forget($address->host);
            ActivityLog::record('portal_address.suspended', null, $actor, $address->billingAccount, ['host' => $address->host]);
        }

        return $address;
    }

    public function restore(PortalAddress $address, User $actor): PortalAddress
    {
        if ($address->state === PortalAddressState::Suspended) {
            // A name serves at once. A custom domain goes back to waiting for its record.
            $state = $address->kind === PortalAddressKind::Name ? PortalAddressState::Active : PortalAddressState::WaitingDns;
            $address->forceFill([
                'state' => $state,
                'suspended_at' => null,
                'suspended_by' => null,
                // A domain gets a fresh seven days to show its record again.
                ...($state === PortalAddressState::WaitingDns ? ['claimed_at' => now(), 'failed_checks' => 0, 'unreachable_since' => null] : []),
            ])->save();
            $this->forget($address->host);
            ActivityLog::record('portal_address.restored', null, $actor, $address->billingAccount, ['host' => $address->host]);
        }

        return $address;
    }

    /**
     * The account's main address (FR-016): its custom domain while that serves, else its
     * name while that serves, else null for the platform's own portal.
     */
    public function mainFor(BillingAccount $account): ?PortalAddress
    {
        if (! $this->enabled()) {
            return null;
        }
        $serving = $this->for($account)->filter(fn (PortalAddress $address): bool => $address->state === PortalAddressState::Active && $address->serves());

        return $serving->firstWhere('kind', PortalAddressKind::Domain) ?? $serving->firstWhere('kind', PortalAddressKind::Name);
    }

    /**
     * The portal's URL on a host: the platform's portal URL with the host swapped, so a
     * development port and the scheme carry over.
     */
    public function url(PortalAddress|string $address, string $path = ''): string
    {
        $host = $address instanceof PortalAddress ? $address->host : $address;
        $platform = parse_url((string) config('app.frontend_url')) ?: [];
        $port = isset($platform['port']) ? ':'.$platform['port'] : '';

        return ($platform['scheme'] ?? 'https').'://'.$host.$port.($path === '' ? '' : '/'.ltrim($path, '/'));
    }

    public function forget(string ...$hosts): void
    {
        foreach ($hosts as $host) {
            Cache::forget(self::CACHE_PREFIX.self::host($host));
        }
    }

    private function reserved(string $name): bool
    {
        return in_array($name, (array) config('branding.reserved_names'), true)
            || str_starts_with($name, (string) config('branding.claim_prefix'));
    }
}
