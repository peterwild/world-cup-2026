// Lets `node --test` resolve the app's extensionless TS imports (e.g. "./teams")
// the same way the Next bundler does — by trying a ".ts" extension. Zero deps.
// Usage: node --import ./scripts/ts-ext-resolver.mjs --test src/lib/foo.test.ts
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith("./") || specifier.startsWith("../");
    const hasExt = /\.[cm]?[jt]sx?$/i.test(specifier);
    if (relative && !hasExt) {
      try {
        return nextResolve(specifier + ".ts", context);
      } catch {
        /* fall through to default resolution */
      }
    }
    return nextResolve(specifier, context);
  },
});
