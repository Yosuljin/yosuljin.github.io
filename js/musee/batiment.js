// The museum's building (D168, D169): its rooms, walls and doors, its exhibits, and what AlmaS says in it. Data only:
// the drawing (rendu.js), the walk (marche.js), the guide (almas.js) and the page (musee.js) read it.
// Units are metres: x to the east, z to the south, y up, the floor at y = 0.
// The plan is the prototype's (D169 (b) 3): the hall in the middle, Aether ahead of it, Game Development and Mondes on
// its right, Photographie and Écriture on its left. No way out (D169 (b) 2): the site's menu stays at the top.

export const MURS_HAUT = 4.2;   // the walls' height
export const EPAISSEUR = 0.3;   // their thickness
export const PORTE_HAUT = 2.9;  // the doors' lintel

// Rooms: their floor (x0..x1, z0..z1), their hue (a token of styles.css 02 — the plan, the chips), the light they are
// lit with when it is another (the darkroom's red), what their door says, their page in the readable site.
export const SALLES = [
  { id: "hall", nom: "Le hall", x0: -8, x1: 8, z0: 0, z1: 12, teinte: "--accent", page: "index.html" },
  { id: "aether", nom: "Aether", x0: -12, x1: 12, z0: -22, z1: 0, teinte: "--acc-aether", sous: "PROJET SENTIENCE", page: "aether.html" },
  { id: "jeux", nom: "Game Development", court: "JEUX", x0: 8, x1: 17, z0: 0, z1: 6.2, teinte: "--acc-games", sous: "FRAME, MON PREMIER JEU", page: "jeux.html" },
  { id: "mondes", nom: "Mondes", x0: 8, x1: 17, z0: 6.2, z1: 13, teinte: "--acc-worlds-text", sous: "LIBERA · CE SITE", page: "mondes.html" },
  { id: "photographie", nom: "Photographie", court: "PHOTO", x0: -17, x1: -8, z0: 0, z1: 6.2, teinte: "--acc-photo", lumiere: "#ff3a2a", sous: "LA CHAMBRE NOIRE", page: "photographie.html" },
  { id: "ecriture", nom: "Écriture", x0: -17, x1: -8, z0: 6.2, z1: 13, teinte: "--acc-writing", sous: "LA BIBLIOTHÈQUE", page: "ecriture.html" },
].map(s => ({ ...s, ouverte: true }));

/** The room a point is in (the first that holds it: on a door's line, the hall). */
export const salleEn = (x, z) => SALLES.find(s => x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) || null;

// Walls, as centre lines [x0, z0, x1, z1]; the gaps between them are the doors.
export const MURS = [
  // The hall: its south wall whole; east and west, a door to each room.
  [-8, 12, 8, 12],
  [8, 0, 8, 2.1], [8, 4.1, 8, 8.6], [8, 10.6, 8, 13],
  [-8, 0, -8, 2.1], [-8, 4.1, -8, 8.6], [-8, 10.6, -8, 13],
  // Between the hall and Aether, the door in its middle; the Aether room's three other walls.
  [-12, 0, -2, 0], [2, 0, 12, 0],
  [-12, 0, -12, -22], [12, 0, 12, -22], [-12, -22, 12, -22],
  // Game Development and Mondes, on the hall's right.
  [12, 0, 17, 0], [17, 0, 17, 13], [8, 6.2, 17, 6.2], [8, 13, 17, 13],
  // Photographie and Écriture, on its left.
  [-17, 0, -12, 0], [-17, 0, -17, 13], [-17, 6.2, -8, 6.2], [-17, 13, -8, 13],
];

