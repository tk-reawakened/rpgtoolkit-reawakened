// ducking.prg - an authored media package, pure RPGCode (epic 21, entry 21.7).
//
// What it does for a game author: while any voice is playing on the `ui` track,
// the music track sits at 40 percent; when the last one finishes it comes back
// to 100. Both changes are ordinary track fades, so they are tick-deterministic
// and a save carries them as data.
//
// How it works: the package subscribes once at start-up; `duckCount` is a global
// cell, so the listener only reads and writes package state.
duckCount = 0
duckStart = (event) => {
  if (event.detail.track == "ui") {
    duckCount = duckCount + 1
    if (duckCount == 1) {
      media.music.fade(40, 0.25)
    }
  }
}
duckEnd = (event) => {
  if (event.detail.track == "ui") {
    duckCount = duckCount - 1
    if (duckCount <= 0) {
      duckCount = 0
      media.music.fade(100, 0.25)
    }
  }
}
media.on("started", duckStart)
media.on("ended", duckEnd)
media.on("stopped", duckEnd)
end()
