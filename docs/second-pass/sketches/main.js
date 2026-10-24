for (const f of INITS) f();
if (document.fonts) document.fonts.ready.then(() => { for (const s of sketches) if (s.ready) s.draw(); });
requestAnimationFrame(loop);