// Doors: all open, each between the hall and its room. `hall` and `salle` are the points a step before and after it,
// on each side: the way through it (almas.js).
const porte = (vers, x0, z0, x1, z1) => {
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, nx = z0 === z1 ? 0 : Math.sign(mx), nz = z0 === z1 ? -1 : 0;
  return { id: vers, vers, x0, z0, x1, z1, ouverte: true, hall: [mx - nx * 0.9, mz - nz * 0.9], salle: [mx + nx * 0.9, mz + nz * 0.9] };
};
export const PORTES = [
  porte("aether", -2, 0, 2, 0),
  porte("jeux", 8, 2.1, 8, 4.1),
  porte("mondes", 8, 8.6, 8, 10.6),
  porte("photographie", -8, 2.1, -8, 4.1),
  porte("ecriture", -8, 8.6, -8, 10.6),
];

// Where one arrives: the hall, facing the Aether door; each room just past its door, facing in (the plan, the chips,
// a link #salle). `cap` is the yaw: 0 looks north, π/2 west, -π/2 east.
export const ARRIVEES = {
  hall: { x: 0, z: 9.6, cap: 0 },
  aether: { x: 0, z: -2.4, cap: 0 },
  jeux: { x: 9.5, z: 3.1, cap: -Math.PI / 2 },
  mondes: { x: 9.5, z: 9.6, cap: -Math.PI / 2 },
  photographie: { x: -9.5, z: 3.1, cap: Math.PI / 2 },
  ecriture: { x: -9.5, z: 9.6, cap: Math.PI / 2 },
};

// Furniture that stops the walk, as rectangles [x0, z0, x1, z1] (the drawing has their shapes, rendu.js).
export const MEUBLES = {
  bureau: [15.9, 2.0, 16.75, 4.2],          // Game Development: the desk
  tour: [16.0, 4.28, 16.6, 4.58],           // and the PC, beside it
  table: [11.6, 8.4, 14.0, 10.8],           // Mondes: the model's table
  paillasse: [-16.75, 1.0, -15.95, 5.2],    // Photographie: the bench and its trays
  rayonsO: [-16.85, 6.8, -16.45, 12.4],     // Écriture: the shelves, on three walls
  rayonsS: [-16.4, 12.45, -9.0, 12.85],
  rayonsN: [-16.4, 6.35, -9.0, 6.75],
};

// The exhibits. `contenu` names what an exhibit opens in its room's page (`page`, aether.html when unsaid): the page
// stays the source, the room stages it. A showcase faces `face` (the Aether map when unsaid); a panel or a frame
// faces (nx, nz). `r` is what stops the walk around it (none for what hangs on a wall).
const C = [0, -11];
const autour = (deg, r = 6.2) => { const a = deg * Math.PI / 180; return [C[0] + r * Math.sin(a), C[1] - r * Math.cos(a)]; };
function xz(p) { return { x: p[0], z: p[1] }; }
const THEMES = [["Ville", ""], ["Nuit", ""], ["Architecture", ""],
  ["Nature", ""], ["Présences", ""], ["Autres", ""]];
