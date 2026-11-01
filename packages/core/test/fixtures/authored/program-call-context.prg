function readContext() {
    return context.value
}
context_root = context.value
context_function = readContext()
context_is_this = context == this
