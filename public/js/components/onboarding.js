// Primo accesso: crea una casa o unisciti con un codice.
import { el, toast } from "../core/ui.js";
import { createHousehold, joinHousehold } from "../core/household.js";
import { logout } from "../core/auth.js";

export function renderOnboarding(container) {
  let code = "";
  container.replaceChildren(
    el("div.blocco", {},
      el("h3", {}, "Crea la casa"),
      el("p", {}, "La casa è lo spazio condiviso in due. Chi la crea trova in Impostazioni il codice da dare all'altra persona."),
      el("button.btn.btn--primario", {
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await createHousehold(); toast("Casa creata"); }
          catch (err) { toast(err.message); e.currentTarget.disabled = false; }
        },
      }, "Crea casa"),
    ),
    el("div.blocco", {},
      el("h3", {}, "Oppure unisciti"),
      el("div.campo", {},
        el("label", {}, "Codice ricevuto"),
        el("input", { placeholder: "es. 7Kx…", autocomplete: "off", oninput: (e) => { code = e.target.value; } }),
      ),
      el("button.btn", {
        onclick: async (e) => {
          if (!code.trim()) return toast("Inserisci il codice");
          const b = e.currentTarget;
          b.disabled = true;
          try { await joinHousehold(code); toast("Benvenuto in casa"); }
          catch (err) { toast("Codice non valido o accesso negato"); b.disabled = false; }
        },
      }, "Unisciti"),
    ),
    el("p", { style: "margin-top:18px" }, el("button.btn.btn--piatto", { onclick: logout }, "Esci")),
  );
}