export const OEUVRES = [
  // ---- Aether
  { id: "carte", salle: "aether", type: "carte", nom: "La carte d’Aether", sous: "LUMINA ET CE QUI LA CONSTRUIT", x: C[0], z: C[1], r: 1.5,
    contenu: ["#architecture .aether-arch-card:not(.aether-arch-card-wide)"] },
  { id: "thehive", salle: "aether", type: "vitrine", nom: "TheHive", sous: "LÀ OÙ LUMINA VIVRA", ...xz(autour(-120)), r: 0.75, teinte: "--acc-aether",
    contenu: ["#scene-thehive", "#projet-thehive"] },
  { id: "lumina", salle: "aether", type: "vitrine", nom: "Lumina", sous: "CE QUI LA FAIT PENSER", ...xz(autour(-80)), r: 0.75, teinte: "--accent",
    contenu: ["#scene-lumina", "#projet-lumina"] },
  { id: "furu", salle: "aether", type: "vitrine", nom: "Furu", sous: "LE SENS DE SON CORPS", ...xz(autour(-40)), r: 0.75, teinte: "--acc-dev",
    contenu: ["#scene-furu", "#projet-furu"] },
  { id: "reminiscence", salle: "aether", type: "vitrine", nom: "reminiscence", sous: "SA MÉMOIRE", ...xz(autour(40)), r: 0.75, teinte: "--acc-photo",
    contenu: ["#scene-reminiscence", "#projet-reminiscence"] },
  { id: "almas", salle: "aether", type: "vitrine", nom: "AlmaS", sous: "LE PREMIER AGENT", ...xz(autour(80)), r: 0.75, teinte: "--sakura",
    contenu: ["#scene-almas", "#projet-almas"] },
  { id: "miscellaneous", salle: "aether", type: "vitrine", nom: "Miscellaneous", sous: "NET ET LARA", ...xz(autour(120)), r: 0.75, teinte: "--acc-worlds-text",
    contenu: ["#scene-miscellaneous", "#projet-net", "#projet-lara"] },
  { id: "trajectoire", salle: "aether", type: "panneau", nom: "La trajectoire", sous: "LE PROCHAIN MOUVEMENT EST ALMAS", x: 0, z: -21.8, nx: 0, nz: 1, l: 11,
    contenu: ["#trajectoire"] },
  { id: "qui", salle: "aether", type: "panneau", nom: "Qui elle sera", sous: "LUMINA, ELLE-MÊME", x: -11.8, z: -6.5, nx: 1, nz: 0, l: 7, teinte: "--acc-aether",
    contenu: ["#architecture .aether-arch-card-wide"] },
  { id: "regles", salle: "aether", type: "panneau", nom: "Mes règles", sous: "TROIS RÈGLES", x: -11.8, z: -16, nx: 1, nz: 0, l: 5, teinte: "--rose",
    contenu: ["#regles"] },
  { id: "projets", salle: "aether", type: "panneau", nom: "Les autres projets", sous: "LA LUMINA, GREFFE, LUCARNE, TEMOIN, RÉSEAU", x: 11.8, z: -6.5, nx: -1, nz: 0, l: 7, teinte: "--acc-dev",
    contenu: ["#projet-la-lumina", "#projet-greffe", "#projet-lucarne", "#projet-temoin", "#projet-reseau"] },
  { id: "inscrits", salle: "aether", type: "panneau", nom: "Inscrits", sous: "PAS DES PROJETS", x: 11.8, z: -16, nx: -1, nz: 0, l: 5, teinte: "--acc-worlds-text",
    contenu: [".grid-inscrits"] },

  // ---- Game Development: the PC on its desk, Frame open on its page; one sits down, the screen opens (D169 (b) 4).
  // `assise`: the eye on the chair; `ecran`: the screen's middle, where the eye goes to open it.
  { id: "pc", salle: "jeux", type: "pc", nom: "Frame", sous: "TITRE PROVISOIRE", verbe: "S’ASSEOIR", x: 15.25, z: 3.1, r: 0.38, portee: 1.7,
    assise: { x: 15.2, y: 1.16, z: 3.1, yaw: -Math.PI / 2 }, ecran: { x: 16.42, y: 1.25, z: 3.1 }, teinte: "--acc-games",
    page: "jeux.html", contenu: ["#frame", ".detail-grid > article:nth-of-type(3)", "aside.detail-aside"] },
  { id: "liste-jeux", salle: "jeux", type: "panneau", nom: "Jeux", sous: "UN SEUL, PAS ENCORE COMMENCÉ", x: 11.4, z: 0.2, nx: 0, nz: 1, l: 3.6, teinte: "--acc-games",
    page: "jeux.html", contenu: [".detail-grid > article:nth-of-type(2)"] },
  { id: "souhaits", salle: "jeux", type: "panneau", nom: "Liste de souhaits", sous: "IL SORTIRA SUR STEAM", x: 11.4, z: 6.0, nx: 0, nz: -1, l: 3.6, teinte: "--acc-games",
    page: "jeux.html", contenu: [".detail-grid > article:nth-of-type(3)", "aside.detail-aside"] },

  // ---- Mondes: the museum in a model, where one sees oneself; Libera in its showcase.
  { id: "maquette", salle: "mondes", type: "maquette", nom: "Ce site", sous: "LE MUSÉE, EN MAQUETTE", x: 12.8, z: 9.6, r: 0, portee: 2.6, teinte: "--acc-worlds-text",
    page: "mondes.html", contenu: [".detail-grid > article:nth-of-type(2) li:nth-child(2)", ".detail-grid > article:nth-of-type(3) p:last-child"] },
  { id: "libera", salle: "mondes", type: "vitrine", nom: "Libera", sous: "DES APPLICATIONS, ENCORE UNE IDÉE", x: 15.7, z: 12.0, r: 0.75, teinte: "--acc-worlds-text", face: [12.8, 9.6],
    page: "mondes.html", contenu: [".detail-grid > article:nth-of-type(2) li:nth-child(1)"] },

  // ---- Photographie: a darkroom, and empty frames, one per theme, waiting for their prints.
  ...THEMES.map(([nom, sous], i) => ({ id: `theme-${i + 1}`, salle: "photographie", type: "cadre", nom, sous, n: i + 1,
    x: [-15.2, -12.6, -10.0][i % 3], z: i < 3 ? 0.17 : 6.03, nx: 0, nz: i < 3 ? 1 : -1, teinte: "--acc-photo",
    page: "photographie.html", contenu: [`.photo-theme-grid > .photo-theme:nth-child(${i + 1})`] })),
  { id: "cuves", salle: "photographie", type: "cuves", nom: "Les séries", sous: "AUCUNE POUR L’INSTANT", x: -15.4, z: 3.1, r: 0, portee: 1.8, teinte: "--acc-photo",
    page: "photographie.html", contenu: ["#series .photo-empty-copy"] },

  // ---- Écriture: an empty library, one book on its shelf; one takes it, lays it on the lectern, reads it — what
  // exists: L'Œil de Linh, its sentence, in rewriting (D169 (b) 4).
  { id: "livre", salle: "ecriture", type: "livre", nom: "L’Œil de Linh", sous: "EN RÉÉCRITURE", verbe: "PRENDRE", x: -16.62, z: 8.9, y: 1.36, r: 0, portee: 1.9,
    teinte: "--acc-writing" },
  { id: "pupitre", salle: "ecriture", type: "pupitre", nom: "L’Œil de Linh", sous: "MON RÉCIT", x: -12.2, z: 9.6, r: 0.4, portee: 1.8, teinte: "--acc-writing",
    page: "ecriture.html", contenu: [".detail-grid > article:nth-of-type(2) li:nth-child(1)", "figure.domain-quote", ".detail-grid > article:nth-of-type(4) p"] },
];

