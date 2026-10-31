// region-music.prg - an authored media package, pure RPGCode (epic 21, entry 21.7).
//
// What it does for a game author: a board may name its own background music, but a
// world region wants one theme across its boards. This package rewrites board-started
// music to the region's file before it begins, so the cue stream and the music state
// carry the region theme and the board file never plays.
//
// How it works: `beforePlay` is the one cancelable decision point every producer
// passes. Only `board` sources are rewritten; script, battle, menu and video starts
// keep their file.
regionChoice = (event) => {
  if (event.detail.source != "board") {
    return
  }
  if (event.detail.file == "media/theme.mid") {
    event.detail.file = "media/region.mid"
  }
}
media.on("beforePlay", regionChoice)
end()
