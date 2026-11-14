// Licence gate and THIRD_PARTY_NOTICES checker (G6, ADR 0002, ADR 0003).
// Evaluates production and dev workspace dependencies against the pinned
// Blue Oak Council list (v16) and repo policy configuration, and verifies
// that all production dependencies appear in THIRD_PARTY_NOTICES.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const RATING_ORDER = ["Model", "Gold", "Silver", "Bronze", "Lead"];

export function loadBlueOakList(listPath) {
  const content = readFileSync(listPath, "utf8");
  const data = JSON.parse(content);
  const licenseMap = new Map();

  for (const rating of data.ratings || []) {
    for (const lic of rating.licenses || []) {
      if (lic.id) {
        licenseMap.set(lic.id, rating.name);
      }
    }
  }

  return {
    version: data.version,
    licenseMap,
  };
}

export function loadConfig(configPath) {
  const content = readFileSync(configPath, "utf8");
  return JSON.parse(content);
}

/**
 * Parses and evaluates an SPDX license expression against the policy.
 *
 * Handles identifiers, parentheses, AND, and OR operators.
 * - For A OR B: passes if at least one alternative passes.
 * - For A AND B: passes if all components pass.
 */
export function evaluateLicense(expr, policy, tier = "direct") {
  if (!expr || typeof expr !== "string" || expr.trim() === "") {
    return {
      pass: false,
      reason: "Missing or empty license expression",
    };
  }

  const trimmed = expr.trim();

  // Simple tokenizer
  const tokens = [];
  const regex = /\s*(\(|\)|AND|OR|[^\s()]+)\s*/g;
  let match;
  while ((match = regex.exec(trimmed)) !== null) {
    if (match[1]) {
      tokens.push(match[1]);
    }
  }

  if (tokens.length === 0) {
    return {
      pass: false,
      reason: "Missing or empty license expression",
    };
  }

  let index = 0;

  function peek() {
    return tokens[index];
  }

  function consume() {
    return tokens[index++];
  }

  function parseExpression() {
    let node = parseAndExpression();
    while (peek() === "OR") {
      consume();
      const right = parseAndExpression();
      node = { type: "OR", left: node, right };
    }
    return node;
  }

  function parseAndExpression() {
    let node = parsePrimary();
    while (peek() === "AND") {
      consume();
      const right = parsePrimary();
      node = { type: "AND", left: node, right };
    }
    return node;
  }

  function parsePrimary() {
    const token = consume();
    if (!token) {
      throw new Error("Unexpected end of expression");
    }
    if (token === "(") {
      const expr = parseExpression();
      const next = consume();
      if (next !== ")") {
        throw new Error(`Expected ')' but found '${next || "EOF"}'`);
      }
      return expr;
    }
    if (token === "OR" || token === "AND" || token === ")") {
      throw new Error(`Unexpected token '${token}'`);
    }
    return { type: "IDENTIFIER", id: token };
  }

  let ast;
  try {
    ast = parseExpression();
    if (index < tokens.length) {
      throw new Error(`Unexpected extra tokens after expression: '${tokens.slice(index).join(" ")}'`);
    }
  } catch (err) {
    return {
      pass: false,
      reason: `Malformed SPDX expression: ${err.message}`,
    };
  }

  function evaluateAst(node) {
    if (node.type === "IDENTIFIER") {
      const id = node.id;
      if (policy.blocked?.includes(id)) {
        return {
          pass: false,
          reason: `License '${id}' is blocked by policy exception list (ADR 0003)`,
          license: id,
        };
      }

      // Copyleft is blocked at every dependency tier.
      if (/^(GPL|AGPL|LGPL|MPL|EUPL|SSPL)(-[0-9.]+.*)?$/i.test(id)) {
        return {
          pass: false,
          reason: `Copyleft licence '${id}' blocked by G6`,
          license: id,
        };
      }

      const rating = policy.blueOakList?.licenseMap.get(id);
      if (tier === "transitive") {
        if (rating) {
          return {
            pass: true,
            rating,
            license: id,
          };
        }
        if (policy.transitiveNonCopyleft?.includes(id)) {
          return {
            pass: true,
            license: id,
            classification: "known non-copyleft",
          };
        }
        return {
          pass: false,
          reason: `License '${id}' is not classified as a known non-copyleft transitive license`,
          license: id,
        };
      }

      if (!rating) {
        return {
          pass: false,
          reason: `License '${id}' is not on the Blue Oak Council permissive list`,
          license: id,
        };
      }

      const minRatingIndex = RATING_ORDER.indexOf(policy.minimumRating || "Bronze");
      const currentRatingIndex = RATING_ORDER.indexOf(rating);

      if (rating === "Lead") {
        return {
          pass: false,
          reason: `License '${id}' is rated Lead on Blue Oak Council list (below Bronze)`,
          rating,
          license: id,
        };
      }

      if (currentRatingIndex === -1 || currentRatingIndex > minRatingIndex) {
        return {
          pass: false,
          reason: `License '${id}' rating '${rating}' does not satisfy minimum '${policy.minimumRating}'`,
          rating,
          license: id,
        };
      }

      return {
        pass: true,
        rating,
        license: id,
      };
    }

    if (node.type === "OR") {
      const left = evaluateAst(node.left);
      const right = evaluateAst(node.right);
      if (left.pass || right.pass) {
        return {
          pass: true,
          reason: `Alternative accepted in OR expression (${left.pass ? left.license || "left" : right.license || "right"})`,
        };
      }
      return {
        pass: false,
        reason: `No acceptable alternative in OR expression: (${left.reason}) OR (${right.reason})`,
      };
    }

    if (node.type === "AND") {
      const left = evaluateAst(node.left);
      const right = evaluateAst(node.right);
      if (!left.pass) {
        return left;
      }
      if (!right.pass) {
        return right;
      }
      return {
        pass: true,
      };
    }

    return {
      pass: false,
      reason: `Unknown AST node type: ${node.type}`,
    };
  }

  return evaluateAst(ast);
}