// The map in the middle of the Aether room: the nodes and links of the page's map (aether.html, .aether-graph), lifted
// into space. Coordinates are the SVG's (1000 × 660), Lumina at (500, 300); `kind` is its node class there.
export const CARTE = {
  noeuds: [
    { id: "lumina", x: 500, y: 300, kind: "core" }, { id: "reminiscence", x: 500, y: 96, kind: "future" },
    { id: "la-lumina", x: 290, y: 172, kind: "noyau" }, { id: "furu", x: 710, y: 172, kind: "code" },
    { id: "thehive", x: 500, y: 480, kind: "code" }, { id: "memoria", x: 205, y: 336, kind: "inscrit" },
    { id: "almas", x: 340, y: 580, kind: "code" }, { id: "greffe", x: 660, y: 580, kind: "code" },
    { id: "lucarne", x: 160, y: 572, kind: "code" }, { id: "net", x: 795, y: 336, kind: "code" },
    { id: "lara", x: 890, y: 452, kind: "vision" }, { id: "reseau", x: 112, y: 214, kind: "vision" },
  ],
  liens: [
    ["lumina", "la-lumina"], ["lumina", "furu"], ["lumina", "reminiscence"], ["lumina", "thehive"], ["memoria", "thehive"],
    ["la-lumina", "memoria"], ["almas", "greffe"], ["lucarne", "almas"], ["almas", "furu"],
  ],
};

