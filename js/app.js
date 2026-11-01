import { HandLandmarker, FilesetResolver, DrawingUtils } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

import { GRUPOS, TEXTO } from "./frases.js";

const $ = (id) => document.getElementById(id);
const ctx = $("canvas").getContext("2d");
const video = $("video");
const mezclar = (a) => [...a].sort(() => Math.random() - 0.5);

// ---------- Tus grabaciones (senas.json) ----------
let datos = {};
try { datos = await (await fetch("senas.json")).json(); } catch (e) { console.error("No se pudo cargar senas.json", e); }

function aviso(txt) {
  let a = document.getElementById("aviso");
  if (!a) { a = document.createElement("div"); a.id = "aviso"; a.setAttribute("role", "alert"); document.getElementById("inicio").prepend(a); }
  a.textContent = txt;
}
if (location.protocol === "file:") aviso("Abre Monvi desde un servidor (localhost o internet), no con doble clic en el archivo. Si no, la cámara y los datos no cargan.");
else if (!Object.keys(datos).length) aviso("No se pudieron cargar las señas (senas.json). Revisa que el archivo esté junto a index.html.");

const MOV_MIN = 5;        // repeticiones mínimas para tratar una letra como movimiento
const UMBRAL_MOV = 1.15;  // distancia DTW máxima para aceptar un movimiento (menor = más estricto)
const N = 20, PESO = 2, DUR = 2000;

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
  return { letra, mano: mano || "?", votos: n };
}
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
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) C[i][j] = d(a[i - 1], b[j - 1]) + Math.min(C[i - 1][j], C[i][j - 1], C[i - 1][j - 1]);
  return C[n][m] / (n + m);
}
function mejorMovimiento(buf) {
  const seq = secuencia(buf);
  let mejor = { d: Infinity, letra: null };
  for (const [clave, arr] of Object.entries(datos)) {
    if (!clave.endsWith("|M")) continue;
    for (const m of arr) { const d = dtw(seq, m); if (d < mejor.d) mejor = { d, letra: clave.split("|")[0] }; }
  }
  return mejor;
}

// Letras con movimiento: las que tienen suficientes repeticiones grabadas
// Letras que llevan movimiento: las de esta lista y las que tengan suficientes repeticiones grabadas
const LETRAS_MOV = ["J", "K", "LL", "RR", "Ñ", "Q", "X", "Z"];
const MOV_LETRAS = new Set([...LETRAS_MOV,
  ...Object.keys(datos).filter((k) => k.endsWith("|M") && datos[k].length >= MOV_MIN).map((k) => k.split("|")[0])]);
const tieneMov = (letra, mano) => (datos[`${letra}|${mano}|M`] || []).length >= MOV_MIN;

// ---------- Errores mínimos que se aceptan como válidos ----------
// "pide X" -> también vale detectar cualquiera de la lista. Edita esta tabla a tu gusto.
const ACEPTAN = {
  P: ["K"], K: ["P"], M: ["N"], N: ["M", "Ñ"], Ñ: ["N"],
  I: ["J"], R: ["RR", "Y", "U"], RR: ["R", "Y", "U"], U: ["V"], V: ["U"], L: ["LL"], LL: ["L"]
};
const aceptadas = (l) => [l, ...(ACEPTAN[l] || [])];

// Frases parecidas o que dependen de un gesto de la cara (valen en los dos sentidos)
const PAREJAS_FRASES = [["entiendo", "noentiendo"], ["si", "no"], ["soysordo", "soyoyente"], ["buenastardes", "buenasnoches"],
  ["buenosdias", "buenastardes"], ["que", "quien"], ["donde", "cuando"]];
const ACEPTAN_FRASES = {};
PAREJAS_FRASES.forEach(([a, b]) => { (ACEPTAN_FRASES[a] ||= []).push(b); (ACEPTAN_FRASES[b] ||= []).push(a); });
// Confusiones que aparecieron en tus grabaciones (solo en un sentido)
Object.entries({ cuando: ["agua"], porque: ["conpermiso"], medico: ["soyoyente"], comida: ["denada"] })
  .forEach(([k, v]) => { (ACEPTAN_FRASES[k] ||= []).push(...v); });
const aceptadasF = (id) => [id, ...(ACEPTAN_FRASES[id] || [])];

const FRASES = TEXTO;

