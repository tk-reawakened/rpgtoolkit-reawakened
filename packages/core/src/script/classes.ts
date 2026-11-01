/**
 * The class model of a legacy `class` (OOP-8, OOP-9, OOP-10; entry 19.5,
 * docs/spec/engine/rpgcode-modules-and-objects.md#oop-10).
 *
 * A class is a declaration in a compiled program, not data in a save: an object
 * names its class and the declaration is found here, by name, in the class table
 * of the program that is running. The functions are plain functions over the
 * compiled `Program` (G1, G3); none of them reads or writes the handle table.
 */

import type { MemberDef } from "./ast.ts";
import type { CompiledClass, FunctionInfo, Program } from "./program.ts";

/** Prefix for a saved callable that names a class-method tear-off. */
const CLASS_METHOD_PREFIX = "@class-method:";

/** The plain-data definition name of a bound class-method callable. */
export function classMethodDef(name: string): string {
  return `${CLASS_METHOD_PREFIX}${name}`;
}

/** Return the method name in a bound class-method definition, or `null`. */
export function parseClassMethodDef(def: string): string | null {
  return def.startsWith(CLASS_METHOD_PREFIX) ? def.slice(CLASS_METHOD_PREFIX.length) : null;
}

/** The distinct implemented arities a class and its ancestors expose for `name`, nearest class first. */
export function methodArities(program: Program, className: string, name: string): number[] {
  const arities: number[] = [];
  for (const current of classWalk(program, className)) {
    const methods = classInfo(program, current)?.methods;
    const list = methods !== undefined && Object.hasOwn(methods, name) ? methods[name] : undefined;
    for (const method of list ?? []) {
      if (method.entry < 0 || arities.includes(method.params.length)) continue;
      arities.push(method.params.length);
    }
  }
  return arities;
}

/** The declaration of class `name` in `program`, or `undefined` when its table has none. */
export function classInfo(program: Program, name: string): CompiledClass | undefined {
  return Object.hasOwn(program.classes, name) ? program.classes[name] : undefined;
}

/**
 * The OOP-8 transitive order: `name` first, then the ancestors, each base list
 * taken in declaration order and a class used only the first time it is met.
 * The class's own definition wins, and between two ancestors the one met first
 * wins; the order depends on no class name's sort position.
 */
export function classWalk(program: Program, name: string, seen: string[] = []): string[] {
  if (seen.includes(name)) return seen;
  seen.push(name);
  const info = classInfo(program, name);
  if (info !== undefined) {
    for (const base of info.bases) classWalk(program, base, seen);
  }
  return seen;
}

/** The method `name` taking `argc` parameters that `className` or its nearest ancestor defines (OOP-8). */
export function findMethod(
  program: Program,
  className: string,
  name: string,
  argc: number,
): FunctionInfo | undefined {
  for (const current of classWalk(program, className)) {
    const methods = classInfo(program, current)?.methods;
    const list = methods !== undefined && Object.hasOwn(methods, name) ? methods[name] : undefined;
    const method = list?.find((candidate) => candidate.params.length === argc);
    if (method !== undefined) return method;
  }
  return undefined;
}

/** The declaration of field `name` in `className` or its nearest ancestor (OOP-6, OOP-9). */
export function findMember(program: Program, className: string, name: string): MemberDef | undefined {
  for (const current of classWalk(program, className)) {
    const member = classInfo(program, current)?.members.find((candidate) => candidate.name === name);
    if (member !== undefined) return member;
  }
  return undefined;
}

/**
 * Every field `className` has, in the order an instance enumerates them (OOP-10):
 * the class's own declarations first and then each ancestor's in the OOP-8 walk
 * order, each class's fields in declaration order. A name two classes both
 * declare is one field, the nearest declaration.
 */
export function declaredMembers(program: Program, className: string): MemberDef[] {
  const members: MemberDef[] = [];
  const names = new Set<string>();
  for (const current of classWalk(program, className)) {
    for (const member of classInfo(program, current)?.members ?? []) {
      if (names.has(member.name)) continue;
      names.add(member.name);
      members.push(member);
    }
  }
  return members;
}
