import http.server, threading, functools, os, sys
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "_sito")
OUT = os.path.join(HERE, "_schermate")
os.makedirs(OUT, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store"); super().end_headers()

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8766), functools.partial(Quiet, directory=SITE))
threading.Thread(target=srv.serve_forever, daemon=True).start()

errors = []
step = ["avvio"]
def shot(pg, name): pg.screenshot(path=f"{OUT}/{name}.png")
def conferma(pg): pg.click("#foglio button[aria-label='Conferma']")

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

        # ── Lista: il + apre «Mi serve», Invio aggiunge e resta aperto ──
        step[0] = "lista"
        pg.click("button.fab")
        inp = "#foglio input[aria-label='Aggiungi alla lista']"
        pg.wait_for_selector(inp)
        pg.fill(inp, "latte, uova; pane, pesce: spada, pasta sfoglia, gelato alla crema")
        pg.keyboard.press("Enter")
        pg.wait_for_selector("#foglio .pillola >> text=Pane")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector(".tessera >> text=Pane")
        assert pg.locator(".tessera:not(.tessera--verde)").count() == 6, "6 tessere rosse attese"
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
        assert pg.locator(".tessera >> text=Latte").count() == 1, "Latte non deve duplicarsi"

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
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_timeout(200)
        assert not pg.is_visible("#foglio"), "indietro chiude il foglio"
        pg.click("button.pillola >> text=Pareggia")
        conferma(pg)
        pg.wait_for_selector("text=siete in pari")

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
        pg.route("https://people.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="application/json",
            body='{"connections":[{"resourceName":"people/c1","names":[{"displayName":"Giulia Bianchi"}],"phoneNumbers":[{"value":"333 1234567"}]},'
                 '{"resourceName":"people/c2","names":[{"displayName":"Marco"}],"emailAddresses":[{"value":"marco@example.com"}]}]}'))
        pg.click(".schede a[href='#/manuale']")
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
        pg.click("text=Prendi da Google Contatti")
        pg.wait_for_selector("#foglio .riga >> text=Giulia Bianchi")
        assert "già in rubrica" in pg.locator("#foglio .riga", has_text="Marco").inner_text(), "Marco riconosciuto"
        pg.click("#foglio .riga >> text=Giulia Bianchi")
        pg.wait_for_selector("#foglio .riga >> text=già in rubrica")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.wait_for_selector(".riga >> text=Giulia Bianchi")
        # Scheda di Marco: i suoi task, e la mail per le bozze
        pg.click(".riga >> text=Marco")
        pg.wait_for_selector("#foglio >> text=Task con questa persona")
        assert pg.locator("#foglio .riga").count() == 2, "due task aperti con Marco"
        pg.fill("#foglio input[type='email']", "marco@example.com")
        pg.wait_for_timeout(300)
        shot(pg, "6-persona")
        conferma(pg)
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
        pg.click(".schede a[href='#/manuale']")
        pg.click("button.pillola >> text=Persone")
        pg.wait_for_selector(".riga >> text=Giulia Bianchi")
        assert pg.locator(".riga", has_text="Marco").count() == 1, "la proposta non deve duplicare Marco"
        pg.click(".schede a[href='#/lista']")
        pg.wait_for_selector(".tessera >> text=Lampadine")

        # ── Tema scuro ──
        step[0] = "tema"
        pg.click("a[aria-label='Impostazioni']")
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
        print("FLUSSO COMPLETO")
    except Exception as e:
        shot(pg, "errore")
        print(f"FALLITO allo step {step[0]}: {e}")
    b.close()
srv.shutdown()
print("ERRORS:", "\n".join(errors) if errors else "none")
