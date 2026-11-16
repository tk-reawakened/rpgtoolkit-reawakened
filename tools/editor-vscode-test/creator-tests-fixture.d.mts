export interface CreatorTestFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export const CREATOR_TEST_SPEC_PATH: string;
export const CREATOR_TEST_CASE_NAME: string;
export function createCreatorTestFiles(options?: { readonly failWall?: boolean }): CreatorTestFile[];
