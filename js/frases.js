// Frases por nivel: [id, texto]. El id es el nombre del video (assets/videos/frases/ID.mp4)
// y la clave con la que se guardan las grabaciones en frases.json.
export const GRUPOS = [
  { titulo: "Saludos", sub: "Hola, adiós, buenos días…", frases: [
    ["hola", "Hola"], ["buenosdias", "Buenos días"], ["buenastardes", "Buenas tardes"],
    ["buenasnoches", "Buenas noches"], ["adios", "Adiós"], ["comoestas", "¿Cómo estás?"] ] },
  { titulo: "Cortesía", sub: "Gracias, por favor, perdón…", frases: [
    ["gracias", "Gracias"], ["denada", "De nada"], ["porfavor", "Por favor"],
    ["perdon", "Perdón"], ["conpermiso", "Con permiso"], ["bienvenido", "Bienvenido"] ] },
  { titulo: "Respuestas", sub: "Sí, no, entiendo…", frases: [
    ["si", "Sí"], ["no", "No"], ["talvez", "Tal vez"],
    ["entiendo", "Entiendo"], ["noentiendo", "No entiendo"], ["despacio", "Más despacio, por favor"] ] },
  { titulo: "Presentación", sub: "Yo soy, mucho gusto…", frases: [
    ["nombre", "Hola, yo soy…"], ["comotellamas", "¿Cómo te llamas?"], ["muchogusto", "Mucho gusto"],
    ["soysordo", "Soy sordo"], ["soyoyente", "Soy oyente"], ["aprendolsm", "Estoy aprendiendo LSM"] ] },
  { titulo: "Necesidades", sub: "Ayuda, agua, baño…", frases: [
    ["ayuda", "Ayuda"], ["agua", "Agua"], ["bano", "Baño"],
    ["comida", "Comida"], ["meduele", "Me duele"], ["medico", "Necesito un médico"] ] },
  { titulo: "Preguntas", sub: "Dónde, qué, cuándo…", frases: [
    ["donde", "¿Dónde?"], ["que", "¿Qué?"], ["cuando", "¿Cuándo?"],
    ["porque", "¿Por qué?"], ["quien", "¿Quién?"], ["cuanto", "¿Cuánto cuesta?"] ] }
];
export const TEXTO = {};
GRUPOS.forEach((g) => g.frases.forEach(([id, t]) => { TEXTO[id] = t; }));