// A parked status program proves its frame and battle-thread context are saved.
global(statusWaitStarted)
global(statusWaitResumed)
global(statusWaitContext)
global(statusWaitSource)
global(statusWaitTarget)
statusWaitStarted = statusWaitStarted + 1
statusWaitContext = context.status
statusWaitSource = sourceHandle()
statusWaitTarget = targetHandle()
threadSleep(getThreadId(), 1/60)
statusWaitResumed = statusWaitResumed + 1
