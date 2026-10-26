// The status round runs through executeProgram with its filename and fighter pair.
global(statusProgramOrder)
global(statusProgramCount)
global(statusProgramSource)
global(statusProgramTarget)
global(statusProgramContext)
global(statusProgramHp)
global(statusProgramSmp)
global(statusProgramSignature)
statusProgramCount = statusProgramCount + 1
statusProgramOrder = statusProgramOrder + context.status + ";"
statusProgramSource = sourceHandle()
statusProgramTarget = targetHandle()
statusProgramContext = context.status
statusProgramHp = gethp(battle.fighter(0, 0))
statusProgramSmp = getsmp(battle.fighter(0, 0))
statusProgramSignature = statussignature(battle.fighter(0, 0))
