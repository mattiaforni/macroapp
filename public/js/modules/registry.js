// Registro dei moduli. Per aggiungerne uno: creare modules/<id>/index.js che esporta
// { id, title, nav, mount(container) } e aggiungerlo qui.
import * as spese from "./spese/index.js";
import * as lista from "./lista/index.js";
import * as manuale from "./manuale/index.js";
import * as diario from "./diario/index.js";
import * as task from "./task/index.js";
import * as proposte from "./proposte/index.js";
import * as impostazioni from "./impostazioni/index.js";

export const modules = [lista, spese, manuale, diario, task, proposte, impostazioni];

// Moduli mostrati nella barra inferiore (massimo 5 per leggibilità su mobile).
export const navModules = modules.filter((m) => m.nav);

export const DEFAULT_ROUTE = "lista";
