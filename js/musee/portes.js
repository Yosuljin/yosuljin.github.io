// The doors of the museum, built from ONE description: the rooms, the whole walls and the five doors. Pure: no DOM, no GL,
// no import (batiment.js will read this file, so this file reads nothing), so Node can play it. With the default
// hole (2.0 m) it gives, number for number, the MURS and PORTES of batiment.js as they are today; with a wider hole the
// four side doors widen and Aether's keeps its 4.0 m. Units are metres, x to the east, z to the south.

export const TROU_DEFAUT = 2.0;       // the width of the four side doors
export const LARGEUR_AETHER = 4.0;    // Aether's door keeps its own width whatever the hole
export const EPAISSEUR_MUR = 0.3;     // the walls' thickness (batiment.js EPAISSEUR)
export const RAYON_CORPS = 0.32;      // what stops the walk against a wall (marche.js RAYON)
export const PROFONDEUR_CHEMIN = 0.9; // how far from a door's middle its two way-points are (almas.js)

// The description. `salles`: the floors (x0..x1, z0..z1); `murs`: the whole walls as centre lines [x0, z0, x1, z1], from
// the lower end to the higher one, a door cuts them where it stands; `portes`: each door, between the hall and `vers`,
// by its middle (`largeur` when it is not the hole's).
export const DESCRIPTION = {
  hall: "hall",
  salles: [
    { id: "hall", x0: -8, x1: 8, z0: 0, z1: 12 },
    { id: "aether", x0: -12, x1: 12, z0: -22, z1: 0 },
    { id: "jeux", x0: 8, x1: 17, z0: 0, z1: 6.2 },
    { id: "mondes", x0: 8, x1: 17, z0: 6.2, z1: 13 },
    { id: "photographie", x0: -17, x1: -8, z0: 0, z1: 6.2 },
    { id: "ecriture", x0: -17, x1: -8, z0: 6.2, z1: 13 },
  ],
  murs: [
    [-8, 12, 8, 12],                                                    // the hall's south wall, whole
    [8, 0, 8, 13], [-8, 0, -8, 13],                                     // east and west of the hall: two doors on each
    [-12, 0, 12, 0],                                                    // between the hall and Aether
    [-12, 0, -12, -22], [12, 0, 12, -22], [-12, -22, 12, -22],          // Aether's three other walls
    [12, 0, 17, 0], [17, 0, 17, 13], [8, 6.2, 17, 6.2], [8, 13, 17, 13],    // Game Development and Mondes
    [-17, 0, -12, 0], [-17, 0, -17, 13], [-17, 6.2, -8, 6.2], [-17, 13, -8, 13],   // Photographie and Ecriture
  ],
  portes: [
    { id: "aether", vers: "aether", centre: [0, 0], largeur: LARGEUR_AETHER },
    { id: "jeux", vers: "jeux", centre: [8, 3.1] },
    { id: "mondes", vers: "mondes", centre: [8, 9.6] },
    { id: "photographie", vers: "photographie", centre: [-8, 3.1] },
    { id: "ecriture", vers: "ecriture", centre: [-8, 9.6] },
  ],
};

// The description is frozen all the way down: a consumer that changes DESCRIPTION.salles would change the default of
// every later construirePortes.
const figer = o => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(figer); } return o; };
figer(DESCRIPTION);

const EPS = 1e-9;

/**
 * The two way-points of a door, a step before and after it: { hall: [x, z], salle: [x, z] }, at 0.9 m from its middle.
 * `normale` [nx, nz] is the direction from the hall into the room; unsaid, the museum's rule (the hall is in the middle):
 * a door in a wall along x opens to the north, a door in a wall along z opens away from x = 0.
 */
export function cheminPorte(p, normale) {
  const mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2;
  const [nx, nz] = normale || (p.z0 === p.z1 ? [0, -1] : [Math.sign(mx), 0]);
  return { hall: [mx - nx * PROFONDEUR_CHEMIN, mz - nz * PROFONDEUR_CHEMIN], salle: [mx + nx * PROFONDEUR_CHEMIN, mz + nz * PROFONDEUR_CHEMIN] };
}

