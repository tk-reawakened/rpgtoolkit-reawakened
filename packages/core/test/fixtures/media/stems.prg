// stems.prg - an authored media package, pure RPGCode (epic 21, entry 21.7).
//
// What it does for a game author: ambient audio is authored as three one-shot
// layers; when the layer that is playing reaches its end, the package starts the
// next one on the same track, so the ambience never gaps and never repeats until
// the third layer.
//
// How it works: `ended` on the ambience track names the file that finished, and the
// package starts the next authored one-shot. Every layer is a one-shot, so the chain
// is driven only by core state transitions, never by a device report.
stemNext = (event) => {
  if (event.detail.track != "ambience") {
    return
  }
  if (event.detail.file == "media/stem1.wav") {
    mediaPlay("media/stem2.wav", { track: "ambience", loop: false })
  }
  if (event.detail.file == "media/stem2.wav") {
    mediaPlay("media/stem3.wav", { track: "ambience", loop: false })
  }
}
media.on("ended", stemNext)
end()
