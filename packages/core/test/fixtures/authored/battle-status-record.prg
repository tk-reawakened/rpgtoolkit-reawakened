// The status round runs through executeProgram with its filename and fighter pair.
global(statusProgramOrder)
global(statusProgramCount)
global(statusProgramSource)
global(statusProgramTarget)
global(statusProgramContext)
statusProgramCount = statusProgramCount + 1
statusProgramOrder = statusProgramOrder + context.status + ";"
statusProgramSource = sourceHandle()
statusProgramTarget = targetHandle()
statusProgramContext = context.status