// ---------- Frases (frases.json, grabadas con grabar-frases.html) ----------
let datosF = {};
try { datosF = await (await fetch("frases.json")).json(); } catch (e) {}
const MIN_REPS_FRASE = 5, DURF = 3000, NF = 30, NEVAL = 300;
const MARGEN = 0.85;      // la frase pedida debe quedar al menos 15% más cerca que cualquier otra
const PASES = 3, DE = 5;  // hacen falta 3 aciertos en las últimas 5 revisiones (~1.5 s)
const frasePorCamara = (id) => (datosF[id] || []).length >= MIN_REPS_FRASE;

function cuadroFrase(res) {
  const f = new Array(132).fill(0);
  const lados = res.handedness || res.handednesses || [];
  res.landmarks.forEach((p, i) => {
    const base = (lados[i] && lados[i][0].categoryName === "Left" ? 0 : 1) * 66;
    vector(p).forEach((x, j) => { f[base + j] = x; });
    f[base + 63] = (p[0].x - 0.5) * PESO * 2;
    f[base + 64] = (p[0].y - 0.5) * PESO * 2;
    f[base + 65] = 1;
  });
  return f;
}
const secF = (fr) => Array.from({ length: NF }, (_, i) => fr[Math.round(i * (fr.length - 1) / (NF - 1))]);

// DTW con banda (más rápido y evita alineaciones absurdas)
function dtwB(a, b, band = 8) {
  const n = a.length, m = b.length, W = m + 1;
  const C = new Float64Array((n + 1) * W).fill(Infinity);
  C[0] = 0;
  for (let i = 1; i <= n; i++) {
    const x = a[i - 1];
    for (let j = Math.max(1, i - band); j <= Math.min(m, i + band); j++) {
      const y = b[j - 1]; let t = 0;
      for (let k = 0; k < x.length; k++) { const z = x[k] - y[k]; t += z * z; }
      C[i * W + j] = Math.sqrt(t) + Math.min(C[(i - 1) * W + j], C[i * W + j - 1], C[(i - 1) * W + j - 1]);
    }
  }
  return C[n * W + m] / (n + m);
}
function recorridoSeq(seq) { // cuánto se movieron las manos
  let t = 0;
  for (let i = 1; i < seq.length; i++) for (const base of [0, 66]) {
    if (seq[i - 1][base + 65] && seq[i][base + 65]) t += Math.hypot(seq[i][base + 63] - seq[i - 1][base + 63], seq[i][base + 64] - seq[i - 1][base + 64]);
  }
  return t;
}
const presenciaSeq = (seq) => seq.filter((f) => f[65] || f[131]).length / seq.length;
// Se descartan grabaciones malas: manos casi siempre fuera de cuadro o casi sin movimiento
const MIN_PRES = 0.45, MIN_REC = 0.4;
for (const id of Object.keys(datosF)) {
  if (!id.startsWith("_")) datosF[id] = datosF[id].filter((s) => presenciaSeq(s) >= MIN_PRES && recorridoSeq(s) >= MIN_REC);
}
const mediana = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const percentil = (a, q) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(q * a.length))];

// Parámetros de cada frase, calculados con TUS grabaciones: qué tan parecidas son entre sí,
// cuánto se mueven las manos y cuánto tiempo se ven.
const PF = {};
let PF_LISTO = false;
function calcularParametros() {
  PF_LISTO = true;
  for (const [id, s] of Object.entries(datosF)) {
    if (id.startsWith("_") || s.length < MIN_REPS_FRASE) continue;
    const D = s.map(() => s.map(() => Infinity));
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) D[i][j] = D[j][i] = dtwB(s[i], s[j]);
    PF[id] = { thr: percentil(D.map((f) => Math.min(...f)), 0.9), rec: mediana(s.map(recorridoSeq)), pres: mediana(s.map(presenciaSeq)) };
  }
}
setTimeout(calcularParametros, 500);

// Una revisión: ¿lo que hizo el usuario en los últimos 3 s es la frase pedida (o una muy parecida)?
function evaluarFrase(id, b) {
  const seq = secF(b.map((x) => x.f));
  const p = PF[id], validas = aceptadasF(id);
  if (presenciaSeq(seq) < 0.7 * p.pres) return { ok: false, motivo: "manos" };
  if (recorridoSeq(seq) < 0.5 * p.rec) return { ok: false, motivo: "mov" };
  let dA = Infinity, claseA = null, dR = Infinity;
  for (const [k, arr] of Object.entries(datosF)) {
    if (k.startsWith("_") || !PF[k]) continue;
    for (const g of arr) {
      const d = dtwB(seq, g);
      if (validas.includes(k)) { if (d < dA) { dA = d; claseA = k; } } else if (d < dR) dR = d;
    }
  }
  const ok = claseA !== null && dA < PF[claseA].thr && dA < MARGEN * dR;
  return { ok, dA, dR, motivo: ok ? "ok" : "lejos" };
}

