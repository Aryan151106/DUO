# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Together call rooms

The Focus & Study and Movie Night rooms reuse the native WebRTC signaling in
`src/lib/callSignaling.ts`. Copy `.env.example` to `.env.local` and set
`VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` for a TURN
provider. The app includes public fallback relay entries for development, but
production calls should use a private TURN service.

For a self-hosted coturn server, expose UDP/TCP 3478 and TLS 5349, configure a
long-term credential (`lt-cred-mech`), and use a `turns:` URL when possible.
Put the resulting URL and credentials in the local environment used to build
the app; do not commit real credentials. Firebase rules continue to protect the
couple call documents and candidate subcollections.
