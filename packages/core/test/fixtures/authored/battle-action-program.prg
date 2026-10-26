// Program called by the stock battle action hook; observes its context and thread pair.
global(programCalls)
global(programSource)
global(programTarget)
global(programContextSource)
global(programContextTarget)
global(programContextLabel)
global(programContextValue)
programCalls = programCalls + 1
programSource = sourceHandle()
programTarget = targetHandle()
programContextSource = context.source
programContextTarget = context.target
programContextLabel = context.label
programContextValue = context.value
