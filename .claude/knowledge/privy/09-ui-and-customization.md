---
description: Privy UI customization (default UI components, whitelabel theming, modal styling, event listeners, multi-dialog handling, React framework adapters). Synthesized from official docs.
---

# Privy UI & Customization

## Source docs synthesized

- `default-ui.md`, `default-ui (1).md` - default UI components for MFA enrollment / verification
- `ui-component.md` - login modal UI component, `useLogin`, parameters, callbacks
- `listener.md`, `listener (1).md` - MFA-required listener pattern across React, RN, Swift, Android
- `whitelabel.md`, `whitelabel (1).md` - per-platform whitelabel guidance, headless hook list
- `customization.md` - dashboard brand settings (name, logo, brand color, legal)
- `styles.md` - corrupted-styles troubleshooting (Sentry)
- `system-theme.md` - prefers-color-scheme detection and theme switching
- `multiple-dialogs.md` - HTML `<dialog>` interop with Radix UI / headless-ui
- `manage-wallet-UIs.md` - `showWalletUIs` global / per-call config
- `react-frameworks.md` - Gatsby, Next.js App Router, CRA, Vite setup
- Spectre repo: `apps/research/src/main.jsx`, `apps/trading/src/main.jsx`,
  `apps/research/src/lib/privy-config.js`, `apps/trading/src/lib/privy-config.js`,
  `.claude/rules/solana-web3.md` section A

## Core concepts

- **Default UI** = Privy's hosted, fully styled modal stack (login, MFA, funding, wallet
  confirmation, export). Driven entirely by hooks - no JSX rendering needed in your tree.
- **Whitelabel** = build your own UI on top of Privy's hooks (`useLoginWithEmail`,
  `useLoginWithSms`, `useLoginWithOAuth`, `useLoginWithPasskey`, `useLoginWithTelegram`,
  `useMfa`). Privy still handles backend / security. React Native, Swift, Android, Unity,
  Flutter are whitelabel by default.
- **Headless** = the strongest form of whitelabel - no Privy UI is ever mounted; you call
  the hooks directly and render everything yourself.
- **Listener pattern** = register a callback (`useRegisterMfaListener` etc.) that Privy
  invokes when a wallet operation requires extra UI (today: MFA).
- **Dashboard branding** = name, logo, brand color, terms / privacy URLs, affirmative
  consent toggle. Drives OTP emails AND the default modal unless overridden in the SDK.

## Default UI components

Privy auto-mounts these as HTML `<dialog>` elements at the root of the document. They
appear when the corresponding hook method is invoked.

| Modal | Triggered by | Notes |
|-------|--------------|-------|
| Login modal | `useLogin().login()` | The main onboarding modal. Lists `loginMethods`. |
| Connect-wallet modal | `useConnectWallet().connectWallet()` | External wallet picker. |
| Funding modal | `useFundWallet().fundWallet()` | Card / exchange / transfer onramp. |
| MFA enrollment modal | `useMfaEnrollment().showMfaEnrollmentModal()` | Enroll / manage MFA methods. |
| MFA verification modal | Automatic on signature / tx when MFA enrolled | Triggered inside `signMessage`, `sendTransaction`, etc. |
| Wallet confirmation modal | Each signature / tx (configurable) | Suppressed via `embeddedWallets.showWalletUIs: false`. |
| Export wallet modal | `useExportWallet().exportWallet()` | Reveal embedded wallet private key. |

Login modal usage (React):

```tsx
import { useLogin, usePrivy } from '@privy-io/react-auth';

function LoginButton() {
    const { ready, authenticated } = usePrivy();
    const { login } = useLogin();
    const disableLogin = !ready || (ready && authenticated);

    return (
        <button disabled={disableLogin} onClick={login}>
            Log in
        </button>
    );
}
```

Login parameters (passed inline or via `useLogin` config):

```tsx
login: ({
  loginMethods: PrivyClientConfig['loginMethods'],
  prefill?: { type: 'email' | 'phone', value: string },
  disableSignup?: boolean,
  walletChainType?: 'ethereum-only' | 'solana-only' | 'ethereum-or-solana'
}) => PrivyUser;
```

Supported `loginMethods` values: `wallet`, `email`, `sms`, `google`, `twitter`,
`discord`, `github`, `linkedin`, `spotify`, `instagram`, `tiktok`, `apple`, `farcaster`,
`telegram`, `line`, `passkey`.

