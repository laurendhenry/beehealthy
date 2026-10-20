/**
 * Minimal `react-native` stub for offline `node --test` runs.
 * Only the surface our transport/config modules touch is provided.
 * The active platform is selected via `process.env.BEEHEALTHY_TEST_PLATFORM`
 * (`"web"` or `"native"`, default `"native"`).
 */
const platform = process.env.BEEHEALTHY_TEST_PLATFORM === "web" ? "web" : "ios";

export const Platform = {
  OS: platform,
  select: (options) => options[platform] ?? options.default ?? options.native,
};

export const AppState = {
  currentState: "active",
  addEventListener: () => ({ remove: () => undefined }),
};
