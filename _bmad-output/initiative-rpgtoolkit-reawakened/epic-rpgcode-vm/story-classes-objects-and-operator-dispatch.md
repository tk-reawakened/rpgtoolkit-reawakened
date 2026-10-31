---
id: 6
type: story
title: "Classes, objects and operator dispatch"
parent: epic-rpgcode-vm
tracker_id: "#362"
remote: "https://github.com/tk-reawakened/rpgtoolkit-reawakened/issues/362"
tracker_status: done
covers: [CAP-5]
after: [3, 5]
refined: true
hitl: false
risk: high
---

# Classes, objects and operator dispatch

## Description

A script can declare classes and structs, build objects, call their methods, overload operators, release them, and inherit from base classes, all by the rules of `docs/spec/engine/rpgcode-modules-and-objects.md` (OOP-1 to OOP-9). The objects live in the handle table `VmState.objects`, so a snapshot taken at any step restores them exactly. This is the last language feature `system.prg` needs: its `CArray` class must load and run unchanged.

## Acceptance Criteria

1. **Declarations load in every written form**
   **Given** a program with a class whose methods have bodies inside the class, a class with a body-less prototype and a separate `method CName::CName(...)` definition, a mix of both, and a `struct`
   **When** the program loads
   **Then** each class has its members, member arrays (`var m[]`, `m[10]`), methods, constructor, destructor, operator methods and bases as written, and a `protected` label is rejected with a located diagnostic
2. **Construction runs only the named class's constructor**
   **Given** a class with a base class that has a constructor
   **When** the program builds an object with `Cls(a, b)`
   **Then** only `Cls`'s constructor runs, with the arguments given, and the result is the object's handle
3. **Handle numbers follow the rule**
   **Given** a table with handle 1 live and handle 2 free, then a table with handle 1 free and handle 2 live
   **When** a new object is built in each
   **Then** the new handles are 2 and 3, and an empty table gives 1
4. **Assignment stores the handle**
   **Given** `a` holds an object and `b` is unset, holds a number, or holds an object whose class has no `operator=`
   **When** the program runs `b = a`
   **Then** `a` and `b` name the same object, no member is copied, and no constructor runs
5. **`operator=` replaces the store**
   **Given** `b` holds an object whose class defines `operator=` with one parameter
   **When** the program runs `b = a`
   **Then** that method runs with `b` as `this` and `a` as its argument, and `b` still names its own object afterwards
6. **`operator[]` reads and writes**
   **Given** an object whose class defines `operator[]`
   **When** the program reads `a[i]`, or runs `a[i] = v`, or runs `this[i] = v` inside a method
   **Then** the method decides the element; for a write it returns a reference and the value is stored through it, and `operator=` runs only if the referenced variable holds an object
7. **Other operators dispatch on the first operand**
   **Given** objects whose classes define `operator+`, a unary `operator-`, `operator==` and `operator+=`
   **When** the program uses each operator with an object on the left
   **Then** the method with the matching parameter count runs; `==` and `~=` compare handles when no method exists; a compound assignment calls only its own method; any other missing method is a runtime error; `->`, the ternary and conversion operators are never dispatched
8. **Names resolve in the ruled order**
   **Given** a method with a parameter, a member and a global that share a name, and a call to a function with the name of one of its own class's methods
   **When** the method runs
   **Then** the name resolves as `:name`, parameter, member, then local or global, and the call resolves as built-in, own-class method by name and parameter count, script function, plugin, then unknown-call error
9. **Typed and `&` parameters work on methods**
   **Given** a method with a typed parameter and a `&` parameter
   **When** it is called
   **Then** the typed argument is accepted by the type's rule for functions, and a write to the `&` parameter changes the caller's variable
10. **Inheritance follows the ruled order**
    **Given** a class with two bases that both define a method, and a derived class that overrides one of them
    **When** the program calls the method on an object held by a variable of a different class
    **Then** the object's own class wins, then the ancestors in the ruled walk order, and the call uses the object's actual class
