#!/usr/bin/env bun
// Fails if openapi.yaml and docs/TECHNICAL.md's HTTP payload table disagree
// on which routes exist. Zero dependencies, deliberately: this only needs to
// parse two plain-text files, not stand up a YAML/Markdown toolchain for it.
// Once application code exists, this is joined by a real spec-coverage check
// (every openapi.yaml path has a handler, every handler is in openapi.yaml)
// — see docs/TECHNICAL.md §CI/CD pipeline. This script alone cannot catch
// code drifting from either document; it only catches the two documents
// drifting from each other.

import { readFileSync } from "node:fs";

const repoRoot = new URL("..", import.meta.url).pathname;
const openapiPath = `${repoRoot}openapi.yaml`;
const technicalPath = `${repoRoot}docs/TECHNICAL.md`;

// Routes intentionally in one document but not the other — not drift, just
// scope. openapi.yaml documents HTTP APIs; TECHNICAL.md's table does too,
// but the static HTML pages aren't APIs (no request/response contract to
// spec), and the internal nginx-notify routes are described in prose in
// TECHNICAL.md's module list, not in the HTTP payload table.
const staticPagesNotInSpec = new Set(["/", "/setup.html", "/login.html", "/dashboard.html"]);
const internalRoutesNotInTable = new Set([
  "/internal/nginx/on-publish",
  "/internal/nginx/on-publish-done",
]);

function extractOpenApiPaths(yaml: string): Set<string> {
  const paths = new Set<string>();
  const lines = yaml.split("\n");
  let inPathsBlock = false;
  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) {
      inPathsBlock = true;
      continue;
    }
    if (inPathsBlock) {
      if (/^\S/.test(line)) break; // dedented back to a new top-level key
      const match = line.match(/^ {2}(\/\S+):\s*$/);
      const path = match?.[1];
      if (path) paths.add(path);
    }
  }
  return paths;
}

function extractTechnicalMdRoutes(md: string): Set<string> {
  const routes = new Set<string>();
  const tableRowRe = /^\|\s*`((?:GET|POST|PUT|DELETE|PATCH)\s+[^`]+)`/;
  // Path-safe characters only — prose can put a "/" right after a closing
  // backtick (e.g. "`nginx.crashed`/Mongo disconnect"), which a looser
  // pattern misreads as an opening backtick for a path. A real path never
  // contains a space or an em dash, so requiring path-safe chars throughout
  // rules that out without needing to track which backticks are "opening".
  const secondaryPathRe = /`(\/[a-zA-Z0-9_\-/{}.:]+)`/g;
  for (const line of md.split("\n")) {
    const row = line.match(tableRowRe);
    const cell = row?.[1];
    if (!cell) continue;
    const first = cell.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/);
    const firstPath = first?.[2];
    if (firstPath) {
      routes.add(normalizePath(firstPath));
    }
    // Rows that list several routes in one cell (the static-pages row) —
    // pick up every remaining backtick-quoted path on the line too.
    for (const m of line.matchAll(secondaryPathRe)) {
      const p = m[1];
      if (p) routes.add(normalizePath(p));
    }
  }
  return routes;
}

function normalizePath(p: string): string {
  // TECHNICAL.md uses Express-style :param, openapi.yaml uses {param}.
  return p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

const openapiPaths = extractOpenApiPaths(readFileSync(openapiPath, "utf8"));
const technicalRoutes = extractTechnicalMdRoutes(readFileSync(technicalPath, "utf8"));

const inOpenApiOnly = [...openapiPaths]
  .filter((p) => !technicalRoutes.has(p) && !internalRoutesNotInTable.has(p))
  .sort();
const inTechnicalOnly = [...technicalRoutes]
  .filter((p) => !openapiPaths.has(p) && !staticPagesNotInSpec.has(p))
  .sort();

if (inOpenApiOnly.length === 0 && inTechnicalOnly.length === 0) {
  console.log(
    `check-spec-sync: OK — ${openapiPaths.size} openapi.yaml paths, ${technicalRoutes.size} TECHNICAL.md routes, no unexplained drift.`,
  );
  process.exit(0);
}

if (inOpenApiOnly.length > 0) {
  console.error("In openapi.yaml but not documented in TECHNICAL.md's HTTP payload table:");
  for (const p of inOpenApiOnly) console.error(`  ${p}`);
}
if (inTechnicalOnly.length > 0) {
  console.error("In TECHNICAL.md's HTTP payload table but not in openapi.yaml:");
  for (const p of inTechnicalOnly) console.error(`  ${p}`);
}
process.exit(1);