Login callbacks:

```tsx
import { useLogin } from '@privy-io/react-auth';

function LoginButton() {
    const { login } = useLogin({
        onComplete: ({ user, isNewUser, wasAlreadyAuthenticated, loginMethod, loginAccount }) => {
            console.log('User logged in successfully', user);
            console.log('Is new user:', isNewUser);
            console.log('Was already authenticated:', wasAlreadyAuthenticated);
            console.log('Login method:', loginMethod);
            console.log('Login account:', loginAccount);
        },
        onError: (error) => {
            console.error('Login failed', error);
        }
    });

    return <button onClick={login}>Log in</button>;
}
```

`onComplete` callback parameters:

- `user`: `PrivyUser` with DID, linked accounts, etc.
- `isNewUser`: `boolean` - first login vs returning user.
- `wasAlreadyAuthenticated`: `boolean` - true if mounted with an existing session.
- `loginMethod`: `string | null` - one of `email`, `sms`, `siwe`, `apple`, `discord`,
  `github`, `google`, `linkedin`, `spotify`, `tiktok`, `twitter`, `farcaster`, `passkey`,
  `telegram`, `line` (or `null` if already authenticated).
- `loginAccount`: account object with `type` (`wallet`, `email`, `phone`, `*_oauth`,
  `custom_auth`, `farcaster`, `passkey`).

`onError` fires on login failures AND when the user dismisses the modal mid-flow.

React Native login (Expo SDK):

```tsx
import { useLogin } from '@privy-io/expo/ui';

function LoginButton() {
    const { login } = useLogin();

    return (
        <Button
            onPress={() => {
                login({ loginMethods: ['email', 'sms']})
                    .then((session) => {
                        console.log('User logged in', session.user);
                    })
            }}
            title="Log in"
        />
    );
}
```

React Native supports `appearance.logo` per-call (2:1 aspect ratio). Supported RN
loginMethods: `email`, `sms`, `google`, `discord`, `twitter`, `github`, `spotify`,
`instagram`, `tiktok`, `linkedin`, `apple`.

OAuth providers in RN require URL-scheme configuration in the App Client settings -
without it, login fails silently with "Authentication failed".

## Appearance config (provider config)

Full schema of the `appearance` block passed to `PrivyProvider` config:

- `theme`: `'light' | 'dark' | string` (string is a hex color used as background base).
- `accentColor`: hex string. Applies to links and primary buttons.
- `logo`: hosted URL (2:1 recommended). SVG is rejected because OTP emails do not support
  it - dashboard logo must be raster, but the SDK override can be raster or other.
- `walletList`: ordered array of `WalletListEntry` IDs. Only IDs in the union render -
  unsupported IDs are silently dropped. Common entries: `detected_ethereum_wallets`,
  `detected_solana_wallets`, `detected_wallets`, `metamask`, `phantom`, `coinbase_wallet`,
  `backpack`, `solflare`, `okx_wallet`, `safe`, `zerion`, `rainbow`, `wallet_connect`.
- `landingHeader`: copy at the top of the login modal.
- `loginMessage`: subline below the header.
- `showWalletLoginFirst`: `boolean`. When `true`, wallet tiles render before social tiles.
- `walletChainType`: `'ethereum-only' | 'solana-only' | 'ethereum-and-solana'` -
  filters the connect-wallet modal.

Login-method ordering uses one of two APIs:

- v1 (legacy): `loginMethods: ['email', 'google', ...]` - flat ordered array.
- v2: `loginMethodsAndOrder: { primary: [...], overflow: [...] }` - explicit primary
  vs overflow grouping. Primary methods render as large tiles; overflow methods are
  grouped under a "more" expander.

Embedded-wallet config:

```tsx
embeddedWallets: {
  ethereum: { createOnLogin: 'users-without-wallets' | 'off' | 'all' },
  solana: { createOnLogin: 'users-without-wallets' | 'off' | 'all' },
  showWalletUIs: boolean, // global confirmation modal toggle (see below)
}
```

Funding ordering (mirrors login):

```tsx
fundingMethodsAndOrder: {
  primary: ['card'],
  overflow: ['exchange', 'transfer'],
}
```

## Theming deep dive

`appearance.theme` accepts:

- `'light'` - Privy's stock light theme.
- `'dark'` - Privy's stock dark theme.
- Any hex string (e.g. `'#0c0c0e'`) - treated as the modal background base color. Privy
  derives accent contrasts automatically.

