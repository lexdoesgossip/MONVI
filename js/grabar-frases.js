import { HandLandmarker, FilesetResolver, DrawingUtils } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { GRUPOS, TEXTO } from "./frases.js";

const $ = (id) => document.getElementById(id);
const ctx = $("canvas").getContext("2d");
const video = $("video");
const REPS = 8, DUR = 3000, N = 30, PESO = 2, NEVAL = 400;

let datos = {};
try { datos = JSON.parse(localStorage.getItem("lsm-frases")) || {}; } catch (e) {}
const guardar = () => { try { localStorage.setItem("lsm-frases", JSON.stringify(datos)); } catch (e) {} };

// ---------- Características de un cuadro: dos "casilleros" de mano (izquierda y derecha) ----------
function vector(p) {
  const o = p[0], t = Math.hypot(p[9].x - o.x, p[9].y - o.y) || 1;
  return p.flatMap((q) => [(q.x - o.x) / t, (q.y - o.y) / t, (q.z - o.z) / t]);
}
function cuadro(res) {
  const f = new Array(132).fill(0);
  const lados = res.handedness || res.handednesses || [];
  res.landmarks.forEach((p, i) => {
    const base = (lados[i] && lados[i][0].categoryName === "Left" ? 0 : 1) * 66;
    vector(p).forEach((x, j) => { f[base + j] = x; });
    f[base + 63] = (p[0].x - 0.5) * PESO * 2;  // posición de la muñeca en la imagen
    f[base + 64] = (p[0].y - 0.5) * PESO * 2;
    f[base + 65] = 1;                           // esa mano está presente
  });
  return f;
}
const hayMano = (f) => f[65] || f[131];
const secuencia = (fr) => Array.from({ length: N }, (_, i) => fr[Math.round(i * (fr.length - 1) / (N - 1))]);

function dtw(a, b) {
  const d = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) { const z = x[i] - y[i]; s += z * z; } return Math.sqrt(s); };
  const n = a.length, m = b.length;
  const C = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
  C[0][0] = 0;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) C[i][j] = d(a[i - 1], b[j - 1]) + Math.min(C[i - 1][j], C[i][j - 1], C[i - 1][j - 1]);
  return C[n][m] / (n + m);
}
function mejor(seq) {
  let m = { d: Infinity, id: null };
  for (const [id, arr] of Object.entries(datos)) {
    if (id.startsWith("_")) continue;
    for (const s of arr) { const d = dtw(seq, s); if (d < m.d) m = { d, id }; }
  }
  return m.id ? m : null;
}

// ---------- Interfaz ----------
GRUPOS.forEach((g) => {
  const og = document.createElement("optgroup"); og.label = g.titulo;
  g.frases.forEach(([id, t]) => { const o = document.createElement("option"); o.value = id; o.textContent = t; og.appendChild(o); });
  $("frase").appendChild(og);
});

function pintarConteo() {
  $("conteo").innerHTML = GRUPOS.map((g) => `<div><b>${g.titulo}</b>` + g.frases.map(([id, t]) => {
    const n = (datos[id] || []).length;
    return `<span class="${n >= REPS ? "ok" : ""}">${t}: ${n}</span>`;
  }).join("") + "</div>").join("");
}
pintarConteo();

let grabando = null, buf = [], ultimoEval = 0;

$("grabar").onclick = () => {
  if (grabando) return;
  const id = $("frase").value;
  let s = 3;
  $("mensaje").textContent = `Prepárate: ${TEXTO[id]} (${s})`;
  const cuenta = setInterval(() => {
    s--;
    if (s > 0) { $("mensaje").textContent = `Prepárate: ${TEXTO[id]} (${s})`; return; }
    clearInterval(cuenta);
    grabando = { id, frames: [], inicio: performance.now() };
    $("mensaje").textContent = `¡Haz "${TEXTO[id]}" ahora!`;
  }, 1000);
};

