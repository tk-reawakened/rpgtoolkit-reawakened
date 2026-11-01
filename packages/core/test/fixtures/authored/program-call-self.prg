local(level)
level = level + 1
if (context.depth < 2) {
    executeprogram("program-call-self.prg", { depth: context.depth + 1 })
}
self_seen = level
self_calls = self_calls + 1
