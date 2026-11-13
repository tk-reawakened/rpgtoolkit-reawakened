import { readFileSync } from "node:fs";

const TABLE_HEADER = ["Command", "Signature", "Purpose", "Notes"];

function cells(line, lineNumber) {
  if (!line.startsWith("|") || !line.endsWith("|")) {
    throw new Error(`malformed command table row at line ${lineNumber}`);
  }
  const values = line.slice(1, -1).split("|").map((cell) => cell.trim());
  if (values.length !== 4 || values.slice(0, 3).some((cell) => cell.length === 0)) {
    throw new Error(`malformed command table row at line ${lineNumber}`);
  }
  return values;
}

function clean(value) {
  return value.trim().replace(/\s+/g, " ");
}

function commandName(value, lineNumber) {
  const match = /^`([^`]+)`$/.exec(value.trim());
  if (match === null || match[1].length === 0) {
    throw new Error(`malformed command name at line ${lineNumber}`);
  }
  return match[1];
}

function aliasOf(notes) {
  const match = /\balias\s+of\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/i.exec(notes);
  return match?.[1];
}

/** Parse the stable four-column native command tables into plain data. */
export function parseSpecTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  let section;
  let inCommandTable = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      inCommandTable = false;
      continue;
    }
    if (!line.startsWith("|")) {
      if (inCommandTable && line.length > 0) inCommandTable = false;
      continue;
    }
    const values = cells(line, index + 1);
    if (values.every((value, column) => value.toLowerCase() === TABLE_HEADER[column].toLowerCase())) {
      inCommandTable = true;
      continue;
    }
    if (!inCommandTable || values.every((value) => /^[-: ]+$/.test(value))) continue;
    const notes = clean(values[3]);
    const purpose = clean(values[2]);
    rows.push({
      name: commandName(values[0], index + 1),
      purpose,
      ...(section === undefined ? {} : { section }),
      ...(aliasOf(notes) === undefined ? {} : { aliasOf: aliasOf(notes) }),
      ...(/\bobsolete\b/i.test(notes) || /^obsolete\.?$/i.test(purpose) ? { obsolete: true } : {}),
      ...(/^deprecated\b/i.test(notes) ? { deprecated: true } : {}),
    });
  }
  if (rows.length === 0) throw new Error("no native command tables found");
  return rows;
}

export function readSpecTable(path) {
  return parseSpecTable(readFileSync(path, "utf8"));
}
