// media-stems - an authored media package (entry 21.7; MEDIA-1, MEDIA-2).
//
// What it does for a game author: a stem is one layer of a piece of music. Play the
// first stem on the `ambience` track and this package starts the next layer when the
// previous one ends, up to three layers; after the last layer it stops the track.
//
// How it works: the package listens for the `ended` notification the shared `media`
// emitter re-emits (MEDIA-2) and starts the next file with `mediaPlay`, the object
// form that returns the voice (MEDIA-1).
function installStems() {
  local(layer)
  layer = 1
  media.on("ended", (event) => {
    if (event.detail.track != "ambience") {
      return
    }
    if (layer >= 3) {
      media.ambience.stop()
      return
    }
    layer = layer + 1
    mediaPlay("stem" + layer + ".wav", { track: "ambience", loop: 0 })
  })
}
installStems()