`appearance.accentColor` overrides the action color independent of theme - typically used
to keep the button color brand-consistent across light and dark variants.

Privy does NOT expose CSS variables or class-name slots on its hosted modal. Any deeper
visual customization (typography, radius, spacing) requires either:

1. The whitelabel approach (build your own UI using the headless hooks below), OR
2. DOM-mutation hacks against the `#privy-modal-content` element (fragile; see Spectre
   notes below).

## System theme

Detect OS preference and pass the appropriate config object to `PrivyProvider`:

```tsx
import {useEffect, useState} from 'react';

// Returns true if the user prefers dark mode, and false otherwise
export default function useDarkMode() {
  const [darkMode, setDarkMode] = useState(false);

  const modeMe = (e: MediaQueryListEvent) => {
    setDarkMode(!!e.matches);
  };

  useEffect(() => {
    // Query the `prefers-color-scheme` media feature
    const matchMedia = window.matchMedia('(prefers-color-scheme: dark)');
    setDarkMode(matchMedia.matches);
    // Listen to changes in the `prefers-color-scheme` media feature
    matchMedia.addEventListener('change', modeMe);
    return () => matchMedia.removeEventListener('change', modeMe);
  }, []);

  return darkMode;
}
```

Build a light and a dark config:

```tsx
const lightModeConfig = {
  appearance: {
    theme: 'light',
    logo: 'light-logo-url'
  }
};

const darkModeConfig = {
  appearance: {
    theme: 'dark',
    logo: 'dark-logo-url'
  }
};
```

Swap them on the provider:

```tsx
const darkMode = useDarkMode();
const lightModeConfig = { /* your light config */ };
const darkModeConfig = { /* your dark config */ };

return (
  <PrivyProvider appId={'your-app-ID'} config={darkMode ? darkModeConfig : lightModeConfig}>
    {children}
  </PrivyProvider>
);
```

The same swap-the-config-object pattern works for any other branding signal (active
workspace, route, A/B test bucket).

## Whitelabel mode

Whitelabel means you keep Privy for backend / security but build every login screen
yourself. Each flow has a dedicated hook.

Email (passwordless):

```tsx
import {useLoginWithEmail} from '@privy-io/react-auth';

const {sendCode, loginWithCode} = useLoginWithEmail();
sendCode({email: 'test@test.com'});
loginWithCode({code: '123456'});
```

SMS (passwordless):

```tsx
import {useLoginWithSms} from '@privy-io/react-auth';

const {sendCode, loginWithCode} = useLoginWithSms();
sendCode({phoneNumber: '+1234567890'});
loginWithCode({code: '123456'});
```

OAuth socials:

```tsx
import {useLoginWithOAuth} from '@privy-io/react-auth';

const {initOAuth} = useLoginWithOAuth();
initOAuth({provider: 'google'});
```

Passkeys:

```tsx
import {useLoginWithPasskey} from '@privy-io/react-auth';

const {loginWithPasskey} = useLoginWithPasskey();
loginWithPasskey();
```

Passkey signup (separate hook):

```tsx
import {useSignupWithPasskey} from '@privy-io/react-auth';

const {signupWithPasskey} = useSignupWithPasskey();
signupWithPasskey();
```

Link a passkey to an existing user:

```tsx
import {useLinkWithPasskey} from '@privy-io/react-auth';

const {linkWithPasskey} = useLinkWithPasskey();
linkWithPasskey();
```

Telegram:

```tsx
import {useLoginWithTelegram} from '@privy-io/react-auth';

const {login, state} = useLoginWithTelegram();
login();
```

MFA in whitelabel mode follows the custom-UI guide. Each hook exposes a `state` object
your UI can read to render the current flow step (sending-code, awaiting-code, success,
error). Privy still handles rate-limiting, OTP delivery, and key material.

Outside React, whitelabel is the default mode - React Native, Swift, Android, Unity,
and Flutter SDKs ship without a default UI and expect you to drive the flow yourself.

## Listener / event hooks

The only first-class listener today is `useRegisterMfaListener`, which Privy invokes
whenever an embedded-wallet operation requires MFA. Your callback must drive the user
through verification (typically a modal you control) and then Privy resumes the paused
operation.