// ---------- Niveles ----------
const NIVELES = [
  { id: 1, titulo: "Vocales", sub: "A, E, I, O, U", letras: ["A", "E", "I", "O", "U"] },
  { id: 2, titulo: "Práctica de vocales", sub: "En orden aleatorio", letras: ["A", "E", "I", "O", "U"], mezclar: true },
  { id: 3, titulo: "Abecedario 1", sub: "B, C, D, F", letras: ["B", "C", "D", "F"], repaso: 3 },
  { id: 4, titulo: "Abecedario 2", sub: "G, H, J, K", letras: ["G", "H", "J", "K"], repaso: 3 },
  { id: 5, titulo: "Abecedario 3", sub: "L, LL, M, N", letras: ["L", "LL", "M", "N"], repaso: 3 },
  { id: 6, titulo: "Abecedario 4", sub: "Ñ, P, Q, R", letras: ["Ñ", "P", "Q", "R"], repaso: 3 },
  { id: 7, titulo: "Abecedario 5", sub: "RR, S, T, V", letras: ["RR", "S", "T", "V"], repaso: 3 },
  { id: 8, titulo: "Abecedario 6", sub: "W, X, Y, Z", letras: ["W", "X", "Y", "Z"], repaso: 3 },
  { id: 21, titulo: "Repaso 1", sub: "B, C, D, F, G, H", letras: ["B", "C", "D", "F", "G", "H"], mezclar: true },
  { id: 22, titulo: "Repaso 2", sub: "J, K, L, LL, M, N", letras: ["J", "K", "L", "LL", "M", "N"], mezclar: true },
  { id: 23, titulo: "Repaso 3", sub: "Ñ, P, Q, R, RR, S", letras: ["Ñ", "P", "Q", "R", "RR", "S"], mezclar: true },
  { id: 24, titulo: "Repaso 4", sub: "T, V, W, X, Y, Z", letras: ["T", "V", "W", "X", "Y", "Z"], mezclar: true },
  { id: 25, titulo: "Repaso general", sub: "12 letras al azar", cuantas: 12,
    pool: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "LL", "M", "N", "Ñ", "O", "P", "Q", "R", "RR", "S", "T", "U", "V", "W", "X", "Y", "Z"] },
  { id: 9, titulo: "Mini examen", sub: "Deletrea palabras", palabras: ["GATO", "ANA", "PIÑA", "CARRO"] },
  ...GRUPOS.map((g, i) => ({ id: 10 + i, titulo: "Frases: " + g.titulo, sub: g.sub, frases: g.frases.map((f) => f[0]) }))
];

// ---------- Evaluación de una letra con tus grabaciones ----------
const MOV_MIN_BASE = 0.15; // por debajo de esto la mano está quieta y no cuenta
const MOV_MIN_REC = 0.6; // cuánto debe moverse la mano (en tamaños de mano) si no hay movimiento grabado
function extensionMov(b) {
  if (b.length < 5) return 0;
  const xs = b.map((f) => f.wx), ys = b.map((f) => f.wy), t = b.reduce((a, f) => a + f.t, 0) / b.length;
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / t;
}
function formaEnVentana(letra, b) { // ¿la forma de la letra apareció en el último segundo?
  const ok = aceptadas(letra); let n = 0;
  for (let i = Math.max(0, b.length - 36); i < b.length; i += 3) {
    const r = clasificar(b[i].v);
    if (r && r.votos >= 3 && ok.includes(r.letra)) n++;
  }
  return n >= 2;
}