11. **Abstract classes cannot be built**
    **Given** a class with a method declared `= 0`
    **When** the program builds an object of it
    **Then** a runtime error of the invalid-object class is raised and no object exists
12. **Access is checked at each access**
    **Given** a `class` and a `struct` with `public:` and `private:` labels, and code outside any method, in another class's method, and in a method of the same class
    **When** each reaches a member and a method
    **Then** defaults are private for `class` and public for `struct`, same-class code reaches the private members of any object of its class, and every other private access is a runtime error
13. **`release()` runs the destructor and frees**
    **Given** an object whose class and base class both define a destructor
    **When** the program calls `release()`
    **Then** only the object's own class's destructor runs, then the members and handle are freed; `kill(obj)` removes only the variable name and runs nothing
14. **Unreferenced objects are freed at the end of the tick**
    **Given** an object that no global, frame local, operand or member names, and two objects that name each other
    **When** the tick ends
    **Then** the first is freed with no destructor, in a fixed order; the two that name each other stay; at program end the program's objects are freed by the same pass and no destructor runs
15. **Snapshots restore the object table**
    **Given** a program stopped mid-method with live objects, one holding another
    **When** the state is snapshotted, restored into a fresh VM and run to the end
    **Then** the object table and the state hash are identical at every step to an unbroken run, and the next new handle is the same
16. **Bad objects raise runtime errors**
    **Given** a call or member access on a freed handle, an unknown class, or an inaccessible member
    **When** it runs
    **Then** a runtime error with a stable code in the failure table's class is raised, with file and line
17. **`system.prg` loads and its class runs**
    **Given** `system.prg` unchanged
    **When** a driver builds `CArray`, writes and reads elements, calls `resize`, `clone`, assigns with `=`, and calls `release()`
    **Then** every call returns what the class's own code says it should, and the run snapshots and restores identically

## Boundaries

- Must not change: functions, arrays and maps, `local`/`global`, `kill` on plain variables, and every program with no class behave and hash as they did.
- Must not change: the state hash of every existing golden and snapshot fixture, other than the now-populated `objects` table.
- Must not change: `class`, `struct`, `this` and `->` keep their located diagnostics in any dialect or file that does not accept them.
- Out of scope: catching these runtime errors with a handler (entry 7); `#include` and `file.` resolution of classes across files (entry 8); threads (entry 9).

## References

- parent — _bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-vm/epic-rpgcode-vm.md
- spec — docs/spec/engine/rpgcode-modules-and-objects.md, section Objects (OOP-1 to OOP-9)
- spec — docs/spec/engine/rpgcode-errors-and-threads.md, the failure table
- reference — _bmad-output/initiative-rpgtoolkit-reawakened/epic-rpgcode-vm/discovery/language-readiness.md, sections "What system.prg needs from the VM" and OOP-1 to OOP-9
- spine — _bmad-output/initiative-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened/architecture-rpgtoolkit-reawakened.md, AD-7 (objects), AD-8 (lookup order)

## Notes

- Decision: the doc-first step is done (2026-10-12). OOP-4 to OOP-9 are ruled in the spec page above; start at the code.
- Decision: runtime errors in criteria 11, 12 and 16 are thrown with stable codes now; entry 7 makes them catchable (Jensen, 2026-10-16).
- Decision: this whole ruled OOP surface stays in one entry, because no other entry owns inheritance, access labels or the unreferenced-object pass. If the plan finds it too big for one session, the cut is: classes, construction, handles, operators and lifetime (criteria 1 to 9, 13 to 15) first; inheritance and access (10 to 12, 16) second. (Jensen, 2026-10-16).
- Decision: `hitl` is false now that the doc-first step is done; the plan checkpoint stays (Jensen, 2026-10-16).
- Open question: `Value` is `number | string | null` today, so a variable cannot yet hold an object handle plus its type. How the handle value is represented, and that it stays plain data and hashes stably, is settled in the plan.
- Risk is high, because it changes the state shape that every snapshot and save carries. The check outside these criteria is criterion 17, plus the owner's review at the plan checkpoint.
