// Ambient module declarations for Bun's text-loader import attribute
// (`import x from "./file" with { type: "text" }`), used in http-api.ts to
// embed the dashboard's static assets directly into the module graph —
// and, critically, into the compiled binary from `bun build --compile`.
// tsc has no built-in notion of what these specifiers resolve to without
// this; nothing else in src/ imports .css/.js as a module, so these two
// wildcards don't shadow anything real.
//
// *.html is deliberately NOT declared here — bun-types already claims that
// wildcard for its own (unrelated) HTMLBundle dev-server feature, and a
// second `declare module "*.html"` here doesn't override it, it conflicts
// with it (a real tsc error, not a guess — confirmed by trying it). The
// three .html imports in http-api.ts are cast to `string` at the import
// site instead, since a `with { type: "text" }` import.ts is what Bun's
// bundler actually honors at runtime and compile-time regardless of what
// tsc's static types claim.

declare module "*.css" {
  const contents: string;
  export default contents;
}
declare module "*.js" {
  const contents: string;
  export default contents;
}