/**
 * Queries workspace package licenses using `pnpm -r licenses list [--prod] --json`.
 */
export function queryPnpmLicenses(root, prodOnly = false) {
  const args = ["-r", "licenses", "list"];
  if (prodOnly) {
    args.push("--prod");
  }
  args.push("--json");

  const result = spawnSync("pnpm", args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw new Error(`Failed to execute 'pnpm ${args.join(" ")}': ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pnpm licenses list exited with status ${result.status}: ${result.stderr || result.stdout}`);
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    return {};
  }
  return JSON.parse(stdout);
}

function queryPnpmDirectDependencies(root) {
  if (!existsSync(join(root, "pnpm-workspace.yaml"))) {
    const manifestPath = join(root, "package.json");
    if (!existsSync(manifestPath)) return new Set();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return new Set([
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.optionalDependencies || {}),
      ...Object.keys(manifest.peerDependencies || {}),
    ]);
  }

  const args = ["-r", "list", "--prod", "--depth", "0", "--json"];
  const result = spawnSync("pnpm", args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) {
    throw new Error(`Failed to execute 'pnpm ${args.join(" ")}': ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pnpm list exited with status ${result.status}: ${result.stderr || result.stdout}`);
  }

  const projects = JSON.parse(result.stdout || "[]");
  if (!Array.isArray(projects)) {
    throw new Error("pnpm list did not return a workspace project array");
  }
  const direct = new Set();
  for (const project of projects) {
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const name of Object.keys(project[section] || {})) direct.add(name);
    }
  }
  return direct;
}


/**
 * Extracts a map of package name -> Array<{ version, license }> from pnpm licenses output.
 */
export function normalizePackages(pnpmOutput) {
  const packages = new Map();

  for (const [licenseSpdx, items] of Object.entries(pnpmOutput)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item.name) continue;
      const key = item.name;
      const list = packages.get(key) || [];
      const license = item.license || licenseSpdx;
      for (const ver of item.versions || ["unknown"]) {
        list.push({
          name: item.name,
          version: ver,
          license,
        });
      }
      packages.set(key, list);
    }
  }

  return packages;
}

/**
 * Audits bundled font assets against config records, on-disk files, and notices.
 */
