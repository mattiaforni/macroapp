// Tema chiaro/scuro. «auto» segue il telefono e lo segue anche se cambia mentre l'app è aperta.
const CHIAVE = "macroapp.tema";
export const TEMI = [["auto", "Come il telefono", "auto"], ["giorno", "Chiaro", "sole"], ["notte", "Scuro", "luna"]];
const COLORE = { giorno: "#EEEDE8", notte: "#1B1A19" };

export function temaScelto() {
  try { const t = localStorage.getItem(CHIAVE); if (TEMI.some(([v]) => v === t)) return t; } catch (e) {}
  return "auto";
}

export function applicaTema() {
  const s = temaScelto();
  const buio = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effettivo = s === "auto" ? (buio ? "notte" : "giorno") : s;
  document.documentElement.setAttribute("data-tema", effettivo);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLORE[effettivo]);
}

export function scegliTema(t) {
  try { localStorage.setItem(CHIAVE, t); } catch (e) {}
  applicaTema();
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applicaTema);
