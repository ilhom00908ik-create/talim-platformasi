export const fakeMediaScript = `
(function () {
  // Har bir page uchun alohida soxta kamera/ekran (canvas oqimi)
  function makeCanvas(bg, label, clockStart) {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    let t = clockStart || 0;
    function draw() {
      t += 1;
      g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#ffffff'; g.font = 'bold 44px sans-serif';
      g.fillText(label, 24, 72);
      g.font = '20px monospace';
      g.fillText('frame ' + t, 24, 110);
      g.beginPath(); g.arc(340, 230, 70, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    return c;
  }

  const camCanvas = makeCanvas(window.__camBg || '#1d4ed8', window.__camLabel || 'CAMERA', 0);
  const scrCanvas = makeCanvas('#065f46', 'SCREEN SHARE', 0);
  const camStream = camCanvas.captureStream(15);
  const scrStream = scrCanvas.captureStream(10);

  const md = navigator.mediaDevices;
  md.getUserMedia = async (constraints) => {
    window.__gumCalls = (window.__gumCalls || 0) + 1;
    window.__gumConstraints = JSON.parse(JSON.stringify(constraints || {}));
    const tracks = [];
    if (!constraints || constraints.video) {
      camStream.getVideoTracks().forEach((t) => tracks.push(t.clone()));
    }
    if (!constraints || constraints.audio) {
      // "Ovoz": ovoz darajasi indikatori ishlashi uchun real audio track
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.85;      // baland "ovoz" → indikator ko'rinadi
      osc.frequency.value = 320;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      dest.stream.getAudioTracks().forEach((t) => tracks.push(t));
    }
    return new MediaStream(tracks);
  };
  md.getDisplayMedia = async () => {
    window.__displayCalls = (window.__displayCalls || 0) + 1;
    return new MediaStream(scrStream.getVideoTracks().map((t) => t.clone()));
  };
  window.__fakeReady = true;
})();
`