export function auditBundledFonts(root, config, noticesContent, noticesFilePresent) {
  const violations = [];
  const warnings = [];
  const fontRecords = config.bundledAssets?.fonts || [];
  const recordedPaths = new Set(fontRecords.map((r) => r.path));

  for (const record of fontRecords) {
    const fullPath = join(root, record.path);
    if (!existsSync(fullPath)) {
      violations.push({
        type: "missing-bundled-font",
        path: record.path,
        message: `Bundled font asset missing at ${record.path}`,
      });
      continue;
    }

    const bytes = readFileSync(fullPath);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== record.sha256) {
      violations.push({
        type: "bundled-font-hash-mismatch",
        path: record.path,
        expectedHash: record.sha256,
        actualHash,
        message: `Bundled font '${record.path}' SHA-256 mismatch (expected ${record.sha256}, got ${actualHash})`,
      });
    }

    if (record.license === "OFL-1.1") {
      if (record.adr !== "ADR-0003") {
        violations.push({
          type: "unapproved-font-license",
          path: record.path,
          license: record.license,
          message: `Bundled font '${record.path}' with license 'OFL-1.1' requires ADR-0003 exemption`,
        });
      }
    } else {
      const evalRes = evaluateLicense(record.license, config);
      if (!evalRes.pass && !record.adr) {
        violations.push({
          type: "unapproved-font-license",
          path: record.path,
          license: record.license,
          message: `Bundled font '${record.path}' with license '${record.license}' rejected: ${evalRes.reason}`,
        });
      }
    }

    if (noticesFilePresent) {
      const fileName = record.path.slice(record.path.lastIndexOf("/") + 1);
      const hasFileName = noticesContent.includes(fileName) || noticesContent.includes(record.path);
      const hasHash = noticesContent.includes(record.sha256);
      if (!hasFileName || !hasHash) {
        violations.push({
          type: "missing-font-notice",
          path: record.path,
          message: `Bundled font '${record.path}' or its SHA-256 hash '${record.sha256}' is missing from THIRD_PARTY_NOTICES`,
        });
      }
    }
  }

  const mediaFonts = join(root, "media", "fonts");
  if (existsSync(mediaFonts)) {
    const fontExts = new Set([".ttf", ".otf", ".woff", ".woff2"]);
    for (const name of readdirSync(mediaFonts)) {
      const dotIndex = name.lastIndexOf(".");
      if (dotIndex === -1) continue;
      const ext = name.slice(dotIndex).toLowerCase();
      if (fontExts.has(ext)) {
        const relPath = `media/fonts/${name}`;
        if (!recordedPaths.has(relPath)) {
          violations.push({
            type: "unlisted-bundled-font",
            path: relPath,
            message: `Font file '${relPath}' found on disk but is not recorded in bundledAssets.fonts config`,
          });
        }
      }
    }
  }

  return { violations, warnings, count: fontRecords.length };
}
/**
 * Audits bundled SoundFont assets against config records, on-disk files, and notices.
 *
 * Bundled banks are deliberately kept separate from the font audit because they
 * have a stricter, fixed 8 MiB ceiling and must be runner-side SoundFont files.
 */
