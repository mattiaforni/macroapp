// Registro dei moduli. Per aggiungerne uno: creare modules/<id>/index.js che esporta
// { id, title, nav, icon, mount(container, ctx) } e aggiungerlo qui.
// Nella barra in basso ci stanno bene cinque voci; gli altri moduli si aprono da Impostazioni.
import * as lista from "./lista/index.js";
import * as spese from "./spese/index.js";
import * as diario from "./diario/index.js";
import * as task from "./task/index.js";
import * as manuale from "./manuale/index.js";
import * as proposte from "./proposte/index.js";
import * as impostazioni from "./impostazioni/index.js";

export const modules = [lista, spese, diario, task, manuale, proposte, impostazioni];
export const navModules = modules.filter((m) => m.nav);
export const DEFAULT_ROUTE = "lista";
