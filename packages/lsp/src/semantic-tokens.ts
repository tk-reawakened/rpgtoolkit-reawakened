import { PROGRAM_TOKEN_MODIFIERS, PROGRAM_TOKEN_TYPES, type ProgramToken } from "@tk-reawakened/script-tools";

/** The semantic token legend of the server (docs/spec/engine/rpgcode-tooling.md#tool-10). Its order is the wire index. */
export const SEMANTIC_LEGEND: { tokenTypes: string[]; tokenModifiers: string[] } = {
  tokenTypes: [...PROGRAM_TOKEN_TYPES],
  tokenModifiers: [...PROGRAM_TOKEN_MODIFIERS],
};

/** LSP relative encoding: five integers per token, each line and start relative to the previous token. */
export function encodeSemanticTokens(tokens: readonly ProgramToken[]): number[] {
  const data: number[] = [];
  let previousLine = 0;
  let previousStart = 0;
  for (const token of tokens) {
    const type = PROGRAM_TOKEN_TYPES.indexOf(token.type);
    let modifiers = 0;
    for (const modifier of token.modifiers) modifiers |= 1 << PROGRAM_TOKEN_MODIFIERS.indexOf(modifier);
    const deltaLine = token.line - previousLine;
    data.push(deltaLine, deltaLine === 0 ? token.start - previousStart : token.start, token.length, type, modifiers);
    previousLine = token.line;
    previousStart = token.start;
  }
  return data;
}