export function auditBundledSoundFonts(root, config, noticesContent, noticesFilePresent, policy = config) {
  const violations = [];
  const warnings = [];
  const soundfontRecords = config.bundledAssets?.soundfonts || [];
  const recordedPaths = new Set(soundfontRecords.map((record) => record.path));
  const hardCeiling = 8 * 1024 * 1024;

  for (const record of soundfontRecords) {
    const path = record.path;
    const isSafePath =
      typeof path === "string" &&
      path.startsWith("media/soundfonts/") &&
      !path.includes("..") &&
      !path.endsWith("/");
    const extension = typeof path === "string" ? path.slice(path.lastIndexOf(".")).toLowerCase() : "";
    if (!isSafePath || ![".sf2", ".sf3"].includes(extension)) {
      violations.push({
        type: "invalid-bundled-soundfont-path",
        path,
        message: `Bundled SoundFont path '${path}' must be an .sf2 or .sf3 file below media/soundfonts`,
      });
      continue;
    }

    const configuredCeiling = record.sizeCeiling ?? record.maxBytes ?? hardCeiling;
    if (!Number.isInteger(configuredCeiling) || configuredCeiling <= 0 || configuredCeiling > hardCeiling) {
      violations.push({
        type: "invalid-soundfont-size-ceiling",
        path,
        sizeCeiling: configuredCeiling,
        message: `Bundled SoundFont '${path}' has an invalid size ceiling; it must be at most ${hardCeiling} bytes`,
      });
    }

    if (typeof record.license !== "string" || record.license.length === 0) {
      violations.push({
        type: "missing-soundfont-license",
        path,
        message: `Bundled SoundFont '${path}' is missing a licence identifier`,
      });
    } else {
      const licenseResult = evaluateLicense(record.license, policy);
      if (!licenseResult.pass) {
        violations.push({
          type: "unapproved-soundfont-license",
          path,
          license: record.license,
          message: `Bundled SoundFont '${path}' with license '${record.license}' rejected: ${licenseResult.reason}`,
        });
      }
    }

    if (typeof record.adr !== "string" || record.adr.length === 0) {
      violations.push({
        type: "missing-soundfont-adr",
        path,
        message: `Bundled SoundFont '${path}' is missing its ADR reference`,
      });
    }

    const fullPath = join(root, path);
    if (!existsSync(fullPath)) {
      violations.push({
        type: "missing-bundled-soundfont",
        path,
        message: `Bundled SoundFont asset missing at ${path}`,
      });
      continue;
    }

    const bytes = readFileSync(fullPath);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== record.sha256) {
      violations.push({
        type: "bundled-soundfont-hash-mismatch",
        path,
        expectedHash: record.sha256,
        actualHash,
        message: `Bundled SoundFont '${path}' SHA-256 mismatch (expected ${record.sha256}, got ${actualHash})`,
      });
    }

    const sizeCeiling = Math.min(configuredCeiling, hardCeiling);
    if (bytes.length > sizeCeiling) {
      violations.push({
        type: "bundled-soundfont-too-large",
        path,
        size: bytes.length,
        sizeCeiling,
        message: `Bundled SoundFont '${path}' is ${bytes.length} bytes, over the ${sizeCeiling}-byte ceiling`,
      });
    }

    if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "sfbk") {
      violations.push({
        type: "invalid-bundled-soundfont-container",
        path,
        message: `Bundled SoundFont '${path}' is not an RIFF sfbk SoundFont container`,
      });
    }

    if (noticesFilePresent) {
      const fileName = path.slice(path.lastIndexOf("/") + 1);
      const hasFileName = noticesContent.includes(fileName) || noticesContent.includes(path);
      const hasHash = typeof record.sha256 === "string" && noticesContent.includes(record.sha256);
      const hasLicense = typeof record.license === "string" && noticesContent.includes(record.license);
      const hasNoticeText = !record.notice || noticesContent.includes(record.notice);
      if (!hasFileName || !hasHash || !hasLicense || !hasNoticeText) {
        violations.push({
          type: "missing-soundfont-notice",
          path,
          message: `Bundled SoundFont '${path}' needs a THIRD_PARTY_NOTICES entry containing its path, SHA-256, licence, and notice text`,
        });
      }
    }
  }

  const mediaSoundfonts = join(root, "media", "soundfonts");
  const visit = (directory, prefix) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      const relativePath = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(entryPath, relativePath);
        continue;
      }
      const extension = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
      if ([".sf2", ".sf3"].includes(extension) && !recordedPaths.has(relativePath)) {
        violations.push({
          type: "unlisted-bundled-soundfont",
          path: relativePath,
          message: `SoundFont file '${relativePath}' found on disk but is not recorded in bundledAssets.soundfonts config`,
        });
      }
    }
  };
  visit(mediaSoundfonts, "media/soundfonts");

  return { violations, warnings, count: soundfontRecords.length };
}


/**
 * Audits licenses and notices for a workspace.
 */
