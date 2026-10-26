// A nested action program that saves while parked and resumes on the same thread.
global(programCalls)
global(programSource)
global(programTarget)
global(programContextSource)
global(programContextTarget)
global(programStarted)
global(programResumed)
programCalls = programCalls + 1
programStarted = programStarted + 1
programSource = sourceHandle()
programTarget = targetHandle()
programContextSource = context.source
programContextTarget = context.target
threadSleep(getThreadId(), 0.05)
programResumed = programResumed + 1
