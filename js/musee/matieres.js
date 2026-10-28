// The museum's materials, in one table (IMMERSION-musee.md, track 28): the colours the drawing paints with and what each
// floor is made of. Data only: no DOM, no GL, no clock, so Node can run it. The numbers of the first block are, to the
// last digit, the ones rendu.js has always used: this file changes no image. The SOLS table is the image's side of the
// floor; the sound keeps its own table of floors in acoustique.js (S2, SOLS_VARIES). The day a floor of the image
// changes, the two tables are brought together here, in one place.

const gel = a => Object.freeze(a);

// ---------- Paint (word for word the constants of rendu.js) ----------
export const BG = gel([6 / 255, 4 / 255, 11 / 255]);              // the clear colour, and the colour of the far fog
export const MUR = gel([0.075, 0.05, 0.1]);                       // walls
export const SOCLE = gel([0.06, 0.045, 0.085]);                   // plinths and low bodies
export const BOIS = gel([0.085, 0.06, 0.07]);                     // wood: the shelves, the chair, the lectern
export const NOIR = gel([0.035, 0.03, 0.045]);                    // black furniture and frames

// ---------- Floors ----------
// One floor for all: a dark polished floor with its grid (the grid is the identity of the museum, choice 1: it stays).
// No carpet, no parquet: nothing is invented here. `albedo` is the base colour of the floor (rendu.js: uBase),
// `rugosite` and `brillance` are for the lot of the material (the sheen is 0 everywhere, except in Aether where 0.12 is
// reserved for it: rendu.js does not draw it yet); `grille` is the grid's step and its coarse step, in metres. There is no
// `timbre` here: the sound owns its floors (acoustique.js, SOLS_VARIES, five floors: four by room, the rug of Game Development
// the fifth), and a second word for them in this file would say the opposite.
const SOL = { albedo: [0.03, 0.022, 0.045], rugosite: 0.4, brillance: 0, grille: { pas: 1, gros: 4 } };
const sol = (extra = {}) => gel({ ...SOL, ...extra, albedo: gel([...SOL.albedo]), grille: gel({ ...SOL.grille }) });
export const SOLS = gel({
  hall: sol(),
  aether: sol({ brillance: 0.12 }),
  jeux: sol(),
  mondes: sol(),
  photographie: sol(),
  ecriture: sol(),
});

/** The floor of a room: its entry of SOLS (the hall's for an id the table does not know). */
export const solDe = id => typeof id === "string" && Object.prototype.hasOwnProperty.call(SOLS, id) ? SOLS[id] : SOLS.hall;

export const MATIERES = gel({ BG, MUR, SOCLE, BOIS, NOIR, SOLS });