function terminar() {
  const g = grabando;
  grabando = null;
  $("progreso").style.width = "0%";
  if (g.frames.filter(hayMano).length < 10) { $("mensaje").textContent = "Casi no vi tus manos. Repite la grabación."; return; }
  if (!datos[g.id]) datos[g.id] = [];
  datos[g.id].push(secuencia(g.frames).map((f) => f.map((x) => +x.toFixed(3))));
  guardar(); pintarConteo();
  $("mensaje").textContent = `Guardada: ${TEXTO[g.id]} (${datos[g.id].length} de ${REPS})`;
}

$("borrar").onclick = () => { delete datos[$("frase").value]; guardar(); pintarConteo(); };

$("descargar").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: "application/json" }));
  a.download = "frases.json";
  a.click();
};

// Calibración: distancias entre repeticiones de la misma frase vs. de frases distintas
const pct = (arr, q) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(q * arr.length))];
$("calibrar").onclick = () => {
  $("info").textContent = "Calculando...";
  setTimeout(() => {
    const ids = Object.keys(datos).filter((k) => !k.startsWith("_") && datos[k].length >= 3);
    if (ids.length < 2) { $("info").textContent = "Graba al menos 3 repeticiones de 2 frases distintas."; return; }
    const p90s = [], fuera = [];
    ids.forEach((id) => {
      const ds = [];
      for (let i = 0; i < datos[id].length; i++) for (let j = i + 1; j < datos[id].length; j++) ds.push(dtw(datos[id][i], datos[id][j]));
      p90s.push(pct(ds, 0.9));
    });
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++)
      for (const x of datos[ids[a]].slice(0, 3)) for (const y of datos[ids[b]].slice(0, 3)) fuera.push(dtw(x, y));
    const dentro = pct(p90s, 0.5), cerca = pct(fuera, 0.05);
    const umbral = Math.min(dentro * 1.15, cerca * 0.9);
    datos._umbral = +umbral.toFixed(2);
    guardar();
    $("info").textContent = `Misma frase: ~${dentro.toFixed(2)} | frases distintas: desde ${cerca.toFixed(2)} | límite guardado: ${datos._umbral}`
      + (dentro >= cerca ? ". Hay traslape: graba repeticiones más parecidas entre sí." : ". Descarga el archivo para usarlo en la app.");
  }, 50);
};

// ---------- Cámara ----------
const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
const hl = await HandLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    delegate: "GPU"
  },
  runningMode: "VIDEO", numHands: 2
});
video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
await video.play();

function bucle() {
  requestAnimationFrame(bucle);
  const ahora = performance.now();
  if (grabando && ahora - grabando.inicio >= DUR) terminar();

  const res = hl.detectForVideo(video, ahora);
  ctx.clearRect(0, 0, 640, 480);
  const dibujo = new DrawingUtils(ctx);
  res.landmarks.forEach((p) => {
    dibujo.drawConnectors(p, HandLandmarker.HAND_CONNECTIONS, { color: grabando ? "#ff8fb8" : "#7c8cf8", lineWidth: 5 });
    dibujo.drawLandmarks(p, { color: "#ffffff", radius: 3 });
  });
  $("estado").textContent = res.landmarks.length ? `Manos detectadas: ${res.landmarks.length}` : "No veo ninguna mano";

  const f = cuadro(res);
  if (grabando) {
    grabando.frames.push(f);
    $("progreso").style.width = Math.min((ahora - grabando.inicio) / DUR * 100, 100) + "%";
    return;
  }
  buf.push({ f, time: ahora });
  while (buf.length && ahora - buf[0].time > DUR) buf.shift();
  if (ahora - ultimoEval < NEVAL) return;
  ultimoEval = ahora;
  if (buf.length < 15 || buf.filter((b) => hayMano(b.f)).length < 8) { $("pred").textContent = "Probando: ninguna mano"; return; }
  const m = mejor(secuencia(buf.map((b) => b.f)));
  $("pred").textContent = m ? `${TEXTO[m.id]} (dist ${m.d.toFixed(2)}, menor es mejor)` : "Aún no hay frases grabadas";
}
bucle();