function evaluarLetra(letra, p, buf) {
  const r = clasificar(vector(p));
  if (!r) return { nivel: "mal", texto: "Aún no hay señas grabadas", dbg: "" };
  let dbg = `Pose: ${r.letra} (${r.votos}/5)`;

  if (MOV_LETRAS.has(letra)) {
    const mueve = extensionMov(buf);
    dbg += ` | mov ${mueve.toFixed(2)}`;
    const pide = { nivel: "casi", texto: `Haz el movimiento de la ${letra}`, dbg };
    if (mueve < MOV_MIN_BASE) return pide;            // la mano está quieta: se espera el movimiento
    const hayDatos = tieneMov(letra, "D") || tieneMov(letra, "I");
    if (hayDatos && buf.length >= 10) {
      const m = mejorMovimiento(buf);
      pide.dbg = dbg += ` | DTW ${m.letra} ${m.d.toFixed(2)}`;
      if (m.letra === letra && m.d < UMBRAL_MOV) return { nivel: "ok", texto: "¡Bien hecho!", dbg };
    }
    // Una letra parecida (por ejemplo L al pedir LL) también vale, si hay movimiento
    if (r.letra !== letra && aceptadas(letra).includes(r.letra) && r.votos >= 3) return { nivel: "ok", texto: "¡Bien hecho!", dbg };
    // Sin movimiento grabado para esa mano: vale la forma de la letra mientras la mano se mueve
    if ((!hayDatos || !tieneMov(letra, r.mano)) && mueve >= MOV_MIN_REC && formaEnVentana(letra, buf)) return { nivel: "ok", texto: "¡Bien hecho!", dbg };
    return pide;
  }

  if (aceptadas(letra).includes(r.letra) && r.votos >= 3) return { nivel: "ok", texto: "¡Bien hecho!", dbg };
  if (r.votos >= 3) return { nivel: "mal", texto: `Eso parece la ${r.letra}. Mira el ejemplo.`, dbg };
  return { nivel: "casi", texto: "Casi. Acomoda la mano como en el video.", dbg };
}

// ---------- Progreso guardado (racha incluida) ----------
let guardado = { xp: 0, hechos: [], racha: 0, ultimoDia: "" };
try { guardado = { ...guardado, ...JSON.parse(localStorage.getItem("lsm-progreso")) }; } catch (e) {}
const guardar = () => { try { localStorage.setItem("lsm-progreso", JSON.stringify(guardado)); } catch (e) {} };
const fecha = (ms) => new Date(ms).toLocaleDateString("en-CA");

function actualizarRacha() {
  const hoy = fecha(Date.now());
  if (guardado.ultimoDia === hoy) return;
  guardado.racha = guardado.ultimoDia === fecha(Date.now() - 864e5) ? guardado.racha + 1 : 1;
  guardado.ultimoDia = hoy;
}
function rachaVisible() { // si pasó más de un día sin practicar, se muestra en 0
  const ok = [fecha(Date.now()), fecha(Date.now() - 864e5)].includes(guardado.ultimoDia);
  return ok ? guardado.racha : 0;
}

// ---------- Pantalla principal ----------
let pantalla = "inicio";

function pintarInicio() {
  pantalla = "inicio";
  $("inicio").classList.remove("oculto");
  $("leccion").classList.add("oculto");
  $("xpTotal").textContent = guardado.xp;
  $("racha").textContent = rachaVisible();

  const mapa = $("mapa");
  mapa.innerHTML = "";
  $("demo").textContent = guardado.demo ? "Modo demo: activado" : "Modo demo: desactivado";
  NIVELES.forEach((n, i) => {
    const hecho = guardado.hechos.includes(n.id);
    const abierto = guardado.demo || i === 0 || guardado.hechos.includes(NIVELES[i - 1].id);
    const b = document.createElement("button");
    b.className = "nivel " + (hecho ? "hecho" : abierto ? "abierto" : "bloqueado");
    b.innerHTML = `<svg class="mascota${i % 7 === 6 ? " mono" : ""}"><use href="#m${i % 7 + 1}"/></svg><span class="num">Nivel ${i + 1}</span><span class="tit">${n.titulo}</span><small>${n.sub}</small><span class="estado">${hecho ? "Completado" : abierto ? "Empezar" : "Bloqueado"}</span>`;
    b.style.animationDelay = `${i * 70}ms`;
    if (abierto) b.onclick = () => empezarNivel(n);
    mapa.appendChild(b);
  });
}

$("demo").onclick = () => { guardado.demo = !guardado.demo; guardar(); pintarInicio(); };
$("reiniciar").onclick = () => {
  if (!confirm("¿Borrar XP, racha y niveles completados de este navegador?")) return;
  guardado = { xp: 0, hechos: [], racha: 0, ultimoDia: "", demo: guardado.demo }; guardar(); pintarInicio();
};

// ---------- Lección ----------
const TIEMPO_REQUERIDO = 1000, XP_POR_ITEM = 10, PAUSA = 1200, LIMITE = 25000, VIDAS = 3;
let sesion = 0, nivelActual, items, indice, xpSesion, vidas, inicioItem;
let inicioOk = null, enPausa = false, terminado = false, buf = [], bufF = [], ultimoEval = 0, ultimoR = null, viendoVideo = false;

