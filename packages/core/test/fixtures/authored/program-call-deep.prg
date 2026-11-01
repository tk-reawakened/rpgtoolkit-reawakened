local(depth_value)
depth_value = context.depth
if (context.depth < 24) {
    executeprogram("program-call-deep.prg", { depth: context.depth + 1 })
}
deepest_level = depth_value
deep_count = deep_count + 1
