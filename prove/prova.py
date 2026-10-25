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
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, has_touch=False)
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
        # Google Contatti: si collega una volta, passando dalla pagina di Google, e si torna sul Manuale
        step[0] = "collega google contatti"
        assert letture[0] == 0, "nessuna lettura prima del collegamento"
        pg.click("text=Collega Google Contatti")
        pg.wait_for_selector("#foglio .btn--conferma >> text=Collega")
        pg.wait_for_timeout(200)
        shot(pg, "5b-contatti-da-collegare")
        conferma(pg)
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
        mailto = pg.locator(".azione a.pillola", has_text="Apri nella mail").get_attribute("href")
        assert mailto.startswith("mailto:marco%40example.com"), mailto
        pg.locator(".azione", has_text="del circolo entro venerdì").locator("button[aria-label='Conferma']").click()
        pg.wait_for_timeout(400)
        pg.locator(".azione", has_text="Comprare lampadine").locator("button[aria-label='Conferma']").click()
        pg.wait_for_timeout(400)
        assert pg.locator(".azione").count() == 1, "resta solo la bozza"
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
        # Il filtro del Diario torna su Tutte per il resto della prova
        pg.click(".schede a[href='#/diario']")
        pg.click("button.pillola >> text=Tutte")

        # ── Scollegare Google Contatti ──
        step[0] = "scollega"
        menu(pg, "Google Contatti")
        pg.wait_for_selector("#foglio >> text=Collegato come")
        pg.click("#foglio button >> text=Scollega")
        pg.wait_for_selector("text=Google Contatti scollegato")
        menu(pg, "Google Contatti")
        pg.wait_for_selector("#foglio .btn--conferma >> text=Collega")
        pg.click("#foglio button[aria-label='Indietro']")

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
        print("FLUSSO COMPLETO")
    except Exception as e:
        shot(pg, "errore")
        print(f"FALLITO allo step {step[0]}: {e}")
    b.close()
srv.shutdown()
print("ERRORS:", "\n".join(errors) if errors else "none")