function armarItems(n) {
  if (n.items) return n.items;
  if (n.palabras) return n.palabras.flatMap((w) => [...w].map((l, pos) => ({ tipo: "letra", clave: l, palabra: w, pos })));
  if (n.frases) return n.frases.map((c) => ({ tipo: "frase", clave: c }));
  if (n.pool) return mezclar(n.pool).slice(0, n.cuantas || 10).map((l) => ({ tipo: "letra", clave: l, nueva: false }));
  const base = (n.mezclar ? mezclar(n.letras) : n.letras).map((l) => ({ tipo: "letra", clave: l, nueva: !n.mezclar }));
  if (n.repaso) {
    const previas = NIVELES.filter((x) => x.id < n.id && x.letras).flatMap((x) => x.letras).filter((l) => !n.letras.includes(l));
    base.push(...mezclar([...new Set(previas)]).slice(0, n.repaso).map((l) => ({ tipo: "letra", clave: l, nueva: false })));
  }
  return base;
}

async function empezarNivel(n) {
  sesion++; nivelActual = n; items = armarItems(n);
  indice = 0; xpSesion = 0; vidas = VIDAS; terminado = false; enPausa = false;
  pintarVidas();
  $("vidas").classList.toggle("oculto", !!n.libre);
  $("xpChip").classList.toggle("oculto", !!n.libre);
  pintarXp(); viendoVideo = false; $("ejemplo").classList.add("oculto");
  $("inicio").classList.add("oculto");
  $("leccion").classList.remove("oculto");
  pantalla = "leccion";
  mostrarItem();
  const mi = sesion;
  await iniciarCamara();
  if (mi !== sesion) return;
  if (handLandmarker) handLandmarker.setOptions({ numHands: items[indice].tipo === "frase" ? 2 : 1 });
  if (!viendoVideo) { inicioItem = performance.now(); inicioOk = null; } // el tiempo no corre mientras carga el modelo
}

const pintarVidas = () => {
  $("vidas").innerHTML = Array.from({ length: VIDAS }, (_, i) =>
    `<svg class="cor ${i < vidas ? "" : "vacio"}"><use href="#corazon"/></svg>`).join("");
};

const COSTO_VIDEO = 5;
const nombreVideo = (c) => c.replace(/Ñ/g, "enie"); // Ñ -> assets/videos/enie.mp4
const videosFallidos = new Set();
const pintarXp = () => { $("xpLeccion").textContent = xpSesion; };

function abrirVideo(cobrar) {
  const it = items[indice];
  if (cobrar && !nivelActual.libre) { xpSesion = Math.max(0, xpSesion - COSTO_VIDEO); pintarXp(); }
  const src = it.tipo === "frase" ? `assets/videos/frases/${it.clave}.mp4` : `assets/videos/${nombreVideo(it.clave)}.mp4`;
  $("tituloEjemplo").textContent = it.tipo === "frase" ? `Así se hace: ${FRASES[it.clave]}` : `Así se hace la letra ${it.clave}`;
  const falla = videosFallidos.has(src);
  $("sinVideo").classList.toggle("oculto", !falla);
  $("videoEjemplo").classList.toggle("oculto", falla);
  if (!falla) {
    $("videoEjemplo").onerror = () => { videosFallidos.add(src); $("videoEjemplo").classList.add("oculto"); $("sinVideo").classList.remove("oculto"); };
    if (!$("videoEjemplo").src.endsWith(src)) $("videoEjemplo").src = src;
    $("videoEjemplo").play().catch(() => {});
  }
  $("ejemplo").classList.remove("oculto");
  viendoVideo = true;
}
function cerrarVideo() {
  $("videoEjemplo").pause();
  $("ejemplo").classList.add("oculto");
  viendoVideo = false;
  inicioItem = performance.now(); inicioOk = null; buf = []; bufF = []; pases = []; ultimoR = null;
}
$("verEjemplo").onclick = () => { if (!enPausa && !terminado && !viendoVideo) abrirVideo(true); };
$("empezar").onclick = cerrarVideo;

