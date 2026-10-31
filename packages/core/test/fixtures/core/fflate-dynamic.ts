// expect-rule: no-restricted-syntax
export const loadZip = (): Promise<unknown> => import("fflate");
