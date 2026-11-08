# Note: the SMS allowance is built (spec 028)

Spec 028 FR-025 amends this spec's FR-025: the monthly SMS allowance is the billing
account's, resolved as override, else plan, else the deployment default
(`BILLING_DEFAULT_SMS_ALLOWANCE`). The per-organization allowance typed in by platform
administrators is not built.

The billing side exists (spec 029 PR 4). The SMS sender calls
`App\Domain\Billing\Contracts\SmsAllowance`:

- `reserve($account, $organization, $parts, $at)` before handing a message to Twilio.
  `false` means the parts do not fit: cancel the message with "SMS allowance used up for
  this month". Other channels are unaffected.
- `release($account, $organization, $parts, $reservedAt)` if Twilio refuses the message
  before accepting it.

Verification codes never call it. Billing reads `services.twilio.account_sid` and
`services.twilio.from` (`TWILIO_ACCOUNT_SID`, `TWILIO_FROM`) to decide whether customers
see SMS allowances; the sender should use the same settings. Details:
[docs/features/billing.md](../../docs/features/billing.md#sms-allowance).