function mostrarItem() {
  const it = items[indice], o = $("objetivo");
  $("progresoNivel").style.width = (indice / items.length * 100) + "%";
  if (it.palabra) {
    o.innerHTML = `<div class="sub">Deletrea la palabra</div><div class="palabra">${[...it.palabra].map((l, i) =>
      `<span class="${i === it.pos ? "act" : i < it.pos ? "ya" : ""}">${l}</span>`).join("")}</div>`;
  } else if (it.tipo === "frase") {
    o.innerHTML = `<div class="sub">Practica esta frase</div><div class="frase">${FRASES[it.clave]}</div>`;
  } else {
    o.innerHTML = `<div class="sub">${MOV_LETRAS.has(it.clave) ? "Letra con movimiento" : it.nueva ? "Letra nueva" : "Repaso"}</div><div class="letraGrande">${it.clave}</div>`;
  }
  if (it.tipo === "frase" || it.nueva) abrirVideo(false); else viendoVideo = false; // el video sale la primera vez
  $("confirmar").classList.toggle("oculto", it.tipo !== "frase" || frasePorCamara(it.clave));
  $("barra").classList.toggle("oculto", it.tipo === "frase" && !frasePorCamara(it.clave));
  $("mensaje").className = "";
  $("mensaje").textContent = it.tipo === "frase" ? (frasePorCamara(it.clave) ? "Mira el video y haz la frase frente a la cámara." : "Mira el video, repítela frente a la cámara y confirma.") : "Muestra tu mano a la cámara";
  inicioOk = null; $("progreso").style.width = "0%";
  inicioItem = performance.now();
  buf = []; bufF = []; pases = []; ultimoR = null;
  if (handLandmarker) handLandmarker.setOptions({ numHands: it.tipo === "frase" ? 2 : 1 });
}

$("salir").onclick = () => { sesion++; detenerCamara(); terminado = true; viendoVideo = false; $("ejemplo").classList.add("oculto"); pintarInicio(); };
$("volver").onclick = () => { $("final").classList.add("oculto"); detenerCamara(); pintarInicio(); };
$("reintentar").onclick = () => { $("final").classList.add("oculto"); empezarNivel(nivelActual); };
$("confirmar").onclick = () => { if (!enPausa && !terminado) itemCompletado(); };

function itemCompletado() {
  xpSesion += XP_POR_ITEM; pintarXp();
  enPausa = true;
  $("progresoNivel").style.width = ((indice + 1) / items.length * 100) + "%";
  $("mensaje").textContent = `¡Muy bien! +${XP_POR_ITEM} XP`;
  $("mensaje").className = "ok";
  const mi = sesion;
  setTimeout(() => {
    if (mi !== sesion) return;
    indice++;
    if (indice >= items.length) terminarNivel(true);
    else { mostrarItem(); }
    enPausa = false;
  }, PAUSA);
}

function perderVida() {
  vidas--; pintarVidas();
  if (vidas <= 0) { terminarNivel(false); return; }
  $("mensaje").textContent = "Se acabó el tiempo. ¡Inténtalo otra vez!";
  $("mensaje").className = "mal";
  inicioItem = performance.now(); inicioOk = null; $("progreso").style.width = "0%";
}

function terminarNivel(gano) {
  terminado = true;
  if (gano && nivelActual.libre) {
    $("finalTitulo").textContent = "¡Lo lograste!";
    $("finalTexto").textContent = "Escribe otro mensaje cuando quieras practicar más.";
    confeti();
  } else if (gano) {
    guardado.xp += xpSesion;
    if (!guardado.hechos.includes(nivelActual.id)) guardado.hechos.push(nivelActual.id);
    actualizarRacha(); guardar();
    $("finalTitulo").textContent = "¡Lección completada!";
    $("finalTexto").textContent = `Ganaste ${xpSesion} XP. Racha: ${guardado.racha} día(s).`;
    confeti();
  } else {
    $("finalTitulo").textContent = "Te quedaste sin vidas";
    $("finalTexto").textContent = "No pasa nada, repasa el ejemplo e inténtalo de nuevo.";
  }
  $("reintentar").classList.toggle("oculto", gano);
  $("final").classList.remove("oculto");
}

// ---------- Confeti ----------
function confeti() {
  const c = $("confeti"), g = c.getContext("2d");
  c.width = innerWidth; c.height = innerHeight;
  const cols = ["#b9a0f5", "#ffe08a", "#ffb3d1", "#a9d2ff", "#bff0dd"];
  const ps = Array.from({ length: 170 }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.5,
    vx: Math.random() * 4 - 2, vy: 3 + Math.random() * 4,
    s: 7 + Math.random() * 7, c: cols[(Math.random() * cols.length) | 0], r: Math.random() * 6, k: Math.random()
  }));
  let t = 0;
  (function f() {
    g.clearRect(0, 0, c.width, c.height);
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.r += 0.1;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.c;
      if (p.k < 0.3) {
        g.beginPath();
        for (let i = 0; i < 10; i++) { const rr = i % 2 ? p.s * 0.45 : p.s; g.lineTo(Math.cos(i * Math.PI / 5) * rr, Math.sin(i * Math.PI / 5) * rr); }
        g.closePath(); g.fill();
      } else if (p.k < 0.6) { g.beginPath(); g.arc(0, 0, p.s / 2, 0, 7); g.fill(); }
      else g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      g.restore();
    }
    if (++t < 200) requestAnimationFrame(f); else g.clearRect(0, 0, c.width, c.height);
  })();
}

