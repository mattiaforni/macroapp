// Impostazioni: account, casa e codice di invito, tema, versione.
import { el, icon, toast } from "../../core/ui.js";
import { session, logout } from "../../core/auth.js";
import { getHousehold } from "../../core/household.js";
import { TEMI, temaScelto, scegliTema } from "../../core/theme.js";
import { VERSION } from "../../version.js";

export const id = "impostazioni";
export const title = "Impostazioni";
export const nav = false;
const navIcon = "impostazioni";
export { navIcon as icon };

export async function mount(container) {
  const h = await getHousehold({ fresh: true });
  const code = h?.id || "";
  const membri = Object.values(h?.memberNames || {});

  const temi = el("div.segmenti", { style: "padding-top:0" });
  const disegnaTemi = () => temi.replaceChildren(...TEMI.map(([v, l, ic]) =>
    el("button.pillola", { class: temaScelto() === v ? "on" : "", onclick: () => { scegliTema(v); disegnaTemi(); } }, icon(ic), l)));
  disegnaTemi();

  container.append(
    el("div.blocco", {},
      el("h3", {}, h?.name || "Casa"),
      el("p", {}, membri.length ? membri.join(" e ") : `${h?.members?.length || 0} di 2 membri`),
      (h?.members?.length || 0) < 2 ? el("div.campo", {},
        el("label", {}, "Codice di invito"),
        el("div.segmenti", { style: "padding-top:0;align-items:center" },
          el("input.linea-input", { value: code, readonly: true, style: "flex:1;min-width:0" }),
          el("button.pillola", { onclick: async () => { try { await navigator.clipboard.writeText(code); toast("Codice copiato"); } catch (e) { toast(code); } } }, icon("copia"), "Copia"),
        ),
        el("p.meta", { style: "margin-top:6px" }, "L'altra persona accede con Google, sceglie «Unisciti» e inserisce questo codice."),
      ) : null,
    ),
    el("div.blocco", {}, el("h3", {}, "Aspetto"), temi),
    el("div.blocco", {},
      el("h3", {}, "Account"),
      el("p", {}, session.profile?.displayName || "", " · ", session.user.email),
      el("button.btn", { onclick: logout }, icon("esci"), "Esci"),
    ),
    el("p.meta", { style: "text-align:center;margin-top:22px" }, `Macroapp · versione ${VERSION} · identità visiva provvisoria`),
  );
  return () => {};
}