```tsx
import {useRegisterMfaListener, MfaMethod} from '@privy-io/react-auth';

import {MFAModal} from '../components/MFAModal';

export const MFAProvider = ({children}: {children: React.ReactNode}) => {
  const [isMfaModalOpen, setIsMfaModelOpen] = useState(false);
  const [mfaMethods, setMfaMethods] = useState<MfaMethod[]>([]);

  useRegisterMfaListener({
    // Privy will invoke this whenever the user is required to complete MFA
    onMfaRequired: (methods) => {
      // Update app's state with the list of available MFA methods for the user
      setMfaMethods(methods);
      // Open MFA modal to allow user to complete MFA
      setIsMfaModalOpen(true);
    },
  });

  return (
    <div>
      <MFAModal isOpen={isMfaModalOpen} setIsOpen={setIsMfaModalOpen} mfaMethods={mfaMethods} />
      {children}
    </div>
  );
};
```

The component calling `useRegisterMfaListener` must be mounted whenever the embedded
wallet may be used - render it near the root of the app. Otherwise Privy has no UI
target and signs / sends will hang.

The recommended MFA modal abstraction (from the official sample) uses `useMfa` and the
error-discriminator helpers `errorIndicatesMfaVerificationFailed`,
`errorIndicatesMfaMaxAttempts`, `errorIndicatesMfaTimeout`. The modal calls
`init(method)` to request the code, `submit(method, code)` to verify, and `cancel()`
on dismiss. Passkey method uses the response from `init` as the submit payload; other
methods use a numeric code string. The three error helpers route the failure into
"retry-same-code", "request-new-code", or "code-expired" states. Pattern source:
official Privy docs, `listener.md`, accordion "See a recommended abstraction".

For non-MFA login outcomes, use the `useLogin({ onComplete, onError })` callbacks shown
above. There is no `onModalClose` / `onModalOpen` hook today - dismissal is surfaced via
the `onError` path.

The React / React Native SDKs require the listener for MFA - they do NOT support
inline error catching the way Swift and Android do. On Swift / Android you can `try`
the wallet call, catch `mfaRequired`, prompt the user, then retry:

```swift
do {
    let signature = try await wallet.provider.signMessage(message: message)
} catch PrivyError.embeddedWalletFailure(reason: .mfaRequired(let user)) {
    let totpCode = await showMfaPromptAndGetCode()
    try await user.mfa.totp.verify.submit(code: totpCode)
    let signature = try await wallet.provider.signMessage(message: message)
}
```

Equivalent Kotlin uses `MfaRequiredOrInvalidException` and `Result` types.

## Multiple dialogs

The Privy modal is a native HTML `<dialog>` element appended to the document body. It
interacts with focus traps and overlay stacks from third-party UI libraries.

General guidance from the docs:

- Avoid UIs that stack a modal on top of another modal - users can only interact with
  one at a time, and the experience is jarring.
- The `Dialog` component from `headlessui` works out of the box with Privy.

For Radix UI dialogs, two modifications are required:

1. Prevent Radix from closing on outside-click via `onPointerDownOutside`.
2. Disable Radix's global focus trap with `<FocusScope trapped={false}>` from
   `@radix-ui/react-focus-scope`.

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import {FocusScope} from '@radix-ui/react-focus-scope';

<Dialog.Root>
  ...
  <Dialog.Portal>
    <Dialog.Overlay />
    {/* This wrapper prevents the Radix dialog from stealing focus away from other dialogs in the page. */}
    <FocusScope trapped={false}>
        {/* The `onPointerDownOutside` handler prevents Radix from closing the dialog when the user clicks outside. */}
      <Dialog.Content
        onPointerDownOutside={(e) => e.preventDefault()}
      />
        ...
      </Dialog.Content>
    </FocusScope>
  </Dialog.Portal>
<Dialog.Root>
```

Z-index considerations: Privy's `<dialog>` lives in the top-layer browser stack and
will render above any z-indexed element. If you need to layer your own dialog above
Privy, use a `<dialog>` element (it shares the top layer) rather than a positioned div.

## Manage wallet UIs

Privy by default shows a confirmation modal on every signature / transaction. You can
disable this globally or per-call.

Dashboard: **Configuration > Authentication > Advanced** -> "Disable confirmation modals".

`PrivyProvider` config (overrides dashboard):

```tsx
<PrivyProvider
  config={{
    embeddedWallets: {
      showWalletUIs: false
    }
    /** ... */
  }}