// ---------- Práctica libre: texto a señas ----------
const norm = (t) => t.toLowerCase().replace(/ñ/g, "\u0001").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\u0001/g, "ñ").replace(/[^a-zñ\s]/g, " ").replace(/\s+/g, " ").trim();
const INDICE_FRASES = {};
Object.entries(FRASES).forEach(([id, t]) => { INDICE_FRASES[norm(t)] = id; });
[["hola mi nombre es", "nombre"], ["hola yo soy", "nombre"], ["mi nombre es", "nombre"]].forEach(([k, id]) => { INDICE_FRASES[k] = id; });

// Junta frases conocidas (las más largas primero) y deletrea el resto
function textoAItems(texto) {
  const palabras = norm(texto).split(" ").filter(Boolean), out = [];
  for (let i = 0; i < palabras.length && out.length < 40;) {
    let hecho = false;
    for (let j = Math.min(palabras.length, i + 5); j > i; j--) {
      const id = INDICE_FRASES[palabras.slice(i, j).join(" ")];
      if (id) { out.push({ tipo: "frase", clave: id }); i = j; hecho = true; break; }
    }
    if (hecho) continue;
    const w = palabras[i].toUpperCase();
    [...w].forEach((l, pos) => out.push({ tipo: "letra", clave: l, palabra: w, pos }));
    i++;
  }
  return out;
}
$("practicar").onclick = () => {
  const its = textoAItems($("textoLibre").value);
  if (!its.length) { $("textoLibre").focus(); return; }
  empezarNivel({ id: 0, libre: true, titulo: "Práctica libre", items: its });
};
$("textoLibre").onkeydown = (e) => { if (e.key === "Enter") $("practicar").click(); };

// ---------- Cámara y MediaPipe ----------
let handLandmarker = null, camaraLista = false, bucleActivo = false;
function detenerCamara() { video.srcObject?.getTracks().forEach((t) => t.stop()); video.srcObject = null; camaraLista = false; }

async function iniciarCamara() {
  if (camaraLista) return;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("sin-camara-api");
    $("estado").textContent = handLandmarker ? "Activando cámara..." : "Cargando modelo (la primera vez tarda unos segundos)...";
    if (handLandmarker) { video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } }); await video.play(); camaraLista = true; return; }
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO", numHands: 2
    });
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    await video.play();
    camaraLista = true;
    if (!bucleActivo) { bucleActivo = true; bucle(); }
  } catch (e) {
    $("estado").textContent = e.name === "NotAllowedError" ? "Permiso de cámara denegado. Actívalo en el candado de la barra de direcciones y recarga."
      : e.name === "NotFoundError" ? "No se encontró ninguna cámara conectada."
      : e.message === "sin-camara-api" ? "Este navegador necesita https o localhost para usar la cámara."
      : "No se pudo cargar el modelo. Revisa tu conexión a internet y recarga.";
    console.error(e);
  }
}

let pases = [];
function procesarFrase(res, it, dibujo) {
  const ahora = performance.now();
  res.landmarks.forEach((p) => {
    trazo(dibujo, p, colores.ok);
    dibujo.drawLandmarks(p, { color: "#3a2f66", fillColor: "#ffffff", lineWidth: 2, radius: 3 });
  });
  if (!frasePorCamara(it.clave)) return;
  bufF.push({ f: cuadroFrase(res), time: ahora });
  while (bufF.length && ahora - bufF[0].time > DURF) bufF.shift();
  if (ahora - inicioItem > 20000) $("confirmar").classList.remove("oculto"); // salida de emergencia
  if (ahora - ultimoEval < NEVAL) return;
  ultimoEval = ahora;
  if (!PF_LISTO) calcularParametros();
  if (bufF.length < 15 || !PF[it.clave]) return;

  const r = evaluarFrase(it.clave, bufF);
  pases.push(r.ok ? 1 : 0);
  if (pases.length > DE) pases.shift();
  const n = pases.reduce((a, b) => a + b, 0);
  $("progreso").style.width = (Math.min(n / PASES, 1) * 100) + "%";
  $("debug").textContent = r.dA === undefined ? "" : `Frase: dist ${r.dA.toFixed(2)} | otras ${r.dR.toFixed(2)} | aciertos ${n}/${PASES}`;
  if (n >= PASES) { itemCompletado(); return; }
  const msg = { manos: ["Muestra tus manos a la cámara", ""], mov: ["Haz la frase completa, con movimiento", "casi"],
    lejos: ["Casi. Mira el video y repite la frase completa", "casi"], ok: ["¡Vas bien, sigue así!", "ok"] }[r.motivo];
  $("mensaje").textContent = msg[0]; $("mensaje").className = msg[1];
}

