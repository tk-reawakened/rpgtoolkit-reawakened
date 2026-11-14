import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ADR_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/adr");
const NUMBERED_ADR = /^(\d+)-.+\.md$/u;

/** Return duplicate numeric prefixes and their filenames, independent of filesystem state. */
export function findDuplicateAdrNumbers(filenames) {
  const byNumber = new Map();
  for (const filename of filenames) {
    const match = NUMBERED_ADR.exec(filename);
    if (match === null) continue;
    const number = BigInt(match[1]).toString();
    const matches = byNumber.get(number);
    if (matches === undefined) byNumber.set(number, [filename]);
    else matches.push(filename);
  }
  return [...byNumber]
    .filter(([, matches]) => matches.length > 1)
    .sort(([left], [right]) => (BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0))
    .map(([number, matches]) => ({ number, filenames: matches.sort() }));
}

/** Check the repository's ADR directory and throw with every duplicate number. */
export function checkAdrNumbering(directory = ADR_DIRECTORY) {
  const filenames = readdirSync(directory).filter((filename) => filename.endsWith(".md"));
  const duplicates = findDuplicateAdrNumbers(filenames);
  if (duplicates.length > 0) {
    const details = duplicates.map(({ number, filenames: matches }) => `${number}: ${matches.join(", ")}`).join("\n");
    throw new Error(`Duplicate numeric ADR prefixes in ${directory}:\n${details}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    checkAdrNumbering();
    console.log("ADR numeric prefixes are unique");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
