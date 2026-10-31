// media-region-music - an authored media package (entry 21.7; MEDIA-3).
//
// What it does for a game author: the region the player is in owns the music. The
// package replaces whatever music a board asks for with the region's own file, so a
// board never has to know which region it sits in.
//
// How it works: `beforePlay` fires for every attempted start, including the engine's
// board music, and a listener may change `file` (MEDIA-3). The new file is what the
// start uses.
function installRegionMusic() {
  media.on("beforePlay", (event) => {
    if (event.detail.source == "board" && event.detail.track == "music") {
      event.detail.file = "media/region.mid"
    }
  })
}
installRegionMusic()
