levelProgramCount = levelProgramCount + 1
levelProgramLog = levelProgramLog + context.level + ":" + context.experience + ":" + getmaxhp(context.actor) + ";"
outcomeSequence = outcomeSequence + "level" + context.level + ";"
if (context.level == 1) {
  missing_level_up_program_command()
}
threadSleep(getThreadId(), 1/60)
levelProgramContinuation = levelProgramContinuation + 1
