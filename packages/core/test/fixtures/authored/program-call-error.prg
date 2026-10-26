function callee() {
  setErrorHandler(:callee_error)
  missingCalleeCommand()
  callee_continued = 1
  return 0
  :callee_error
  callee_caught = 1
  resumeNext()
}
callee()
