"""Rigenera functions/src/prodotti/additivi.js dalla tassonomia degli additivi di Open Food Facts (ODbL).
    python3 prove/additivi.py
Per ogni additivo: nome italiano (se c'è, altrimenti inglese), classe principale, rischio EFSA da
sovraesposizione (`efsa_evaluation_overexposure_risk`: alto / moderato / nessuno; assente = non valutato)."""
import json, os, re, urllib.request

URL = "https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/additives.txt"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "functions", "src", "prodotti", "additivi.js")
CLASSI = {"preservative": "conservante", "colour": "colorante", "antioxidant": "antiossidante", "emulsifier": "emulsionante",
  "stabiliser": "stabilizzante", "thickener": "addensante", "sweetener": "dolcificante", "flavour-enhancer": "esaltatore di sapidità",
  "acidity-regulator": "regolatore di acidità", "acid": "acidificante", "raising-agent": "agente lievitante", "gelling-agent": "gelificante",
  "anti-caking-agent": "antiagglomerante", "humectant": "umettante", "glazing-agent": "agente di rivestimento", "firming-agent": "agente rassodante",
  "flour-treatment-agent": "agente di trattamento della farina", "sequestrant": "sequestrante", "bulking-agent": "agente di carica",
  "foaming-agent": "agente schiumogeno", "anti-foaming-agent": "antischiumogeno", "antifoaming-agent": "antischiumogeno", "propellant": "propellente",
  "carrier": "supporto", "modified-starch": "amido modificato", "packaging-gas": "gas di imballaggio"}
E = r"E\d{3,4}[a-z]?(\([ivx]+\))?"

testo = urllib.request.urlopen(URL, timeout=60).read().decode("utf-8")
out = {}
for b in testo.split("\n\n"):
    en = it = rischio = classi = None
    for r in b.split("\n"):
        if r.startswith("en:") and en is None: en = r[3:].strip()
        elif r.startswith("it:") and it is None: it = r[3:].strip()
        elif r.startswith("efsa_evaluation_overexposure_risk:en:"): rischio = r.split("en:")[-1].strip()
        elif r.startswith("additives_classes:en:"): classi = r.split(":", 2)[2].strip()
    if not en: continue
    nomi_en = [x.strip() for x in en.split(",")]
    codice = nomi_en[0]
    if not re.fullmatch(E, codice): continue
    nomi_it = [x.strip() for x in (it or "").split(",") if x.strip()]
    nome = next((x for x in nomi_it if not re.fullmatch(E, x)), None) or (nomi_en[1] if len(nomi_en) > 1 else codice)
    cl = ""
    if classi:
        ids = [c.replace("en:", "").strip() for c in classi.split(",")]
        scelta = next((c for c in ids if c != "carrier" and c in CLASSI), None) or next((c for c in ids if c in CLASSI), None)
        cl = CLASSI.get(scelta, "")
    voce = [nome, cl]
    r = {"high": "alto", "moderate": "moderato", "no": "nessuno"}.get(rischio)
    if r: voce.append(r)
    out[codice.lower()] = voce

righe = ",\n".join(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in sorted(out.items()))
testa = """// Additivi alimentari: codice → [nome italiano, classe, rischio EFSA da sovraesposizione].
// Generato dalla tassonomia di Open Food Facts (taxonomies/additives.txt, licenza ODbL):
// il rischio è `efsa_evaluation_overexposure_risk` (alto / moderato / nessuno), presente solo per
// gli additivi che l'EFSA ha rivalutato; per gli altri non c'è un giudizio, non un «nessun rischio».
// Rigenerare con prove/additivi.py quando la tassonomia cambia.
export const ADDITIVI = {
"""
open(OUT, "w", encoding="utf-8").write(testa + righe + ",\n};\n")
print(len(out), "additivi →", OUT)