function trazo(dibujo, p, color) {
  dibujo.drawConnectors(p, HandLandmarker.HAND_CONNECTIONS, { color: "#ffffff", lineWidth: 10 });
  dibujo.drawConnectors(p, HandLandmarker.HAND_CONNECTIONS, { color, lineWidth: 5 });
}
const colores = { ok: "#7c8cf8", casi: "#ffc94d", mal: "#ff8fb8" };

function bucle() {
  requestAnimationFrame(bucle);
  if (pantalla !== "leccion" || !items || !camaraLista) return;

  const it = items[Math.min(indice, items.length - 1)];
  const activo = !enPausa && !terminado && !viendoVideo;

  // Reloj (solo en letras)
  if (it.tipo === "letra") {
    const resta = Math.max(0, Math.ceil((LIMITE - (performance.now() - inicioItem)) / 1000));
    $("reloj").textContent = nivelActual.libre ? "Sin tiempo límite" : "Tiempo " + resta + " s";
    if (activo && resta <= 0 && !nivelActual.libre) perderVida();
  } else $("reloj").textContent = "Sin tiempo límite";

  const res = handLandmarker.detectForVideo(video, performance.now());
  ctx.clearRect(0, 0, 640, 480);
  const dibujo = new DrawingUtils(ctx);
  if (it.tipo === "frase" && activo) procesarFrase(res, it, dibujo);

  if (res.landmarks.length > 0) {
    const p = res.landmarks[0];
    $("estado").textContent = "Mano detectada";

    if (it.tipo === "letra") {
      const ahora = performance.now();
      buf.push({ v: vector(p), wx: p[0].x, wy: p[0].y, t: Math.hypot(p[9].x - p[0].x, p[9].y - p[0].y) || 1, time: ahora });
      while (buf.length && ahora - buf[0].time > DUR) buf.shift();

      const esMov = MOV_LETRAS.has(it.clave);
      let r;
      if (!activo) r = { nivel: "ok", texto: "", dbg: "" };
      else if (esMov) {
        // Letras con movimiento: igual que las frases, se espera a detectar el movimiento (3 de las últimas 5 revisiones)
        if (ahora - ultimoEval >= NEVAL) {
          ultimoEval = ahora;
          ultimoR = evaluarLetra(it.clave, p, buf);
          pases.push(ultimoR.nivel === "ok" ? 1 : 0);
          if (pases.length > DE) pases.shift();
        }
        r = ultimoR || { nivel: "casi", texto: `Haz el movimiento de la ${it.clave}`, dbg: "" };
      } else r = evaluarLetra(it.clave, p, buf);

      trazo(dibujo, p, colores[r.nivel]);
      dibujo.drawLandmarks(p, { color: "#3a2f66", fillColor: "#ffffff", lineWidth: 2, radius: 3 });
      if (activo) {
        if (esMov) {
          const n = pases.reduce((a, b) => a + b, 0);
          $("progreso").style.width = (Math.min(n / PASES, 1) * 100) + "%";
          if (n >= PASES) { itemCompletado(); return; }
        } else if (r.nivel === "ok") {
          if (inicioOk === null) inicioOk = performance.now();
          const av = Math.min((performance.now() - inicioOk) / TIEMPO_REQUERIDO, 1);
          $("progreso").style.width = (av * 100) + "%";
          if (av >= 1) itemCompletado();
        } else { inicioOk = null; $("progreso").style.width = "0%"; }
        if (!enPausa) { $("mensaje").textContent = r.texto; $("mensaje").className = r.nivel; }
        $("debug").textContent = r.dbg;
      }
    } else {
      trazo(dibujo, p, colores.ok);
      dibujo.drawLandmarks(p, { color: "#3a2f66", fillColor: "#ffffff", lineWidth: 2, radius: 3 });
    }
  } else {
    $("estado").textContent = "No veo ninguna mano";
    $("debug").textContent = "";
    if (activo && it.tipo === "letra") {
      $("mensaje").textContent = "Muestra tu mano a la cámara";
      $("mensaje").className = "";
      inicioOk = null; pases = []; ultimoR = null; $("progreso").style.width = "0%";
    }
  }
}

pintarInicio();