export function checkLicences(root = repoRoot, options = {}) {
  const violations = [];
  const warnings = [];

  const listPath = options.blueOakListPath || join(root, "tools", "licences", "blue-oak-list.json");
  const configPath = options.configPath || join(root, "tools", "licences", "config.json");
  const noticesPath = options.noticesPath || join(root, "THIRD_PARTY_NOTICES");

  if (!existsSync(listPath)) {
    violations.push({
      type: "missing-list-file",
      message: `Missing Blue Oak Council list file at ${listPath}`,
    });
    return { pass: false, violations, warnings };
  }

  if (!existsSync(configPath)) {
    violations.push({
      type: "missing-config-file",
      message: `Missing config file at ${configPath}`,
    });
    return { pass: false, violations, warnings };
  }

  const blueOakList = loadBlueOakList(listPath);
  const config = loadConfig(configPath);
  const policy = {
    ...config,
    blueOakList,
  };

  // 1. Verify THIRD_PARTY_NOTICES file exists
  let noticesContent = "";
  const noticesFilePresent = existsSync(noticesPath);
  if (!noticesFilePresent) {
    violations.push({
      type: "missing-notices-file",
      message: `Missing THIRD_PARTY_NOTICES file at ${noticesPath}`,
    });
  } else {
    noticesContent = readFileSync(noticesPath, "utf8");
  }
  // 2. Query production dependencies
  const prodRaw = options.prodLicensesJson ?? queryPnpmLicenses(root, true);
  const prodPackages = normalizePackages(prodRaw);

  // 3. Query all dependencies (prod + dev)
  const allRaw = options.allLicensesJson ?? queryPnpmLicenses(root, false);
  const allPackages = normalizePackages(allRaw);
  const directDependencies = options.directDependencies !== undefined
    ? new Set(options.directDependencies)
    : options.prodLicensesJson !== undefined
      ? new Set(prodPackages.keys())
      : queryPnpmDirectDependencies(root);

  const productionDependencies = [];
  
  // 4. Audit production dependencies
  for (const [pkgName, occurrences] of prodPackages) {
    const tier = directDependencies.has(pkgName) ? "direct" : "transitive";
    for (const occ of occurrences) {
      productionDependencies.push({ package: pkgName, version: occ.version, tier });
      const result = evaluateLicense(occ.license, policy, tier);
      if (!result.pass) {
        violations.push({
          type: "unapproved-prod-license",
          package: pkgName,
          version: occ.version,
          tier,
          license: occ.license,
          message: `Production ${tier} dependency '${pkgName}@${occ.version}' with license '${occ.license}' rejected: ${result.reason}`,
        });
      }

      // Check dev exemption in prod
      if (config.devExemptions?.[pkgName]) {
        violations.push({
          type: "dev-exemption-in-prod",
          package: pkgName,
          version: occ.version,
          message: `Dev exemption package '${pkgName}' found in production dependency tree`,
        });
      }
    }

    // Check notice in THIRD_PARTY_NOTICES
    if (noticesFilePresent) {
      const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const noticePattern = new RegExp(`(^|\\n)###?\\s+${escaped}(\\s|$|\\n)|\\b${escaped}\\b`);
      if (!noticePattern.test(noticesContent)) {
        violations.push({
          type: "missing-notice",
          package: pkgName,
          message: `Production dependency '${pkgName}' is not mentioned in THIRD_PARTY_NOTICES`,
        });
      }
    }
  }

  // 5. Audit dev-only dependencies
  // Track exact (name, version) occurrences in prod so we don't skip dev occurrences
  // that have different versions or licenses.
  const prodOccurrences = new Set();
  for (const [pkgName, occurrences] of prodPackages) {
    for (const occ of occurrences) {
      prodOccurrences.add(`${pkgName}@${occ.version}`);
    }
  }

  for (const [pkgName, occurrences] of allPackages) {
    for (const occ of occurrences) {
      // If exact (name, version) is already in prod, it was checked above
      if (prodOccurrences.has(`${pkgName}@${occ.version}`)) {
        continue;
      }
      // Check if exempted
      const exemption = config.devExemptions?.[pkgName];
      if (exemption) {
        if (exemption.license && exemption.license !== occ.license) {
          violations.push({
            type: "dev-exemption-license-mismatch",
            package: pkgName,
            version: occ.version,
            license: occ.license,
            expectedLicense: exemption.license,
            message: `Dev-exempted package '${pkgName}' has unexpected license '${occ.license}' (expected '${exemption.license}')`,
          });
        }
        // Dev exemption accepted!
        continue;
      }

      // Otherwise dev dep must satisfy Bronze or better
      const result = evaluateLicense(occ.license, policy);
      if (!result.pass) {
        violations.push({
          type: "unapproved-dev-license",
          package: pkgName,
          version: occ.version,
          license: occ.license,
          message: `Dev dependency '${pkgName}@${occ.version}' with license '${occ.license}' rejected: ${result.reason}`,
        });
      }
    }
  }

  // 6. Audit bundled font assets
  let fontCount = 0;
  if (config.bundledAssets?.fonts || existsSync(join(root, "media", "fonts"))) {
    const fontAudit = auditBundledFonts(root, config, noticesContent, noticesFilePresent);
    violations.push(...fontAudit.violations);
    warnings.push(...fontAudit.warnings);
    fontCount = fontAudit.count;
  }

  // 7. Audit bundled SoundFont assets
  let soundfontCount = 0;
  if (config.bundledAssets?.soundfonts || existsSync(join(root, "media", "soundfonts"))) {
    const soundfontAudit = auditBundledSoundFonts(root, config, noticesContent, noticesFilePresent, policy);
    violations.push(...soundfontAudit.violations);
    warnings.push(...soundfontAudit.warnings);
    soundfontCount = soundfontAudit.count;
  }

  return {
    pass: violations.length === 0,
    prodCount: prodPackages.size,
    productionDependencies,
    allCount: allPackages.size,
    fontCount,
    soundfontCount,
    violations,
    warnings,
  };
}

