// media-ducking - an authored media package (entry 21.7; MEDIA-1, MEDIA-2).
//
// What it does for a game author: while any sound plays on the `ui` track the
// music track fades down to 30 percent, and it fades back to 100 percent when the
// last of those sounds ends or is stopped. Nothing else in the game has to call it.
//
// How it works: the package listens on the shared `media` emitter, which re-emits
// every voice's past-tense event (MEDIA-2), and drives the documented track object's
// `fade(percent, seconds)` (MEDIA-1).
function installDucking() {
  local(uiVoices)
  uiVoices = 0
  media.on("started", (event) => {
    if (event.detail.track == "ui") {
      uiVoices = uiVoices + 1
      media.music.fade(30, 0.5)
    }
  })
  media.on("ended", (event) => {
    if (event.detail.track == "ui") {
      uiVoices = uiVoices - 1
      if (uiVoices <= 0) {
        uiVoices = 0
        media.music.fade(100, 0.5)
      }
    }
  })
  media.on("stopped", (event) => {
    if (event.detail.track == "ui") {
      uiVoices = uiVoices - 1
      if (uiVoices <= 0) {
        uiVoices = 0
        media.music.fade(100, 0.5)
      }
    }
  })
}
installDucking()
