// An unhandled nested-program error is reported without ending the battle turn.
global(statusErrorReached)
global(statusErrorContext)
statusErrorContext = context.status
missing_status_effect_command()
statusErrorReached = 1
