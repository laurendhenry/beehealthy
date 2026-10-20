# BeeHealthy frontend

Expo SDK 54 / React Native application backed by the BeeHealthy API.

## Configuration

Set `EXPO_PUBLIC_API_ORIGIN` to the backend **origin only** (scheme, host, optional port):

```bash
EXPO_PUBLIC_API_ORIGIN=https://api.example.test npm start
```

The client derives `/api` for application endpoints and `/api/auth` for Better Auth. Missing configuration is an error, not a switch to mock data. Paths, credentials, queries, and fragments are rejected. HTTPS is required except for localhost development. A physical device's localhost is not your computer, and `backend`'s watch command is not an HTTP server.

Never put database credentials, AWS credentials, USDA keys, or auth secrets in `EXPO_PUBLIC_*` variables.

## Backend-connected behavior

- Sign up/sign in before accessing account data. Native requests use the current Better Auth session cookie from SecureStore; web uses browser-managed cookies.
- Scan a receipt by selecting an image, uploading its bytes to the backend-provided storage URL, and requesting backend parsing. Review the extracted fields before confirming.
- Example receipt fields are explicitly sample input, not OCR results. Confirming an example creates a real receipt in your account through the same backend confirmation endpoint. It affects pantry inventory just like any other confirmed receipt; delete it from receipt history to remove it and its associated pantry inventory.
- Confirmation is successful only after the API returns a confirmed receipt. Backend failures remain visible and do not become local success.
- An interrupted manual confirmation retains its exact request and idempotency key across restarts so it can be retried without inventing local success. If recovery metadata cannot be read, the recovery controls direct you to history before explicitly clearing the pending retry; clearing it does not undo backend changes.
- Receipt history and detail load persisted server records and allow returning to unfinished receipt processing/review. Unsaved field edits and an unuploaded selected photo are transient UI state, not a durable offline queue.
- Home, pantry, profile preferences, food matching, saved/dismissed swaps, and recommendations use backend data. Mutations invalidate affected views; refresh reloads server state. There is no mock fallback when requests fail.
- Basket counts represent currently available pantry items, not food eaten or cumulative purchase quantities. Catalog-dependent results may legitimately be empty.

Signed storage requests do not carry application cookies or idempotency headers. Confirmation and upload allocation use stable idempotency keys; retrying a confirmation with an unknown outcome must retain its original payload/key rather than create a second receipt. Pantry consumption is not idempotent and must be reconciled by refetching after an ambiguous failure.

## Development

```bash
npm install
npm start
npm run lint
npm run typecheck
npm test
```

Use `npx expo install <package>` for SDK-compatible dependency changes. Routes live in `app/`.

## Live environment requirements

Offline tests validate contracts and recovery behavior; they do **not** prove a deployed database, auth, S3 upload, or Textract integration is healthy. No deployment, migration, catalog import, or cloud write is performed by the test suite.

The backend must be deployed with migrations applied and runtime secrets available. Browser origins need credentialed API CORS and Better Auth trusted origins; native auth needs the `beehealthy://` scheme. S3 must permit the signed upload's required headers for browser clients. Cross-site browser cookie restrictions may require same-site domain configuration. Catalog matching/swaps require actual catalog data and any configured server-side USDA credentials.

See `../frontend-integration-plan.md` for contract details and the live acceptance checklist. Account deletion, recipes, meal logging, and persistent offline drafts are not implemented backend capabilities.
