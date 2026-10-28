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
def menu(pg, voce):
    pg.click("button[aria-label='Menu']")
    pg.click(f".menu__voce >> text={voce}")

with sync_playwright() as p:
    # Microfono finto (un tono) per la nota vocale, con il permesso già dato.
    b = p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=False, permissions=["microphone"])
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
        assert pg.locator("#foglio .grado--a").count() == 1, "Nutri-Score A"
        assert pg.input_value("#foglio input[aria-label='In lista come']") == "Spaghetti", "in lista come la categoria"
        pg.click("#foglio button.nota__apri >> text=Valori per 100 g")
        pg.wait_for_selector("#foglio .valori .riga >> text=Energia")
        pg.wait_for_timeout(300)
        shot(pg, "1d-prodotto")
        pg.click("#foglio .btn--conferma >> text=Preso")
        pg.wait_for_selector(".tessera--verde:has(.tessera__indice.indice--eccellente) >> text=Spaghetti")
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
        assert pg.locator("#foglio .additivi li.rischio--alto").count() == 2, "due additivi a rischio alto"
        assert "49" in pg.locator("#foglio .prodotto__avviso").inner_text(), "avviso del tetto a 49"
        pg.wait_for_timeout(200)
        shot(pg, "1e-prodotto-rischio")
        pg.click("#foglio .foglio__secondarie button >> text=Da comprare")
        pg.wait_for_selector(".tessera:not(.tessera--verde):has(.tessera__indice.indice--mediocre) >> text=Würstel")
        pg.wait_for_selector("#foglio", state="hidden")
        assert pg.locator(".tessera >> text=Würstel").count() == 1, "la voce scritta a mano e quella scansionata sono una sola"
        pg.wait_for_timeout(300)
        shot(pg, "1f-lista-prodotti")
        # Dal foglio Modifica si riapre la scheda; un codice sconosciuto dice che non c'è.
        pg.locator(".tessera", has_text="Würstel").locator("button.altro").click()
        pg.wait_for_selector("#foglio .riga >> text=Würstel di pollo")
        pg.click("#foglio .riga >> text=Würstel di pollo")
        pg.wait_for_selector("#foglio .prodotto__nome >> text=Würstel di pollo")
        assert pg.locator("#foglio .foglio__barra").count() == 0, "scheda di sola lettura: niente barra"
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")
        pg.click("button.fab")
        pg.click("#foglio .foglio__secondarie button >> text=Scansiona")
        pg.fill(codice, "4000000000001")
        conferma(pg)
        pg.wait_for_selector("#foglio >> text=Prodotto non trovato")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector("#foglio", state="hidden")

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
            ]}))
        pg.route("https://people.googleapis.com/**", people)
        # Google Calendar finto: due calendari, eventi in memoria (GET/POST/PATCH/DELETE).
        cal = {"eventi": {}, "n": 0}
        def calendar(r):
            req = r.request
            assert req.headers.get("authorization") == "Bearer token-finto", req.headers
            url = req.url
            if "/users/me/calendarList" in url:
                r.fulfill(status=200, content_type="application/json", body=json.dumps({"items": [
                    {"id": "mattia@example.com", "summary": "Mattia", "primary": True, "accessRole": "owner"},
                    {"id": "casa@group.calendar.google.com", "summary": "Casa", "accessRole": "owner", "backgroundColor": "#f6bf26"},
                ]}))
                return
            assert "/calendars/casa%40group.calendar.google.com/events" in url, url
            if req.method == "GET":
                r.fulfill(status=200, content_type="application/json", body=json.dumps({"items": list(cal["eventi"].values())}))
            elif req.method == "POST":
                cal["n"] += 1
                e = {**json.loads(req.post_data), "id": f"ev{cal['n']}", "htmlLink": f"https://calendar.google.com/event?eid=ev{cal['n']}", "creator": {"email": "mattia@example.com", "self": True}, "status": "confirmed"}
                cal["eventi"][e["id"]] = e
                r.fulfill(status=200, content_type="application/json", body=json.dumps(e))
            elif req.method == "PATCH":
                eid = url.rsplit("/", 1)[1]
                e = cal["eventi"][eid]
                for k, v in json.loads(req.post_data).items():
                    e[k] = {kk: vv for kk, vv in v.items() if vv is not None} if isinstance(v, dict) else v
                r.fulfill(status=200, content_type="application/json", body=json.dumps(e))
            elif req.method == "DELETE":
                del cal["eventi"][url.rsplit("/", 1)[1]]
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
        pg.wait_for_timeout(150)  # il fuoco arriva sul testo dopo l'apertura
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
        pg.wait_for_selector(".nota__testa >> text=· Sonnet")  # il modello che ha letto la nota
        mailto = pg.locator(".azione a.pillola", has_text="Apri nella mail").get_attribute("href")
        assert mailto.startswith("mailto:marco%40example.com"), mailto
        pg.locator(".azione", has_text="del circolo entro venerdì").locator("button[aria-label='Conferma']").click()
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

        # ── Diario per progetto: Tennis con istruzioni, riepilogo sotto la nota, trascrizione ripiegata ──
        step[0] = "diario per progetto"
        pg.click(".schede a[href='#/task']")
        pg.click("button.pillola >> text=Progetto")
        pg.fill("#foglio input[placeholder='Nome del progetto']", "Tennis")
        pg.fill("#foglio textarea", "Riassumi cosa mi ha insegnato il maestro e cosa ricordare.")
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
        pg.wait_for_selector(".nota__riepilogo h4 >> text=Cosa ho imparato", timeout=6000)
        assert pg.locator(".nota__riepilogo b >> text=chiudere prima").count() == 1, "grassetto nel riepilogo"
        assert pg.locator(".nota__testo >> text=oggi il maestro").count() == 0, "trascrizione ripiegata"
        assert pg.locator(".azione >> text=Comprare le corde nuove").count() == 1, "le azioni restano proposte"
        pg.wait_for_timeout(250)
        shot(pg, "16-tennis-riepilogo")
        pg.click("button.nota__apri")
        pg.wait_for_selector(".nota__testo >> text=oggi il maestro")
        pg.wait_for_timeout(150)
        shot(pg, "16b-tennis-trascrizione")
        # Il riepilogo si corregge dal foglio della nota
        pg.click(".nota__riepilogo")
        pg.wait_for_selector("#foglio label >> text=Riepilogo")
        r = pg.locator("#foglio .campo textarea")
        assert "Cosa ho imparato" in r.input_value(), r.input_value()
        r.fill(r.input_value() + "\n- Servizio: lancio più avanti")
        pg.wait_for_timeout(150)
        shot(pg, "17-tennis-nota")
        conferma(pg)
        pg.wait_for_selector(".nota__riepilogo li >> text=Servizio: lancio più avanti")
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
        assert "1 lezione" in pg.locator(".tema", has_text="Dritto").inner_text(), "la nota è collegata al tema"
        assert pg.locator(".tema", has_text="Da provare").locator(".meta").count() == 0, "tema senza lezioni"
        pg.click(".tema__testa >> text=Dritto")
        pg.wait_for_selector(".tema--aperto .tema__corpo li >> text=Chiudere la spalla")
        pg.wait_for_timeout(200)
        shot(pg, "17c-progetto-sintesi")
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
        # Vista Lezioni: giorno grande, titolo, temi
        pg.click("button.pillola >> text=Lezioni")
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
        pg.wait_for_selector(".nota__riepilogo li >> text=Servizio: lancio più avanti")
        # In «Tutte» la nota porta il nome del progetto; le altre note restano
        pg.click("button.pillola >> text=Tutte")
        pg.wait_for_selector(".nota .progetto >> text=Tennis")
        assert pg.locator(".nota").count() >= 2, "in Tutte ci sono anche le altre note"
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

        # ── Niente «vuoto» di passaggio: cambiando filtro o sezione la pagina non dice «vuoto»
        # nemmeno per un fotogramma prima che arrivino i dati (video di Mattia, 26/10) ──
        step[0] = "niente vuoto di passaggio"
        pg.wait_for_selector(".nota .progetto >> text=Tennis")
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
        for sezione, sel in [("task", ".riga"), ("lista", ".tessera"), ("spese", ".riga"), ("diario", ".nota")]:
            piena = pg.evaluate("""([s, sel]) => new Promise((ok) => {
                addEventListener('hashchange', () => requestAnimationFrame(() => ok(!!document.querySelector('#view ' + sel))), { once: true });
                document.querySelector(`.schede a[href='#/${s}']`).click(); })""", [sezione, sel])
            assert piena, f"{sezione}: pagina vuota al primo fotogramma"
            pg.wait_for_timeout(100)

        # ── Calendario della casa: scelta dalla pagina Google, agenda, evento nuovo, modifica, proposta ──
        step[0] = "calendario"
        menu(pg, "Calendario")
        pg.wait_for_selector("text=Nessun calendario della casa")
        pg.click("button.btn >> text=Scegli il calendario")
        pg.wait_for_selector("#foglio .riga >> text=Casa")
        assert "principale" in pg.locator("#foglio .riga", has_text="Mattia").inner_text()
        pg.click("#foglio .riga >> text=Casa")
        pg.wait_for_selector("text=Calendario della casa: Casa")
        menu(pg, "Calendario")
        pg.wait_for_selector("text=Nessun evento nei prossimi 60 giorni")
        assert pg.locator("#view .vuoto").count() == 0, "calendario vuoto: una riga, non la pagina vuota"
        pg.click("button.fab")
        pg.wait_for_selector("#foglio h2 >> text=Nuovo evento")
        pg.fill("#foglio input[placeholder='Cosa']", "Lezione di tennis")
        pg.click("#foglio button.pillola >> text=Con orario")
        pg.locator("#foglio input[type=time]").first.evaluate("i => { i.value = '18:00'; i.dispatchEvent(new Event('change')); }")
        pg.fill("#foglio input[placeholder='Dove (facoltativo)']", "Circolo")
        pg.wait_for_timeout(150)
        shot(pg, "19-evento-nuovo")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".evento >> text=Lezione di tennis")
        riga = pg.locator(".evento", has_text="Lezione di tennis")
        # Come le lezioni: il giorno in serif con «oggi» sotto, una fascia per mese
        import datetime
        assert riga.locator(".evento__giorno b.display").inner_text() == str(datetime.date.today().day), riga.inner_text()
        assert riga.locator(".evento__giorno small").inner_text().lower() == "oggi"
        assert riga.locator(".evento__quando").inner_text() == "18:00 – 19:00 · Circolo", riga.inner_text()
        assert pg.locator("#view .fascia").count() == 1, "una fascia, quella del mese"
        assert cal["eventi"]["ev1"]["start"]["timeZone"] == "Europe/Rome", cal["eventi"]["ev1"]
        # Modifica: tutto il giorno, titolo nuovo
        riga.click()
        pg.wait_for_selector("#foglio h2 >> text=Evento")
        pg.fill("#foglio input[placeholder='Cosa']", "Torneo")
        pg.click("#foglio button.pillola >> text=Tutto il giorno")
        conferma(pg)
        pg.wait_for_selector(".evento >> text=Torneo")
        assert pg.locator(".evento", has_text="Torneo").locator(".evento__quando").inner_text() == "Tutto il giorno · Circolo"
        assert "date" in cal["eventi"]["ev1"]["start"] and "dateTime" not in cal["eventi"]["ev1"]["start"], cal["eventi"]["ev1"]
        # La proposta dell'agente ora passa: l'evento compare tra tre giorni
        step[0] = "prossimi giorni nel diario"
        pg.click(".schede a[href='#/diario']")
        pg.locator(".azione", has_text="Cena con i Rossi").locator("button[aria-label='Conferma']").click()
        pg.wait_for_selector("text=Evento nel calendario della casa")
        assert cal["eventi"]["ev2"]["summary"] == "Cena con i Rossi" and cal["eventi"]["ev2"]["location"] == "Da noi", cal["eventi"]
        # In cima al Diario: oggi e i due giorni dopo. Il torneo di oggi c'è, la cena tra tre giorni no.
        pg.wait_for_selector(".prossimi .fascia >> text=Prossimi giorni")
        assert pg.locator(".prossimi .evento", has_text="Torneo").count() == 1
        assert pg.locator(".prossimi .evento", has_text="Cena con i Rossi").count() == 0, "oltre i due giorni non compare"
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
        assert pg.locator(".evento", has_text="Torneo").count() == 0 and "ev1" not in cal["eventi"]
        pg.click(".schede a[href='#/diario']")
        pg.wait_for_selector(".stato-ai")
        pg.wait_for_timeout(300)
        assert pg.locator(".prossimi").is_hidden(), "senza eventi vicini la striscia non c'è"

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
        pg.click("button.pillola >> text=Azioni da confermare")
        pg.wait_for_selector(".azione >> text=dalla banca")
        assert pg.locator(".azione", has_text="dalla banca").count() == 3, "tre proposte dalla banca"
        assert pg.locator(".azione", has_text="AMAZON EU").locator("text=Carta").count() == 1, "l'acquisto con la carta dice da quale conto viene"
        pg.wait_for_timeout(300)
        shot(pg, "14-banca-proposte")
        pg.locator(".azione", has_text="dalla banca").first.locator("button[aria-label='Conferma']").click()
        pg.click(".schede a[href='#/spese']")
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
        assert pg.locator(".spunta.on").count() == 4, "quattro categorie, accese all'inizio"
        pg.click(".riga:has-text('Lista della spesa')")
        pg.wait_for_selector(".riga:has-text('Lista della spesa') .spunta:not(.on)")
        assert pg.locator(".spunta.on").count() == 3
        utente = pg.evaluate("(() => { const s = JSON.parse(sessionStorage.getItem('finto.firestore')); return new Map(s.store.find(([c]) => c === 'users')[1]).get('uid-test'); })()")
        assert utente["notifiche"] == {"lista": False}, f"preferenza salvata: {utente.get('notifiche')}"
        pg.wait_for_timeout(2700)  # il toast di attivazione se ne va
        shot(pg, "16-notifiche")
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
        pg.wait_for_selector(".nota__testa >> text=· Haiku", timeout=6000)

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
        pg.wait_for_selector(".nota__testo >> text=Riga 40 della riunione")
        pg.wait_for_timeout(300)
        pg.locator(".nota__testo", has_text="Riga 1 della riunione").first.click()
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
        assert stato["cima"] < 200, f"il testo comincia in alto: {stato}"
        shot(pg, "19-nota-lunga")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(400)
        print("FLUSSO COMPLETO")
    except Exception as e:
        shot(pg, "errore")
        print(f"FALLITO allo step {step[0]}: {e}")
    b.close()
srv.shutdown()
print("ERRORS:", "\n".join(errors) if errors else "none")
