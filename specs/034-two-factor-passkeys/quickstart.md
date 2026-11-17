# Quickstart: Verifying Two-Step Sign-In and Passkeys

These are the checks each implementation pull request runs on the local stack before
it is reported done (constitution IX). Routes and payloads are in
[contracts/auth-api.md](contracts/auth-api.md).

## Prerequisites

- The dev stack is running (`./taskw devices:up`), and the API family, `portal` and
  `admin` have been rebuilt from the branch. Take the stack rebuild lock first.
- There are two test people: one plain member, and one platform administrator. They
  are created with the existing seeders or the admin app, and their passwords come
  from the seed files.
- An authenticator app or a command-line TOTP tool. To make a code from a setup key
  without a phone:

  ```bash
  rtk proxy docker compose exec api php -r 'require "vendor/autoload.php"; echo (new PragmaRX\Google2FA\Google2FA)->getCurrentOtp("SETUPKEY"), PHP_EOL;'
  ```

- For passkeys, use either Chrome's virtual authenticator (DevTools → More tools →
  WebAuthn, or the Playwright `WebAuthn.addVirtualAuthenticator` call the end-to-end
  specs use), or Touch ID on a Mac. `localhost` counts as a secure origin.

## US1: Authenticator app

1. Sign in to the portal as the member and open **Account → Security**. Choose
   **Set up**, confirm the password, scan the code or copy the setup key, and enter a
   code.
   - **Expect**: eight recovery codes appear once, and an email reaches Mailpit.
   - **Expect**: an activity entry `person.two_step_enabled` is visible in the admin
     app's activity timeline for that person.
2. Sign in on a second browser first, then turn two-step on. The second browser is
   signed out on its next request.
3. Sign out and sign in again. The password step answers `202`, and the code step
   appears.
   - A wrong code shows the attempts left.
   - The same valid code entered twice signs in only once.
   - Five wrong codes send the person back to the password.
4. Sign in with a recovery code.
   - **Expect**: "7 recovery codes left", the code fails on its second use, and an
     email and activity entry are written.
5. Tick **Keep me signed in**, complete both steps, close the browser and reopen it.
   - **Expect**: the person is still signed in, with no password and no code asked
     (spec 033).
6. Open the admin app's sign-in page and repeat step 3. It asks for the code the same
   way.
7. Reset the password through **Forgot password** and sign in with the new one.
   - **Expect**: the code is still asked.
8. Regenerate the recovery codes (the old ones fail), then turn two-step off. Both
   need the password and both send an email.

## US2: Passkeys

1. On **Account → Security**, add a passkey named "Virtual key". It appears with its
   creation time, and an email is sent.
2. Sign out, then choose **Sign in with a passkey** on the portal, and again on the
   admin app.
   - **Expect**: the person is signed in without a password or code, and
     **Last used** updates.
3. Remove the passkey. It no longer signs in, and an email names it.
4. Passkey availability is decided by the API from its front-end URLs, so changing
   them on the dev stack would also break its cookies. Check it in two parts:
   - the feature tests from tasks T042 and T043 run with an `http://` front-end URL
     and expect `unavailable_reason: "not_https"` and `404` on both option routes;
   - `passkeys.spec.ts` answers `me/security` with `not_https` and expects
     **Account → Security** to say passkeys need HTTPS, no passkey button on the
     sign-in page, and codes still working.
5. Make a person required (as in US3) who has a passkey and no authenticator app, and
   sign in with their password.
   - **Expect**: the `202` lists only `passkey`, the sign-in page asks for the passkey,
     and no session exists until it is used.

## US3: Required two-step

1. Sign in as the platform administrator, who has no two-step set up.
   - **Expect**: the setup screen appears, every other request returns
     `two_step_setup_required`, and both apps open normally after setup.
2. As an organization administrator with two-step on, open organization settings →
   **Security** and require two-step.
   - **Expect**: a member without it, who is already signed in, is sent to setup on
     their next click.
   - **Expect**: the member list shows a **Two-step** column.
   - **Expect**: `organization.two_step_required_changed` appears in that
     organization's activity.
3. As an organization administrator without two-step, try to require it. You are told
   to set up your own first.
4. Invite a new person to the organization that requires two-step and accept the
   invitation. Setup appears before the app does.
5. Check that an agent connection and an integration application token for a person
   who is required but not set up still work (`/mcp` and integration routes do not
   answer `two_step_setup_required`).
6. Sign in as a member of a second organization. They cannot read or change the first
   organization's security setting (`404`).

## US4: Lock-out help

1. In the admin app, open the member under **Users**, choose **Reset two-step**, and
   give a reason.
   - **Expect**: their codes and passkeys stop working, and their sessions end.
   - **Expect**: they get an email.
   - **Expect**: the activity entry shows the administrator and the reason.
2. Try the same on your own account. It is refused.
3. Run the server reset:

   ```bash
   rtk proxy docker compose exec api php artisan auth:reset-two-step member@example.test --reason="quickstart"
   ```

   **Expect**: the same result, and the activity entry has `source: console`.

## No internet (SC-004)

Run the US1 and US3 end-to-end specs with the API container's outbound traffic
blocked. Disconnect it from every network except the stack's internal one, or use the
compose override from the plan's verification notes.

- **Expect**: they pass, and the API logs show no outbound connection attempts.
