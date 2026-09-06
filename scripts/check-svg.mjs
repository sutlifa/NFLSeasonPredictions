// Fails the build if any SVG we ship is not well-formed XML.
//
// This exists because the favicon shipped broken: an XML comment inside
// app/icon.svg contained a double hyphen, which XML forbids. Nothing warned
// about it. A malformed SVG does not degrade to something plainer, it simply
// fails to render, and Chrome silently falls back to its default globe -- so
// the only symptom was "the favicon isn't showing", with a file that looked
// perfectly fine in an editor.
//
// No dependencies and no DOM: a tiny well-formedness pass over the handful of
// SVGs in the repo, run before `next build`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "public", "components"];

function svgFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out = out.concat(svgFiles(path));
    else if (entry.toLowerCase().endsWith(".svg")) out.push(path);
  }
  return out;
}

/** The checks that actually catch how an SVG breaks in practice. */
function problems(source) {
  const found = [];

  // Comments: XML forbids "--" inside one, and forbids a comment ending in
  // a hyphen. This is the one that broke the favicon.
  const comments = [...source.matchAll(/<!--([\s\S]*?)-->/g)];
  for (const [, body] of comments) {
    if (body.includes("--")) found.push("double hyphen inside an XML comment");
    if (body.endsWith("-")) found.push("XML comment ends with a hyphen");
  }
  // An unterminated comment swallows the rest of the file.
  const opens = (source.match(/<!--/g) ?? []).length;
  const closes = (source.match(/-->/g) ?? []).length;
  if (opens !== closes) found.push(`unbalanced comment markers (${opens} open, ${closes} close)`);

  // Bare ampersands are the other classic way to make an SVG unparseable.
  if (/&(?!(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);)/.test(source)) {
    found.push("bare & that is not an entity");
  }

  if (!/^\s*<svg[\s>]/.test(source)) found.push("does not start with an <svg> element");
  if (!/<\/svg>\s*$/.test(source)) found.push("does not end with </svg>");

  return [...new Set(found)];
}

let failed = false;
for (const file of ROOTS.flatMap(svgFiles)) {
  const issues = problems(readFileSync(file, "utf8"));
  if (issues.length > 0) {
    failed = true;
    console.error(`✗ ${file}`);
    for (const issue of issues) console.error(`    ${issue}`);
  }
}

if (failed) {
  console.error(
    "\nMalformed SVG. It will not render at all, and a favicon will silently " +
      "fall back to the browser default.",
  );
  process.exit(1);
}