>
  <App />
</PrivyProvider>
```

Per-call override (overrides provider config) - pass `uiOptions.showWalletUIs` to any
of:

- Ethereum: `signMessage`, `signTransaction`, `signTypedData`, `sendTransaction`.
- Solana: `signAndSendTransaction`, `signTransaction`, `signMessage`.

Override precedence is per-call > provider > dashboard.

Disabling wallet UIs is appropriate when:

- You are building a swap / trading flow where confirmation is shown in your own UI
  (so Privy's modal would be redundant).
- You are batching many signatures (e.g. allowance + swap) and don't want a modal
  per step.

It is NOT appropriate when:

- The wallet is also linked to external app integrations where the user expects per-op
  confirmation.
- MFA is enrolled - MFA verification UIs are unaffected by `showWalletUIs` and will
  still render, but suppressing the surrounding confirmation modal can confuse users.

## React framework specifics

### Vite (our stack)

Privy depends on `@coinbase/wallet-sdk` which references the Node `process` global.
Without polyfills you hit:

```
Uncaught (in promise) ReferenceError: process is not defined
  at ../../../node_modules/@coinbase/wallet-sdk/dist/CoinbaseWalletSDK.js
```

Install `vite-plugin-node-polyfills`:

```sh
npm i --save-dev vite-plugin-node-polyfills
```

```ts
import {defineConfig} from 'vite';
import {nodePolyfills} from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [nodePolyfills()]
});
```

Optional Solana peer-dep workaround (only if NOT using Solana): alias
`@solana-program/system` to a shim:

```ts
import {fileURLToPath, URL} from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@solana-program/system': fileURLToPath(
        new URL('./src/shims/solana-program-system.ts', import.meta.url)
      )
    }
  }
});
```

```ts
// src/shims/solana-program-system.ts
export function getTransferSolInstruction() {
  throw new Error(
    '@solana-program/system is not installed. Install Solana peer dependencies if you use Solana wallets.'
  );
}
```

If your app DOES use Solana, install the real peer deps from the React installation
guide instead of aliasing.

### Next.js App Router

`PrivyProvider` is a client React context with mounted UI elements. Wrap it inside a
client component:

```tsx
// components/providers.tsx
'use client';

import {PrivyProvider} from '@privy-io/react-auth';

export default function Providers({children}: {children: React.ReactNode}) {
  return <PrivyProvider appId="insert-your-privy-app-id">{children}</PrivyProvider>;
}
```

Use it from the server `RootLayout`:

```tsx
import Providers from '../components/providers';

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

Reference repo: `privy-io/examples/tree/main/privy-next-starter`.

### Gatsby

Use `wrapPageElement`, NOT `wrapRootElement`. `PrivyProvider` ships UI elements
(`<dialog>` and an iframe for embedded wallets) and Gatsby's root wrapper does not run
on every page render the way the page wrapper does. Using `wrapRootElement` causes
`iframe not initialized` errors.

```tsx
// gatsby-browser.tsx
import React from 'react';

import {PrivyProvider} from '@privy-io/react-auth';

export const wrapPageElement = ({element}) => {
  return <PrivyProvider appId={'insert-your-app-id'}>{element}</PrivyProvider>;
};
```

### Create React App

CRA's Webpack 5 strips Node polyfills - many web3 deps need them back. Install:

```sh
npm i --save-dev react-app-rewired assert buffer process stream-browserify url
```

Update `package.json` scripts:

```json
{
    "scripts": {
        "start": "react-app-rewired start",
        "build": "react-app-rewired build",
        "test": "react-app-rewired test",
        "eject": "react-scripts eject"
    }
}
```

Drop a `config-overrides.js` at the repo root:

```js
const webpack = require('webpack');
module.exports = function override(config) {
  config.resolve.fallback = {
    assert: require.resolve('assert'),
    buffer: require.resolve('buffer'),
    'process/browser': require.resolve('process/browser'),
    stream: require.resolve('stream-browserify'),
    url: require.resolve('url'),
    http: false,
    https: false,
    os: false
  };
  config.plugins.push(
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    })
  );
  config.ignoreWarnings = [/Failed to parse source map/];
  return config;
};
```

### Remix / others

No dedicated guidance in the official UI docs - treat them like Next.js App Router
(wrap the provider in a client / browser-only component). Vite-based Remix benefits
from the same `vite-plugin-node-polyfills` setup.

