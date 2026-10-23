// Impostazioni: casa e codice di invito, moduli secondari, uscita.
import { el, toast } from "../../core/ui.js";
import { session, logout } from "../../core/auth.js";
import { getHousehold } from "../../core/household.js";
import { VERSION } from "../../version.js";

export const id = "impostazioni";
export const title = "Impostazioni";
export const nav = false;
export const icon = "impostazioni";

export async function mount(container) {
  const h = await getHousehold();
  const code = h?.id || "";
  container.append(
    el("div.card", {},
      el("h2", {}, "Account"),
      el("p", {}, session.profile?.displayName || "", el("br"), el("span.small.muted", {}, session.user.email)),
      el("button.btn", { onclick: logout }, "Esci"),
    ),
    el("div.card", {},
      el("h2", {}, h?.name || "Casa"),
      el("p.small.muted", {}, `Membri: ${h?.members?.length || 0} di 2`),
      el("div.field", {},
        el("label", {}, "Codice di invito (da dare all'altra persona)"),
        el("div.row", {},
          el("input", { value: code, readonly: true }),
          el("button.btn", { onclick: async () => { await navigator.clipboard?.writeText(code); toast("Copiato"); } }, "Copia"),
        ),
      ),
    ),
    el("div.card", {},
      el("h2", {}, "Altri moduli"),
      el("p", {}, el("a", { href: "#/task" }, "Task")),
    ),
    el("div.card", {},
      el("h2", {}, "Integrazioni"),
      el("p.small.muted", {}, "Banca (Enable Banking), Google Contatti e agente: si attivano quando le Cloud Functions relative sono configurate. Vedi README."),
    ),
    el("p.small.muted", { style: "text-align:center" }, `Macroapp · versione ${VERSION} · identità visiva provvisoria`),
  );
  return () => {};
}