// CLI entry point
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const isMain = isEntryPoint();

if (isMain) {
  const argv = process.argv.slice(2);
  const runAudit = argv.includes("--audit");
  const unknownFlags = argv.filter((arg) => arg.startsWith("-") && arg !== "--audit");
  if (unknownFlags.length > 0) {
    console.error(`tools/licences/check.mjs: unknown flag(s): ${unknownFlags.join(", ")}`);
    process.exit(1);
  }

  const positional = argv.filter((arg) => !arg.startsWith("-"));
  if (positional.length > 1) {
    console.error(
      `tools/licences/check.mjs: expected at most one root argument, got ${positional
        .map((arg) => JSON.stringify(arg))
        .join(", ")}`,
    );
    process.exit(1);
  }

  const targetRoot = positional.length === 1 ? resolve(positional[0]) : repoRoot;
  if (runAudit) {
    console.log("Running 'pnpm audit --prod'...");
    const auditRes = spawnSync("pnpm", ["audit", "--prod"], {
      cwd: targetRoot,
      stdio: "inherit",
    });
    if (auditRes.status !== 0) {
      console.error(`\npnpm audit --prod failed with exit code ${auditRes.status}`);
      process.exit(auditRes.status ?? 1);
    }
  }

  console.log(`Checking licences for workspace at: ${targetRoot}`);
  try {
    const result = checkLicences(targetRoot);
    console.log(`  Production dependency tiers:`);
    for (const dependency of result.productionDependencies) {
      console.log(`    ${dependency.tier}: ${dependency.package}@${dependency.version}`);
    }
    if (!result.pass) {
      console.error(`\nLicence check FAILED with ${result.violations.length} violation(s):\n`);
      for (const v of result.violations) {
        console.error(`  - [${v.type}] ${v.message}`);
      }
      process.exit(1);
    } else {
      console.log(`\nLicence check PASSED.`);
      console.log(`  Production packages checked: ${result.prodCount}`);
      console.log(`  Total (prod + dev) packages checked: ${result.allCount}`);
      if (result.fontCount !== undefined) {
        console.log(`  Bundled fonts checked: ${result.fontCount}`);
      }
      if (result.soundfontCount !== undefined) {
        console.log(`  Bundled SoundFonts checked: ${result.soundfontCount}`);
      }
      console.log(`  0 violations found.`);
      process.exit(0);
    }
  } catch (err) {
    console.error(`Licence checker failed with error: ${err.message}`);
    process.exit(1);
  }
}
