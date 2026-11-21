import { HandLandmarker, FilesetResolver, DrawingUtils } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const $ = (id) => document.getElementById(id);
const ctx = $("canvas").getContext("2d");
const video = $("video");
const LETRAS = "A B C D E F G H I J K L LL M N Ñ O P Q R RR S T U V W X Y Z".split(" ");
const MUESTRAS = 30;   // poses fijas por letra y mano
const REPS = 8;        // repeticiones de movimiento por letra y mano
const DUR = 2000;      // duración de una grabación de movimiento (ms)
const N = 20, PESO = 2; // cuadros por secuencia y peso del desplazamiento de la mano

let datos = {};
try { datos = JSON.parse(localStorage.getItem("lsm-datos")) || {}; } catch (e) {}
const guardar = () => { try { localStorage.setItem("lsm-datos", JSON.stringify(datos)); } catch (e) {} };

// ---------- Poses fijas ----------
function vector(p) {
  const o = p[0], t = Math.hypot(p[9].x - o.x, p[9].y - o.y) || 1;
  return p.flatMap((q) => [(q.x - o.x) / t, (q.y - o.y) / t, (q.z - o.z) / t]);
}

function clasificar(v, k = 5) {
  const todos = [];
  for (const [clave, arr] of Object.entries(datos)) {
    if (clave.endsWith("|M")) continue;
    for (const m of arr) {
      let d = 0;
      for (let i = 0; i < v.length; i++) { const x = v[i] - m[i]; d += x * x; }
      todos.push([d, clave]);
    }
  }
  if (!todos.length) return null;
  todos.sort((a, b) => a[0] - b[0]);
  const cerca = todos.slice(0, k), cuenta = {};
  cerca.forEach(([, c]) => { cuenta[c] = (cuenta[c] || 0) + 1; });
  const [clave, n] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
  const [letra, mano] = clave.split("|");
  return { letra, mano, votos: n, de: cerca.length, dist: Math.sqrt(cerca[0][0]) };
}

// ---------- Movimientos (secuencias + DTW) ----------
// Cada cuadro: forma de la mano + cuánto se movió la muñeca desde el primer cuadro.
function secuencia(fr) {
  const b = fr[0];
  const lista = fr.map((f) => [...f.v, ((f.wx - b.wx) / b.t) * PESO, ((f.wy - b.wy) / b.t) * PESO]);
  return Array.from({ length: N }, (_, i) => lista[Math.round(i * (lista.length - 1) / (N - 1))]);
}

function dtw(a, b) {
  const d = (x, y) => { let s = 0; for (let i = 0; i < x.length; i++) { const z = x[i] - y[i]; s += z * z; } return Math.sqrt(s); };
  const n = a.length, m = b.length;
  const C = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
  C[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      C[i][j] = d(a[i - 1], b[j - 1]) + Math.min(C[i - 1][j], C[i][j - 1], C[i - 1][j - 1]);
    }
  }
  return C[n][m] / (n + m);
}

function clasificarMov(seq) {
  let mejor = null;
  for (const [clave, arr] of Object.entries(datos)) {
    if (!clave.endsWith("|M")) continue;
    for (const m of arr) {
      const dist = dtw(seq, m);
      if (!mejor || dist < mejor.dist) { const [letra, mano] = clave.split("|"); mejor = { letra, mano, dist }; }
    }
  }
  return mejor;
}

// ---------- Interfaz ----------
LETRAS.forEach((l) => { const o = document.createElement("option"); o.value = o.textContent = l; $("letra").appendChild(o); });

function pintarConteo() {
  const filas = [["D", "Derecha", "", MUESTRAS], ["I", "Izquierda", "", MUESTRAS],
                 ["D", "Mov. derecha", "|M", REPS], ["I", "Mov. izquierda", "|M", REPS]];
  $("conteo").innerHTML = filas.map(([m, nombre, suf, meta]) =>
    `<div><b>${nombre}</b>` + LETRAS.map((l) => {
      const n = (datos[`${l}|${m}${suf}`] || []).length;
      return `<span class="${n >= meta ? "ok" : ""}">${l}: ${n}</span>`;
    }).join("") + "</div>").join("");
}
pintarConteo();

const actualizarBoton = () => { $("grabar").textContent = $("tipo").value === "mov" ? "Grabar 1 movimiento (2 s)" : "Grabar 30 muestras"; };
$("tipo").onchange = actualizarBoton;
actualizarBoton();

let grabando = null, ultima = 0, buf = [], ultimoMov = 0;

