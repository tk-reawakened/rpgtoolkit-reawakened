// Capture the unset/finished helper result from inside the script environment.
beforeDecision = 0
if (battleDecided()) { beforeDecision = 1 }
if (finishCode >= 0) { battle.finish(finishCode) }
afterDecision = 0
if (battleDecided()) { afterDecision = 1 }