// The model of the museum in the Mondes room: the building at 1/16, on its table (rendu.js draws it; the visitor and
// AlmaS move on it).
export const MAQUETTE = { cx: 12.8, cz: 9.6, y: 0.92, echelle: 1 / 16, ox: 0, oz: -4.5 };
export const enMaquette = (x, z) => [MAQUETTE.cx + (x - MAQUETTE.ox) * MAQUETTE.echelle, MAQUETTE.cz + (z - MAQUETTE.oz) * MAQUETTE.echelle];

// What AlmaS says: Mandarin in simplified characters, heard through the browser's voice, read with English subtitles
// (D168 b 4). `tactile` replaces the line on a touch screen. Written by the coordination, to be read again by her.
export const PAROLES = {
  bienvenue: { zh: "欢迎来到 Yosuljin 的博物馆。我是 AlmaS，你的向导。", en: "Welcome to Yosuljin’s museum. I’m AlmaS, your guide." },
  commandes: {
    zh: "用 ZQSD 或 WASD 键，或方向键走路，用鼠标看四周。按 M 打开平面图。", en: "Walk with ZQSD or WASD, or the arrow keys; look around with the mouse. Press M for the floor plan.",
    tactile: { zh: "用左边的摇杆走路，在右边滑动看四周。平面图一直在上面。", en: "Walk with the stick on the left; swipe on the right to look around. The floor plan is always up top." },
  },
  hall: { zh: "前面是 Aether，Yosuljin 目前唯一的 Sentience 项目。右边是 Game Development 和 Mondes，左边是 Photographie 和 Écriture。",
    en: "Ahead is Aether, Yosuljin’s only Sentience project for now. To the right, Game Development and Mondes; to the left, Photographie and Écriture." },
  aether: {
    zh: "这里是 Aether。中间是 Lumina 的地图：Lumina 还没有被点亮。走近展柜，按 E 看看里面。", en: "This is Aether. In the middle is Lumina’s map: Lumina isn’t lit yet. Walk up to a showcase and press E to look inside.",
    tactile: { zh: "这里是 Aether。中间是 Lumina 的地图：Lumina 还没有被点亮。走近展柜，点出现的按钮。", en: "This is Aether. In the middle is Lumina’s map: Lumina isn’t lit yet. Walk up to a showcase and tap the button that appears." },
  },
  jeux: { zh: "这里是 Game Development。Frame 是 Yosuljin 的第一个游戏，还没开始做。坐到电脑前，看看它的页面。",
    en: "This is Game Development. Frame is Yosuljin’s first game, and it isn’t started yet. Sit at the computer to see its page." },
  mondes: { zh: "这里是 Mondes，Yosuljin 的其他项目。中间是这座博物馆的模型：那个小光点就是你。",
    en: "This is Mondes, Yosuljin’s other projects. In the middle is a model of this museum: that little light is you." },
  photographie: { zh: "这里是暗房。照片还没有来，墙上的相框在等它们。",
    en: "This is the darkroom. The photos haven’t come yet; the frames on the walls are waiting for them." },
  ecriture: { zh: "这里是图书馆。书架上只有一本书：拿起它，放到阅读台上读。",
    en: "This is the library. There’s only one book on the shelves: take it, and lay it on the lectern to read." },
  livre: { zh: "把它放到阅读台上。", en: "Lay it on the lectern." },
  range: { zh: "我把书放回书架上了。", en: "I put the book back on its shelf." },
  suivre: { zh: "跟我来。", en: "Follow me." },
  arrive: { zh: "到了。", en: "Here we are." },
  retour: { zh: "欢迎回来。", en: "Welcome back." },
};