### React Native (Expo)

Wrap your app with `PrivyProvider` (from `@privy-io/expo`) AND mount `PrivyElements`
at the root if you want the default MFA / verification UIs:

```tsx
import {PrivyElements} from '@privy-io/expo/ui';

export default function RootLayout() {
  return (
    <>
      {/* Your app's content */}
      <PrivyElements config={{mfa: {enableMfaVerificationUIs: true}}} />
    </>
  );
}
```

OAuth requires URL-scheme registration in the App Client settings.

## Dashboard branding

Dashboard path: **Configuration > UI components**.

- **Name** - product name shown in OTP messages and modal copy.
- **Logo** - 2:1 aspect, ~180x90 px raster. SVG is rejected because OTP email clients
  do not support it reliably. Used in OTP emails AND the default modal (unless the SDK
  overrides via `appearance.logo`).
- **Brand color** - hex, applied to links and primary buttons in Privy UIs.
- **Terms & conditions** - public URL. Shown during login if set.
- **Privacy policy** - public URL. Shown during login if set.
- **Require affirmative consent** - toggle. When enabled, users see an explicit consent
  step on first login. When disabled, legal links are still surfaced but not gated.

The dashboard logo is the email logo; the SDK logo is the modal logo. Always set both.

## UI component primitives

Privy does not ship a public component library (no `<LoginButton />`, no `<UserMenu />`
exports). All UI surfacing is driven through hooks:

- `useLogin` - opens the login modal.
- `useLogout` - signs the user out (no UI).
- `useConnectWallet` - opens the external-wallet picker.
- `useLinkAccount` family - link additional methods to a logged-in user.
- `useFundWallet` - opens funding modal.
- `useExportWallet` - opens the export-key modal.
- `useMfaEnrollment` - opens the MFA enrollment modal.
- `useMfa` - low-level MFA prompt / init / submit / cancel.
- `usePrivy` - state (`ready`, `authenticated`, `user`, `logout`, `getAccessToken`).

If you want your own polished components, build them with these hooks (whitelabel
approach). The official repo has reference designs in `privy-io/examples`.

## Code patterns (verbatim)

### Dark-mode modal with brand accent (config object)

```tsx
const privyConfig = {
  appearance: {
    theme: '#0c0c0e',
    accentColor: '#18181b',
    logo: '/your-dark-logo.png',
    landingHeader: 'Sign in to Your App',
    loginMessage: 'Your tagline goes here.',
  },
};
```

### System-aware theme switching

```tsx
const darkMode = useDarkMode();
const lightModeConfig = { appearance: { theme: 'light', logo: 'light-logo-url' } };
const darkModeConfig = { appearance: { theme: 'dark', logo: 'dark-logo-url' } };

return (
  <PrivyProvider appId={'your-app-ID'} config={darkMode ? darkModeConfig : lightModeConfig}>
    {children}
  </PrivyProvider>
);
```

### Listen for login success and trigger analytics

```tsx
import { useLogin } from '@privy-io/react-auth';
import { track } from '@/services/analytics';

function LoginButton() {
  const { login } = useLogin({
    onComplete: ({ isNewUser, loginMethod }) => {
      track('login_complete', { isNewUser, loginMethod });
    },
    onError: (error) => {
      track('login_error', { message: String(error) });
    },
  });
  return <button onClick={login}>Sign in</button>;
}
```

### Coordinate Privy modal with a Radix modal

```tsx
import * as Dialog from '@radix-ui/react-dialog';
import { FocusScope } from '@radix-ui/react-focus-scope';

<Dialog.Root>
  <Dialog.Portal>
    <Dialog.Overlay />
    <FocusScope trapped={false}>
      <Dialog.Content onPointerDownOutside={(e) => e.preventDefault()}>
        {/* your content */}
      </Dialog.Content>
    </FocusScope>
  </Dialog.Portal>
</Dialog.Root>
```

### Disable wallet confirmation modal globally

```tsx
<PrivyProvider
  config={{
    embeddedWallets: { showWalletUIs: false },
  }}
>
  <App />
</PrivyProvider>
```

### Vite + React Router setup (minimal)

```tsx
// main.jsx
import { Buffer } from 'buffer';
window.Buffer = Buffer;

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <PrivyProvider appId={import.meta.env.VITE_PRIVY_APP_ID} config={{ appearance: { theme: 'dark' } }}>
        <App />
      </PrivyProvider>
    </BrowserRouter>
  </StrictMode>
);
```

