import http.server, threading, functools, os, sys, json
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "_sito")
OUT = os.path.join(HERE, "_schermate")
os.makedirs(OUT, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def translate_path(self, path):
        # Come il rewrite di Firebase Hosting: una pagina senza file (es. /banca) serve index.html.
        p = super().translate_path(path)
        if not os.path.exists(p) and "." not in os.path.basename(p):
            return os.path.join(SITE, "index.html")
        return p

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8766), functools.partial(Quiet, directory=SITE))
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
step = ["avvio"]
def shot(pg, name): pg.screenshot(path=f"{OUT}/{name}.png")
def conferma(pg): pg.click("#foglio .btn--conferma")

def tocca_testo(pg, selettore, pezzo):
    """Tocca a metà di `pezzo`, dentro l'elemento (il primo nodo di testo che lo contiene), portandolo in vista."""
    p = pg.evaluate("""([sel, pezzo]) => {
      const radice = document.querySelector(sel);
      const giro = document.createTreeWalker(radice, NodeFilter.SHOW_TEXT);
      for (let t = giro.nextNode(); t; t = giro.nextNode()) {
        const i = t.textContent.indexOf(pezzo);
        if (i < 0) continue;
        const r = document.createRange(), m = i + Math.floor(pezzo.length / 2);
        r.setStart(t, m); r.setEnd(t, m + 1);
        const corpo = radice.closest('.foglio__corpo');
        let b = r.getBoundingClientRect();
        if (corpo && (b.top < 120 || b.bottom > innerHeight - 140)) { corpo.scrollTop += b.top - 240; b = r.getBoundingClientRect(); }
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
      return null;
    }""", [selettore, pezzo])
    assert p, f"«{pezzo}» in {selettore}"
    pg.mouse.click(p["x"], p["y"])

def cursore(pg):
    """Dove sta il cursore nel campo col fuoco: riga, se `pezzo` lo contiene, e se la riga si vede nel foglio."""
    return pg.evaluate("""(() => {
      const a = document.activeElement;
      if (!/^(INPUT|TEXTAREA)$/.test(a.tagName)) return { fuoco: false };
      const i = a.selectionStart, prima = a.value.slice(0, i);
      const riga = a.value.slice(prima.lastIndexOf('\\n') + 1).split('\\n')[0];
      const s = getComputedStyle(a), c = a.closest('.foglio__corpo').getBoundingClientRect();
      const y = a.getBoundingClientRect().top + parseFloat(s.paddingTop) + (prima.split('\\n').length - 1) * parseFloat(s.lineHeight);
      return { fuoco: true, campo: a.tagName + '.' + a.className, i, riga, valore: a.value, vista: y >= c.top && y <= c.top + c.height / 2 };
    })()""")

def dentro(c, pezzo):
    """Il cursore sta dentro la prima volta che `pezzo` compare nel campo."""
    j = c["valore"].find(pezzo)
    return j >= 0 and j <= c["i"] <= j + len(pezzo)
def menu(pg, voce):
    pg.click("button[aria-label='Menu']")
    pg.click(f".menu__voce >> text={voce}")

