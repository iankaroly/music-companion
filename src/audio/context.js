// One shared output AudioContext for the whole app.
//
// iOS specifics this solves:
// - The ring/silent switch mutes Web Audio unless the page declares a
//   playback-capable audio session (iOS 16.4+ API).
// - Contexts start suspended and get interrupted when the mic session
//   ends; resume() must be called from inside the user gesture.
// - Safari caps the number of live AudioContexts — sharing one keeps us
//   under it alongside the mic capture context.
export function audioContext() {
  if (navigator.audioSession) {
    try { navigator.audioSession.type = 'play-and-record'; } catch { /* older iOS */ }
  }
  audioContext.ctx ??= new AudioContext();
  if (audioContext.ctx.state !== 'running') audioContext.ctx.resume();
  return audioContext.ctx;
}
