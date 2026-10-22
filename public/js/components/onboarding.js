// Primo accesso: crea una casa o unisciti con un codice.
import { el, toast } from "../core/ui.js";
import { createHousehold, joinHousehold } from "../core/household.js";
import { logout } from "../core/auth.js";

export function renderOnboarding(container) {
  let code = "";
  container.replaceChildren(
    el("div.card", {},
      el("h2", {}, "Crea la tua casa"),
      el("p.muted", {}, "La casa è lo spazio condiviso in due. Chi la crea riceve un codice da dare all'altra persona."),
      el("button.btn.btn--primary", {
        onclick: async (e) => {
          e.target.disabled = true;
          try { await createHousehold(); toast("Casa creata"); }
          catch (err) { toast(err.message); e.target.disabled = false; }
        },
      }, "Crea casa"),
    ),
    el("div.card", {},
      el("h2", {}, "Oppure unisciti"),
      el("div.field", {},
        el("label", {}, "Codice ricevuto"),
        el("input", { placeholder: "es. 7Kx…", oninput: (e) => { code = e.target.value; } }),
      ),
      el("button.btn", {
        onclick: async (e) => {
          if (!code.trim()) return toast("Inserisci il codice");
          e.target.disabled = true;
          try { await joinHousehold(code); toast("Benvenuto in casa"); }
          catch (err) { toast("Codice non valido o accesso negato"); e.target.disabled = false; }
        },
      }, "Unisciti"),
    ),
    el("p.small.muted", {}, el("button.btn.btn--ghost", { onclick: logout }, "Esci")),
  );
}