/** The free width of a door for the walking body: its hole minus, on each side, the wall's half thickness and the body's radius. */
export function passageLibre(p, epaisseur = EPAISSEUR_MUR, rayon = RAYON_CORPS) {
  return Math.hypot(p.x1 - p.x0, p.z1 - p.z0) - 2 * (rayon + epaisseur / 2);
}

/**
 * The walls cut by the doors, and the doors: { MURS, PORTES } in the shapes of batiment.js. `trou` is the width of the
 * four side doors; a door that says its `largeur` keeps it (Aether's, 4.0). A door that stands on no wall throws.
 */
export function construirePortes({ salles = DESCRIPTION.salles, murs = DESCRIPTION.murs, trou = TROU_DEFAUT, portes = DESCRIPTION.portes, hall = DESCRIPTION.hall } = {}) {
  if (!(trou > 0)) throw new Error("construirePortes: trou must be positive");
  const salle = id => { const s = salles.find(e => e.id === id); if (!s) throw new Error(`construirePortes: unknown room ${id}`); return s; };
  const milieu = (a, b) => (a + b) / 2;
  const maison = salle(hall);
  const posees = portes.map(d => {
    const largeur = d.largeur || trou, [cx, cz] = d.centre;
    return { d, largeur, cx, cz, lo: 0, hi: 0, mur: -1, horizontal: false, vers: salle(d.vers) };
  });
  const MURS = [];
  murs.forEach((m, i) => {
    const [x0, z0, x1, z1] = m, horizontal = z0 === z1, vertical = x0 === x1;
    if (!horizontal && !vertical) { MURS.push([x0, z0, x1, z1]); return; }
    const debut = horizontal ? x0 : z0, fin = horizontal ? x1 : z1, ligne = horizontal ? z0 : x0;
    const ici = posees.filter(p => {
      const a = horizontal ? p.cx : p.cz, c = horizontal ? p.cz : p.cx;
      return Math.abs(c - ligne) < EPS && a - p.largeur / 2 > debut - EPS && a + p.largeur / 2 < fin + EPS && a > debut + EPS && a < fin - EPS;
    });
    for (const p of ici) {
      if (p.mur >= 0) throw new Error(`construirePortes: door ${p.d.id} stands on two walls`);
      const a = horizontal ? p.cx : p.cz;
      p.mur = i; p.horizontal = horizontal; p.lo = a - p.largeur / 2; p.hi = a + p.largeur / 2;
    }
    if (!ici.length) { MURS.push([x0, z0, x1, z1]); return; }      // a wall without a door stays as it is, whichever way it runs
    if (!(fin > debut)) throw new Error("construirePortes: a wall with a door runs from its lower end to its higher one");
    ici.sort((p, q) => p.lo - q.lo);
    const piece = (a, b) => MURS.push(horizontal ? [a, ligne, b, ligne] : [ligne, a, ligne, b]);
    let curseur = debut;
    for (const p of ici) {
      if (p.lo < curseur - EPS) throw new Error(`construirePortes: door ${p.d.id} overlaps the one before it on the same wall`);
      if (p.lo > curseur + EPS) piece(curseur, p.lo);
      curseur = p.hi;
    }
    if (fin > curseur + EPS) piece(curseur, fin);
  });
  const PORTES = posees.map(p => {
    if (p.mur < 0) throw new Error(`construirePortes: door ${p.d.id} stands on no wall`);
    const horizontal = p.horizontal;
    const x0 = horizontal ? p.lo : p.cx, x1 = horizontal ? p.hi : p.cx, z0 = horizontal ? p.cz : p.lo, z1 = horizontal ? p.cz : p.hi;
    // The direction from the hall into the room, across the wall.
    const normale = horizontal
      ? [0, Math.sign(milieu(p.vers.z0, p.vers.z1) - milieu(maison.z0, maison.z1))]
      : [Math.sign(milieu(p.vers.x0, p.vers.x1) - milieu(maison.x0, maison.x1)), 0];
    const porte = { id: p.d.id, vers: p.d.vers, x0, z0, x1, z1, ouverte: true };
    return { ...porte, ...cheminPorte(porte, normale) };
  });
  return { MURS, PORTES };
}
