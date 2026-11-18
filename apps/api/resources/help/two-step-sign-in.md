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
    "turn off"
  ],
  "required_capabilities": [],
  "revision": 1,
  "summary": "Turn on two-step sign-in so that, after your password, signing in also asks for a code from an authenticator app on your phone. Save recovery codes for the day you can't use your phone.",
  "questions": [
    "How do I turn on two-step sign-in?",
    "What do I do if I lose my phone?",
    "How do I get new recovery codes?",
    "How do I turn off two-step sign-in?"
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
8. **Turn it off.** On the security page, select **Turn off** and confirm. Your recovery codes stop working and you are signed out on your other devices.

## Expected result
Signing in asks for your password and then a code. You get an email whenever two-step sign-in is turned on or off, recovery codes are made, or a recovery code is used, so you notice if someone else does it.

## Troubleshooting
- **The code is refused.** Codes depend on your phone's clock. Turn on automatic date and time on your phone and try the next code. A code that already signed you in can't be used again; wait for the next one.
- **Back at the password step.** A sign-in waits five minutes and five tries for its code. After that, enter your password again to start over.
- **You lost your phone.** Sign in with a recovery code, then turn two-step sign-in off and set it up again on your new phone, or make new recovery codes.
- **You lost your phone and your recovery codes.** Ask your platform administrator to reset your two-step sign-in. They confirm it's you first; afterwards you sign in with your password and set it up again.
- **A security email you didn't expect.** Change your password straight away and check the security page. Tell your administrator.

## Related guides
[Getting started](/help/getting-started) · [Invite people and manage roles](/help/members)