with sync_playwright() as p:
    # Microfono finto (un tono) per la nota vocale, con il permesso già dato.
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=False, permissions=["microphone", "camera"])
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(f"[{step[0]}] pageerror: {e}"))
    pg.on("console", lambda m: errors.append(f"[{step[0]}] console.{m.type}: {m.text}") if m.type in ("error","warning","log") else None)
    try:
        pg.goto("http://127.0.0.1:8766/")
        step[0] = "onboarding"
        pg.wait_for_selector("text=Crea casa", timeout=6000)
        pg.click("text=Crea casa")
        pg.wait_for_selector(".schede a", timeout=6000)

        # ── Si apre sul Diario ──
        step[0] = "avvio sul diario"
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/diario']")
        assert pg.locator(".schede a").count() == 4, "quattro sezioni in basso"

        # ── Scorrendo la pagina a sinistra si va alla sezione dopo, a destra a quella prima: la pagina
        #    segue il dito, quella accanto è montata a lato, al rilascio si assesta ──
        step[0] = "scorrimento tra le sezioni"
        TOCCO = """([tipo, x, y, fine]) => {
          const v = document.getElementById("view");
          const mk = () => new Touch({ identifier: 1, target: v, clientX: x, clientY: y });
          v.dispatchEvent(new TouchEvent(tipo, { bubbles: true, cancelable: true, touches: fine ? [] : [mk()], changedTouches: [mk()] }));
        }"""
        def tocco(tipo, x, y, fine=False): pg.evaluate(TOCCO, [tipo, x, y, fine])
        def scorri(dx, dy=0, durante=None, lento=False):
            # Un gesto simulato è istantaneo, cioè un colpo deciso: con `lento` si ferma prima di lasciare.
            x0, y0 = 180, 400
            tocco("touchstart", x0, y0); tocco("touchmove", x0 + dx / 3, y0 + dy / 3); tocco("touchmove", x0 + dx, y0 + dy)
            if durante: durante()
            if lento: pg.wait_for_timeout(200)
            tocco("touchend", x0 + dx, y0 + dy, True)
            pg.wait_for_function("!document.documentElement.hasAttribute('data-scorro')")
        def accanto_e(testo, dx):
            st = pg.evaluate("""() => ({ verso: document.documentElement.dataset.scorro, dx: document.documentElement.style.getPropertyValue("--scorro-dx"),
              figli: document.querySelector(".scorro .vista")?.childElementCount || 0, fab: !!document.querySelector(".scorro .fab:not([style*='display'])") })""")
            assert st["verso"] == ("avanti" if dx < 0 else "indietro") and st["dx"] == f"{dx}px" and st["figli"] > 0, f"la pagina accanto è a lato e si segue il dito: {st}"
            pg.wait_for_selector(f".scorro >> text={testo}", timeout=3000)
        def sezione(): return pg.locator(".schede a[aria-current='page']").get_attribute("href")
        scorri(-120, durante=lambda: accanto_e("Da comprare", -120))
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/lista']")
        assert pg.locator(".scorro").count() == 0, "il pannello a lato se ne va dopo il passaggio"
        scorri(-120)
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/spese']")
        scorri(120, durante=lambda: accanto_e("Da comprare", 120))
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/lista']")
        scorri(-40, lento=True)  # troppo corto e senza slancio: si torna a posto
        scorri(-120, 150)    # più verticale che orizzontale: è uno scorrimento della pagina
        assert sezione() == "#/lista" and pg.locator(".scorro").count() == 0, "un gesto corto o verticale non cambia sezione"
        scorri(120)
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/diario']")
        scorri(-50)          # un colpo corto ma deciso basta
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/lista']")
        scorri(120)
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/diario']")
        scorri(120)          # dalla prima sezione a destra: resta
        assert sezione() == "#/diario", "dal Diario a destra non si va da nessuna parte"
        assert pg.locator("#view .fab").count() >= 1, "il + della pagina c'è ancora"

        # ── Lista: il + apre «Mi serve», Invio aggiunge e resta aperto ──
        step[0] = "lista"
        pg.click(".schede a[href='#/lista']")
        pg.click("button.fab")
        inp = "#foglio input[aria-label='Aggiungi alla lista']"
        pg.wait_for_selector(inp)
        pg.fill(inp, "latte, uova; pane, pesce: spada, pasta sfoglia, gelato alla crema")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("#foglio .pillola >> text=Pane")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector(".tessera >> text=Pane")
        assert pg.locator(".tessera:not(.tessera--verde)").count() == 6, "6 tessere rosse attese"
        # Divise per reparto, nell'ordine del giro; «gelato» va nei surgelati, il pesce prima dei latticini.
        reparti = pg.locator(".reparto__nome").all_inner_texts()
        assert [r.strip().lower() for r in reparti] == ["pane e dispensa", "carne e pesce", "latticini e uova", "surgelati"], f"reparti: {reparti}"
        pg.locator(".tessera:not(.tessera--verde) >> text=Latte").click()
        pg.locator(".tessera:not(.tessera--verde) >> text=Uova").click()
        pg.wait_for_selector(".tessera--verde >> text=Latte")
        pg.wait_for_timeout(300)
        shot(pg, "1-lista")
        pg.click("button.fab")
        pg.fill(inp, "lat")
        pg.wait_for_selector("#foglio .tessera >> text=Latte")
        pg.wait_for_timeout(300)
        shot(pg, "1b-mi-serve")
        pg.click("#foglio .tessera >> text=Latte")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector(".tessera:not(.tessera--verde) >> text=Latte")
        # Il foglio si chiude in dissolvenza: finché c'è, la sua tessera «Latte» conta anche lei.
        pg.wait_for_selector("#foglio", state="hidden")
        assert pg.locator(".tessera >> text=Latte").count() == 1, "Latte non deve duplicarsi"
        # Reparto scelto a mano: la pasta sfoglia sta nel banco frigo, non in dispensa.
        step[0] = "lista, reparto a mano"
        pg.locator(".tessera:not(.tessera--verde)", has_text="Pasta sfoglia").locator("button.altro").click()
        pg.wait_for_selector("#foglio .pillola.on >> text=Pane e dispensa")
        pg.click("#foglio .pillola >> text=Latticini e uova")
        conferma(pg)
        pg.wait_for_selector("section.reparto[aria-label='Latticini e uova'] .tessera >> text=Pasta sfoglia")
        pg.wait_for_selector("#foglio", state="hidden")
        shot(pg, "1c-lista-reparti")

        # ── Lista, codice a barre: in Chromium senza fotocamera si scrive il codice ──
        step[0] = "lista, scansione"
        pg.click("button.fab")
        pg.wait_for_selector(inp)
        pg.click("#foglio .foglio__secondarie button >> text=Scansiona")
        codice = "#foglio input[aria-label='Codice a barre']"
        pg.wait_for_selector(codice)
        assert pg.locator("#foglio .scanner").count() == 0, "senza BarcodeDetector niente mirino"
        pg.fill(codice, "8076809513753")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("#foglio .prodotto__nome >> text=Spaghetti n.5")
        assert pg.locator("#foglio .prodotto__indice.indice--eccellente b").inner_text() == "90", "indice 90"
        assert "Nutri-Score" not in pg.locator("#foglio").inner_text(), "niente Nutri-Score nella scheda (31/10)"
        assert pg.input_value("#foglio input[aria-label='In lista come']") == "Spaghetti", "in lista come la categoria"
        # Come in Yuka: Positivo con frase e pallino; niente Negativo se non c'è nulla; al tocco la scala.
        sezioni = pg.locator("#foglio .prodotto__sezione h3").all_inner_texts()
        assert sezioni == ["Positivo", "Additivi", "Trasformazione"], f"sezioni: {sezioni}"
        assert "Quantità eccellente" in pg.locator("#foglio .nutr--proteine").inner_text(), "proteine 12,5 g eccellenti"
        assert pg.locator("#foglio .nutr--proteine .indice-pallino.liv--1").count() == 1, "pallino verde scuro"
        assert "Senza sale" in pg.locator("#foglio .nutr--sale").inner_text(), "sale 0 → senza sale"
        assert "Basso impatto" in pg.locator("#foglio .nutr--kcal").inner_text(), "359 kcal → basso impatto"
        pg.click("#foglio .nutr--kcal")
        pg.wait_for_selector("#foglio .nutr--kcal .scala__soglie >> text=360 kcal")
        pg.click("#foglio button.nota__apri >> text=Tutti i valori per 100 g")
        pg.wait_for_selector("#foglio .valori .riga >> text=Energia")
        pg.wait_for_timeout(300)
        shot(pg, "1d-prodotto")
        pg.click("#foglio .btn--conferma >> text=Preso")
        pg.wait_for_selector(".tessera--verde:has(.tessera__indice .indice--eccellente) >> text=Spaghetti")
        pg.wait_for_selector("#foglio", state="hidden")
        voce = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); return [...new Map(s.store.find(([c]) => c === 'shopping_items')[1]).values()].find((v) => v.text === 'Spaghetti'); })()")
        assert voce["ean"] == "8076809513753" and voce["prodotto"]["fascia"] == "eccellente" and voce["detail"] == "Barilla" and voce["done"] and voce["count"] == 1, f"voce dal prodotto: {voce}"
        # Un prodotto a rischio, messo «Da comprare», unito alla voce «Würstel» scritta a mano.
        pg.click("button.fab")
        pg.fill(inp, "würstel")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("#foglio .pillola >> text=Würstel")
        pg.click("#foglio .foglio__secondarie button >> text=Scansiona")
        pg.fill(codice, "8001234567890")
        conferma(pg)
        pg.wait_for_selector("#foglio .prodotto__nome >> text=Würstel di pollo")
        assert pg.locator("#foglio .additivo.rischio--alto").count() == 2, "due additivi a rischio alto"
        assert "49" in pg.locator("#foglio .prodotto__avviso").inner_text(), "avviso del tetto a 49"
        assert pg.locator("#foglio .nutr--saturi .indice-pallino.liv--4").count() == 1 and pg.locator("#foglio .nutr--sale .indice-pallino.liv--4").count() == 1, "saturi e sale rossi"
        # NOVA spiegato: i quattro gruppi, il 4 evidenziato, e cosa lo ha deciso.
        pg.click("#foglio .nutr--nova")
        pg.wait_for_selector("#foglio .nova li.on >> text=Ultra-trasformati")
        assert "Nitrito di sodio" in pg.locator("#foglio .nova__perche").inner_text(), "marcatori del NOVA 4"
        pg.locator("#foglio .nutr--nova").scroll_into_view_if_needed()
        pg.wait_for_timeout(200)
        shot(pg, "1e-prodotto-rischio")
        pg.click("#foglio .foglio__secondarie button >> text=Da comprare")
        pg.wait_for_selector(".tessera:not(.tessera--verde):has(.tessera__indice .indice--scarso) >> text=Würstel")
        pg.wait_for_selector("#foglio", state="hidden")
        assert pg.locator(".tessera >> text=Würstel").count() == 1, "la voce scritta a mano e quella scansionata sono una sola"
        pg.wait_for_timeout(300)
        shot(pg, "1f-lista-prodotti")
        # Il pallino della tessera apre la scheda (29/10: prima solo dai tre puntini e dal foglio Modifica); l'angolo
        # che si tocca è largo anche se il pallino è piccolo.
        wurstel = pg.locator(".tessera", has_text="Würstel")
        box = wurstel.locator("button.tessera__indice").bounding_box()
        assert box["width"] >= 34 and box["height"] >= 34, f"angolo del pallino: {box}"
        box = wurstel.locator("button.altro").bounding_box()
        assert box["width"] >= 34 and box["height"] >= 34, f"angolo dei tre puntini: {box}"
        wurstel.locator("button.tessera__indice").click()
        pg.wait_for_selector("#foglio .prodotto__nome >> text=Würstel di pollo")
        assert pg.input_value("#foglio input[aria-label='In lista come']") == "Würstel", "la scheda è quella della voce"
        assert pg.locator("#foglio .btn--conferma >> text=Preso").count() == 1
        pg.wait_for_timeout(250)
        shot(pg, "1f2-scheda-dal-pallino")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        assert pg.locator(".tessera:not(.tessera--verde)", has_text="Würstel").count() == 1, "aprire la scheda non compra"
        # Dal foglio Modifica la riga del prodotto sta in cima e riapre la scheda; un codice sconosciuto dice che non c'è.
        wurstel.locator("button.altro").click()
        pg.wait_for_selector("#foglio .riga >> text=Würstel di pollo")
        assert pg.evaluate("document.querySelector('#foglio .riga').getBoundingClientRect().top < document.querySelector('#foglio input').getBoundingClientRect().top"), "il prodotto prima del nome"
        pg.click("#foglio .riga >> text=Würstel di pollo")
        pg.wait_for_selector("#foglio .prodotto__nome >> text=Würstel di pollo")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        pg.click("button.fab")
        pg.click("#foglio .foglio__secondarie button >> text=Scansiona")
        pg.fill(codice, "8001111111116")
        conferma(pg)
        # Biologico = solo la foglia accanto al nome; frutta 95% tra i positivi.
        pg.wait_for_selector("#foglio .prodotto__nome .prodotto__bio")
        assert "95%" in pg.locator("#foglio .nutr--frutta").inner_text(), "frutta e verdura 95%"
        assert pg.locator("#foglio .prodotto__sezione h3", has_text="Biologico").count() == 0, "niente riga del bio"
        pg.wait_for_timeout(200)
        shot(pg, "1e2-prodotto-bio")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        # Scheda OFF senza nome né ingredienti (il cracker del 31/10): titolo dalla marca, additivi e NOVA non noti.
        pg.click("button.fab")
        pg.click("#foglio .foglio__secondarie button >> text=Scansiona")
        pg.fill(codice, "8002222222225")
        conferma(pg)
        pg.wait_for_selector("#foglio .prodotto__nome b >> text=Galbusera Belle Buone")
        assert "Un po' troppo calorico" in pg.locator("#foglio .nutr--kcal").inner_text() and "Un po' troppo salato" in pg.locator("#foglio .nutr--sale").inner_text(), "480 kcal e 1,1 g di sale tra i negativi"
        assert "non ha gli ingredienti" in pg.locator("#foglio").inner_text(), "additivi non noti detti"
        assert "valori nutrizionali, " not in pg.locator("#foglio .prodotto__avviso").inner_text(), "con i valori la nutrizione è nota"
        pg.wait_for_timeout(200)
        shot(pg, "1e3-prodotto-incompleto")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        # Cosmetico (Open Beauty Facts, 31/10 sera): ingredienti segnalati, lista INCI, nota sui limiti, fonte OBF.
        step[0] = "lista, cosmetico"
        pg.click("button.fab")
        pg.click("#foglio .foglio__secondarie button >> text=Scansiona")
        pg.fill(codice, "3600000000004")
        conferma(pg)
        pg.wait_for_selector("#foglio .prodotto__nome b >> text=Crema mani alla lavanda")
        assert pg.locator("#foglio .prodotto__bio").count() == 1, "foglia del bio"
        sezioni = pg.locator("#foglio .prodotto__sezione h3").all_inner_texts()
        assert sezioni == ["Da sapere", "Ingredienti"], f"sezioni del cosmetico: {sezioni}"
        assert pg.locator("#foglio .additivo.rischio--moderato").count() == 2 and pg.locator("#foglio .additivo.rischio--basso").count() == 5, "2 moderati, 5 bassi"
        assert pg.locator("#foglio .additivo").first.locator("b").inner_text() in ("Propylparaben", "Benzyl Salicylate"), "i moderati per primi"
        assert "non supera 49" in pg.locator("#foglio .prodotto__avviso").inner_text(), "avviso del tetto"
        assert "Open Beauty Facts" in pg.locator("#foglio .prodotto__fonte").inner_text(), "fonte OBF"
        assert "Positivo" not in pg.locator("#foglio").inner_text(), "niente sezioni degli alimenti"
        pg.wait_for_timeout(200)
        shot(pg, "1e4-cosmetico")
        pg.click("#foglio .foglio__secondarie button >> text=Da comprare")
        pg.wait_for_selector("section.reparto[aria-label='Casa e persona'] .tessera >> text=Creme per le mani")
        pg.wait_for_selector("#foglio", state="hidden")
        pg.click("button.fab")
        pg.click("#foglio .foglio__secondarie button >> text=Scansiona")
        pg.fill(codice, "4000000000001")
        conferma(pg)
        pg.wait_for_selector("#foglio >> text=Prodotto non trovato")
        # «Completa» (1/11): tre foto con la fotocamera finta, lettura, riepilogo, account la prima volta, scheda.
        step[0] = "lista, completa su Open Food Facts"
        pg.click("#foglio .contributo__riga")
        pg.wait_for_selector("#foglio .contributo__passo >> text=1 di 3 · Fronte")
        pg.wait_for_function("document.querySelector('#foglio video')?.readyState >= 2", timeout=5000)
        conferma(pg)
        pg.wait_for_selector("#foglio .contributo__passo >> text=2 di 3 · Ingredienti")
        conferma(pg)
        pg.wait_for_selector("#foglio .contributo__passo >> text=3 di 3 · Valori nutrizionali")
        assert pg.locator("#foglio .foto-miniature img").count() == 2, "due miniature"
        pg.wait_for_timeout(200)
        shot(pg, "1i-completa-foto")
        conferma(pg)
        pg.wait_for_selector("#foglio .foglio__testa h2 >> text=Da aggiungere")
        assert pg.input_value("#foglio input[aria-label='Nome']") == "Gallette di riso", "nome letto"
        assert pg.input_value("#foglio input[aria-label='Sale']") == "0,2", "sale con la virgola"
        assert pg.locator("#foglio .contributo__account").is_visible(), "la prima volta si chiede l'account"
        pg.fill("#foglio input[aria-label='Nome']", "Gallette di riso integrale")
        conferma(pg)
        assert pg.evaluate("document.activeElement?.getAttribute('aria-label')") == "Nome utente di Open Food Facts", "senza account Invia porta al nome utente"
        pg.fill("#foglio input[aria-label='Nome utente di Open Food Facts']", "sbagliato")
        pg.fill("#foglio input[aria-label='Password di Open Food Facts']", "x")
        pg.wait_for_timeout(200)
        shot(pg, "1j-completa-riepilogo")
        conferma(pg)
        pg.wait_for_selector("#foglio .contributo__rifiutato")
        assert pg.input_value("#foglio input[aria-label='Nome']") == "Gallette di riso integrale", "le correzioni restano dopo il rifiuto"
        pg.fill("#foglio input[aria-label='Nome utente di Open Food Facts']", "mattia")
        pg.fill("#foglio input[aria-label='Password di Open Food Facts']", "giusta")
        conferma(pg)
        pg.wait_for_selector("#foglio .prodotto__nome b >> text=Gallette di riso integrale")
        assert pg.locator("#foglio .contributo__riga").count() == 0, "scheda completa: niente più «Completa»"
        chiamate = pg.evaluate("JSON.parse(sessionStorage.getItem('finto.contributi'))")
        invii = [c for c in chiamate if c["azione"] == "invia"]
        assert [c["azione"] for c in chiamate][0] == "leggi" and len(invii) == 2, f"una lettura e due invii: {chiamate}"
        assert invii[-1]["foto"] == ["front", "ingredients", "nutrition"] and invii[-1]["campi"]["nutrizione"]["sale"] == 0.2, f"foto e valori inviati: {invii[-1]}"
        pg.wait_for_timeout(200)
        shot(pg, "1k-completa-fatto")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        # La seconda volta l'account non si chiede più: «Invio come mattia».
        pg.evaluate("sessionStorage.removeItem('finto.off.aggiunte')")
        pg.click("button.fab")
        pg.click("#foglio .foglio__secondarie button >> text=Scansiona")
        pg.fill(codice, "4000000000003")
        conferma(pg)
        pg.wait_for_selector("#foglio .contributo__riga")
        pg.click("#foglio .contributo__riga")
        pg.wait_for_selector("#foglio .contributo__passo >> text=1 di 3")
        pg.wait_for_function("document.querySelector('#foglio video')?.readyState >= 2", timeout=5000)
        conferma(pg)
        pg.click("#foglio .foglio__secondarie button >> text=Salta")
        pg.click("#foglio .foglio__secondarie button >> text=Salta")
        pg.wait_for_selector("#foglio .contributo__chi >> text=Invio come mattia")
        assert not pg.locator("#foglio .contributo__account").is_visible(), "account già dato: campi nascosti"
        # Valori come la tabella dell'etichetta: i «di cui» rientrati sotto la loro voce, cifre allineate a destra.
        rientri = pg.evaluate("""[...document.querySelectorAll('#foglio .contributo__valore')].map((r) => ({
          nome: r.querySelector('span').textContent, x: Math.round(r.querySelector('span').getBoundingClientRect().left
            + parseFloat(getComputedStyle(r.querySelector('span')).paddingLeft)), destra: Math.round(r.querySelector('input').getBoundingClientRect().right) }))""")
        assert [r["nome"] for r in rientri][:3] == ["Energia", "Grassi", "di cui saturi"], rientri
        assert len({r["destra"] for r in rientri}) == 1, f"cifre in colonna: {rientri}"
        assert rientri[2]["x"] > rientri[1]["x"] and rientri[4]["x"] == rientri[2]["x"], f"«di cui» rientrati: {rientri}"
        shot(pg, "1l-completa-valori")
        # OFF lento: la rilettura dopo l'invio dà ancora la scheda di prima → in cima «Contributo inviato» con l'anello,
        # niente «Completa», e la scheda si rilegge da sola finché arriva quella nuova (1/11: «Rileggi» in fondo era scomodo).
        pg.evaluate("sessionStorage.setItem('finto.off.lento', '1')")
        conferma(pg)
        pg.wait_for_selector("#foglio .contributo__inviato .contributo__segno--gira")
        assert pg.locator("#foglio .contributo__riga:not(.contributo__inviato)").count() == 0, "contributo appena inviato: niente «Completa»"
        assert pg.locator("#foglio .foglio__secondarie .btn--rileggi").is_visible(), "Rileggi nella barra in basso"
        pg.wait_for_timeout(200)
        shot(pg, "1m-completa-in-pubblicazione")
        pg.wait_for_function("Number(sessionStorage.getItem('finto.off.lento.letture')) >= 1", timeout=6000)
        assert pg.locator("#foglio .contributo__inviato").count() == 1, "ancora la scheda di prima: la riga resta"
        pg.evaluate("sessionStorage.removeItem('finto.off.lento')")
        pg.wait_for_selector("#foglio .prodotto__nome b >> text=Gallette di riso", timeout=8000)
        assert pg.locator("#foglio .contributo__inviato").count() == 0, "arrivata la scheda nuova: niente più riga"
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")

        # ── Scansiona sopra il +: fotocamera finta che legge il codice. La ricerca è lenta (come una
        # function fredda) e il foglio resta sull'attesa finché la scheda non arriva (29/10: prima lo
        # scanner chiudeva con un history.back() che chiudeva anche l'attesa, e la lista restava ferma).
        step[0] = "lista, scansiona diretto"
        assert pg.locator("button.fab--sopra[aria-label='Scansiona un prodotto']").count() == 1, "Scansiona sopra il +"
        assert pg.evaluate("document.documentElement.hasAttribute('data-fab-doppio')"), "toast e spazio in fondo spostati"
        pg.evaluate("""() => { sessionStorage.setItem('finto.prodotto.ritardo', '1500');
            window.BarcodeDetector = class { constructor() { this.n = 0; } async detect() { return ++this.n > 3 ? [{ rawValue: '8076809513753' }] : []; } }; }""")
        pg.click("button.fab--sopra")
        pg.wait_for_selector("#foglio .scanner")
        pg.wait_for_selector("#foglio .prodotto__indice--attesa")
        pg.wait_for_timeout(500)
        assert pg.locator("#foglio .prodotto__indice--attesa").count() == 1, "l'attesa resta visibile finché la scheda non arriva"
        assert "8076809513753" in pg.locator("#foglio .prodotto__nome").inner_text(), "l'attesa mostra il codice letto"
        shot(pg, "1g-prodotto-attesa")
        pg.wait_for_selector("#foglio .prodotto__nome >> text=Spaghetti n.5")
        assert "foglio--sostituisce" not in (pg.get_attribute("#foglio", "class") or ""), "la scheda prende il posto dell'attesa senza dissolvenza"
        # «Rileggi» (dopo aver corretto la scheda su OFF): di nuovo l'attesa, poi la scheda, col nome scritto.
        pg.fill("#foglio input[aria-label='In lista come']", "Spaghettini")
        pg.click("#foglio .foglio__secondarie .btn--rileggi")
        pg.wait_for_selector("#foglio .prodotto__indice--attesa")
        pg.wait_for_selector("#foglio .prodotto__nome >> text=Spaghetti n.5")
        assert pg.input_value("#foglio input[aria-label='In lista come']") == "Spaghettini", "Rileggi tiene il nome scritto"
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        # Indietro durante l'attesa: la scheda non ricompare da sola quando arriva.
        pg.click("button.fab--sopra")
        pg.wait_for_selector("#foglio .prodotto__indice--attesa")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        pg.wait_for_timeout(1700)
        assert pg.locator("#foglio").is_hidden(), "chiusa l'attesa, la scheda non si riapre"
        pg.evaluate("() => { sessionStorage.removeItem('finto.prodotto.ritardo'); delete window.BarcodeDetector; }")
        # Errore della ricerca nello stesso foglio, «Riprova» in basso a destra.
        pg.click("button.fab--sopra")
        pg.fill(codice, "4000000000002")
        conferma(pg)
        pg.wait_for_selector("#foglio .btn--conferma >> text=Riprova")
        assert "non risponde" in pg.locator("#foglio .prodotto__nome").inner_text(), "il foglio dice l'errore"
        conferma(pg)
        pg.wait_for_selector("#foglio >> text=Prodotto non trovato")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        pg.wait_for_timeout(300)
        shot(pg, "1h-lista-scansiona")
        # Pallino calcolato col modello 1 dell'indice: rientrando nella Lista la voce si rilegge e si aggiorna.
        step[0] = "lista, pallini del modello vecchio"
        pg.evaluate("""async () => { const { update } = await import('/js/core/db.js');
            const s = JSON.parse(sessionStorage.getItem('finto.firestore'));
            const [id] = [...new Map(s.store.find(([c]) => c === 'shopping_items')[1]).entries()].find(([, v]) => v.text === 'Spaghetti');
            await update('shopping_items', id, { prodotto: { nome: 'Spaghetti n.5', marca: 'Barilla', indice: 60, fascia: 'buono' } }); }""")
        pg.wait_for_selector(".tessera:has(.tessera__indice .indice--buono) >> text=Spaghetti")
        pg.click(".schede a[href='#/spese']")
        pg.click(".schede a[href='#/lista']")
        pg.wait_for_selector(".tessera:has(.tessera__indice .indice--eccellente) >> text=Spaghetti", timeout=5000)
        voce = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); return [...new Map(s.store.find(([c]) => c === 'shopping_items')[1]).values()].find((v) => v.text === 'Spaghetti'); })()")
        assert voce["prodotto"]["v"] == 2 and voce["prodotto"]["indice"] == 90, f"riassunto aggiornato: {voce['prodotto']}"

        # ── Cronologia dei prodotti scansionati: l'orologio in testata della Lista ──
        step[0] = "lista, cronologia"
        # Una scheda letta prima che la cronologia esistesse (solo nella cache `prodotti`, con lettoDa).
        pg.evaluate("""async () => { const f = await import('/firebase-stub.js'); const { session } = await import('/js/core/auth.js');
            await f.setDoc(f.doc({}, 'prodotti', '8000000000009'), { ean: '8000000000009', trovato: true, nome: 'Biscotti al farro', marca: 'Mulino',
              indice: 55, fascia: 'buono', letto: new Date('2026-09-20T10:00:00'), lettoDa: session.user.uid }); }""")
        pg.click(".testata button[aria-label='Prodotti scansionati']")
        pg.wait_for_selector("#page-title >> text=Prodotti scansionati")
        pg.wait_for_selector(".lezione__titolo >> text=Würstel di pollo")
        titoli = pg.locator(".lezione__titolo").all_inner_texts()
        assert titoli[-1] == "Biscotti al farro", f"la scheda vecchia in fondo: {titoli}"
        assert titoli.count("Spaghetti n.5") == 1, f"un prodotto una volta sola: {titoli}"
        assert "Prodotto non trovato" in titoli, titoli
        spaghetti = pg.locator(".voce-nota", has_text="Spaghetti n.5")
        assert "volte" in spaghetti.inner_text(), "scansionato più volte"
        assert pg.locator(".voce-nota", has_text="Würstel di pollo").locator(".lezione__stato >> text=in lista").count() == 1
        assert pg.locator(".fascia >> text=Settembre 2026").count() == 1
        assert pg.locator(".testata button[aria-label='Prodotti scansionati']").count() == 0, "l'orologio sta solo nella Lista"
        pg.wait_for_timeout(250)
        shot(pg, "1i-scansioni")
        # Dalla cronologia la scheda, con la voce della lista già scelta
        spaghetti.locator("button.lezione").click()
        pg.wait_for_selector("#foglio .prodotto__nome >> text=Spaghetti n.5")
        assert pg.input_value("#foglio input[aria-label='In lista come']") == "Spaghetti"
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        pg.click(".schede a[href='#/lista']")
        pg.wait_for_selector(".testata button[aria-label='Prodotti scansionati']")

        # ── Spese ──
        step[0] = "spese"
        pg.click(".schede a[href='#/spese']")
        pg.click("button.fab")
        pg.wait_for_selector("#foglio input[placeholder='Descrizione']")
        pg.fill("#foglio input[placeholder='Descrizione']", "Gpl")
        pg.keyboard.press("Enter")
        pg.keyboard.type("25")
        pg.wait_for_timeout(150)
        shot(pg, "2-spesa-foglio")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".riga >> text=Gpl")
        # Multa pagata dall'altra persona
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder='Descrizione']", "Multa")
        pg.fill("#foglio input[placeholder='0,00']", "15")
        pg.click("#foglio button.pillola >> text=Pagato da te e diviso")
        pg.click("#foglio button.pillola >> text=tutto a carico")
        conferma(pg)
        pg.wait_for_selector(".riga >> text=Multa")
        # Internet ricorrente
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder='Descrizione']", "Internet")
        pg.fill("#foglio input[placeholder='0,00']", "38")
        pg.select_option("#foglio select[aria-label='Ripeti']", "month")
        conferma(pg)
        pg.wait_for_selector(".riga >> text=Internet")
        txt = pg.inner_text("main")
        assert "12,50" in txt and "devi restituire" in txt and "hai prestato" in txt, "importi Splitwise"
        # saldo: 12,50 - 7,50 + 19,00 = 24,00
        assert "24,00" in txt, f"saldo atteso 24,00: {txt[:200]}"
        pg.wait_for_timeout(300)
        shot(pg, "3-spese")
        # Ricorrenti → modello: il secondo foglio sostituisce il primo e resta aperto
        pg.click("button.pillola >> text=Ricorrenti")
        pg.wait_for_selector("#foglio >> text=Internet")
        pg.click("#foglio .riga >> text=Internet")
        pg.wait_for_timeout(300)
        assert pg.is_visible("#foglio"), "il foglio del modello deve restare aperto"
        assert "foglio--sostituisce" in pg.get_attribute("#foglio", "class"), "il modello cambia solo il contenuto"
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)
        assert not pg.is_visible("#foglio"), "indietro chiude il foglio"
        pg.click("button.pillola >> text=Pareggia")
        assert pg.inner_text("#foglio .btn--conferma").strip() == "Registra"
        conferma(pg)
        pg.wait_for_selector("text=siete in pari")
        # Dal menu: «Spese ricorrenti» apre il foglio, anche stando già su Spese
        menu(pg, "Spese ricorrenti")
        pg.wait_for_selector("#foglio h2 >> text=Ricorrenti")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)
        assert not pg.is_visible("#foglio")

        # ── Task: progetto leggero nella riga, persone dalla rubrica ──
        step[0] = "task"
        pg.click(".schede a[href='#/task']")
        pg.click("button.pillola >> text=Progetto")
        pg.wait_for_timeout(150)
        # Una cosa nuova invece si apre con la tastiera sul primo campo
        assert pg.evaluate("document.activeElement === document.querySelector(\"#foglio input[placeholder='Nome del progetto']\")"), "progetto nuovo con la tastiera"
        pg.fill("#foglio input[placeholder='Nome del progetto']", "Circolo")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("button.pillola.on >> text=Circolo")
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder=\"Cosa c'è da fare\"]", "Mandare il verbale")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".riga >> text=Mandare il verbale")
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder=\"Cosa c'è da fare\"]", "Prenotare la sala")
        pg.fill("#foglio input[placeholder='Scrivi un nome']", "marco")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("#foglio button.pillola.on >> text=Marco")
        pg.keyboard.press("Enter")  # Invio a campo vuoto: salva
        pg.wait_for_selector(".riga >> text=Prenotare la sala")
        pg.click("button.pillola >> text=Tutti")
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder=\"Cosa c'è da fare\"]", "Rinnovare la carta d'identità")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".riga >> text=Rinnovare")
        riga_sala = pg.locator(".riga", has_text="Prenotare la sala")
        assert riga_sala.locator(".progetto >> text=Circolo").count() == 1, "progetto nella riga"
        assert "Marco" in riga_sala.inner_text(), "persone nella riga"
        pg.locator(".riga", has_text="Mandare il verbale").locator("button.spunta").click()
        pg.wait_for_selector("text=Completati · 1")
        # Un secondo task con Marco: deve ritrovare la stessa persona
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder=\"Cosa c'è da fare\"]", "Chiedere le chiavi")
        pg.fill("#foglio input[placeholder='Scrivi un nome']", "mar")
        pg.wait_for_selector("#foglio button.pillola:not(.on) >> text=Marco")
        pg.click("#foglio button.pillola:not(.on) >> text=Marco")
        conferma(pg)
        pg.wait_for_selector(".riga >> text=Chiedere le chiavi")
        pg.wait_for_timeout(200)
        shot(pg, "4-task")

        # ── Giorno a sinistra come nel Diario (5/11): numero in serif, sotto «oggi» / giorno della settimana / mese;
        #    solo sulla prima riga del giorno; in ritardo del colore delle cose in ritardo; senza scadenza la colonna è vuota ──
        step[0] = "task con il giorno a sinistra"
        import datetime as _dt
        oggi = _dt.date.today()
        def task_datato(testo, giorno):
            pg.click("button.fab")
            pg.fill("#foglio input[placeholder=\"Cosa c'è da fare\"]", testo)
            pg.locator("#foglio input[type='date']").evaluate("(i, v) => { i.value = v; i.dispatchEvent(new Event('change')); }", giorno.isoformat())
            conferma(pg)
            pg.wait_for_selector(f".riga >> text={testo}")
        task_datato("Chiamare il commercialista", oggi - _dt.timedelta(days=3))
        task_datato("Pagare il bollo", oggi)
        task_datato("Comprare il regalo", oggi + _dt.timedelta(days=2))
        task_datato("Prenotare il ristorante", oggi + _dt.timedelta(days=2))
        task_datato("Dentista", oggi + _dt.timedelta(days=20))
        GB = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"]
        MB = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"]
        def giorno_di(testo): return pg.locator(".riga", has_text=testo).locator(".riga__giorno")
        g = giorno_di("Chiamare il commercialista"); tardi = oggi - _dt.timedelta(days=3)
        assert g.locator("b").inner_text() == str(tardi.day) and g.locator("small").inner_text().lower() == MB[tardi.month - 1] and "tardi" in g.get_attribute("class"), "in ritardo: giorno, mese, colore"
        g = giorno_di("Pagare il bollo")
        assert g.locator("b").inner_text() == str(oggi.day) and g.locator("small").inner_text().lower() == "oggi", "oggi"
        tra2 = oggi + _dt.timedelta(days=2)
        g = giorno_di("Comprare il regalo")
        assert g.locator("b").inner_text() == str(tra2.day) and g.locator("small").inner_text().lower() == GB[tra2.weekday()], "entro la settimana: giorno della settimana"
        assert giorno_di("Prenotare il ristorante").inner_text().strip() == "", "stesso giorno della riga sopra: colonna vuota"
        tra20 = oggi + _dt.timedelta(days=20)
        g = giorno_di("Dentista")
        assert g.locator("b").inner_text() == str(tra20.day) and g.locator("small").inner_text().lower() == MB[tra20.month - 1], "più avanti: mese"
        assert giorno_di("Chiedere le chiavi").inner_text().strip() == "", "senza scadenza: colonna vuota"
        assert "era per" not in pg.locator(".riga", has_text="Chiamare il commercialista").inner_text(), "la data non si ripete nel testo"
        pg.wait_for_timeout(400)
        shot(pg, "4b-task-giorni")

        # ── Manuale: categorie della casa, mappa automatica, persone, Google Contatti ──
        step[0] = "manuale"
        # Google Contatti finto: il numero di Giulia si cambia a metà prova per vedere l'aggiornamento.
        google = {"giulia": "333 1234567"}
        letture = [0]
        def people(r):
            letture[0] += 1
            assert r.request.headers.get("authorization") == "Bearer token-finto", r.request.headers
            r.fulfill(status=200, content_type="application/json", body=json.dumps({"connections": [
                {"resourceName": "people/c1", "names": [{"displayName": "Giulia Bianchi"}], "phoneNumbers": [{"value": google["giulia"]}], "organizations": [{"name": "Circolo"}]},
                {"resourceName": "people/c2", "names": [{"displayName": "Marco"}], "emailAddresses": [{"value": "marco@example.com"}], "phoneNumbers": [{"value": "333 5550000"}]},
                {"resourceName": "people/c3", "names": [{"displayName": "Giuseppe Verdi"}], "nicknames": [{"value": "Beppe"}], "phoneNumbers": [{"value": "+39 347 0000000"}]},
                {"resourceName": "people/c4", "names": [{"displayName": "Anna Rossetti"}], "nicknames": [{"value": "Ani"}]},
            ]}))
        pg.route("https://people.googleapis.com/**", people)
        # Google Calendar finto: quattro calendari (il personale, la casa, la band in sola lettura, l'associazione),
        # eventi in memoria per calendario (GET/POST/PATCH/DELETE, move). Nella band le prove di domani e un concerto
        # a cui Mattia è invitato, che compare anche nel suo personale (stesso iCalUID); nel personale anche un invito.
        import datetime as _dt
        domani = (_dt.date.today() + _dt.timedelta(days=1)).isoformat()
        CAL_MIO, CAL_CASA, CAL_BAND, CAL_ASS = "mattia@example.com", "casa@group.calendar.google.com", "band@group.calendar.google.com", "ass@group.calendar.google.com"
        concerto = {"summary": "Concerto al circolo", "iCalUID": "concerto@band", "start": {"dateTime": f"{domani}T22:00:00Z"}, "end": {"dateTime": f"{domani}T23:30:00Z"}, "status": "confirmed"}
        cal = {"eventi": {
            CAL_MIO: {
                "inv1": {"id": "inv1", "summary": "Cena da Giulia", "iCalUID": "inv1@g", "start": {"dateTime": f"{domani}T19:00:00Z"}, "end": {"dateTime": f"{domani}T21:00:00Z"}, "organizer": {"email": "giulia@example.com"}, "htmlLink": "https://calendar.google.com/event?eid=inv1", "status": "confirmed"},
                "conc": {**concerto, "id": "conc", "organizer": {"email": CAL_BAND}, "htmlLink": "https://calendar.google.com/event?eid=conc"},
            },
            CAL_CASA: {},
            CAL_BAND: {
                "prove": {"id": "prove", "summary": "Prove con la band", "iCalUID": "prove@band", "location": "Sala prove", "start": {"dateTime": f"{domani}T18:00:00Z"}, "end": {"dateTime": f"{domani}T20:00:00Z"}, "organizer": {"email": CAL_BAND, "self": True}, "htmlLink": "https://calendar.google.com/event?eid=prove", "status": "confirmed"},
                "conc": {**concerto, "id": "conc", "organizer": {"email": CAL_BAND, "self": True}, "htmlLink": "https://calendar.google.com/event?eid=conc"},
            },
            CAL_ASS: {},
        }, "n": 0, "letti": []}
        from urllib.parse import unquote, urlparse, parse_qs
        def calendar(r):
            req = r.request
            assert req.headers.get("authorization") == "Bearer token-finto", req.headers
            url = req.url
            if "/users/me/calendarList" in url:
                r.fulfill(status=200, content_type="application/json", body=json.dumps({"items": [
                    {"id": CAL_MIO, "summary": CAL_MIO, "primary": True, "accessRole": "owner"},
                    {"id": CAL_CASA, "summary": "Casa", "accessRole": "owner", "backgroundColor": "#f6bf26"},
                    {"id": CAL_BAND, "summary": "Band", "accessRole": "reader"},
                    {"id": CAL_ASS, "summary": "Associazione", "accessRole": "writer"},
                ]}))
                return
            parti = urlparse(url).path.split("/calendars/", 1)[1].split("/")
            cid = unquote(parti[0])
            assert parti[1] == "events", url
            eventi = cal["eventi"][cid]
            eid = unquote(parti[2]) if len(parti) > 2 else None
            if req.method == "GET":
                cal["letti"].append(cid)
                r.fulfill(status=200, content_type="application/json", body=json.dumps({"items": list(eventi.values())}))
            elif req.method == "POST" and len(parti) > 3 and parti[3] == "move":
                verso = parse_qs(urlparse(url).query)["destination"][0]
                e = eventi.pop(eid)
                cal["eventi"][verso][eid] = e
                r.fulfill(status=200, content_type="application/json", body=json.dumps(e))
            elif req.method == "POST":
                assert cid in (CAL_MIO, CAL_CASA), f"l'app scrive solo nella casa e nel personale, non in {cid}"
                cal["n"] += 1
                e = {**json.loads(req.post_data), "id": f"ev{cal['n']}", "iCalUID": f"ev{cal['n']}@google.com", "htmlLink": f"https://calendar.google.com/event?eid=ev{cal['n']}", "creator": {"email": "mattia@example.com", "self": True}, "organizer": {"email": cid, "self": True}, "status": "confirmed"}
                eventi[e["id"]] = e
                r.fulfill(status=200, content_type="application/json", body=json.dumps(e))
            elif req.method == "PATCH":
                e = eventi[eid]
                for k, v in json.loads(req.post_data).items():
                    e[k] = {kk: vv for kk, vv in v.items() if vv is not None} if isinstance(v, dict) else v
                r.fulfill(status=200, content_type="application/json", body=json.dumps(e))
            elif req.method == "DELETE":
                del eventi[eid]
                r.fulfill(status=204, body="")
        pg.route("https://www.googleapis.com/calendar/**", calendar)
        # Google Drive finto: tre file, ricerca per nome.
        drive_files = [
            {"id": "doc1", "name": "Programma allenamenti tennis", "mimeType": "application/vnd.google-apps.document", "webViewLink": "https://docs.google.com/document/d/doc1", "modifiedTime": "2026-10-20T10:00:00Z", "owners": [{"displayName": "Mattia"}]},
            {"id": "pdf1", "name": "Contratto caldaia", "mimeType": "application/pdf", "webViewLink": "https://drive.google.com/file/d/pdf1", "modifiedTime": "2026-09-01T10:00:00Z", "owners": [{"displayName": "Mattia"}]},
            {"id": "doc2", "name": "Appunti programma circolo", "mimeType": "application/vnd.google-apps.document", "webViewLink": "https://docs.google.com/document/d/doc2", "modifiedTime": "2026-10-01T10:00:00Z", "owners": [{"displayName": "Giulia"}]},
        ]
        def drive(r):
            req = r.request
            assert req.headers.get("authorization") == "Bearer token-finto", req.headers
            q = req.url
            import urllib.parse
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(q).query).get("q", [""])[0]
            m = [x for x in drive_files if ("name contains" not in qs) or (qs.split("'")[1].lower() in x["name"].lower())]
            r.fulfill(status=200, content_type="application/json", body=json.dumps({"files": m}))
        pg.route("https://www.googleapis.com/drive/v3/files**", drive)
        menu(pg, "Manuale e rubrica")
        pg.wait_for_selector("h1 >> text=Manuale")
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder='Nome']", "Ferramenta Rossi")
        pg.click("#foglio button.pillola >> text=Vernici e ferramenta")
        pg.fill("#foglio input[placeholder='Via, paese']", "Via Roma 3, Leccio")
        pg.fill("#foglio textarea", "Vernici, viti, consegna a domicilio")
        conferma(pg)
        pg.wait_for_selector(".riga >> text=Ferramenta Rossi")
        href = pg.locator(".riga", has_text="Ferramenta Rossi").locator("a[aria-label='Apri in Google Maps']").get_attribute("href")
        assert "Ferramenta%20Rossi%2C%20Via%20Roma%203" in href, href
        # Categoria nuova dal foglio
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder='Nome']", "Bici Sport")
        pg.click("#foglio button.pillola >> text=Nuova")
        pg.fill("#foglio input[placeholder='Nuova categoria']", "ciclismo")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("#foglio button.pillola.on >> text=Ciclismo")
        conferma(pg)
        pg.wait_for_selector(".riga >> text=Bici Sport")
        # Rinomina dalla gestione: la voce segue
        pg.click("button.pillola >> text=Negozi")
        pg.wait_for_selector(".fascia >> text=Ciclismo")
        pg.click("text=Gestisci le categorie")
        ultima = pg.locator("#foglio .riga input").last  # le categorie nuove vanno in fondo
        assert ultima.input_value() == "Ciclismo", ultima.input_value()
        ultima.fill("Biciclette")
        conferma(pg)
        pg.wait_for_selector(".fascia >> text=Biciclette")
        shot(pg, "5-manuale-negozi")
        # Persone: Marco c'è una volta sola, arrivato dai task
        pg.click("button.pillola >> text=Persone")
        pg.wait_for_selector(".riga >> text=Marco")
        assert pg.locator(".riga", has_text="Marco").count() == 1, "Marco una volta sola"
        # Google: si collega una volta dalla pagina Google (dal manuale ci si arriva da «Collega Google»),
        # passando dalla pagina di Google, e si torna sulla pagina Google; i contatti si aprono da lì.
        step[0] = "collega google"
        assert letture[0] == 0, "nessuna lettura prima del collegamento"
        pg.click("text=Collega Google")
        pg.wait_for_selector("h1 >> text=Google")
        pg.wait_for_selector("button.fab >> text=Collega")
        pg.wait_for_timeout(200)
        shot(pg, "5b-google-da-collegare")
        pg.click("button.fab >> text=Collega")
        pg.wait_for_selector(".blocco h3 >> text=mattia@example.com", timeout=8000)
        assert pg.url.endswith("/#/google"), pg.url
        pg.wait_for_selector("text=Scegli il calendario della casa")
        pg.wait_for_timeout(200)
        shot(pg, "5b2-google")
        pg.click(".riga >> text=Contatti")
        pg.wait_for_selector("#foglio >> text=Collegato come mattia@example.com", timeout=8000)
        assert pg.url.endswith("/#/manuale"), pg.url
        pg.wait_for_selector("#foglio .riga >> text=Giulia Bianchi")
        assert "non collegata" in pg.locator("#foglio .riga", has_text="Marco").inner_text(), "Marco riconosciuto per nome"
        pg.fill("#foglio input[placeholder='Cerca tra i contatti']", "beppe")
        pg.wait_for_selector("#foglio .riga >> text=Giuseppe Verdi")
        assert pg.locator("#foglio .riga").count() == 1, "ricerca per soprannome"
        pg.fill("#foglio input[placeholder='Cerca tra i contatti']", "")
        pg.wait_for_timeout(200)
        shot(pg, "5c-contatti")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)
        assert pg.locator(".riga", has_text="Giulia").count() == 0, "in rubrica solo chi colleghi"
        step[0] = "manuale persone"
        # Scheda di Marco: i suoi task, e la mail per le bozze (prima un numero per le scorciatoie)
        pg.click(".riga >> text=Marco")
        pg.wait_for_selector("#foglio >> text=Task con questa persona")
        assert pg.locator("#foglio .riga").count() == 2, "due task aperti con Marco"
        pg.fill("#foglio input[type='email']", "marco@example.com")
        pg.wait_for_timeout(300)
        shot(pg, "6-persona")
        conferma(pg)
        # «Chiedere le chiavi» non dice di chiamare: niente scorciatoia; un task «Chiamare Marco» sì
        pg.click(".schede a[href='#/task']")
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder=\"Cosa c'è da fare\"]", "Chiamare Marco per la sala")
        # Marco è in rubrica senza numero e in Google con il numero: un solo suggerimento, che lo collega
        pg.fill("#foglio input[placeholder='Scrivi un nome']", "marco")
        pg.wait_for_selector("#foglio button.pillola:not(.on) >> text=Marco")
        assert pg.locator("#foglio button.pillola:not(.on):not(.pillola--accento)", has_text="Marco").count() == 1, "Marco una volta sola"
        pg.keyboard.press("Enter")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".riga >> text=Chiamare Marco per la sala")
        tel = pg.locator(".riga", has_text="Chiamare Marco per la sala").locator("a.tondo")
        assert tel.get_attribute("href") == "tel:3335550000", tel.get_attribute("href")
        rubrica = pg.evaluate("""() => JSON.parse(sessionStorage.getItem('finto.firestore')).store.find(([c]) => c === 'manual_entries')[1].map(([, d]) => d)""")
        marchi = [d for d in rubrica if d.get("name") == "Marco"]
        assert len(marchi) == 1 and marchi[0].get("googleId") == "people/c2", marchi
        assert pg.locator(".riga", has_text="Chiedere le chiavi").locator("a.tondo").count() == 0
        pg.click(".riga >> text=Chiamare Marco per la sala")
        wa = pg.locator("#foglio a.pillola", has_text="WhatsApp").get_attribute("href")
        assert wa == "https://wa.me/393335550000", wa
        pg.wait_for_timeout(250)
        shot(pg, "6b-task-contatti")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)

        # Una persona da Google mentre scrivi il nome: entra in rubrica collegata, col numero di Google
        step[0] = "task con contatto google"
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder=\"Cosa c'è da fare\"]", "Chiamare Giulia per le chiavi")
        pg.fill("#foglio input[placeholder='Scrivi un nome']", "giu")
        pg.wait_for_selector("#foglio button.pillola:not(.on) >> text=Giulia Bianchi")
        assert pg.locator("#foglio button.pillola:not(.on)", has_text="Giuseppe Verdi").count() == 1
        pg.wait_for_timeout(150)
        shot(pg, "6c-task-google")
        pg.click("#foglio button.pillola:not(.on) >> text=Giulia Bianchi")
        pg.keyboard.press("Enter")  # campo vuoto: salva
        pg.wait_for_selector(".riga >> text=Chiamare Giulia per le chiavi")
        tel = pg.locator(".riga", has_text="Chiamare Giulia per le chiavi").locator("a.tondo")
        assert tel.get_attribute("href") == "tel:3331234567", tel.get_attribute("href")

        # Nel manuale: Giulia collegata, recapiti in sola lettura; un numero cambiato in Google arriva da solo
        step[0] = "persona collegata"
        menu(pg, "Manuale e rubrica")
        pg.wait_for_selector(".riga >> text=Giulia Bianchi")
        pg.click(".riga >> text=Giulia Bianchi")
        pg.wait_for_selector("#foglio .nota-campo >> text=Da Google Contatti")
        assert pg.locator("#foglio input[type='tel']").get_attribute("readonly") is not None, "numero in sola lettura"
        assert pg.input_value("#foglio input[type='tel']") == "333 1234567"
        assert pg.input_value("#foglio textarea") == "Circolo", "azienda nelle note"
        pg.wait_for_timeout(200)
        shot(pg, "6d-persona-google")
        pg.click("#foglio button[aria-label='Indietro']")
        google["giulia"] = "333 7654321"
        pg.reload()
        pg.wait_for_selector(".riga >> text=333 7654321", timeout=8000)
        # Persona nuova dal manuale: il nome cerca tra i contatti
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder='Nome']", "bep")
        pg.wait_for_selector("#foglio button.pillola >> text=Giuseppe Verdi")
        pg.click("#foglio button.pillola >> text=Giuseppe Verdi")
        assert pg.input_value("#foglio input[placeholder='Nome']") == "Giuseppe Verdi"
        assert pg.input_value("#foglio input[type='tel']") == "+39 347 0000000"
        conferma(pg)
        pg.wait_for_selector(".riga >> text=Giuseppe Verdi")
        pg.wait_for_timeout(200)
        shot(pg, "7-manuale-persone")

        # ── Diario: il + apre la nota; una nota diventa subito un task ──
        step[0] = "diario"
        pg.click(".schede a[href='#/diario']")
        pg.click("button.fab")
        pg.fill("#foglio textarea", "Chiamare l'idraulico")
        pg.click("#foglio button.pillola >> text=Task")
        pg.wait_for_selector("#foglio h2 >> text=Nuovo task")
        assert pg.locator("#foglio input.linea-input").first.input_value() == "Chiamare l'idraulico"
        pg.wait_for_timeout(150)
        # Testo già scritto: niente tastiera all'apertura (31/10); toccando il campo, Invio salva.
        assert pg.evaluate("!/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)"), "task dalla nota aperto senza tastiera"
        pg.click("#foglio input.linea-input")
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(200)
        assert not pg.is_visible("#foglio"), "task salvato con Invio"
        pg.click("button.fab")
        pg.fill("#foglio textarea", "Devo preparare l'assemblea del circolo entro venerdì con Marco, scrivergli una mail. Comprare lampadine.")
        pg.wait_for_timeout(300)
        shot(pg, "8-nota")
        conferma(pg)
        pg.wait_for_selector(".azione >> text=Comprare lampadine", timeout=6000)
        pg.wait_for_timeout(300)
        shot(pg, "9-diario")
        pg.wait_for_selector(".voce-nota .lezione__ora >> text=· Sonnet")  # il modello che ha letto la nota
        pg.wait_for_selector(".lezione__titolo >> text=Assemblea del circolo con Marco")  # il titolo scritto dall'AI
        mailto = pg.locator(".azione a.pillola", has_text="Apri nella mail").get_attribute("href")
        assert mailto.startswith("mailto:marco%40example.com"), mailto
        # Le azioni come le righe delle altre sezioni (7/11): il giorno a sinistra, il titolo da solo, l'importo a destra
        assemblea = pg.locator(".azione").filter(has=pg.locator(".azione__titolo", has_text="Preparare l'assemblea"))
        assert assemblea.locator(".riga__giorno b").inner_text() == "30" and assemblea.locator(".azione__titolo").inner_text() == "Preparare l'assemblea", assemblea.inner_text()
        assert pg.locator(".azione", has_text="Comprare lampadine").locator(".riga__giorno b").count() == 0, "senza giorno, l'icona del tipo"
        pg.wait_for_timeout(200)
        shot(pg, "8b-azioni")
        assemblea.locator("button[aria-label='Conferma']").click()
        pg.wait_for_timeout(400)
        pg.locator(".azione", has_text="Comprare lampadine").locator("button[aria-label='Conferma']").click()
        pg.wait_for_timeout(400)
        # L'evento proposto: senza il calendario della casa la conferma non passa e la proposta resta
        assert "tutto il giorno" not in pg.locator(".azione", has_text="Cena con i Rossi").inner_text()
        pg.locator(".azione", has_text="Cena con i Rossi").locator("button[aria-label='Conferma']").click()
        pg.wait_for_selector("text=Scegli prima il calendario della casa")
        pg.wait_for_timeout(400)
        assert pg.locator(".azione").count() == 2, "restano la bozza e l'evento"
        pg.click(".schede a[href='#/task']")
        pg.click("button.pillola >> text=Tutti")
        pg.wait_for_selector(".riga >> text=Preparare l'assemblea")
        pg.wait_for_selector(".riga >> text=Chiamare l'idraulico")
        assert pg.locator("button.pillola", has_text="Circolo").count() == 1, "il progetto non deve duplicarsi"
        assert "Marco" in pg.locator(".riga", has_text="Preparare l'assemblea").inner_text()
        menu(pg, "Manuale e rubrica")
        pg.click("button.pillola >> text=Persone")
        pg.wait_for_selector(".riga >> text=Giulia Bianchi")
        assert pg.locator(".riga", has_text="Marco").count() == 1, "la proposta non deve duplicare Marco"
        pg.click(".schede a[href='#/lista']")
        pg.wait_for_selector(".tessera >> text=Lampadine")

        # ── Titolo e persone: l'AI intitola la nota e mette le persone nominate (rubrica o Google Contatti) ──
        step[0] = "titolo e persone"
        pg.click(".schede a[href='#/diario']")
        pg.click("button.fab")
        pg.fill("#foglio textarea", "Oggi al circolo si parlava di smartphone e adolescenti: non toglierli, ma insegnare a usarli. Ani Rossetti vorrebbe organizzare dei big talk, ne parlo con Giulia.")
        conferma(pg)
        riga = pg.locator(".voce-nota", has=pg.locator(".lezione__titolo", has_text="Smartphone e adolescenti"))
        riga.wait_for(timeout=6000)
        riga.locator(".persona >> text=Anna Rossetti").wait_for()
        assert riga.locator(".persona >> text=Giulia Bianchi").count() == 1, "Giulia, in rubrica"
        assert riga.locator(".lezione__giorno small").inner_text().lower() == "oggi"
        pg.evaluate("window.scrollTo(0, 0)")
        pg.wait_for_timeout(300)
        shot(pg, "9b-diario-persone")
        # Il foglio di lettura: Giulia apre la rubrica, Anna Google Contatti (in rubrica non entra da sola)
        riga.locator("button.lezione").click()
        pg.wait_for_selector("#foglio h2 >> text=Smartphone e adolescenti")
        assert pg.locator("#foglio .lettura__persone a.pillola", has_text="Anna Rossetti").get_attribute("href") == "https://contacts.google.com/person/c4"
        assert pg.locator("#foglio .lettura__persone button.pillola", has_text="Giulia Bianchi").count() == 1
        pg.wait_for_timeout(150)
        shot(pg, "9c-nota-lettura")
        # Modifica: titolo e persone cambiati a mano restano anche rianalizzando
        conferma(pg)
        pg.wait_for_selector("#foglio h2 >> text=Nota")
        assert pg.locator("#foglio input.nota__titolo-campo").input_value() == "Smartphone e adolescenti"
        pg.fill("#foglio input.nota__titolo-campo", "Big talk al circolo")
        pg.click("#foglio button[aria-label='Togli Anna Rossetti']")
        pg.wait_for_timeout(150)
        shot(pg, "9d-nota-modifica")
        conferma(pg)
        riga = pg.locator(".voce-nota", has=pg.locator(".lezione__titolo", has_text="Big talk al circolo"))
        riga.wait_for()
        assert riga.locator(".persona >> text=Anna Rossetti").count() == 0
        riga.locator("button.lezione").click()
        pg.click("#foglio button >> text=Rianalizza")
        pg.wait_for_timeout(800)
        assert riga.locator(".lezione__titolo").inner_text() == "Big talk al circolo", "il titolo scritto a mano resta"
        assert riga.locator(".persona >> text=Anna Rossetti").count() == 0, "le persone corrette a mano restano"
        assert riga.locator(".persona >> text=Giulia Bianchi").count() == 1
        # Una nota nuova con il titolo scritto da te: l'AI non lo cambia
        pg.click("button.fab")
        pg.fill("#foglio input.nota__titolo-campo", "Idee per il giardino")
        pg.keyboard.press("Enter")
        assert pg.evaluate("document.activeElement === document.querySelector('#foglio textarea')"), "Invio nel titolo porta al testo"
        pg.keyboard.type("Spostare il rosmarino vicino al muro")
        conferma(pg)
        pg.wait_for_timeout(800)
        assert pg.locator(".lezione__titolo >> text=Idee per il giardino").count() == 1

        # ── Foto nelle note (4/11, richiesta di Mattia): dal foglio della nota «Aggiungi foto»; nell'elenco la
        # fotocamera col numero, nel foglio di lettura la striscia delle miniature, il tocco apre la foto intera ──
        step[0] = "foto nelle note"
        riga = pg.locator(".voce-nota", has=pg.locator(".lezione__titolo", has_text="Idee per il giardino"))
        riga.locator("button.lezione").click()
        pg.wait_for_selector("#foglio h2 >> text=Idee per il giardino")
        assert pg.locator("#foglio .foto-striscia").count() == 0, "senza foto niente striscia"
        conferma(pg)  # Modifica
        pg.wait_for_selector("#foglio h2 >> text=Nota")
        # «Scatta» apre la fotocamera (campo con capture, una foto), «Galleria» il selettore (più foto)
        assert pg.get_attribute("#foglio input[aria-label='Scatta una foto']", "capture") == "environment"
        assert pg.get_attribute("#foglio input[aria-label='Scegli le foto']", "capture") is None
        pg.set_input_files("#foglio input[aria-label='Scegli le foto']", [os.path.join(HERE, "finto", "foto.jpg")])
        pg.wait_for_selector("#foglio .foto-striscia--scelta .foto-striscia__foto img")
        pg.set_input_files("#foglio input[aria-label='Scatta una foto']", [os.path.join(HERE, "finto", "foto-alta.jpg")])
        pg.wait_for_selector("#foglio .foto-striscia--scelta .foto-striscia__foto img >> nth=1")
        assert pg.locator("#foglio .foto-striscia__foto").count() == 2
        pg.wait_for_timeout(150)
        shot(pg, "9e-nota-foto-scelta")
        conferma(pg)
        riga.locator(".lezione__foto >> text=2").wait_for(timeout=4000)
        riga.locator("button.lezione").click()
        pg.wait_for_selector("#foglio h2 >> text=Idee per il giardino")
        pg.wait_for_selector("#foglio .foto-striscia__foto img >> nth=1")
        larghezze = pg.eval_on_selector_all("#foglio .foto-striscia__foto", "ns => ns.map((n) => n.getBoundingClientRect().width)")
        assert larghezze[0] > larghezze[1], f"miniature con le proporzioni delle foto: {larghezze}"
        pg.wait_for_timeout(150)
        shot(pg, "9f-nota-foto-lettura")
        pg.click("#foglio .foto-striscia__foto >> nth=0")
        pg.wait_for_selector(".visore img")
        pg.wait_for_timeout(150)
        shot(pg, "9g-nota-foto-intera")
        pg.click(".visore")
        assert pg.locator(".visore").count() == 0, "il visore si chiude al tocco"
        assert pg.is_visible("#foglio"), "il foglio di lettura resta"
        # Togliere una foto dal foglio della nota
        conferma(pg)
        pg.wait_for_selector("#foglio .foto-striscia--scelta .foto-striscia__foto img")
        pg.click("#foglio .foto-striscia__togli >> nth=0")
        assert pg.locator("#foglio .foto-striscia__foto").count() == 1
        conferma(pg)
        pg.wait_for_timeout(400)
        assert riga.locator(".lezione__foto").count() == 1 and "2" not in riga.locator(".lezione__foto").inner_text(), "resta una foto, senza numero"
        assert pg.evaluate("[...window.__finto.coll('journal_photos').values()].length") == 1, "la foto tolta non resta in journal_photos"
        menu(pg, "Manuale e rubrica")
        pg.click("button.pillola >> text=Persone")
        pg.wait_for_selector(".riga >> text=Giulia Bianchi")
        assert pg.locator(".riga", has_text="Anna Rossetti").count() == 0, "una persona nominata non entra in rubrica"

        # ── Diario per progetto: Tennis con istruzioni, riepilogo sotto la nota, trascrizione ripiegata ──
        step[0] = "diario per progetto"
        pg.click(".schede a[href='#/task']")
        pg.click("button.pillola >> text=Progetto")
        pg.fill("#foglio input[placeholder='Nome del progetto']", "Tennis")
        pg.fill("#foglio textarea", "Riassumi cosa mi ha insegnato il maestro e cosa ricordare.")
        # Le istruzioni si dettano come una nota: la trascrizione si aggiunge al campo
        pg.click("#foglio button[aria-label='Registra le istruzioni']")
        ferma_istr = pg.locator("#foglio button[aria-label='Ferma la registrazione']")
        ferma_istr.wait_for(timeout=4000)
        pg.wait_for_timeout(1300)
        ferma_istr.click()
        pg.wait_for_function("document.querySelector('#foglio textarea').value.includes('split step')", timeout=8000)
        assert pg.locator("#foglio textarea").input_value().startswith("Riassumi cosa mi ha insegnato il maestro e cosa ricordare.\n\n"), "si aggiunge a quello scritto"
        pg.evaluate("sessionStorage.removeItem('finto.trascrizioni')")
        assert pg.locator("#foglio .colore").count() == 12, "undici colori e nessuno"
        pg.click("#foglio .colore[data-colore='giallo']")
        assert pg.locator("#foglio .colore[data-colore='giallo'][aria-pressed='true']").count() == 1
        pg.wait_for_timeout(150)
        shot(pg, "15-progetto-istruzioni")
        conferma(pg)
        pg.wait_for_selector("button.pillola.on >> text=Tennis")
        pg.click("button.btn--piatto >> text=Diario")
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/diario']")
        pg.wait_for_selector("button.pillola.on >> text=Tennis")
        pg.wait_for_selector("text=Nessuna nota in questo progetto")
        assert pg.locator("button.pillola >> text=Circolo").count() == 0, "Circolo senza note né istruzioni: niente filtro"
        pg.click("button.fab")
        pg.wait_for_selector("#foglio button.pillola.on >> text=Tennis")  # progetto già scelto dal filtro
        pg.fill("#foglio textarea", "oggi il maestro mi ha fatto lavorare sul dritto, chiudere prima la spalla, e sul rovescio a due mani con i piedi più larghi. devo comprare le corde")
        conferma(pg)
        # Nel Diario la nota è una riga come le lezioni: titolo dell'AI, anteprima dal riepilogo, temi
        pg.wait_for_selector(".lezione__titolo >> text=Spalla chiusa sul dritto", timeout=6000)
        riga = pg.locator(".voce-nota", has_text="Spalla chiusa sul dritto")
        assert "Dritto: chiudere prima la spalla" in riga.locator(".lezione__anteprima").inner_text(), "anteprima dal riepilogo"
        assert riga.locator(".lezione__temi .etichetta >> text=Dritto").count() == 1
        assert pg.locator("text=oggi il maestro").count() == 0, "il testo si legge solo aprendo la nota"
        assert riga.locator(".azione >> text=Comprare le corde nuove").count() == 1, "le azioni restano proposte, sotto la riga"
        pg.wait_for_timeout(250)
        shot(pg, "16-tennis-riepilogo")
        # Toccandola: foglio di lettura con il riepilogo e la trascrizione ripiegata
        riga.locator("button.lezione").click()
        pg.wait_for_selector("#foglio .lezione__riepilogo h4 >> text=Cosa ho imparato")
        assert pg.locator("#foglio .lezione__riepilogo b >> text=chiudere prima").count() == 1, "grassetto nel riepilogo"
        assert pg.locator("#foglio .nota__testo--trascrizione").is_hidden(), "trascrizione ripiegata"
        pg.click("#foglio button.nota__apri")
        pg.wait_for_selector("#foglio .nota__testo--trascrizione >> text=oggi il maestro")
        pg.wait_for_timeout(150)
        shot(pg, "16b-tennis-trascrizione")
        # Il riepilogo si corregge toccandolo: foglio della nota con il cursore lì (31/10; prima si passava da Modifica)
        tocca_testo(pg, "#foglio .lezione__riepilogo", "chiudere prima")
        pg.wait_for_selector("#foglio label >> text=Riepilogo")
        c = cursore(pg)
        assert c["fuoco"] and dentro(c, "chiudere prima") and "**" in c["valore"], f"cursore nel riepilogo, sul grassetto toccato: {c}"
        r = pg.locator("#foglio .campo textarea")
        assert "Cosa ho imparato" in r.input_value(), r.input_value()
        r.fill(r.input_value() + "\n- Servizio: lancio più avanti")
        pg.wait_for_timeout(150)
        shot(pg, "17-tennis-nota")
        conferma(pg)
        pg.wait_for_timeout(300)
        riga.locator("button.lezione").click()
        pg.wait_for_selector("#foglio .lezione__riepilogo li >> text=Servizio: lancio più avanti")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(300)
        # Il task proposto finisce nel progetto Tennis
        pg.locator(".azione", has_text="Comprare le corde nuove").locator("button[aria-label='Conferma']").click()
        pg.wait_for_timeout(300)
        # La sintesi del progetto è una proposta: si legge ripiegata, poi la spunta la mette nel progetto
        prop = pg.locator(".azione", has_text="Prima sintesi di Tennis")
        assert prop.locator(".sintesi-proposta").is_hidden(), "la sintesi proposta parte ripiegata"
        prop.locator("button.nota__apri").click()
        pg.wait_for_selector(".sintesi-proposta h4 >> text=Rovescio a due mani")
        pg.wait_for_timeout(150)
        shot(pg, "17b-tennis-sintesi-proposta")
        prop.locator("button[aria-label='Conferma']").click()
        pg.wait_for_timeout(300)
        assert pg.locator(".azione", has_text="Prima sintesi di Tennis").count() == 0, "la proposta confermata sparisce"
        # ── Pagina del progetto: Sintesi per temi, Lezioni con titolo, Da fare ──
        step[0] = "pagina del progetto"
        pg.click("button.btn--piatto >> text=Pagina del progetto")
        pg.wait_for_selector("#page-title >> text=Tennis")
        pg.wait_for_selector("html[data-colore='giallo'] .pagina-progetto")
        pg.wait_for_selector(".tema__nome >> text=Dritto")
        assert pg.locator(".tema", has_text="Dritto").locator(".tema__stato--bene >> text=migliora").count() == 1, "stato del tema"
        assert "1 nota" in pg.locator(".tema", has_text="Dritto").inner_text(), "la nota è collegata al tema"
        assert pg.locator(".tema", has_text="Da provare").locator(".meta").count() == 0, "tema senza lezioni"
        pg.click(".tema__testa >> text=Dritto")
        pg.wait_for_selector(".tema--aperto .tema__corpo li >> text=Chiudere la spalla")
        # Rubriche come etichette con l'elenco sotto, non come voci dello stesso elenco
        corpo = pg.locator(".tema--aperto .tema__corpo")
        assert corpo.locator("h5").all_text_contents() == ["Acquisito", "In lavorazione"], corpo.locator("h5").all_text_contents()
        assert corpo.locator("li >> text=Acquisito").count() == 0, "«Acquisito:» non è una voce"
        assert corpo.locator("ul").count() == 2 and corpo.locator("li").count() == 3, "due elenchi sotto le due rubriche"
        pg.wait_for_timeout(200)
        shot(pg, "17c-progetto-sintesi")
        # Toccando il testo della sintesi si scrive lì
        tocca_testo(pg, ".tema--aperto .tema__corpo", "Mano sinistra per la distanza")
        pg.wait_for_selector("#foglio >> text=Sintesi di Tennis")
        c = cursore(pg)
        assert c["fuoco"] and dentro(c, "Mano sinistra per la distanza"), f"cursore sulla voce toccata della sintesi: {c}"
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(300)
        # Dal tema alla lezione: foglio di lettura con riepilogo e trascrizione ripiegata
        pg.click(".tema--aperto .tema__lezioni button.pillola")
        pg.wait_for_selector("#foglio >> text=Spalla chiusa sul dritto")
        assert pg.locator("#foglio .lezione__riepilogo h4 >> text=Cosa ho imparato").count() == 1
        assert pg.locator("#foglio .nota__testo--trascrizione").is_hidden()
        pg.click("#foglio button.nota__apri")
        pg.wait_for_selector("#foglio .nota__testo--trascrizione >> text=oggi il maestro")
        pg.wait_for_timeout(150)
        shot(pg, "17d-progetto-lezione")
        pg.click("#foglio .btn--conferma")  # Modifica: apre il foglio della nota
        pg.wait_for_selector("#foglio label >> text=Riepilogo")
        r = pg.locator("#foglio .campo textarea")
        r.fill(r.input_value() + "\n- Servizio: lancio più avanti")
        conferma(pg)
        pg.wait_for_timeout(200)
        # Vista Note (prima «Lezioni», che valeva solo per il tennis): giorno grande, titolo, temi
        assert pg.locator("button.pillola >> text=Lezioni").count() == 0
        pg.click("button.pillola >> text=\"Note\"")
        pg.wait_for_selector(".lezione__titolo >> text=Spalla chiusa sul dritto")
        assert pg.locator(".lezione__temi .etichetta >> text=Rovescio a due mani").count() == 1
        # Una lezione passata: dal + con la data cambiata finisce in fondo, nel suo mese
        pg.click("button.fab")
        pg.wait_for_selector("#foglio textarea")
        pg.fill("#foglio textarea", "prima lezione, solo palleggio da fondo")
        assert pg.locator("#foglio button.pillola", has_text="Oggi").count() == 1
        pg.locator("#foglio input[type=date]").evaluate("i => { i.value = '2026-09-29'; i.dispatchEvent(new Event('change')); }")
        assert pg.locator("#foglio button.pillola", has_text="29 set").count() == 1, "la pillola mostra la data scelta"
        conferma(pg)
        pg.wait_for_selector(".fascia >> text=Settembre 2026")
        assert pg.locator(".lezione").count() == 2
        assert pg.locator(".lezione").last.locator(".lezione__giorno b").inner_text() == "29", "la nota retrodatata è in fondo, nel suo mese"
        assert pg.locator(".fascia").count() >= 1, "fascia del mese"
        pg.wait_for_timeout(200)
        shot(pg, "17e-progetto-lezioni")
        # Vista Da fare: il task confermato è qui
        pg.click("button.pillola >> text=Da fare")
        pg.wait_for_selector(".riga >> text=Comprare le corde nuove")
        # Sintesi corretta a mano dal suo foglio
        pg.click("button.pillola >> text=Sintesi")
        pg.click("button.btn--piatto >> text=Modifica la sintesi")
        pg.wait_for_selector("#foglio >> text=Sintesi di Tennis")
        t = pg.locator("#foglio textarea")
        assert "Piedi più larghi" in t.input_value()
        pg.wait_for_timeout(150)
        assert pg.evaluate("!/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)"), "sintesi aperta senza tastiera"
        t.fill(t.input_value() + "\n\n## Volée\n- Racchetta davanti")
        conferma(pg)
        pg.wait_for_selector(".tema__nome >> text=Volée")
        # Storico: la versione dell'AI è tra le versioni, si rilegge e si ripristina
        pg.click("button.btn--piatto >> text=Versioni")
        pg.wait_for_selector("#foglio .versione")
        assert pg.locator("#foglio .versione").count() == 1, "una versione precedente (quella dell'AI)"
        assert "dall'AI" in pg.locator("#foglio .versione__testa").inner_text()
        pg.click("#foglio .versione__testa")
        pg.wait_for_selector("#foglio .versione__testo h4 >> text=Dritto")
        assert pg.locator("#foglio .versione__testo h4 >> text=Volée").count() == 0, "la versione vecchia non ha Volée"
        pg.wait_for_timeout(150)
        shot(pg, "17f-sintesi-versioni")
        pg.click("#foglio button >> text=Ripristina questa versione")
        pg.wait_for_timeout(300)
        assert pg.locator(".tema__nome >> text=Volée").count() == 0, "ripristinata la versione senza Volée"
        pg.click("button.btn--piatto >> text=Versioni")
        pg.wait_for_selector("#foglio .versione")
        assert pg.locator("#foglio .versione").count() == 2, "l'attuale è finita nello storico"
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)
        # Documenti di Drive collegati al progetto: dal foglio del progetto si cerca per nome
        step[0] = "documenti del progetto"
        pg.click("button[aria-label='Modifica progetto']")
        pg.wait_for_selector("#foglio label >> text=Documenti da Drive")
        pg.wait_for_timeout(150)
        # Un progetto già scritto si apre senza tastiera (31/10, dal video di Mattia)
        assert pg.evaluate("!/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)"), "progetto aperto senza tastiera"
        pg.fill("#foglio input[placeholder='Cerca nel tuo Drive per nome']", "programma")
        pg.wait_for_selector("#foglio .etichetta-campo >> text=Risultati")
        pg.wait_for_selector("#foglio .riga >> text=Programma allenamenti tennis")
        assert pg.locator("#foglio .riga", has_text="Contratto caldaia").count() == 0, "la ricerca filtra per nome"
        pg.click("#foglio .riga >> text=Programma allenamenti tennis")
        pg.wait_for_selector("#foglio .riga >> text=l'agente ne legge il testo")
        pg.wait_for_timeout(150)
        shot(pg, "17g-progetto-documenti")
        conferma(pg)
        pg.wait_for_selector(".fascia >> text=Documenti")
        assert pg.locator("#view .riga a", has_text="Programma allenamenti tennis").get_attribute("href") == "https://docs.google.com/document/d/doc1"
        # Dal menu si torna alla pagina; il Diario del progetto dal pulsante
        menu(pg, "Tennis")
        pg.wait_for_selector("#page-title >> text=Tennis")
        pg.click("button.btn--piatto >> text=Diario")
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/diario']")
        assert pg.locator("html[data-colore]").count() == 0, "fuori dalla pagina del progetto il colore se ne va"
        pg.wait_for_selector("button.pillola.on >> text=Tennis")
        pg.wait_for_selector(".lezione__titolo >> text=Spalla chiusa sul dritto")
        # Rianalisi di una nota già entrata nella sintesi: nessuna proposta, ma la nota lo dice
        lezione = pg.locator(".voce-nota").first  # la più recente: quella che ha proposto la sintesi
        assert lezione.locator(".lezione__stato--muto").count() == 0, "la nota che ha proposto la sintesi non dice «invariata»"
        lezione.locator("button.lezione").click()
        pg.click("#foglio button >> text=Rianalizza")
        lezione.locator(".lezione__stato--muto >> text=sintesi invariata").wait_for(timeout=6000)
        assert pg.locator(".azione", has_text="Sintesi di Tennis").count() == 0, "nessuna sintesi proposta"
        lezione.locator("button.lezione").click()
        pg.wait_for_selector("#foglio .nota__esito >> text=Sintesi del progetto invariata")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)
        shot(pg, "17h-sintesi-invariata")
        # In «Tutte» la nota porta il nome del progetto; le altre note restano
        pg.click("button.pillola >> text=Tutte")
        pg.wait_for_selector(".voce-nota .progetto >> text=Tennis")
        assert pg.locator(".voce-nota").count() >= 2, "in Tutte ci sono anche le altre note"
        # Etichetta del progetto e temi nel colore del progetto (Tennis giallo: testo #6E7A00)
        tennis = pg.locator(".voce-nota[data-colore='giallo']").first
        assert tennis.locator(".progetto").evaluate("e => getComputedStyle(e).color") == "rgb(110, 122, 0)", "etichetta gialla"
        assert tennis.locator(".lezione__temi .etichetta").first.evaluate("e => getComputedStyle(e).color") == "rgb(110, 122, 0)", "temi gialli"
        pg.wait_for_timeout(200)
        shot(pg, "18-diario-tutte")
        pg.click(".schede a[href='#/task']")
        pg.click("button.pillola >> text=Tennis")
        pg.wait_for_selector(".riga >> text=Comprare le corde nuove")
        assert pg.locator("button.pillola", has_text="Tennis").count() == 1, "il progetto non deve duplicarsi"
        assert pg.locator("button.btn--piatto", has_text="Progetto").filter(has_not_text="Modifica").count() == 1, "dai Task si va alla pagina del progetto"
        # Il filtro del Diario torna su Tutte per il resto della prova
        pg.click(".schede a[href='#/diario']")
        pg.click("button.pillola >> text=Tutte")

        # ── Pillole dei progetti tornando al Diario filtrato (2/11, dal video di Mattia): un progetto senza
        # istruzioni ma con note (là LAMA) spariva riaprendo il Diario con il filtro su un altro progetto ──
        step[0] = "pillole del diario filtrato"
        assert pg.locator("#view button.fab--sopra").is_hidden(), "senza un calendario in cui scrivere, niente tondo dell'evento"
        assert not pg.evaluate("document.documentElement.hasAttribute('data-fab-doppio')"), "un solo tondo: niente spazio in più"
        pg.click("button.fab")
        pg.wait_for_selector("#foglio >> text=Oppure trasformala subito in")
        assert pg.locator("#foglio button.pillola >> text=Evento").count() == 0, "senza calendari niente «Evento» tra le trasformazioni"
        pg.fill("#foglio textarea", "Direttivo del circolo: rivedere il regolamento della sala")
        pg.click("#foglio button.pillola >> text=Circolo")
        conferma(pg)
        pg.wait_for_selector("button.pillola >> text=Circolo")
        pg.click("button.pillola >> text=Tennis")
        pg.wait_for_selector("button.pillola.on >> text=Tennis")
        pg.click(".schede a[href='#/spese']")
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/spese']")
        pg.click(".schede a[href='#/diario']")
        pg.wait_for_selector("button.pillola.on >> text=Tennis")
        assert pg.locator(".segmenti button.pillola", has_text="Circolo").count() == 1, "il progetto con note resta tra le pillole: " + pg.locator(".segmenti").last.inner_text()
        pg.wait_for_timeout(150)
        shot(pg, "18b-diario-filtrato-ritorno")
        pg.click("button.pillola >> text=Tutte")

        # ── Niente «vuoto» di passaggio: cambiando filtro o sezione la pagina non dice «vuoto»
        # nemmeno per un fotogramma prima che arrivino i dati (video di Mattia, 26/10) ──
        step[0] = "niente vuoto di passaggio"
        pg.wait_for_selector(".voce-nota .progetto >> text=Tennis")
        pg.evaluate("""() => { window.lampi = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            const v = n.matches('.vuoto') ? n : n.querySelector('.vuoto');
            if (v) lampi.push(location.hash + ' ' + v.querySelector('b').textContent); } })
          .observe(document.getElementById('view'), { childList: true, subtree: true }); }""")
        for f in ["Tennis", "Tutte", "Tennis", "Tutte"]:
            pg.click(f"button.pillola >> text={f}")
            pg.wait_for_selector(f"button.pillola.on >> text={f}")
            pg.wait_for_timeout(150)
        for sezione in ["task", "spese", "lista", "diario", "task", "diario"]:
            pg.click(f".schede a[href='#/{sezione}']")
            pg.wait_for_selector(f".schede a[aria-current='page'][href='#/{sezione}']")
            pg.wait_for_timeout(150)
        lampi = pg.evaluate("lampi")
        assert not lampi, f"«vuoto» comparso per un attimo: {lampi}"
        # Tornando a una sezione già vista, la pagina è piena al primo fotogramma (ascolti condivisi in db.js)
        for sezione, sel in [("task", ".riga"), ("lista", ".tessera"), ("spese", ".riga"), ("diario", ".voce-nota")]:
            piena = pg.evaluate("""([s, sel]) => new Promise((ok) => {
                addEventListener('hashchange', () => requestAnimationFrame(() => ok(!!document.querySelector('#view ' + sel))), { once: true });
                document.querySelector(`.schede a[href='#/${s}']`).click(); })""", [sezione, sel])
            assert piena, f"{sezione}: pagina vuota al primo fotogramma"
            pg.wait_for_timeout(100)

        # ── Calendari: la casa e gli altri tuoi (1/11), agenda, evento nuovo, modifica, proposta ──
        step[0] = "calendario"
        menu(pg, "Calendario")
        pg.wait_for_selector("#view .vuoto b >> text=Nessun calendario")
        pg.click("button.btn >> text=Scegli i calendari")
        pg.wait_for_selector("#foglio h2 >> text=Calendari")
        pg.wait_for_selector('#foglio .riga b:text-is("Casa")')
        assert "principale" in pg.locator("#foglio .riga", has=pg.locator('b:text-is("Personale")')).first.inner_text(), "il principale si chiama Personale"
        pg.click('#foglio .riga b:text-is("Casa")')
        # La casa scelta resta su una riga; sotto, gli altri calendari da vedere (la casa non c'è più)
        pg.wait_for_selector("#foglio .riga >> text=Tocca per cambiarlo")
        assert pg.locator('#foglio .riga b:text-is("Casa")').count() == 1
        pg.click('#foglio .riga b:text-is("Personale")')
        pg.click('#foglio .riga b:text-is("Band")')
        personale = pg.locator("#foglio .riga", has=pg.locator('b:text-is("Personale")'))
        band = pg.locator("#foglio .riga", has=pg.locator('b:text-is("Band")'))
        assert "Lo modifichi anche dall'app" in personale.inner_text(), personale.inner_text()
        assert "si legge soltanto" in band.inner_text(), band.inner_text()
        assert personale.locator(".pallino--colore").get_attribute("data-colore") == "blu", "primo colore proposto"
        assert band.locator(".pallino--colore").get_attribute("data-colore") == "viola", "il secondo è un altro colore"
        band.locator(".colore[data-colore=verde]").click()
        assert band.locator(".pallino--colore").get_attribute("data-colore") == "verde"
        assert pg.locator("#foglio .riga", has=pg.locator('b:text-is("Associazione")')).locator(".colori").count() == 0, "non scelto: niente colori"
        pg.wait_for_timeout(150)
        shot(pg, "19a-calendari")
        conferma(pg)
        pg.wait_for_selector("text=Calendario della casa: Casa")
        scelti = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); return [...new Map(s.store.find(([c]) => c === 'users')[1]).values()].find((u) => u.calendari).calendari; })()")
        assert [(c["nome"], c["colore"], c["modificabile"]) for c in scelti] == [("Personale", "blu", True), ("Band", "verde", False)], scelti
        # Agenda con tutti i calendari: pillole per vederne uno solo; la band col suo nome nel suo colore
        pg.wait_for_selector(".evento >> text=Prove con la band")
        assert [t.strip() for t in pg.locator(".filtri-calendari .pillola").all_inner_texts()] == ["Tutti", "Casa", "Personale", "Band"], pg.locator(".filtri-calendari").inner_text()
        prove_band = pg.locator(".evento", has_text="Prove con la band")
        assert prove_band.get_attribute("data-colore") == "verde"
        assert prove_band.locator(".progetto").inner_text().lower() == "band"
        concerto_riga = pg.locator(".evento", has_text="Concerto al circolo")
        assert concerto_riga.count() == 1, "lo stesso evento in due calendari compare una volta"
        assert concerto_riga.locator(".progetto").inner_text().lower() == "band", "dal calendario a cui appartiene, non dall'invito"
        assert set(cal["letti"]) == {CAL_CASA, CAL_MIO, CAL_BAND}, cal["letti"]
        pg.wait_for_timeout(150)
        shot(pg, "19a2-calendario-tutti")
        # Un evento della band si legge soltanto: niente Salva, il link a Google
        prove_band.click()
        pg.wait_for_selector("#foglio h2 >> text=Prove con la band")
        assert pg.locator("#foglio .btn--conferma").count() == 0, "sola lettura: niente Salva"
        assert "sola lettura" in pg.locator("#foglio").inner_text()
        assert pg.locator("#foglio a >> text=Apri in Google").count() == 1
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)
        # Un invito nel personale: si legge soltanto, perché l'evento è di qualcun altro
        pg.click(".evento >> text=Cena da Giulia")
        pg.wait_for_selector("#foglio >> text=È un invito")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)
        # Con il filtro sulla casa: solo i suoi eventi, senza il nome del calendario
        pg.click(".filtri-calendari .pillola >> text=Casa")
        pg.wait_for_selector("text=Nessun evento nei prossimi 60 giorni in Casa")
        assert pg.locator("#view .vuoto").count() == 0, "calendario vuoto: una riga, non la pagina vuota"
        import datetime
        pg.click("button.fab")
        pg.wait_for_selector("#foglio h2 >> text=Nuovo evento")
        pg.fill("#foglio input[placeholder='Aggiungi titolo']", "Lezione di tennis")
        # Dove scrivere: la casa (il filtro) o il personale; gli altri calendari non ci sono
        assert [t.strip() for t in pg.locator("#foglio .ev-calendari .pillola").all_inner_texts()] == ["Casa", "Personale"]
        assert "on" in pg.locator("#foglio .pillola >> text=Casa").get_attribute("class")
        # Come in Google Calendar (7/11): titolo e calendari, poi «Tutto il giorno», inizio e fine con la data a sinistra e
        # l'ora a destra, la ripetizione; poi luogo e descrizione. Un evento nuovo è con orario e dura un'ora.
        gruppi = pg.locator("#foglio .ev-gruppo")
        assert gruppi.count() == 3, gruppi.all_inner_texts()
        assert [t.strip() for t in gruppi.nth(1).locator(".ev-riga").all_inner_texts()][0] == "Tutto il giorno"
        assert gruppi.nth(1).locator(".ev-riga").last.inner_text().strip() == "Non si ripete"
        assert pg.locator("#foglio .ev-riga .spunta.on").count() == 0, "un evento nuovo è con orario"
        SET = "(i, v) => { i.value = v; i.dispatchEvent(new Event('change')); }"
        oggi_iso = datetime.date.today().isoformat()
        pg.locator("#foglio input[type=date]").first.evaluate(SET, oggi_iso)
        pg.locator("#foglio input[type=time]").first.evaluate(SET, "18:00")
        assert pg.locator("#foglio .ev-valore--ora").all_inner_texts() == ["18:00", "19:00"], "la fine segue l'inizio, un'ora dopo"
        date = pg.locator("#foglio .ev-riga--rientro .ev-valore:not(.ev-valore--ora)").all_inner_texts()
        import re as _re
        assert date[0] == date[1] and _re.match(r"^[A-Z][a-zì]{2} \d{1,2} [a-z]{3} \d{4}$", date[0]), date
        pg.fill("#foglio input[placeholder='Aggiungi luogo']", "Circolo")
        # Il progetto dell'evento (7/11): le pillole dei progetti col loro colore, «Nessun progetto» di partenza
        assert "on" in pg.locator("#foglio .ev-progetti .pillola >> text=Nessun progetto").get_attribute("class")
        pg.click("#foglio .ev-progetti .pillola >> text=Tennis")
        pg.wait_for_timeout(150)
        shot(pg, "19-evento-nuovo")
        pg.locator("#foglio input[placeholder='Aggiungi luogo']").press("Enter")
        pg.wait_for_selector(".evento >> text=Lezione di tennis")
        riga = pg.locator(".evento", has_text="Lezione di tennis")
        # Come le lezioni: il giorno in serif con «oggi» sotto, una fascia per mese
        assert riga.locator(".evento__giorno b.display").inner_text() == str(datetime.date.today().day), riga.inner_text()
        assert riga.locator(".evento__giorno small").inner_text().lower() == "oggi"
        assert riga.locator(".evento__quando").inner_text().endswith("18:00 – 19:00 · Circolo"), riga.inner_text()
        tennis_id = pg.evaluate("[...window.__finto.coll('projects')].find(([, p]) => p.name === 'Tennis')[0]")
        assert cal["eventi"][CAL_CASA]["ev1"]["extendedProperties"]["shared"]["ddProgetto"] == tennis_id, cal["eventi"][CAL_CASA]["ev1"]
        etichetta = riga.locator(".progetto--evento")
        assert etichetta.inner_text().lower() == "tennis" and etichetta.get_attribute("data-colore") == "giallo", "il progetto nella riga, nel suo colore"
        assert pg.locator("#view .fascia").count() == 1, "una fascia, quella del mese"
        assert cal["eventi"][CAL_CASA]["ev1"]["start"]["timeZone"] == "Europe/Rome", cal["eventi"][CAL_CASA]
        assert riga.locator(".progetto:not(.progetto--evento)").count() == 0, "con il filtro sulla casa niente nome del calendario"
        # Modifica: tutto il giorno, titolo nuovo
        riga.click()
        pg.wait_for_selector("#foglio h2 >> text=Evento")
        assert pg.locator("#foglio .ev-valore--ora").all_inner_texts() == ["18:00", "19:00"], "si riapre con i suoi orari"
        pg.fill("#foglio input[placeholder='Aggiungi titolo']", "Torneo")
        pg.click("#foglio .ev-riga >> text=Tutto il giorno")
        assert pg.locator("#foglio .ev-riga .spunta.on").count() == 1 and pg.locator("#foglio .ev-valore--ora:visible").count() == 0, "tutto il giorno: niente ore"
        conferma(pg)
        pg.wait_for_selector(".evento >> text=Torneo")
        assert pg.locator(".evento", has_text="Torneo").locator(".evento__quando").inner_text().endswith("Tutto il giorno · Circolo")
        assert pg.locator(".evento", has_text="Torneo").locator(".progetto--evento").inner_text().lower() == "tennis", "il progetto resta"
        assert "date" in cal["eventi"][CAL_CASA]["ev1"]["start"] and "dateTime" not in cal["eventi"][CAL_CASA]["ev1"]["start"], cal["eventi"][CAL_CASA]["ev1"]
        # La proposta dell'agente ora passa: l'evento compare tra tre giorni
        step[0] = "prossimi giorni nel diario"
        pg.click(".schede a[href='#/diario']")
        pg.locator(".azione", has_text="Cena con i Rossi").locator("button[aria-label='Conferma']").click()
        pg.wait_for_selector("text=Evento nel calendario della casa")
        assert cal["eventi"][CAL_CASA]["ev2"]["summary"] == "Cena con i Rossi" and cal["eventi"][CAL_CASA]["ev2"]["location"] == "Da noi", cal["eventi"]
        # In cima al Diario: oggi e i due giorni dopo. Il torneo di oggi c'è, la cena tra tre giorni no.
        pg.wait_for_selector(".prossimi .fascia >> text=Prossimi giorni")
        assert pg.locator(".prossimi .evento", has_text="Torneo").count() == 1
        assert pg.locator(".prossimi .evento", has_text="Cena con i Rossi").count() == 0, "oltre i due giorni non compare"
        # Anche gli altri calendari (scelta di Mattia, 1/11), con il nome del calendario
        assert pg.locator(".prossimi .evento", has_text="Prove con la band").locator(".progetto").inner_text().lower() == "band"
        assert pg.locator("#view > *").first.evaluate("n => n.classList.contains('prossimi')"), "la striscia sta in cima"
        assert "null" not in pg.locator(".prossimi").inner_text(), pg.locator(".prossimi").inner_text()
        pg.evaluate("window.scrollTo(0, 0)")
        pg.wait_for_timeout(200)
        shot(pg, "19c-diario-prossimi")
        # Dalla striscia: un evento si apre nel suo foglio, «Calendario» porta alla pagina
        pg.click(".prossimi .evento >> text=Torneo")
        pg.wait_for_selector("#foglio h2 >> text=Evento")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)
        pg.click(".prossimi .fascia button >> text=Calendario")
        pg.wait_for_selector("#page-title >> text=Calendario")
        pg.wait_for_selector(".evento >> text=Cena con i Rossi")
        cena = pg.locator(".evento", has_text="Cena con i Rossi")
        assert cena.locator(".evento__quando").inner_text() == "20:00 – 21:00 · Da noi", cena.inner_text()
        assert cena.locator(".evento__giorno b").count() == 1, "altro giorno: ha il suo numero"
        pg.wait_for_timeout(200)
        shot(pg, "19b-calendario")
        # Elimina
        pg.click(".evento >> text=Torneo")
        pg.click("#foglio button >> text=Elimina")
        pg.wait_for_selector("text=Evento eliminato")
        pg.wait_for_timeout(300)
        assert pg.locator(".evento", has_text="Torneo").count() == 0 and "ev1" not in cal["eventi"][CAL_CASA]
        # Un evento nel personale, poi spostato nella casa
        pg.click(".filtri-calendari .pillola >> text=Tutti")
        pg.click("button.fab")
        pg.wait_for_selector("#foglio h2 >> text=Nuovo evento")
        pg.fill("#foglio input[placeholder='Aggiungi titolo']", "Dentista")
        pg.click("#foglio .pillola >> text=Personale")
        conferma(pg)
        pg.wait_for_selector("text=Evento in Personale")
        dentista = pg.locator(".evento", has_text="Dentista")
        assert dentista.locator(".progetto").inner_text().lower() == "personale" and dentista.get_attribute("data-colore") == "blu"
        nuovo = next(k for k, e in cal["eventi"][CAL_MIO].items() if e["summary"] == "Dentista")
        dentista.click()
        pg.wait_for_selector("#foglio h2 >> text=Evento")
        pg.click("#foglio .pillola >> text=Casa")
        conferma(pg)
        pg.wait_for_selector("text=Evento spostato in Casa")
        assert nuovo in cal["eventi"][CAL_CASA] and nuovo not in cal["eventi"][CAL_MIO], cal["eventi"]
        pg.wait_for_timeout(300)
        assert pg.locator(".evento", has_text="Dentista").locator(".progetto").count() == 0, "ora è della casa"
        pg.click(".evento >> text=Dentista")
        pg.click("#foglio button >> text=Elimina")
        pg.wait_for_selector("text=Evento eliminato")
        # Ripetizione e fine dopo mezzanotte, come in Google Calendar: 22:00 → 01:00 finisce il giorno dopo
        pg.click("button.fab")
        pg.wait_for_selector("#foglio h2 >> text=Nuovo evento")
        pg.fill("#foglio input[placeholder='Aggiungi titolo']", "Corso di yoga")
        giorni_ev = lambda: pg.locator("#foglio .ev-riga--rientro .ev-valore:not(.ev-valore--ora)").all_inner_texts()
        # Alle 23 un'ora finisce a mezzanotte del giorno dopo; la fine alle 23:45 riporta allo stesso giorno (come Google)
        pg.locator("#foglio input[type=time]").nth(0).evaluate(SET, "23:00")
        assert pg.locator("#foglio .ev-valore--ora").all_inner_texts() == ["23:00", "00:00"] and giorni_ev()[0] != giorni_ev()[1], giorni_ev()
        pg.locator("#foglio input[type=time]").nth(1).evaluate(SET, "23:45")
        assert giorni_ev()[0] == giorni_ev()[1], f"23:00 → 23:45 nello stesso giorno: {giorni_ev()}"
        pg.locator("#foglio input[type=time]").nth(1).evaluate(SET, "00:00")
        pg.click("#foglio .ev-riga >> text=Tutto il giorno")
        assert giorni_ev()[0] == giorni_ev()[1], f"fino a mezzanotte, per tutto il giorno è un giorno solo: {giorni_ev()}"
        pg.click("#foglio .ev-riga >> text=Tutto il giorno")
        pg.locator("#foglio input[type=time]").nth(0).evaluate(SET, "22:00")
        pg.locator("#foglio input[type=time]").nth(1).evaluate(SET, "01:00")
        date = pg.locator("#foglio .ev-riga--rientro .ev-valore:not(.ev-valore--ora)").all_inner_texts()
        assert date[0] != date[1], f"la fine passa al giorno dopo: {date}"
        pg.click("#foglio .ev-riga >> text=Non si ripete")
        assert pg.locator("#foglio .ev-opzione").count() == 6
        pg.click("#foglio .ev-opzione >> text=Ogni settimana")
        assert pg.locator("#foglio .ev-opzioni").is_hidden(), "scelta la ripetizione, l'elenco si chiude"
        assert pg.locator("#foglio .ev-riga[aria-expanded]").inner_text().startswith("Ogni settimana, "), pg.locator("#foglio .ev-riga[aria-expanded]").inner_text()
        pg.wait_for_timeout(150)
        shot(pg, "19g-evento-ripetuto")
        conferma(pg)
        pg.wait_for_selector("text=Evento nel calendario della casa")
        yoga = next(e for e in cal["eventi"][CAL_CASA].values() if e["summary"] == "Corso di yoga")
        assert yoga["recurrence"] == ["RRULE:FREQ=WEEKLY"], yoga
        assert yoga["end"]["dateTime"][:10] > yoga["start"]["dateTime"][:10] and yoga["end"]["dateTime"][11:16] == "01:00", yoga
        pg.click(".evento >> text=Corso di yoga")
        pg.click("#foglio button >> text=Elimina")
        pg.wait_for_selector("text=Evento eliminato")
        pg.click(".schede a[href='#/diario']")
        pg.wait_for_selector(".stato-ai")
        pg.wait_for_timeout(300)
        assert pg.locator(".prossimi .evento", has_text="Torneo").count() == 0, "l'evento eliminato non resta nella striscia"

        # ── Evento dal Diario (2/11, scelte B e C di Mattia tra tre schermate): il tondo col calendario sopra il +,
        # come «Scansiona» nella Lista, e «Evento» tra le trasformazioni del foglio della nota ──
        step[0] = "evento dal diario"
        doppio = lambda: pg.evaluate("document.documentElement.hasAttribute('data-fab-doppio')")
        tondo = pg.locator("#view button.fab--sopra[aria-label='Nuovo evento']")
        tondo.wait_for(state="visible", timeout=3000)
        assert doppio(), "con il doppio tondo toast e spazio in fondo salgono"
        pg.evaluate("window.scrollTo(0, 0)")
        pg.wait_for_timeout(200)
        shot(pg, "19e-diario-tondo-evento")
        tondo.click()
        pg.wait_for_selector("#foglio h2 >> text=Nuovo evento")
        pg.wait_for_timeout(150)
        assert pg.evaluate("document.activeElement.placeholder") == "Aggiungi titolo", "si scrive subito il titolo"
        pg.fill("#foglio input[placeholder='Aggiungi titolo']", "Idraulico")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("text=Evento nel calendario della casa")
        assert any(e["summary"] == "Idraulico" for e in cal["eventi"][CAL_CASA].values()), cal["eventi"][CAL_CASA]
        pg.wait_for_selector(".prossimi .evento >> text=Idraulico")
        # Da una nota: la prima riga è il titolo, il resto le note; la nota non si salva
        pg.click("button.fab.fab--tondo")
        pg.wait_for_selector("#foglio h2 >> text=Nuova nota")
        pg.fill("#foglio textarea", "Aperitivo da Luca\nportare il vino")
        pg.click("#foglio button.pillola >> text=Evento")
        pg.wait_for_selector("#foglio h2 >> text=Nuovo evento")
        assert pg.input_value("#foglio input[placeholder='Aggiungi titolo']") == "Aperitivo da Luca"
        assert pg.input_value("#foglio textarea[placeholder='Aggiungi descrizione']") == "portare il vino"
        pg.wait_for_timeout(200)
        shot(pg, "19f-evento-dalla-nota")
        conferma(pg)
        pg.wait_for_selector(".prossimi .evento >> text=Aperitivo da Luca")
        aperitivo = next(e for e in cal["eventi"][CAL_CASA].values() if e["summary"] == "Aperitivo da Luca")
        assert aperitivo.get("description") == "portare il vino", aperitivo
        assert pg.locator(".voce-nota", has_text="Aperitivo da Luca").count() == 0, "trasformata: la nota non resta"
        # Scorrendo tra Diario e Lista, che hanno entrambe il doppio tondo, lo spazio in più resta; altrove no
        pg.wait_for_selector("#foglio", state="hidden")
        scorri(-120)
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/lista']")
        assert doppio(), "la Lista tiene il suo spazio anche se il Diario si è smontato dopo"
        scorri(120)
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/diario']")
        assert doppio() and tondo.is_visible(), "tornando al Diario c'è ancora il tondo"
        pg.click(".schede a[href='#/spese']")
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/spese']")
        assert not doppio(), "nelle Spese un solo tondo"
        pg.click(".schede a[href='#/diario']")
        pg.wait_for_selector(".stato-ai")

        # ── Scollegare Google ──
        step[0] = "scollega"
        menu(pg, "Google")
        pg.wait_for_selector(".blocco h3 >> text=mattia@example.com")
        pg.click("button.btn--pericolo >> text=Scollega")
        pg.wait_for_selector("#foglio .btn--conferma >> text=Scollega")
        conferma(pg)
        pg.wait_for_selector("text=Google scollegato")
        pg.wait_for_selector("button.fab >> text=Collega")
        assert pg.evaluate("localStorage.getItem('macroapp.calendario.eventi')") is None, "scollegando si dimenticano gli eventi"
        menu(pg, "Calendario")
        pg.wait_for_selector("#page-title >> text=Calendario")
        pg.wait_for_selector("#view .vuoto >> text=Google non collegato")
        pg.wait_for_timeout(400)  # fine del passaggio, prima di contare i passaggi del tema

        # ── Tema scuro ──
        step[0] = "tema"
        # Passaggi tra le pagine (data-passaggio su <html>): dal menu si entra, verso la barra si
        # torna, tra le sezioni della barra niente.
        pg.evaluate("""() => { window.passaggi = []; new MutationObserver(() => {
            const p = document.documentElement.dataset.passaggio; if (p) passaggi.push(p); })
          .observe(document.documentElement, { attributes: true, attributeFilter: ["data-passaggio"] }); }""")
        pg.click("button[aria-label='Menu']")
        pg.wait_for_timeout(250)
        shot(pg, "10-menu")
        pg.click(".menu__voce >> text=Casa, tema e account")
        pg.click("button.pillola >> text=Scuro")
        shot(pg, "6-impostazioni")
        pg.click(".schede a[href='#/lista']")
        pg.wait_for_timeout(300)
        shot(pg, "7-lista-scuro")
        pg.click(".schede a[href='#/spese']")
        pg.wait_for_timeout(300)
        shot(pg, "8-spese-scuro")
        pg.click(".schede a[href='#/diario']")
        pg.wait_for_timeout(300)
        shot(pg, "9-diario-scuro")
        assert pg.locator("#view button.fab--sopra").is_hidden() and not pg.evaluate("document.documentElement.hasAttribute('data-fab-doppio')"), "Google scollegato: niente tondo dell'evento"
        assert pg.evaluate("passaggi") == ["entra", "torna"], pg.evaluate("passaggi")
        pg.click("button[aria-label='Menu']")
        pg.click(".menu__voce >> text=Casa, tema e account")
        pg.click("button.pillola >> text=Chiaro")

        # ── Banca: dal menu, scelta della banca, ritorno con il codice, stato del collegamento, lettura ──
        step[0] = "banca"
        menu(pg, "Banca")
        pg.wait_for_selector("text=Nessuna banca collegata")
        pg.wait_for_timeout(300)
        shot(pg, "11-banca-vuota")
        pg.click("button[aria-label='Collega una banca']")
        pg.wait_for_selector("#foglio .riga >> text=Banca di Prova")
        pg.fill("#foglio input", "prova")
        assert pg.locator("#foglio .riga").count() == 1, "il filtro lascia una banca"
        assert "null" not in pg.locator("#foglio").inner_text(), "foglio senza barra: niente null in fondo"
        pg.wait_for_timeout(300)
        shot(pg, "12-banca-scelta")
        pg.click("#foglio .riga >> text=Banca di Prova")
        # Lo stub rimanda subito su /banca?code=…: la pagina si ricarica (i dati finti restano, come in
        # Firestore), poi va su #/banca e conclude il collegamento.
        pg.wait_for_selector("text=Consenso valido fino al", timeout=8000)
        assert pg.url.endswith("/#/banca"), f"dopo il ritorno l'indirizzo è {pg.url}"
        assert pg.locator("button[aria-label='Collega una banca']").is_hidden(), "collegata: niente +"
        assert "null" not in pg.locator("#view").inner_text(), "nessun null disegnato"
        # Nomi dei conti dal tipo, non dall'intestatario ripetuto
        pg.wait_for_selector(".riga b >> text=Conto corrente")
        pg.wait_for_selector(".riga b >> text=Carta")
        assert pg.locator(".riga b", has_text="ROSSI MARIO").count() == 0, "l'intestatario non fa da nome del conto"
        pg.wait_for_timeout(300)
        shot(pg, "13-banca-collegata")
        pg.click("button.pillola >> text=Leggi ora")
        pg.wait_for_selector("text=3 movimenti nuovi")
        pg.wait_for_selector("text=3 proposte nuove")
        # Gli acquisti della carta non ancora contabilizzati si vedono, ma non sono proposte
        pg.wait_for_selector("text=In attesa di contabilizzazione")
        pg.wait_for_selector(".riga >> text=RISTORANTE DA PINO")
        pg.wait_for_selector("text=6 movimenti letti · 2 in attesa")
        # Toccando il conto: gli ultimi movimenti letti con l'esito di ciascuno
        pg.click(".riga >> text=Carta")
        pg.wait_for_selector("#foglio h2 >> text=Carta")
        pg.wait_for_selector("#foglio >> text=la banca ha dato 6 movimenti: 3 uscite contabilizzate, 2 uscite in attesa, 1 entrata contabilizzata")
        pg.wait_for_selector("#foglio .riga >> text=Proposta nuova")
        pg.wait_for_selector("#foglio .riga >> text=Entrata: non è una spesa")
        pg.wait_for_timeout(400)
        shot(pg, "13c-banca-conto")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        assert pg.locator(".azione", has_text="RISTORANTE DA PINO").count() == 0
        # Il saldo della carta non diventa una proposta: compare tra gli scartati, col motivo
        pg.wait_for_selector("text=Scartati, non sono spese")
        pg.wait_for_selector(".riga >> text=ADDEBITO SALDO E/C CARTA 9876")
        pg.wait_for_selector(".riga >> text=Saldo della carta, importo abbinato")
        pg.locator("text=In attesa di contabilizzazione").scroll_into_view_if_needed()
        pg.wait_for_timeout(5500)  # il toast se ne va
        shot(pg, "13b-banca-scartati")
        # Le uscite da confermare stanno in Spese (7/11, richiesta di Mattia): «Dalla banca» accanto a «Ricorrenti», col numero
        # in un pallino; la pagina Banca ci porta col foglio già aperto
        pg.click("button.pillola >> text=Da confermare in Spese")
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/spese']")
        pg.wait_for_selector("#foglio h2 >> text=Dalla banca")
        voci = pg.locator("#foglio .banca-voce")
        voci.first.wait_for()
        assert voci.count() == 3, "tre uscite dalla banca"
        assert pg.locator("#foglio .banca-voce", has_text="AMAZON EU").locator(".testo span").inner_text() == "Carta", "l'acquisto con la carta dice da quale conto viene"
        assert pg.locator("button.pillola", has_text="Dalla banca").locator(".contatore").inner_text() == "3", "il pallino col numero"
        pg.wait_for_timeout(300)
        shot(pg, "14-banca-proposte")
        # «Dividi a metà»: la spesa entra, divisa
        pg.locator("#foglio .banca-voce", has_text="ESSELUNGA FIRENZE").locator("button >> text=Dividi a metà").click()
        pg.wait_for_selector("text=Spesa aggiunta")
        pg.wait_for_function("document.querySelectorAll('#foglio .banca-voce').length === 2")
        # Una riga toccata: il foglio della spesa già compilato; cambio la divisione e la aggiungo
        pg.locator("#foglio .banca-voce", has_text="Enel Energia").locator(".riga").click()
        pg.wait_for_selector("#foglio h2 >> text=Aggiungi spesa")
        assert pg.input_value("#foglio input[placeholder='Descrizione']") == "Enel Energia" and pg.input_value("#foglio input[placeholder='0,00']") == "61,3"
        pg.click("#foglio button.pillola >> text=Pagato da te e diviso")
        conferma(pg)
        pg.wait_for_selector(".riga >> text=Enel Energia")
        spese_db = pg.evaluate("[...window.__finto.coll('expenses').values()].map((e) => ({ d: e.description, split: e.split, source: e.source, bankTxId: e.bankTxId || null }))")
        enel = next(e for e in spese_db if e["d"] == "Enel Energia")
        assert enel == {"d": "Enel Energia", "split": "full", "source": "bank", "bankTxId": "eb_prova_2"}, enel
        assert pg.evaluate("window.__finto.coll('proposals').get('eb_prova_2').status") == "accepted", "la proposta della riga è confermata"
        assert pg.locator("button.pillola", has_text="Dalla banca").locator(".contatore").inner_text() == "1"
        # «Solo mia»: la toglie da qui, senza spesa; il pallino se ne va
        pg.click("button.pillola >> text=Dalla banca")
        pg.locator("#foglio .banca-voce", has_text="AMAZON EU").locator("button >> text=Solo mia").click()
        pg.wait_for_selector("#foglio >> text=Niente da confermare")
        assert pg.locator("button.pillola", has_text="Dalla banca").locator(".contatore").count() == 0
        assert not any(e["d"] == "AMAZON EU" for e in pg.evaluate("[...window.__finto.coll('expenses').values()].map((e) => ({ d: e.description }))"))
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector(".riga >> text=ESSELUNGA FIRENZE")

        # ── Banca: la banca chiude il consenso prima della scadenza → stato interrotto e rinnovo ──
        step[0] = "banca interrotta"
        menu(pg, "Banca")
        pg.click("button.pillola >> text=Leggi ora")
        pg.wait_for_selector("text=Collegamento interrotto oggi")
        pg.wait_for_selector("text=La banca ha chiuso il consenso: rinnovalo")
        assert pg.locator("button.fab[aria-label='Rinnova il consenso']").is_visible(), "rinnovo in basso a destra"
        assert pg.locator("button[aria-label='Collega una banca']").is_hidden(), "niente + mentre è collegata"
        assert pg.locator("button.pillola", has_text="Leggi ora").count() == 0, "niente Leggi ora a consenso chiuso"
        assert pg.locator("text=Consenso valido fino al").count() == 0, "niente scadenza ingannevole"
        assert pg.locator(".errore", has_text="EXPIRED_SESSION").count() == 0, "niente errore grezzo"
        pg.wait_for_selector("text=Lettura sospesa: riprende dopo il rinnovo.")
        box = pg.locator("button.fab[aria-label='Rinnova il consenso']").bounding_box()
        assert box["x"] + box["width"] > 390 - 30 and box["y"] > 844 - 200, f"rinnovo nella zona del pollice destro: {box}"
        pg.wait_for_timeout(5500)  # il toast se ne va
        shot(pg, "15-banca-interrotta")
        pg.click("button.fab[aria-label='Rinnova il consenso']")
        pg.wait_for_selector("text=Consenso valido fino al", timeout=8000)
        assert pg.locator("button.fab[aria-label='Rinnova il consenso']").is_hidden(), "rinnovato: niente pulsante di rinnovo"
        pg.wait_for_selector("button.pillola >> text=Leggi ora")

        pg.click("button.btn--pericolo >> text=Scollega")
        pg.wait_for_selector("#foglio h2 >> text=Scollega la banca")
        conferma(pg)
        pg.wait_for_selector("text=Nessuna banca collegata")

        # ── Notifiche: le scritture condivise di prima sono state segnalate alla funzione `avvisa` ──
        step[0] = "notifiche, segnalazioni"
        avvisi = pg.evaluate("JSON.parse(sessionStorage.getItem('finto.avvisi') || '[]')")
        print("AVVISI:", json.dumps(avvisi))
        tipi = {(a.get("coll"), a.get("evento")) for a in avvisi}
        assert ("expenses", "nuovo") in tipi, f"spesa condivisa segnalata: {tipi}"
        assert any(c == "shopping_items" for c, _ in tipi), f"lista segnalata: {tipi}"
        assert not any(c in ("journal_entries", "proposals", "manual_entries", "notes") for c, _ in tipi), f"niente avvisi per il resto: {tipi}"
        # La lista manda una chiamata sola per più voci aggiunte di seguito.
        n_lista = sum(1 for a in avvisi if a.get("coll") == "shopping_items")
        pg.evaluate("sessionStorage.removeItem('finto.avvisi')")
        pg.click(".schede a[href='#/lista']")
        pg.click("button.fab")
        pg.fill("#foglio input[aria-label='Aggiungi alla lista']", "zucchine, basilico, ceci")
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(2200)
        avvisi = pg.evaluate("JSON.parse(sessionStorage.getItem('finto.avvisi') || '[]')")
        assert len(avvisi) == 1 and avvisi[0]["coll"] == "shopping_items", f"una chiamata per tre voci: {avvisi}"
        voce = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); const m = new Map(s.store.find(([c]) => c === 'shopping_items')[1]); return m.get(%s); })()" % json.dumps(avvisi[0]["id"]))
        assert voce["addedBy"] == "uid-test" and voce["text"].lower() == "ceci", f"l'ultima voce, con chi l'ha aggiunta: {voce}"
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        # Spesa modificata: la segnalazione porta i campi di prima; spesa eliminata: una copia (il server non la rilegge).
        pg.evaluate("sessionStorage.removeItem('finto.avvisi')")
        pg.click(".schede a[href='#/spese']")
        pg.click(".riga >> text=Multa")
        pg.wait_for_selector("#foglio h2 >> text=Modifica spesa")
        pg.fill("#foglio input[placeholder='0,00']", "18")
        conferma(pg)
        pg.wait_for_selector(".riga:has-text('Multa') >> text=18,00")
        pg.click(".riga >> text=Gpl")
        pg.wait_for_selector("#foglio h2 >> text=Modifica spesa")
        pg.click("#foglio button >> text=Elimina")
        pg.wait_for_selector(".riga >> text=Gpl", state="detached")
        pg.wait_for_timeout(300)
        avvisi = pg.evaluate("JSON.parse(sessionStorage.getItem('finto.avvisi') || '[]')")
        mod = [a for a in avvisi if a.get("evento") == "modificata"]
        eli = [a for a in avvisi if a.get("evento") == "eliminata"]
        assert len(mod) == 1 and mod[0]["coll"] == "expenses" and mod[0]["prima"]["amount"] == 15 and mod[0]["prima"]["description"] == "Multa" and len(mod[0]["prima"]["date"]) == 10, f"modifica segnalata con i campi di prima: {avvisi}"
        assert len(eli) == 1 and eli[0]["copia"] == {"description": "Gpl", "amount": 25, "type": "", "visibility": "shared"}, f"eliminazione segnalata con la copia: {avvisi}"

        # ── Notifiche: pagina dal menu, attivazione in basso a destra, categorie, prova ──
        step[0] = "notifiche, pagina"
        # Chromium senza finestra nega sempre le notifiche: il permesso del browser si simula
        # (prima «default», poi «granted» alla richiesta, che deve partire dal tocco su Attiva).
        pg.evaluate("""() => {
          window.__permesso = 'default';
          Object.defineProperty(Notification, 'permission', { configurable: true, get: () => window.__permesso });
          Notification.requestPermission = async () => (window.__permesso = 'granted');
        }""")
        menu(pg, "Notifiche")
        pg.wait_for_selector("text=Spente su questo telefono")
        attiva = pg.locator("button.fab[aria-label='Attiva le notifiche']")
        pg.wait_for_timeout(500)  # fine del passaggio dal menu
        shot(pg, "16a-notifiche-spente")
        box = attiva.bounding_box()
        assert box["x"] + box["width"] > 390 - 30 and box["y"] > 844 - 200, f"Attiva nella zona del pollice destro: {box}"
        attiva.click()
        pg.wait_for_selector("text=Attive su questo telefono.")
        assert attiva.is_hidden(), "attive: niente pulsante Attiva"
        pg.wait_for_selector(".riga >> text=questo telefono")
        utente = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); return new Map(s.store.find(([c]) => c === 'users')[1]).get('uid-test'); })()")
        disp = list((utente.get("dispositivi") or {}).values())
        assert len(disp) == 1 and disp[0]["token"] == "token-finto", f"token salvato: {utente.get('dispositivi')}"
        assert pg.locator(".spunta.on").count() == 9, "otto categorie e il silenzio di notte, accesi all'inizio"
        titoli = pg.locator(".blocco h3").all_inner_texts()
        assert titoli[:4] == ["Questo telefono", "Dall'altra persona", "Per te", "Di notte"], f"gruppi: {titoli}"
        assert pg.locator(".blocco:has(h3:text-is(\"Dall'altra persona\")) .riga").count() == 4 and pg.locator(".blocco:has(h3:text-is('Per te')) .riga").count() == 4
        assert pg.locator(".riga:has-text('Promemoria degli eventi') .anticipo .pillola.on").inner_text() == "1 ora", "anticipo predefinito: un'ora"
        pg.click(".riga:has-text('Lista della spesa')")
        pg.wait_for_selector(".riga:has-text('Lista della spesa') .spunta:not(.on)")
        assert pg.locator(".spunta.on").count() == 8
        # Anticipo: la pillola cambia la scelta e non spegne la categoria
        pg.click(".anticipo .pillola >> text=30 min")
        pg.wait_for_selector(".anticipo .pillola.on >> text=30 min")
        assert pg.locator(".riga:has-text('Promemoria degli eventi') .spunta.on").count() == 1, "promemoria ancora accesi"
        utente = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); return new Map(s.store.find(([c]) => c === 'users')[1]).get('uid-test'); })()")
        assert utente["notifiche"] == {"lista": False, "anticipo": 30}, f"preferenze salvate: {utente.get('notifiche')}"
        # Promemoria spenti: le pillole spariscono
        pg.click(".riga:has-text('Promemoria degli eventi') .spunta")
        pg.wait_for_selector(".anticipo", state="detached")
        pg.click(".riga:has-text('Promemoria degli eventi') .spunta")
        pg.wait_for_selector(".anticipo .pillola.on >> text=30 min")
        # Le descrizioni si leggono intere (vanno a capo)
        desc = pg.locator(".riga:has-text('Promemoria degli eventi') .testo span").first
        assert desc.evaluate("e => e.scrollWidth <= e.clientWidth + 1"), "descrizione non troncata"
        assert pg.locator(".anticipo").evaluate("e => e.scrollWidth <= e.clientWidth + 1"), "le quattro pillole dell'anticipo stanno nella riga"
        pg.wait_for_timeout(2700)  # i toast se ne vanno
        shot(pg, "16-notifiche")
        pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        pg.wait_for_timeout(150)
        shot(pg, "16b-notifiche-fondo")
        pg.evaluate("window.scrollTo(0, 0)")
        pg.click("button.pillola >> text=Manda una prova")
        pg.wait_for_selector("text=Prova inviata")
        pg.click("button.pillola >> text=Spegni qui")
        pg.wait_for_selector("text=Spente su questo telefono")
        utente = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); return new Map(s.store.find(([c]) => c === 'users')[1]).get('uid-test'); })()")
        assert not utente.get("dispositivi"), f"telefono tolto: {utente.get('dispositivi')}"
        assert attiva.is_visible(), "spente: torna Attiva"

        # ── Modelli AI: Sonnet per le note semplici e Opus per i progetti, cambio al tocco ──
        step[0] = "modelli"
        menu(pg, "Modelli AI")
        pg.wait_for_selector("h3 >> text=Note dei progetti")
        blocchi = pg.locator(".blocco")
        assert blocchi.nth(0).locator(".riga:has-text('Sonnet') .spunta.on").count() == 1, "note semplici: Sonnet"
        assert blocchi.nth(1).locator(".riga:has-text('Opus') .spunta.on").count() == 1, "progetti: Opus"
        assert pg.locator(".spunta.on").count() == 2, "una scelta per tipo"
        blocchi.nth(0).locator(".riga:has-text('Haiku')").click()
        pg.wait_for_selector("text=Note semplici: Haiku")
        assert blocchi.nth(0).locator(".riga:has-text('Haiku') .spunta.on").count() == 1
        assert pg.locator(".spunta.on").count() == 2, "sempre una scelta per tipo"
        utente = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); return new Map(s.store.find(([c]) => c === 'users')[1]).get('uid-test'); })()")
        assert utente.get("modelli") == {"note": "haiku"}, f"scelta salvata: {utente.get('modelli')}"
        pg.wait_for_timeout(2700)  # il toast se ne va
        pg.evaluate("window.scrollTo(0, 0)")
        shot(pg, "17-modelli")
        # La nota successiva la legge Haiku.
        pg.click(".schede a[href='#/diario']")
        pg.click("button.fab")
        pg.fill("#foglio textarea", "Comprare il caffè")
        conferma(pg)
        pg.wait_for_selector(".lezione__ora >> text=· Haiku", timeout=6000)

        # ── Nota vocale: Registra in basso a sinistra, Ferma, la trascrizione entra nel campo ──
        step[0] = "nota vocale"
        # Si tengono i flussi del microfono per controllare che vengano chiusi.
        pg.evaluate("""() => { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__flussi = [];
          navigator.mediaDevices.getUserMedia = async (c) => { const f = await g(c); window.__flussi.push(f); return f; }; }""")
        liberi = "window.__flussi.length > 0 && window.__flussi.every((f) => f.getTracks().every((t) => t.readyState === 'ended'))"
        pg.click("button.fab")
        pg.fill("#foglio textarea", "Appunto scritto.")
        pg.click("#foglio button.pillola >> text=Tennis")
        registra = pg.locator("#foglio button[aria-label='Registra una nota vocale']")
        box = registra.bounding_box()
        assert box["y"] > 844 - 160, f"Registra nella barra in basso: {box}"
        registra.click()
        ferma = pg.locator("#foglio button[aria-label='Ferma la registrazione']")
        ferma.wait_for(timeout=4000)
        pg.wait_for_timeout(2300)
        assert "0:02" in ferma.inner_text(), f"il tempo scorre: {ferma.inner_text()}"
        shot(pg, "18a-registra")
        ferma.click()
        pg.wait_for_function("document.querySelector('#foglio textarea').value.includes('split step')", timeout=8000)
        valore = pg.locator("#foglio textarea").input_value()
        assert valore.startswith("Appunto scritto.\n\nLezione di oggi"), f"la trascrizione si aggiunge: {valore!r}"
        viste = pg.evaluate("JSON.parse(sessionStorage.getItem('finto.trascrizioni') || '[]')")
        assert len(viste) == 1 and viste[0]["mimeType"].startswith("audio/webm") and viste[0]["kb"] > 2, f"audio inviato: {viste}"
        assert viste[0]["projectId"], f"con il progetto scelto: {viste}"
        pg.locator("#foglio button[aria-label='Registra una nota vocale']").wait_for()
        assert pg.evaluate(liberi), "microfono liberato dopo Ferma"
        pg.wait_for_timeout(500)
        shot(pg, "18-nota-vocale")
        # Chiudendo il foglio durante la registrazione il microfono si libera e niente viene trascritto.
        pg.locator("#foglio button[aria-label='Registra una nota vocale']").click()
        ferma.wait_for(timeout=4000)
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(800)
        assert len(pg.evaluate("JSON.parse(sessionStorage.getItem('finto.trascrizioni') || '[]')")) == 1, "chiuso: niente trascrizione"
        assert pg.evaluate(liberi), "microfono liberato chiudendo il foglio"

        # ── Nota lunga: riaperta si legge dall'inizio, tutta, scorrendo il foglio ──
        step[0] = "nota lunga"
        righe = [f"Riga {i} della riunione" for i in range(1, 41)]
        pg.click("button.fab")
        pg.fill("#foglio textarea", "\n".join(righe))
        alta = pg.evaluate("(() => { const a = document.querySelector('#foglio textarea'); return a.scrollHeight - a.clientHeight; })()")
        assert alta <= 1, f"mentre scrivi il campo cresce col testo: {alta}px nascosti"
        conferma(pg)
        # Nell'elenco una riga sola: la prima riga fa da titolo, l'anteprima riprende da lì (due righe al più)
        riga = pg.locator(".voce-nota", has=pg.locator(".lezione__titolo", has_text="Riga 1 della riunione"))
        riga.wait_for()
        assert riga.locator(".lezione__anteprima").inner_text().startswith("Riga 2 della riunione"), riga.locator(".lezione__anteprima").inner_text()
        assert riga.locator("button.lezione").bounding_box()["height"] < 120, f"la nota lunga non riempie la pagina: {riga.locator('button.lezione').bounding_box()}"
        pg.wait_for_timeout(300)
        shot(pg, "19a-nota-lunga-elenco")
        # Toccandola si legge tutta, dall'inizio, scorrendo il foglio
        riga.locator("button.lezione").click()
        pg.wait_for_selector("#foglio h2 >> text=Riga 1 della riunione")
        pg.wait_for_selector("#foglio .lettura__testo >> text=Riga 40 della riunione")
        pg.wait_for_timeout(300)
        lettura = pg.evaluate("""(() => { const c = document.querySelector('#foglio .foglio__corpo');
          return { foglio: c.scrollTop, scorre: c.scrollHeight > c.clientHeight }; })()""")
        assert lettura["foglio"] == 0 and lettura["scorre"], f"si legge dall'inizio scorrendo il foglio: {lettura}"
        shot(pg, "19b-nota-lunga-lettura")
        # Modifica: il campo è alto quanto il testo, senza tastiera, dall'inizio
        conferma(pg)
        pg.wait_for_selector("#foglio h2 >> text=Nota")
        pg.wait_for_timeout(300)
        stato = pg.evaluate("""(() => { const a = document.querySelector('#foglio textarea');
          const c = document.querySelector('#foglio .foglio__corpo');
          return { nascosti: a.scrollHeight - a.clientHeight, campo: a.scrollTop, foglio: c.scrollTop,
                   scorre: c.scrollHeight > c.clientHeight, fuoco: document.activeElement === a,
                   cima: a.getBoundingClientRect().top }; })()""")
        assert stato["nascosti"] <= 1 and stato["campo"] == 0, f"la nota intera, senza scorrere il campo: {stato}"
        assert stato["foglio"] == 0 and stato["scorre"], f"si parte dall'inizio e si scorre il foglio: {stato}"
        assert not stato["fuoco"], f"aperta per leggere, senza tastiera: {stato}"
        assert stato["cima"] < 220, f"il testo comincia in alto: {stato}"
        shot(pg, "19-nota-lunga")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(400)
        # Toccando il testo da leggere si scrive lì (31/10): foglio della nota, tastiera, cursore sulla riga toccata
        step[0] = "tocco sul testo"
        riga.locator("button.lezione").click()
        pg.wait_for_selector("#foglio .lettura__testo >> text=Riga 40 della riunione")
        pg.wait_for_timeout(300)
        tocca_testo(pg, "#foglio .lettura__testo", "Riga 30 della riunione")
        pg.wait_for_selector("#foglio h2 >> text=Nota")
        c = cursore(pg)
        assert c["fuoco"] and c["campo"].startswith("TEXTAREA") and c["riga"] == "Riga 30 della riunione", f"cursore sulla riga toccata: {c}"
        assert dentro(c, "Riga 30 della riunione") and c["vista"], f"riga del cursore in vista, sopra la tastiera: {c}"
        pg.wait_for_timeout(200)
        shot(pg, "19c-nota-tocco")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(400)
        assert not pg.is_visible("#foglio"), "indietro chiude anche il foglio arrivato dal tocco"
        # Il titolo in testata si tocca anche lui
        riga.locator("button.lezione").click()
        pg.wait_for_selector("#foglio h2 >> text=Riga 1 della riunione")
        pg.wait_for_timeout(300)
        pg.click("#foglio .foglio__testa h2")
        pg.wait_for_selector("#foglio h2 >> text=Nota")
        assert pg.evaluate("document.activeElement.classList.contains('nota__titolo-campo')"), "toccando il titolo si scrive il titolo"
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(400)
        # ── Note dei progetti condivisi (7/11, richiesta di Mattia): sono della casa, come il progetto; quelle
        # dell'altra persona si leggono col suo nome, senza poterle cambiare. E il colore del progetto anche nel Diario ──
        step[0] = "note dei progetti condivisi"
        note_db = lambda: pg.evaluate("Object.fromEntries([...window.__finto.coll('journal_entries')].map(([k, v]) => [k, { vis: v.visibility, titolo: v.titolo || v.text.slice(0, 30), owner: v.ownerUid, projectId: v.projectId || null }]))")
        pg.click(".schede a[href='#/diario']")
        pg.click("button.pillola >> text=Circolo")
        pg.wait_for_selector("button.pillola.on >> text=Circolo")
        direttivo = next(k for k, v in note_db().items() if v["titolo"].startswith("Direttivo del circolo"))
        assert note_db()[direttivo]["vis"] == "private", "nota di un progetto solo mio: privata"
        # Il progetto diventa condiviso, color terra: la mia nota lo segue
        pg.click("button.btn--piatto >> text=Modifica progetto")
        pg.click("#foglio .pillola >> text=Condiviso")
        pg.click("#foglio .colore[data-colore='terra']")
        conferma(pg)
        pg.wait_for_function(f"window.__finto.coll('journal_entries').get('{direttivo}').visibility === 'shared'", timeout=4000)
        # Filtrato sul progetto, il Diario ne prende il colore: pillola piena, +, giorno delle note (terra: #9C6A4E, testo #7A4D33)
        pg.wait_for_selector("button.pillola--progetto.on[data-colore='terra']")
        sfondo = pg.locator("button.pillola.on >> text=Circolo").evaluate("e => getComputedStyle(e).backgroundColor")
        assert sfondo == "rgb(156, 106, 78)", f"pillola piena del colore: {sfondo}"
        assert pg.locator("#view > button.fab.fab--tondo").evaluate("e => getComputedStyle(e).backgroundColor") == "rgb(156, 106, 78)", "il + nel colore del progetto"
        assert pg.locator(".voce-nota .lezione__giorno b").first.evaluate("e => getComputedStyle(e).color") == "rgb(122, 77, 51)", "il giorno nel colore del progetto"
        # Una nota scritta prima del 7/11 (ancora privata) e una della compagna, già condivisa; una sua privata non si vede
        pg.evaluate(f"""() => {{
          const F = window.__finto, [hid, casa] = [...F.coll('households').entries()][0];
          casa.memberNames = {{ ...(casa.memberNames || {{}}), 'uid-giulia': 'Giulia Bianchi' }};
          const pid = F.coll('journal_entries').get('{direttivo}').projectId;
          F.coll('journal_entries').get('{direttivo}').visibility = 'private';
          const base = {{ ownerUid: 'uid-giulia', householdId: hid, analyzed: false, updatedAt: new Date() }};
          F.coll('journal_entries').set('nota-giulia', {{ ...base, visibility: 'shared', projectId: pid, titolo: 'Sala libera il giovedì',
            text: 'Ho sentito il presidente: la sala è libera il giovedì sera', createdAt: new Date(Date.now() - 3600e3) }});
          F.coll('journal_entries').set('nota-giulia-privata', {{ ...base, visibility: 'private', titolo: 'Privata di Giulia', text: 'solo sua', createdAt: new Date() }});
          F.notify();
        }}""")
        # Riaprendo l'app (dopo qualche ora: l'allineamento all'avvio si fa al più ogni 6) le proprie note dei progetti
        # condivisi tornano condivise
        pg.evaluate("localStorage.removeItem('macroapp.note.allineate')")
        pg.reload()
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/diario']", timeout=8000)
        pg.wait_for_function(f"window.__finto.coll('journal_entries').get('{direttivo}').visibility === 'shared'", timeout=4000)
        pg.wait_for_selector("button.pillola.on >> text=Circolo")
        sala = pg.locator(".voce-nota", has_text="Sala libera il giovedì")
        sala.wait_for(timeout=4000)
        assert sala.locator(".lezione__autore").inner_text().strip() == "Giulia", sala.inner_text()
        assert pg.locator(".voce-nota", has_text="Privata di Giulia").count() == 0, "le note private dell'altra persona non si vedono"
        assert pg.locator(".voce-nota", has_text="Direttivo del circolo").locator(".lezione__autore").count() == 0, "le mie senza nome"
        pg.wait_for_timeout(200)
        shot(pg, "26-diario-progetto-condiviso")
        # La sua nota la modifico anch'io (seconda richiesta del 7/11); in fondo, appena visibile, chi l'ha modificata per ultimo
        sala.locator("button.lezione").click()
        pg.wait_for_selector("#foglio h2 >> text=Sala libera il giovedì")
        assert pg.locator("#foglio .meta").first.inner_text().startswith("di Giulia · "), pg.locator("#foglio .meta").first.inner_text()
        assert pg.locator("#foglio .nota__modifica").count() == 0, "mai modificata a mano: niente riga"
        pg.click("#foglio .btn--conferma")
        pg.wait_for_selector("#foglio h2 >> text=Nota")
        # Solo i progetti condivisi e niente «Nessuno»: la nota resta visibile a Giulia
        assert [t.strip() for t in pg.locator("#foglio .segmenti", has=pg.locator(".pillola--progetto")).first.locator(".pillola").all_inner_texts()] == ["Circolo"]
        pg.fill("#foglio textarea", "Ho sentito il presidente: la sala è libera il giovedì sera e il martedì")
        conferma(pg)
        pg.wait_for_function("window.__finto.coll('journal_entries').get('nota-giulia').text.endsWith('il martedì')")
        g = pg.evaluate("(() => { const n = window.__finto.coll('journal_entries').get('nota-giulia'); return { da: n.modificataDa, at: !!n.modificataAt, owner: n.ownerUid, vis: n.visibility }; })()")
        assert g == {"da": "uid-test", "at": True, "owner": "uid-giulia", "vis": "shared"}, g
        sala.locator("button.lezione").click()
        pg.wait_for_selector("#foglio .nota__modifica")
        assert pg.locator("#foglio .nota__modifica").inner_text().startswith("Ultima modifica: tu, oggi alle "), pg.locator("#foglio .nota__modifica").inner_text()
        assert pg.locator("#foglio .foglio__barra button", has_text="Analizza").count() == 1, "si analizza anche la sua"
        pg.wait_for_timeout(200)
        shot(pg, "26b-nota-di-giulia")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(300)
        # Una nota nuova nel progetto condiviso nasce condivisa; una senza progetto resta mia
        pg.click("button.fab.fab--tondo")
        pg.wait_for_selector("#foglio button.pillola--progetto.on[data-colore='terra'] >> text=Circolo")
        assert pg.locator("#foglio button.pillola--progetto", has_text="Tennis").locator(".colore--pallino").count() == 1, "le pillole dei progetti col loro colore"
        pg.fill("#foglio textarea", "Preparare l'ordine del giorno del direttivo")
        conferma(pg)
        pg.wait_for_selector(".lezione__titolo >> text=Preparare l'ordine del giorno del direttivo", timeout=6000)
        ordine = next(v for v in note_db().values() if v["titolo"].startswith("Preparare l'ordine"))
        assert ordine["vis"] == "shared" and ordine["owner"] == "uid-test", ordine
        # In «Tutte»: le pillole col pallino del colore, la nota di Giulia con l'etichetta del progetto nel suo colore
        pg.click("button.pillola >> text=Tutte")
        pg.wait_for_selector(".voce-nota >> text=Sala libera il giovedì")
        assert pg.locator("#view > button.fab.fab--tondo").get_attribute("data-colore") is None, "su Tutte il + torna dell'app"
        pillole_circolo = pg.locator("#view .segmenti button.pillola--progetto", has_text="Circolo")
        assert pillole_circolo.count() == 1 and pillole_circolo.locator(".colore--pallino").count() == 1, f"pallino nella pillola: {pillole_circolo.evaluate_all('es => es.map((e) => e.outerHTML)')}"
        etichetta = pg.locator(".voce-nota", has_text="Sala libera il giovedì").locator(".progetto")
        colori = etichetta.evaluate("e => [getComputedStyle(e).color, getComputedStyle(e, '::before').backgroundColor]") if etichetta.count() == 1 else etichetta.count()
        assert colori == ["rgb(122, 77, 51)", "rgb(156, 106, 78)"], f"etichetta e pallino del progetto: {colori}"
        pg.evaluate("window.scrollTo(0, 0)")
        pg.wait_for_timeout(200)
        shot(pg, "26c-diario-tutte-colori")
        # Il progetto torna solo mio: le mie note lo seguono, quella di Giulia (non posso cambiarla) resta condivisa
        pg.click("button.pillola >> text=Circolo")
        pg.click("button.btn--piatto >> text=Modifica progetto")
        pg.click("#foglio .pillola >> text=Solo io")
        conferma(pg)
        pg.wait_for_function(f"window.__finto.coll('journal_entries').get('{direttivo}').visibility === 'private'", timeout=4000)
        assert all(v["vis"] == "private" for v in note_db().values() if v["owner"] == "uid-test" and v["projectId"] == note_db()[direttivo]["projectId"]), note_db()
        assert note_db()["nota-giulia"]["vis"] == "shared"
        pg.click("button.pillola >> text=Tutte")

        # ── Barra in basso personalizzabile (3/11): sezioni e ordine per persona, progetti compresi ──
        step[0] = "barra in basso"
        menu(pg, "Barra in basso")
        pg.wait_for_selector("h3 >> text=Nella barra")
        pg.wait_for_selector("h3 >> text=Progetti")
        scelte = pg.locator(".blocco").nth(0)
        assert scelte.locator(".riga").count() == 4, "la barra di sempre"
        assert scelte.locator(".riga").nth(0).locator("span >> text=L'app si apre qui").count() == 1
        pg.click(".blocco:has(h3:text('Progetti')) .riga >> text=Tennis")
        pg.wait_for_selector(".schede a:nth-child(5) >> text=Tennis")
        tennis = pg.locator(".schede a", has_text="Tennis").get_attribute("href")
        assert tennis.startswith("#/progetto-"), f"route del progetto: {tennis}"
        pg.click(".blocco:has(h3:text('Pagine')) .riga >> text=Calendario")
        pg.wait_for_selector("text=Al massimo 5 sezioni")
        assert pg.locator(".schede a").count() == 5
        scelte.locator(".riga:has-text('Diario') .spunta").click()
        pg.wait_for_selector(".schede a:nth-child(1) >> text=Lista")
        assert pg.locator(".schede a", has_text="Diario").count() == 0, "il Diario non c'è più"
        pg.click(".blocco:has(h3:text('Pagine')) .riga >> text=Calendario")
        pg.wait_for_selector(".schede a:nth-child(5) >> text=Calendario")
        for _ in range(4): scelte.locator(".riga:has-text('Calendario') button[aria-label$='sposta su']").click()
        pg.wait_for_selector(".schede a:nth-child(1) >> text=Calendario")
        assert scelte.locator(".riga").nth(0).locator("span >> text=L'app si apre qui").count() == 1, "la prima è la pagina d'apertura"
        assert scelte.locator(".riga").nth(0).locator("button[aria-label$='sposta su']").is_disabled()
        pg.wait_for_timeout(2700)  # il toast se ne va
        pg.evaluate("window.scrollTo(0, 0)")
        shot(pg, "25-barra")
        utente = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); return new Map(s.store.find(([c]) => c === 'users')[1]).get('uid-test'); })()")
        assert utente.get("barra") == ["calendario", "lista", "spese", "task", tennis[2:]], f"scelta salvata: {utente.get('barra')}"
        # Il progetto dalla barra: la sua pagina, col suo colore, e la barra lo segna
        pg.click(f".schede a[href='{tennis}']")
        pg.wait_for_selector("#page-title >> text=Tennis")
        pg.wait_for_selector(f".schede a[aria-current='page'][href='{tennis}']")
        assert pg.locator("html[data-colore='giallo']").count() == 1
        # Dal menu si arriva alla stessa sezione (non alla pagina Progetto generica)
        pg.click(".schede a[href='#/lista']")
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/lista']")
        menu(pg, "Tennis")
        pg.wait_for_selector(f".schede a[aria-current='page'][href='{tennis}']")
        # Senza hash l'app si apre sulla prima sezione scelta
        pg.goto("http://127.0.0.1:8766/")
        pg.wait_for_selector(".schede a[aria-current='page'][href='#/calendario']", timeout=8000)
        pg.wait_for_selector("#page-title >> text=Calendario")
        assert pg.locator(".schede a").count() == 5, "la barra scelta anche dopo la riapertura"
        shot(pg, "25b-barra-apertura")
        print("FLUSSO COMPLETO")
    except Exception as e:
        shot(pg, "errore")
        print(f"FALLITO allo step {step[0]}: {e}")
    b.close()
srv.shutdown()
print("ERRORS:", "\n".join(errors) if errors else "none")
