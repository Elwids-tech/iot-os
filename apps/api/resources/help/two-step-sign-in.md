---
{
  "slug": "two-step-sign-in",
  "title": "Sign in with two steps",
  "section": "Your account",
  "contexts": [
    "account.security"
  ],
  "keywords": [
    "two-step",
    "two-factor",
    "2fa",
    "mfa",
    "authenticator",
    "authenticator app",
    "code",
    "six-digit code",
    "qr code",
    "setup key",
    "recovery code",
    "recovery codes",
    "lost phone",
    "new phone",
    "security",
    "sign in",
    "turn off",
    "required",
    "require two-step",
    "organization security",
    "passkey",
    "passkeys",
    "touch id",
    "face id",
    "windows hello",
    "fingerprint"
  ],
  "required_capabilities": [],
  "revision": 3,
  "summary": "Turn on two-step sign-in so that, after your password, signing in also asks for a code from an authenticator app on your phone. Save recovery codes for the day you can't use your phone. Or add a passkey and sign in with your fingerprint, face or screen lock alone.",
  "questions": [
    "How do I turn on two-step sign-in?",
    "What do I do if I lose my phone?",
    "How do I get new recovery codes?",
    "How do I turn off two-step sign-in?",
    "How do I sign in with a passkey?",
    "Why am I asked to set up two-step sign-in?",
    "How do I require two-step sign-in for my organization?"
  ]
}
---
## Purpose
Two-step sign-in protects your account if someone learns your password. After your password, signing in also asks for a six-digit code from an authenticator app on your phone. The code changes every 30 seconds, and each one works only once.

## Before you start
Install an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password. You need your password: changing how you sign in asks for it again when you last entered it more than 15 minutes ago.

## Steps
1. **Open the security page.** Open your user menu and choose **Security**. In the administration app, choose **Security settings**.
2. **Set up the app.** Under **Two-step sign-in**, select **Set up** and confirm your password. In your authenticator app, add an account and scan the QR code. If you can't scan it, type the setup key instead.
3. **Confirm a code.** Enter the six-digit code the app shows. Two-step sign-in is on from this moment, and you are signed out on your other devices.
4. **Save your recovery codes.** You see eight recovery codes once. Select **Copy** or **Download** and keep them somewhere safe, away from your phone, such as a password manager. Tick **I have saved these codes** and select **Done**.
5. **Sign in with a code.** Next time, after your password, enter the code your app shows. **Keep me signed in** on the password step still keeps this browser signed in for 30 days.
6. **Use a recovery code.** If you can't use your phone, select **Use a recovery code** on the code step and enter one of your saved codes. Each recovery code works once, and you are told how many are left.
7. **Make new recovery codes.** On the security page, under **Recovery codes**, select **Make new codes**. Every earlier code stops working, so save the new ones.
8. **Turn it off.** On the security page, select **Turn off** and confirm. Your recovery codes stop working and you are signed out on your other devices. When two-step sign-in is required for you, the page says who requires it and you can't turn it off.
9. **Add a passkey.** A passkey signs you in with your fingerprint, face or screen lock instead of a password and code. On the security page, under **Passkeys**, select **Add a passkey**, name it after the device or key that holds it, and follow your browser's prompt. One passkey works in both apps.
10. **Sign in with a passkey.** On the sign-in page, select **Sign in with a passkey**, or pick your passkey from the email field's suggestions. When the code step is showing, select **Use a passkey instead**. A passkey counts as both steps.
11. **Remove a passkey.** On the security page, select **Remove** next to it and confirm. It stops signing you in; remove it from your device's password manager too.
12. **Require it for your organization.** If you manage your organization, open **Settings**, then **Security**, and switch on **Require two-step sign-in**. You need two-step sign-in on your own account first. Members without it are asked to set it up on their next click, and the **Members** list shows who has it. The change appears in the organization's activity.

## Expected result
Signing in asks for your password and then a code, or only your passkey. You get an email whenever two-step sign-in is turned on or off, recovery codes are made, a recovery code is used, or a passkey is added or removed, so you notice if someone else does it.

## Troubleshooting
- **You are asked to set up two-step sign-in before you can continue.** It is required for your account: for platform staff, or by an organization you belong to. Select **Set up** and follow steps 2 to 4, or select **Add a passkey instead** where it is offered; afterwards you return to the page you were opening. You can also select **Sign out**.
- **The code is refused.** Codes depend on your phone's clock. Turn on automatic date and time on your phone and try the next code. A code that already signed you in can't be used again; wait for the next one.
- **Back at the password step.** A sign-in waits five minutes and five tries for its code. After that, enter your password again to start over.
- **You lost your phone.** Sign in with a recovery code, then turn two-step sign-in off and set it up again on your new phone, or make new recovery codes. If two-step sign-in is required for you, you can't turn it off: keep signing in with recovery codes and ask your platform administrator to reset it, then set it up on your new phone.
- **You lost your phone and your recovery codes.** Ask your platform administrator to reset your two-step sign-in. They confirm it's you first; afterwards you sign in with your password and set it up again.
- **No passkey option.** Passkeys need a browser that supports them and a site served over HTTPS. The security page says which is missing. Use your password and code meanwhile.
- **The passkey is not recognized.** It may have been removed from your account, or the site's address changed. Sign in with your password and code, remove the old passkey and add it again.
- **A security email you didn't expect.** Change your password straight away and check the security page. Tell your administrator.

## Related guides
[Getting started](/help/getting-started) · [Invite people and manage roles](/help/members)