$("grabar").onclick = () => {
  if (grabando) return;
  const tipo = $("tipo").value, letra = $("letra").value, mano = $("mano").value;
  const nombreMano = mano === "D" ? "derecha" : "izquierda";
  const clave = `${letra}|${mano}` + (tipo === "mov" ? "|M" : "");
  let s = 3;
  $("mensaje").textContent = `Prepárate: ${letra} con mano ${nombreMano} (${s})`;
  const cuenta = setInterval(() => {
    s--;
    if (s > 0) { $("mensaje").textContent = `Prepárate: ${letra} con mano ${nombreMano} (${s})`; return; }
    clearInterval(cuenta);
    if (tipo === "mov") {
      grabando = { tipo, letra, clave, nombreMano, frames: [], inicio: performance.now() };
      $("mensaje").textContent = `¡Haz la ${letra} ahora!`;
    } else {
      datos[clave] = [];
      grabando = { tipo, letra, clave, nombreMano, n: 0 };
      $("mensaje").textContent = `Grabando ${letra} con mano ${nombreMano}...`;
    }
  }, 1000);
};

$("borrar").onclick = () => {
  delete datos[`${$("letra").value}|${$("mano").value}` + ($("tipo").value === "mov" ? "|M" : "")];
  guardar(); pintarConteo();
};

$("descargar").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: "application/json" }));
  a.download = "senas.json";
  a.click();
};

function terminarMov() {
  const g = grabando;
  grabando = null;
  $("progreso").style.width = "0%";
  if (g.frames.length < 10) { $("mensaje").textContent = "Casi no vi tu mano. Repite la grabación."; return; }
  if (!datos[g.clave]) datos[g.clave] = [];
  datos[g.clave].push(secuencia(g.frames).map((f) => f.map((x) => +x.toFixed(3))));
  guardar(); pintarConteo();
  $("mensaje").textContent = `Movimiento ${g.letra} guardado (${datos[g.clave].length} de ${REPS})`;
}

// ---------- Cámara ----------
const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
const hl = await HandLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    delegate: "GPU"
  },
  runningMode: "VIDEO", numHands: 1
});
video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
await video.play();

function bucle() {
  requestAnimationFrame(bucle);
  const ahora = performance.now();
  if (grabando && grabando.tipo === "mov" && ahora - grabando.inicio >= DUR) terminarMov();

  const res = hl.detectForVideo(video, ahora);
  ctx.clearRect(0, 0, 640, 480);
  if (!res.landmarks.length) { $("estado").textContent = "No veo ninguna mano"; $("pred").textContent = "Probando: ninguna mano"; return; }

  const p = res.landmarks[0];
  const dibujo = new DrawingUtils(ctx);
  dibujo.drawConnectors(p, HandLandmarker.HAND_CONNECTIONS, { color: grabando ? "#ff8fb8" : "#7c8cf8", lineWidth: 5 });
  dibujo.drawLandmarks(p, { color: "#ffffff", radius: 3 });
  $("estado").textContent = "Mano detectada";

  const v = vector(p);
  const cuadro = { v, wx: p[0].x, wy: p[0].y, t: Math.hypot(p[9].x - p[0].x, p[9].y - p[0].y) || 1, time: ahora };

  if (grabando && grabando.tipo === "mov") {
    grabando.frames.push(cuadro);
    $("progreso").style.width = Math.min((ahora - grabando.inicio) / DUR * 100, 100) + "%";
  } else if (grabando) {
    if (ahora - ultima > 100) {
      ultima = ahora;
      datos[grabando.clave].push(v.map((x) => +x.toFixed(4)));
      grabando.n++;
      $("progreso").style.width = (grabando.n / MUESTRAS * 100) + "%";
      if (grabando.n >= MUESTRAS) {
        $("mensaje").textContent = `Listo: ${grabando.letra} con mano ${grabando.nombreMano} guardada`;
        grabando = null; guardar(); pintarConteo();
        setTimeout(() => { $("progreso").style.width = "0%"; }, 800);
      }
    }
  } else {
    const r = clasificar(v);
    $("pred").textContent = r
      ? `Pose: ${r.letra} (mano ${r.mano === "D" ? "derecha" : "izquierda"}, ${r.votos}/${r.de} vecinos, dist ${r.dist.toFixed(2)})`
      : "Pose: aún no hay señas grabadas";

    // Prueba en vivo de movimientos: se compara lo que hiciste en los últimos 2 s
    buf.push(cuadro);
    while (buf.length && ahora - buf[0].time > DUR) buf.shift();
    if (ahora - ultimoMov > 300 && buf.length >= 10) {
      ultimoMov = ahora;
      const m = clasificarMov(secuencia(buf));
      $("predMov").textContent = m
        ? `Movimiento: ${m.letra} (mano ${m.mano === "D" ? "derecha" : "izquierda"}, dist ${m.dist.toFixed(2)}, menor es mejor)`
        : "Movimiento: sin datos";
    }
  }
}
bucle();