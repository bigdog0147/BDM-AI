/**
 * Remove dead CSS rules.
 *
 * A rule is removed when EVERY selector in its selector list contains one of
 * the retired class names. A rule that mixes a retired class with a live one
 * is left untouched, and the same applies to a rule with no class at all.
 *
 * Usage: node tools/prune-dead-css.js [--apply]
 * Without --apply it only reports what would be removed.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const APPLY = process.argv.includes("--apply");

/** Class names belonging to the retired status rail and hero empty state. */
const DEAD = new Set([
  "rail", "rail-card", "rail-head", "rail-title", "rail-title", "rail-list",
  "rail-link", "rail-action", "rail-action-icon", "rail-empty", "rail-status",
  "rail-status-label", "rail-status-value", "rail-note", "rail-chat",
  "rail-chat-title", "rail-chat-time", "rail-chats", "rail-actions",
  "rail-health", "rail-services", "rail-service-name", "rail-service-detail",
  "hero", "hero-stars", "hero-emblem", "hero-title", "hero-sub",
  "action-card", "action-cards", "action-icon", "action-text"
]);

/**
 * Generic state modifiers. They never identify a component on their own, so
 * a selector that only pairs them with a retired class is still dead.
 */
const MODIFIER = new Set([
  "active", "ok", "warn", "error", "live", "muted", "wide", "primary",
  "secondary", "gold", "disabled", "selected", "current", "open", "hidden"
]);

const FILES = [
  "app/workspace.css",
  "app/dashboard.css",
  "app/components.css",
  "app/brand.css",
  "app/premium.css"
];

/** Every class name that is actually rendered somewhere in app/. */
function renderedClasses() {
  const used = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx")) {
        const source = fs.readFileSync(full, "utf8");
        const patterns = [
          /className\s*=\s*"([^"]*)"/g,
          /className\s*=\s*\{`([^`]*)`\}/g,
          /className\s*=\s*\{'([^']*)'\}/g,
          /className=\{[^}]*?\?\s*"([^"]*)"\s*:\s*"([^"]*)"/g
        ];
        for (const pattern of patterns) {
          for (const match of source.matchAll(pattern)) {
            for (const raw of match.slice(1)) {
              for (const token of String(raw).split(/\s+/)) {
                const clean = token.trim();
                if (clean && !clean.includes("${")) used.add(clean);
              }
            }
          }
        }
      }
    }
  };
  walk(path.join(ROOT, "app"));
  return used;
}

/**
 * Split a CSS file into a list of top-level chunks, each of which is either a
 * comment, an at-rule, or a rule. Nested blocks are kept whole.
 */
function splitTopLevel(css) {
  const chunks = [];
  let index = 0;

  while (index < css.length) {
    const start = index;

    // Comment
    if (css.startsWith("/*", index)) {
      const end = css.indexOf("*/", index + 2);
      index = end === -1 ? css.length : end + 2;
      chunks.push({ kind: "comment", text: css.slice(start, index) });
      continue;
    }

    // At-rule or rule: find the matching closing brace.
    let depth = 0;
    let sawBrace = false;
    while (index < css.length) {
      const char = css[index];
      if (char === "{") {
        depth++;
        sawBrace = true;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          index++;
          break;
        }
      } else if (char === ";" && depth === 0 && !sawBrace) {
        index++;
        break;
      }
      index++;
    }
    chunks.push({ kind: "block", text: css.slice(start, index) });
  }

  return chunks;
}

/** The selector list of a rule chunk, or null when it is not a plain rule. */
function selectorOf(text) {
  const braceAt = text.indexOf("{");
  if (braceAt === -1) return null;
  const head = text.slice(0, braceAt).trim();
  if (!head || head.startsWith("@")) return null;
  return head;
}

/** True when every selector in the list mentions a retired class. */
function isFullyDead(selector, used) {
  const parts = selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => {
    const classes = [...part.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map(
      (m) => m[1]
    );
    if (classes.length === 0) return false;
    // A selector that touches a class which is still rendered is live, unless
    // that class is only a generic state modifier.
    const live = classes.filter(
      (name) => used.has(name) && !DEAD.has(name) && !MODIFIER.has(name)
    );
    if (live.length > 0) return false;
    return classes.some((name) => DEAD.has(name));
  });
}

/** Remove dead rules and any at-rule that ends up empty. */
function prune(css, used) {
  const chunks = splitTopLevel(css);
  const out = [];
  let removed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.kind === "comment") {
      out.push(chunk);
      continue;
    }

    const selector = selectorOf(chunk.text);
    if (selector && isFullyDead(selector, used)) {
      removed++;
      // Drop the comment that documents the removed rule.
      const previous = out[out.length - 1];
      if (previous && previous.kind === "comment" && previous.text.length < 400) {
        out.pop();
      }
      continue;
    }

    // Recurse into at-rules with blocks.
    const braceAt = chunk.text.indexOf("{");
    if (chunk.text.trim().startsWith("@") && braceAt !== -1) {
      const inner = chunk.text.slice(braceAt + 1, chunk.text.lastIndexOf("}"));
      const pruned = prune(inner, used);
      const head = chunk.text.slice(0, braceAt);
      if (pruned.css.trim().length === 0) {
        removed++;
        const previous = out[out.length - 1];
        if (previous && previous.kind === "comment" && previous.text.length < 400) {
          out.pop();
        }
        continue;
      }
      out.push({ kind: "block", text: head + "{" + pruned.css + "}" });
      continue;
    }

    out.push(chunk);
  }

  return { css: out.map((c) => c.text).join(""), removed };
}

const used = renderedClasses();
const conflicts = [...used].filter((name) => DEAD.has(name));
if (conflicts.length > 0) {
  console.error(
    "REFUSING: these retired names are still rendered: " + conflicts.join(", ")
  );
  process.exit(1);
}

let total = 0;
for (const relative of FILES) {
  const full = path.join(ROOT, relative);
  if (!fs.existsSync(full)) continue;
  const source = fs.readFileSync(full, "utf8");
  const result = prune(source, used);
  total += result.removed;
  if (result.removed > 0) {
    console.log(
      `${relative}: removed ${result.removed} dead rule(s)  ${source.length} -> ${result.css.length} bytes`
    );
    if (APPLY) fs.writeFileSync(full, result.css, "utf8");
  }
}
console.log(
  `${APPLY ? "Applied" : "Would remove"} ${total} dead rule(s) in total.`
);
