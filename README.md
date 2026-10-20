# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## BeeHealthy configuration (M0/M1 foundation)

### Public API origin

Set `EXPO_PUBLIC_API_ORIGIN` to the API **origin only** (scheme + host +
optional port), for example:

```bash
EXPO_PUBLIC_API_ORIGIN=https://api.example.test npx expo start
```

Rules enforced by `lib/config.ts` (`parseApiOrigin`):

- Missing configuration is an error — the app shows a configuration error
  instead of falling back to any backend.
- Paths, queries, fragments, and credentials are rejected.
- Only `https` is accepted, except `http://localhost` (or `127.0.0.1`) for
  local development.
- The client derives `https://<origin>/api` (application API, incl.
  `GET /users/me` and profile `PUT`/`PATCH`/`DELETE /users/me/profile`) and
  `https://<origin>/api/auth` (Better Auth: sign-up, sign-in, `get-session`,
  sign-out). The test stub `/auth/session` is NOT a real endpoint.

Never put database/AWS credentials, USDA keys, auth secrets, or secret ARNs
in `EXPO_PUBLIC_*` variables.

### Auth dependencies

Installed with Expo-compatible resolution (`npx expo install`, no unrelated
upgrades): `better-auth@1.7.10`, `@better-auth/expo@1.7.10`,
`expo-secure-store` (native session cookies under the `beehealthy` storage
prefix, scheme `beehealthy` — see `app.json`). Native transport awaits
`authClient.getCookie()` and sends it as a `Cookie` header with
`credentials: "omit"`; web uses `credentials: "include"` and never touches
cookies manually. No bearer tokens: the backend has no bearer plugin.

### Checks

```bash
npm run lint       # expo lint
npm run typecheck  # tsc --noEmit
npm test           # offline contract tests (origin/path, native-vs-web
                   # credentials, no S3 cookies, 204/non-JSON, auth expiry)
```

These offline tests do not prove live readiness. Live staging (migrations,
secrets, CORS/`AUTH_TRUSTED_ORIGINS`, real devices) requires separate
authorization per `frontend-integration-plan.md` §11.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
