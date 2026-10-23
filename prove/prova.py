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

        # ── Lista ──
        step[0] = "lista"
        inp = "input[aria-label='Aggiungi alla lista']"
        pg.fill(inp, "latte, uova; pane, pesce: spada, pasta sfoglia, gelato alla crema")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".tessera >> text=Pane")
        assert pg.locator(".tessera:not(.tessera--verde)").count() == 6, "6 tessere rosse attese"
        pg.locator(".tessera:not(.tessera--verde) >> text=Latte").click()
        pg.locator(".tessera:not(.tessera--verde) >> text=Uova").click()
        pg.wait_for_selector(".tessera--verde >> text=Latte")
        pg.wait_for_timeout(300)
        shot(pg, "1-lista")
        pg.fill(inp, "lat")
        pg.wait_for_selector(".suggerimenti >> text=Latte")
        pg.click(".suggerimenti >> text=Latte")
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
        pg.click("button.pillola >> text=Ricorrenti")
        pg.wait_for_selector("#foglio >> text=Internet")
        pg.click("#foglio button[aria-label='Indietro']")
        pg.click("button.pillola >> text=Pareggia")
        conferma(pg)
        pg.wait_for_selector("text=siete in pari")

        # ── Task ──
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
        pg.click("button.pillola >> text=Tutti")
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder=\"Cosa c'è da fare\"]", "Rinnovare la carta d'identità")
        pg.keyboard.press("Enter")
        pg.wait_for_selector(".riga >> text=Rinnovare")
        pg.locator(".riga >> text=Mandare il verbale").locator("xpath=ancestor::div[contains(@class,'riga')]").locator("button.spunta").click()
        pg.wait_for_selector("text=Completati · 1")
        pg.wait_for_timeout(200)
        shot(pg, "4-task")

        # ── Manuale ──
        step[0] = "manuale"
        pg.click(".schede a[href='#/manuale']")
        pg.click("button.fab")
        pg.fill("#foglio input[placeholder='Nome']", "Ferramenta Rossi")
        pg.click("#foglio button.pillola >> text=Vernici e ferramenta")
        pg.fill("#foglio textarea", "Vernici, viti, consegna a domicilio")
        conferma(pg)
        pg.wait_for_selector(".riga >> text=Ferramenta Rossi")

        # ── Diario ──
        step[0] = "diario"
        pg.click(".schede a[href='#/diario']")
        pg.fill(".taccuino textarea", "Devo preparare l'assemblea del circolo entro venerdì con Marco, scrivergli una mail. Comprare lampadine.")
        pg.click("text=Salva nota")
        pg.wait_for_selector(".azione >> text=Comprare lampadine", timeout=6000)
        pg.wait_for_timeout(300)
        shot(pg, "5-diario")
        pg.locator(".azione", has_text="del circolo entro venerdì").locator("button[aria-label='Conferma']").click()
        pg.wait_for_timeout(400)
        pg.locator(".azione", has_text="Comprare lampadine").locator("button[aria-label='Conferma']").click()
        pg.wait_for_timeout(400)
        assert pg.locator(".azione").count() == 1, "resta solo la bozza"
        pg.click(".schede a[href='#/task']")
        pg.click("button.pillola >> text=Circolo")
        pg.wait_for_selector(".riga >> text=Preparare l'assemblea")
        assert pg.locator("button.pillola", has_text="Circolo").count() == 1, "il progetto non deve duplicarsi"
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