## Spectre-specific notes

### Current implementation

Both apps currently DO use `appearance.theme` (set to `'#0c0c0e'`), `accentColor`
(`'#18181b'`), `logo`, `landingHeader`, `loginMessage`, `walletChainType`, and a
curated `walletList`. They do NOT use whitelabel - the default login modal is what
users see.

Two DOM-mutation hacks live in `main.jsx` of both apps because Privy does not expose
config for the underlying behaviors:

1. **Auto-click "Continue with Email" tile** so the email input is shown by default.
   Targets `#privy-modal-content` and finds `button.login-method-button` with text
   matching `/Continue with Email/i`. Defers the click with `setTimeout(..., 50)` to
   let Privy finish its initial render. Tracks a `clickedFor = modal` ref so the hack
   only fires once per modal mount.

2. **Make the wallet list scrollable**. Privy renders the "Select your wallet" screen
   with `react-window` virtualization. The list has 612 entries but Privy pre-renders
   only ~11-14 (the popular ones) and the scroll listener is attached to a higher
   ancestor (the L2 wrapper). The patch walks up two levels from a wallet-row button
   (`offsetWidth > 200` AND label matching `/MetaMask|Phantom|Coinbase|Wallet/i`),
   makes that wrapper scrollable, and caps Privy's `react-window` placeholder height
   to the actual rendered content so the layout doesn't break.

Research's version of the hack also handles Solana-specific selectors. Trading's
version is simpler (no Solana split in `detected_wallets`).

### Provider mounting guard

Both apps conditionally skip `PrivyProvider` when `VITE_PRIVY_APP_ID` is empty - the
SDK throws on missing appId. Research additionally suppresses Privy when iframed in
showcase mode (Privy's internal auth iframe enforces its own session and the showcase
demo never needs wallet auth).

```jsx
{PRIVY_APP_ID && !isShowcaseEmbed ? (
  <PrivyProvider appId={PRIVY_APP_ID} config={privyConfig}>
    {appTree}
  </PrivyProvider>
) : appTree}
```

### Config differences between apps

| Setting | Research | Trading |
|---------|----------|---------|
| Login API | `loginMethodsAndOrder` (v2 primary/overflow split) | `loginMethods` (v1 flat array) |
| Solana external wallets | `toSolanaWalletConnectors` from `@privy-io/react-auth/solana` (`shouldAutoConnect: false`) | None |
| Detected wallets entry | Separate `detected_ethereum_wallets` + `detected_solana_wallets` | Generic `detected_wallets` |
| Embedded wallet creation | ETH + SOL on signup | ETH + SOL on signup |
| `walletChainType` | `'ethereum-and-solana'` | `'ethereum-and-solana'` |
| `showWalletUIs` config | Not set (default = show) | Not set (default = show) |

The v1 vs v2 login API discrepancy is intentional per the trading app CLAUDE.md - the
trading app's flow has not been re-verified against v2 yet.

### Listener pattern (or lack thereof)

We do NOT use `useRegisterMfaListener` - MFA is not enabled in either app. We do NOT
use Privy's `onComplete` callback for login analytics - we listen via PostHog from a
`useEffect` watching `authenticated` instead:

```jsx
useEffect(() => {
  if (authenticated && user) {
    track(Events.LOGIN, { ... });
  }
}, [authenticated, user]);
```

This is acceptable but less precise than `onComplete` (it can't distinguish new vs
returning users without extra logic). Migrating to `onComplete` would be a clean win.

### Wallet confirmation modals

Neither app sets `embeddedWallets.showWalletUIs`. That means swap and send flows currently
show Privy's confirmation modal AND our own confirmation UI - a double prompt. We
should consider `showWalletUIs: false` once our UI is the canonical confirmation step.

### Whitelabel status

We do NOT use whitelabel. Whitelabel is a hook-based pattern available on the free
plan - there is no pricing gate, just engineering effort. If we move to a whitelabel
login modal we can drop both DOM hacks (auto-click email tile, wallet-list scroll).

### React framework

Both apps are Vite + React 18. Research uses `react-router-dom` v7. Trading has no
router (hash-based view switching in `App.jsx`). Both work with Privy. We use
`vite-plugin-node-polyfills` already.

### Implications for audit

- Configure `appearance.theme` and `accentColor` matching our brand - done.
- Configure `appearance.walletList` to surface email-friendly wallets first - done in
  both apps, but the curated lists drift apart (research splits `detected_*` while
  trading uses generic `detected_wallets`). Pick one source of truth.
- Migrate trading from v1 `loginMethods` to v2 `loginMethodsAndOrder` for parity (only
  after testing Solana wallet flow per the trading CLAUDE.md note).
- Eliminate the auto-click-email DOM hack by using `loginMethodsAndOrder.primary:
  ['email', ...]` and confirming Privy renders email as a non-collapsed tile by default.
  If the tile collapse is a Privy product decision, file a feature request rather than
  shipping more DOM mutation.
- Eliminate the wallet-list scroll hack by reducing `walletList` to ~10 entries (we
  already do) AND configuring the modal to not virtualize when the list is short. If
  Privy still virtualizes, file a bug.
- Replace the `useEffect(authenticated)` analytics pattern with `useLogin({ onComplete })`
  for accurate `isNewUser` + `loginMethod` tracking.
- Consider `embeddedWallets.showWalletUIs: false` to deduplicate the swap confirmation.

## Gotchas & pitfalls

- `appearance.walletList` order matters - first entry renders first. Unsupported IDs are
  silently dropped (`binance` is in the TypeScript union but the runtime drops it because
  the asset is missing from the bundle - Binance users go through `wallet_connect`).
- `appearance.theme` accepts a hex string, but the rendered modal samples it once at
  mount. Hot reloads may show the previous theme until you reload the page.
- The login modal closes on outside click by default - there is no config to prevent
  this. If you need a sticky modal (e.g. during MFA), the listener pattern keeps the
  flow alive even if the user dismisses the visual.
- Z-index: Privy's modal is a real `<dialog>` element living in the browser top layer,
  so plain z-indexed app modals will always render BELOW it. Use a `<dialog>` (or
  headless-ui Dialog) for your own modals if you need to stack them above Privy.
- DOM hacks (like our auto-click-email and wallet-list scroll) target Privy's internal
  DOM (`#privy-modal-content`, `button.login-method-button`, react-window L2 wrapper).
  These break silently on any Privy update that changes the markup. Prefer config /
  whitelabel.
- React 18 `StrictMode` double-mounts components in dev, which double-fires hook
  effects. This can cause double `onComplete` invocations in development - production
  is unaffected. Trading's CLAUDE.md notes intentional StrictMode handling.
- SSR frameworks (Next.js App Router, Remix) require the provider in a client
  component. Server-rendering the provider crashes.
- Vite hot reload occasionally re-mounts `PrivyProvider` and triggers re-hydration,
  briefly flipping `ready` to `false`. Components calling `useWallets` / `useFundWallet`
  / `useConnectWallet` / `useSendTransaction` crash if called before hydration - defer
  them to child components that mount on user action (see `solana-web3.md` section A).
- Whitelabel does NOT require Privy review or a paid plan - it is just a different
  integration path.
- `appearance.logo` must be a hosted URL. Importing a local image and passing it as a
  blob URL works in dev but breaks in build (Vite hashes the asset). Use `/public`
  paths.
- The dashboard logo (used in OTP emails) cannot be SVG - many mail clients drop SVG.
  Use raster.
- Sentry's React / Next.js integration < 7.74.0 corrupts Privy's modal styles. Upgrade
  Sentry above 7.74.0 to fix.
- `getAccessToken` returns a new function reference each render - putting it in a
  `useEffect` dep array causes infinite loops. Stash in `useRef` (see solana-web3.md
  section A "The getAccessToken useRef pattern").

## Cross-references

- Login methods config (per-flow detail) -> `01-auth-and-identity.md`.
- Embedded wallet list config and chain coverage -> `02-embedded-wallets.md`.
- Funding modal configuration and ordering -> `07-funding-and-onramp.md`.
- Migrating modal API (v1 `loginMethods` vs v2 `loginMethodsAndOrder`) ->
  `12-migrations-and-changelog.md`.
- Current Spectre Privy implementation details -> `spectre/current-implementation.md`.
- Patterns for working around modal limitations -> `spectre/patterns.md`.
- Provider mounting, hook-before-hydration crashes, `getAccessToken` ref pattern ->
  `.claude/rules/solana-web3.md` section A.
