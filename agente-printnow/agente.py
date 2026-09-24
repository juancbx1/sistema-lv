"""Agente local de etiquetas da embalagem.

Escuta só em 127.0.0.1:17840. Não guarda produto.
A impressora escolhida fica em Documentos/PrintNow/config.json.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HOST = "127.0.0.1"
PORT = 17840
LARGURA = 384
ALTURA = 240
COPIAS_MAX = 500
CONFIG_PATH = Path.home() / "Documents" / "PrintNow" / "config.json"


def origem_permitida(origin: str) -> bool:
    if origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:"):
        return True
    if origin in ("http://localhost", "http://127.0.0.1"):
        return True
    return origin.startswith("https://")


def ler_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def impressora_salva() -> str:
    return str(ler_config().get("printer_name") or "").strip()


def salvar_impressora(nome: str) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    dados = ler_config()
    dados["printer_name"] = nome
    CONFIG_PATH.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")


def listar_impressoras() -> list[str]:
    import win32print

    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    nomes = []
    for item in win32print.EnumPrinters(flags):
        nome = str(item[2]).strip()
        if nome and nome not in nomes:
            nomes.append(nome)
    return nomes


def diagnosticar_impressora(nome: str | None = None) -> dict:
    escolhida = (nome or impressora_salva() or "").strip()
    base = {
        "impressora": escolhida,
        "instalada": False,
        "conectada": False,
        "pronta": False,
        "motivo": "Nenhuma impressora selecionada.",
    }
    if not escolhida:
        return base
    try:
        instaladas = listar_impressoras()
    except Exception as erro:
        base["motivo"] = f"Não foi possível consultar as impressoras do Windows. {erro}"
        return base
    if escolhida not in instaladas:
        base["motivo"] = "A impressora não está instalada neste computador."
        return base

    status = 0
    attributes = 0
    try:
        import win32print

        handle = win32print.OpenPrinter(escolhida)
        try:
            info = win32print.GetPrinter(handle, 2)
            status = int(info.get("Status") or 0)
            attributes = int(info.get("Attributes") or 0)
        finally:
            win32print.ClosePrinter(handle)
    except Exception as erro:
        base["instalada"] = True
        base["motivo"] = f"Não foi possível falar com a impressora. {erro}"
        return base

    work_offline = False
    printer_status = 0
    try:
        import win32com.client

        nome_wmi = escolhida.replace("\\", "\\\\").replace("'", "''")
        servico = win32com.client.GetObject("winmgmts:")
        consulta = servico.ExecQuery(
            "SELECT WorkOffline, PrinterStatus, PrinterState "
            f"FROM Win32_Printer WHERE Name='{nome_wmi}'"
        )
        for item in consulta:
            work_offline = bool(item.WorkOffline)
            printer_status = int(item.PrinterStatus or 0)
            if int(item.PrinterState or 0) & 0x80:
                work_offline = True
            break
    except Exception:
        pass

    desconectada = (
        work_offline
        or printer_status == 7
        or bool(status & 0x80)
        or bool(status & 0x1000)
        or bool(attributes & 0x400)
    )
    if desconectada:
        return {
            "impressora": escolhida,
            "instalada": True,
            "conectada": False,
            "pronta": False,
            "motivo": "A impressora está instalada, mas não está conectada neste computador.",
        }
    if status & 0x10:
        motivo = "A impressora está sem papel."
    elif status & 0x8:
        motivo = "A impressora está com papel atolado."
    elif status & 0x400000:
        motivo = "A tampa da impressora está aberta."
    else:
        motivo = ""
    return {
        "impressora": escolhida,
        "instalada": True,
        "conectada": True,
        "pronta": motivo == "",
        "motivo": motivo,
    }


def fonte(tamanho: int):
    candidatos = [
        "arial.ttf",
        os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "arial.ttf"),
    ]
    for caminho in candidatos:
        try:
            return ImageFont.truetype(caminho, tamanho)
        except OSError:
            continue
    return ImageFont.load_default()


def largura_texto(draw: ImageDraw.ImageDraw, texto: str, font) -> int:
    if hasattr(draw, "textlength"):
        return int(draw.textlength(texto, font=font))
    caixa = draw.textbbox((0, 0), texto, font=font)
    return int(caixa[2] - caixa[0])


def desenhar_centralizado(draw, texto: str, y: int, font, fill=0) -> None:
    x = (LARGURA - largura_texto(draw, texto, font)) / 2
    draw.text((x, y), texto, font=font, fill=fill)


def desenhar_ajustado(draw, texto: str, y: int, tamanho_inicial: int, fill=0) -> None:
    tamanho = tamanho_inicial
    font = fonte(tamanho)
    limite = LARGURA - 20
    while tamanho > 10 and largura_texto(draw, texto, font) > limite:
        tamanho -= 2
        font = fonte(tamanho)
    desenhar_centralizado(draw, texto, y, font, fill)


def gerar_barcode(valor: str):
    from barcode import get_barcode_class
    from barcode.writer import ImageWriter

    limpo = str(valor or "").strip()
    if not limpo:
        return None
    buffer = BytesIO()
    codigo = get_barcode_class("code128")
    codigo(limpo, writer=ImageWriter()).write(
        buffer,
        options={"write_text": False, "module_height": 12.0, "quiet_zone": 1.0},
    )
    buffer.seek(0)
    return Image.open(buffer).convert("RGB")


def montar_imagem(dados: dict, preview: bool) -> Image.Image:
    imagem = Image.new("RGB", (LARGURA, ALTURA), (255, 255, 255))
    draw = ImageDraw.Draw(imagem)
    tinta = (0, 0, 0)

    qtd = int(dados.get("qtd_pacote") or 1)
    variante = str(dados.get("variante") or "").upper()
    topo = f"{variante} [ {qtd} UND ]" if qtd > 1 else variante
    desenhar_ajustado(draw, topo, 10, 30, tinta)
    desenhar_ajustado(draw, f"SKU: {dados.get('sku') or ''}", 50, 22, tinta)

    codigo = str(dados.get("codigo_barras") or "").strip() or str(dados.get("sku") or "").strip()
    barras = gerar_barcode(codigo)
    if barras is not None:
        barras = barras.resize((340, 80))
        x = int((LARGURA - 340) / 2)
        imagem.paste(barras, (x, 80))

    fabricacao = str(dados.get("fabricacao") or "").strip() or "IND. BRASILEIRA"
    fabricacao = fabricacao.replace("FABRICADO NO BRASIL", "IND. BRASILEIRA")
    cnpj = str(dados.get("cnpj") or "").strip()
    mini = fonte(16)
    desenhar_centralizado(draw, fabricacao, 175, mini, tinta)
    if cnpj:
        desenhar_centralizado(draw, cnpj, 200, mini, tinta)
    if not preview:
        return imagem.convert("1")
    return imagem


def validar_pedido(dados: dict, exigir_copias: bool) -> tuple[dict, int]:
    if not isinstance(dados, dict):
        raise ValueError("payload_invalido")
    sku = str(dados.get("sku") or "").strip()
    if not sku:
        raise ValueError("payload_invalido")
    copias = 1
    if exigir_copias:
        copias = int(dados.get("copias") or 0)
        if copias < 1 or copias > COPIAS_MAX:
            raise ValueError("payload_invalido")
    qtd_pacote = int(dados.get("qtd_pacote") or 1)
    if qtd_pacote < 1 or qtd_pacote > 999:
        raise ValueError("payload_invalido")
    return {
        "sku": sku,
        "variante": str(dados.get("variante") or ""),
        "codigo_barras": str(dados.get("codigo_barras") or "").strip(),
        "qtd_pacote": qtd_pacote,
        "fabricacao": str(dados.get("fabricacao") or ""),
        "cnpj": str(dados.get("cnpj") or ""),
    }, copias


def imprimir(imagem: Image.Image, copias: int) -> str:
    import win32ui
    from PIL import ImageWin

    diagnostico = diagnosticar_impressora()
    if not diagnostico["pronta"]:
        raise RuntimeError(str(diagnostico["motivo"]))
    impressora = str(diagnostico["impressora"])
    girada = imagem.convert("1").rotate(180, expand=True)
    dc = win32ui.CreateDC()
    try:
        dc.CreatePrinterDC(impressora)
        dc.StartDoc("PrintNow Etiqueta")
        for _ in range(copias):
            dc.StartPage()
            largura = dc.GetDeviceCaps(8)
            altura = dc.GetDeviceCaps(10)
            dib = ImageWin.Dib(girada)
            dib.draw(dc.GetHandleOutput(), (0, 0, largura, altura))
            dc.EndPage()
        dc.EndDoc()
    except Exception as erro:
        texto = str(erro)
        if "sem_impressora" in texto:
            raise
        raise RuntimeError(f"falha_impressao: {texto}") from erro
    finally:
        try:
            dc.DeleteDC()
        except Exception:
            pass
    return impressora


def png_base64(imagem: Image.Image) -> str:
    import base64

    buffer = BytesIO()
    imagem.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


class Agente(BaseHTTPRequestHandler):
    def log_message(self, formato, *args):
        saida = sys.stdout
        if saida is None:
            return
        saida.write("[printnow] " + (formato % args) + "\n")
        saida.flush()

    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin and origem_permitida(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def responder(self, status: int, payload: dict):
        corpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def responder_html(self, html: str):
        corpo = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def ler_json(self) -> dict:
        tamanho = int(self.headers.get("Content-Length") or 0)
        if tamanho <= 0 or tamanho > 200_000:
            raise ValueError("payload_invalido")
        bruto = self.rfile.read(tamanho)
        dados = json.loads(bruto.decode("utf-8"))
        if not isinstance(dados, dict):
            raise ValueError("payload_invalido")
        return dados

    def do_GET(self):
        caminho = self.path.split("?", 1)[0]
        if caminho == "/":
            impressora = impressora_salva() or "nenhuma selecionada"
            self.responder_html(
                "<!doctype html><meta charset='utf-8'><title>PrintNow agente</title>"
                "<body style='font-family:sans-serif;max-width:36rem;margin:2rem auto'>"
                "<h1>PrintNow agente</h1>"
                "<p>Este endereço não é uma tela de cadastro. Ele só imprime o que a "
                "página de embalagem do Sistema LV enviar.</p>"
                f"<p>Impressora salva: <strong>{impressora}</strong></p>"
                "<p>Para trabalhar, abra "
                "<a href='http://localhost:5173/admin/embalagem-de-produtos.html'>"
                "embalagem de produtos</a>.</p>"
                "</body>"
            )
            return
        if caminho == "/saude":
            diagnostico = diagnosticar_impressora()
            self.responder(200, {"ok": True, **diagnostico})
            return
        if caminho == "/impressoras":
            try:
                nomes = listar_impressoras()
            except Exception as erro:
                self.responder(503, {"ok": False, "erro": "falha_impressao", "mensagem": str(erro)})
                return
            self.responder(200, {"ok": True, "impressoras": nomes, "selecionada": impressora_salva()})
            return
        self.responder(404, {"ok": False, "erro": "payload_invalido", "mensagem": "Rota não encontrada."})

    def do_POST(self):
        caminho = self.path.split("?", 1)[0]
        try:
            dados = self.ler_json()
        except Exception:
            self.responder(400, {"ok": False, "erro": "payload_invalido", "mensagem": "JSON inválido."})
            return

        if caminho == "/impressora":
            nome = str(dados.get("name") or dados.get("impressora") or "").strip()
            try:
                disponiveis = listar_impressoras()
            except Exception as erro:
                self.responder(503, {"ok": False, "erro": "falha_impressao", "mensagem": str(erro)})
                return
            if nome not in disponiveis:
                self.responder(400, {"ok": False, "erro": "payload_invalido", "mensagem": "Impressora não encontrada neste computador."})
                return
            salvar_impressora(nome)
            self.responder(200, {"ok": True, "impressora": nome})
            return

        if caminho not in ("/preview", "/imprimir"):
            self.responder(404, {"ok": False, "erro": "payload_invalido", "mensagem": "Rota não encontrada."})
            return

        try:
            etiqueta, copias = validar_pedido(dados, exigir_copias=caminho == "/imprimir")
            imagem = montar_imagem(etiqueta, preview=caminho == "/preview")
        except Exception:
            self.responder(400, {"ok": False, "erro": "payload_invalido", "mensagem": "Etiqueta inválida."})
            return

        if caminho == "/preview":
            self.responder(200, {"ok": True, "imagem": png_base64(imagem)})
            return

        try:
            impressora = imprimir(imagem, copias)
        except RuntimeError as erro:
            texto = str(erro)
            codigo = "sem_impressora" if texto.startswith("sem_impressora") else "falha_impressao"
            mensagem = (
                "Nenhuma impressora selecionada."
                if codigo == "sem_impressora"
                else texto.removeprefix("falha_impressao: ").strip() or "Falha na impressora."
            )
            anotar_resultado(f"Etiqueta não impressa: {mensagem}")
            self.responder(503, {"ok": False, "erro": codigo, "mensagem": mensagem})
            return
        anotar_resultado(f"Etiqueta impressa na {impressora}. {copias} {'cópia' if copias == 1 else 'cópias'}.")
        self.responder(200, {"ok": True, "copias": copias, "impressora": impressora})


def gerar_amostra():
    imagem = montar_imagem(
        {
            "sku": "FR-01001",
            "variante": "Preto",
            "codigo_barras": "7792022602975",
            "qtd_pacote": 1,
            "fabricacao": "IND. BRASILEIRA",
            "cnpj": "39.974.006.0001-03",
        },
        preview=True,
    )
    destino = Path(__file__).with_name("amostra-fr-01001.png")
    imagem.save(destino, format="PNG")
    print(destino)


def registrar_log(texto: str):
    try:
        pasta = Path.home() / "Documents" / "PrintNow"
        pasta.mkdir(parents=True, exist_ok=True)
        with (pasta / "agente.log").open("a", encoding="utf-8") as arquivo:
            arquivo.write(texto.rstrip() + "\n")
    except Exception:
        pass


INSTANCIA = None
ULTIMO_RESULTADO = "Nenhuma etiqueta nesta sessão."
ROOT = None
JANELA = None
ROTULOS = {}


def anotar_resultado(texto: str):
    global ULTIMO_RESULTADO
    ULTIMO_RESULTADO = texto


def avisar(titulo: str, texto: str, erro: bool = False):
    import win32api
    import win32con

    bandeira = win32con.MB_ICONERROR if erro else win32con.MB_ICONINFORMATION
    win32api.MessageBox(0, texto, titulo, bandeira | win32con.MB_SETFOREGROUND | win32con.MB_TOPMOST)


def reservar_instancia() -> bool:
    global INSTANCIA
    import win32api
    import win32event
    import winerror

    INSTANCIA = win32event.CreateMutex(None, False, "Local\\LojasVariaraPrintNowAgente")
    if win32api.GetLastError() == winerror.ERROR_ALREADY_EXISTS:
        avisar(
            "PrintNow",
            "O PrintNow já está aberto neste computador.\n\n"
            "Olhe a seta ao lado do relógio: o ícone roxo está na bandeja.",
        )
        return False
    return True


def servir():
    servidor = ThreadingHTTPServer((HOST, PORT), Agente)
    print(f"PrintNow agente em http://{HOST}:{PORT}")
    print(f"Impressora salva: {impressora_salva() or '(nenhuma)'}")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()


def abrir_servidor():
    try:
        servidor = ThreadingHTTPServer((HOST, PORT), Agente)
    except OSError as erro:
        avisar(
            "PrintNow",
            f"Não consegui ficar pronto para imprimir.\n\n{erro}",
            erro=True,
        )
        raise
    thread = threading.Thread(target=servidor.serve_forever, name="printnow-http", daemon=True)
    thread.start()
    return servidor


def icone_bandeja():
    imagem = Image.new("RGB", (64, 64), (79, 70, 229))
    draw = ImageDraw.Draw(imagem)
    draw.rounded_rectangle((10, 18, 54, 46), radius=6, fill="white")
    draw.rectangle((18, 28, 46, 36), fill=(79, 70, 229))
    return imagem


def texto_falha(erro: BaseException) -> str:
    texto = str(erro)
    if texto.startswith("sem_impressora"):
        return "Nenhuma impressora selecionada."
    return texto.removeprefix("falha_impressao: ").strip() or "Falha na impressora."


def imprimir_teste():
    def trabalho():
        try:
            imagem = montar_imagem(
                {
                    "sku": "TESTE",
                    "variante": "Conferência",
                    "codigo_barras": "",
                    "qtd_pacote": 1,
                    "fabricacao": "IND. BRASILEIRA",
                    "cnpj": "",
                },
                preview=False,
            )
            nome = imprimir(imagem, 1)
            anotar_resultado(f"Etiqueta de teste impressa na {nome}.")
        except Exception as erro:
            anotar_resultado(f"Etiqueta não impressa: {texto_falha(erro)}")

    threading.Thread(target=trabalho, name="printnow-teste", daemon=True).start()


def escolher_impressora(nome: str):
    salvar_impressora(nome)
    anotar_resultado(f"Impressora selecionada: {nome}.")


def atualizar_conferencia():
    if not ROTULOS:
        return
    diagnostico = diagnosticar_impressora()
    if diagnostico["pronta"]:
        estado = "Pronta para imprimir"
    elif diagnostico["instalada"] and not diagnostico["conectada"]:
        estado = "Instalada, mas não conectada"
    elif not diagnostico["instalada"]:
        estado = "Não instalada neste computador"
    else:
        estado = diagnostico["motivo"] or "Não está pronta"
    ROTULOS["estado"].configure(text=estado)
    ROTULOS["impressora"].configure(text=diagnostico["impressora"] or "Nenhuma selecionada")
    ROTULOS["ultimo"].configure(text=ULTIMO_RESULTADO)


def mostrar_conferencia():
    if JANELA is None:
        return
    atualizar_conferencia()
    JANELA.deiconify()
    JANELA.lift()
    JANELA.focus_force()


def abrir_escolha_impressora():
    import tkinter as tk
    from tkinter import ttk

    try:
        nomes = listar_impressoras()
    except Exception as erro:
        anotar_resultado(f"Etiqueta não impressa: {erro}")
        atualizar_conferencia()
        return
    if not nomes:
        anotar_resultado("Etiqueta não impressa: nenhuma impressora encontrada no Windows.")
        atualizar_conferencia()
        return

    dialogo = tk.Toplevel(ROOT)
    dialogo.title("Impressora")
    dialogo.resizable(False, False)
    dialogo.transient(JANELA)
    quadro = ttk.Frame(dialogo, padding=16)
    quadro.grid()
    ttk.Label(quadro, text="Impressoras deste computador").grid(sticky="w")
    atual = impressora_salva()
    for indice, nome in enumerate(nomes, start=1):
        ttk.Button(
            quadro,
            text=("✓  " if nome == atual else "     ") + nome,
            command=lambda escolhida=nome: (escolher_impressora(escolhida), atualizar_conferencia(), dialogo.destroy()),
        ).grid(sticky="ew", pady=(8 if indice == 1 else 4, 0))


def montar_janela(root):
    import tkinter as tk
    from tkinter import ttk

    global JANELA, ROTULOS
    janela = root
    janela.title("PrintNow")
    janela.geometry("440x390")
    janela.resizable(False, False)
    janela.protocol("WM_DELETE_WINDOW", janela.withdraw)

    corpo = ttk.Frame(janela, padding=18)
    corpo.pack(fill="both", expand=True)

    ttk.Label(corpo, text="Conferência", font=("Segoe UI", 16, "bold")).grid(sticky="w")
    ttk.Label(corpo, text="Estado").grid(sticky="w", pady=(14, 0))
    ROTULOS["estado"] = ttk.Label(corpo, font=("Segoe UI", 11, "bold"))
    ROTULOS["estado"].grid(sticky="w")
    ttk.Label(corpo, text="Impressora").grid(sticky="w", pady=(12, 0))
    ROTULOS["impressora"] = ttk.Label(corpo, font=("Segoe UI", 11, "bold"))
    ROTULOS["impressora"].grid(sticky="w")
    ttk.Label(corpo, text="Última etiqueta").grid(sticky="w", pady=(12, 0))
    ROTULOS["ultimo"] = ttk.Label(corpo, wraplength=400, justify="left")
    ROTULOS["ultimo"].grid(sticky="w")

    acoes = ttk.Frame(corpo)
    acoes.grid(sticky="w", pady=(16, 0))
    ttk.Button(acoes, text="Escolher impressora", command=abrir_escolha_impressora).grid(row=0, column=0, padx=(0, 8))
    ttk.Button(acoes, text="Etiqueta de teste", command=imprimir_teste).grid(row=0, column=1)

    guia = ttk.LabelFrame(corpo, text="Num computador novo", padding=10)
    guia.grid(sticky="ew", pady=(18, 0))
    ttk.Label(
        guia,
        justify="left",
        text=(
            "1. Copie o PrintNowAgente.exe\n"
            "2. Abra uma vez\n"
            "3. Instale a impressora no Windows\n"
            "4. Embale pelo Sistema LV"
        ),
    ).grid(sticky="w")

    JANELA = janela
    atualizar_conferencia()


def pulsar_conferencia():
    if JANELA is not None and JANELA.winfo_viewable():
        atualizar_conferencia()
    ROOT.after(2500, pulsar_conferencia)


def iniciar_bandeja():
    import tkinter as tk
    import pystray

    global ROOT
    registrar_log("bandeja: reservando")
    if not reservar_instancia():
        registrar_log("bandeja: já havia uma instância")
        return
    try:
        abrir_servidor()
        registrar_log("bandeja: servidor ok")
    except OSError as erro:
        registrar_log(f"bandeja: porta falhou: {erro}")
        return

    root = tk.Tk()
    registrar_log("bandeja: janela criada")
    ROOT = root
    montar_janela(root)
    root.after(2500, pulsar_conferencia)

    def sair(icone, _item):
        icone.stop()
        os._exit(0)

    def escolher_do_menu(nome):
        def acao(_icone, _item):
            escolher_impressora(nome)
        return acao

    def menu_impressoras():
        try:
            nomes = listar_impressoras()
        except Exception:
            nomes = []
        if not nomes:
            return (pystray.MenuItem("Nenhuma impressora encontrada", None, enabled=False),)
        return tuple(
            pystray.MenuItem(
                nome,
                escolher_do_menu(nome),
                checked=lambda item, escolhida=nome: impressora_salva() == escolhida,
                radio=True,
            )
            for nome in nomes
        )

    menu = pystray.Menu(
        pystray.MenuItem("Conferência", lambda _icone, _item: ROOT.after(0, mostrar_conferencia)),
        pystray.MenuItem("Impressora", pystray.Menu(menu_impressoras)),
        pystray.MenuItem("Etiqueta de teste", lambda _icone, _item: imprimir_teste()),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Sair", sair),
    )
    icone = pystray.Icon("printnow-agente", icone_bandeja(), "PrintNow", menu)
    threading.Thread(target=icone.run, name="printnow-bandeja", daemon=True).start()
    root.mainloop()


def garantir_inicializacao():
    if not getattr(sys, "frozen", False):
        return
    destino = Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / "PrintNow Agente.lnk"
    if not destino.parent.exists():
        return
    try:
        import win32com.client

        atalho = win32com.client.Dispatch("WScript.Shell").CreateShortCut(str(destino))
        atalho.Targetpath = sys.executable
        atalho.WorkingDirectory = str(Path(sys.executable).parent)
        atalho.WindowStyle = 7
        atalho.Description = "Agente de etiquetas da embalagem"
        atalho.save()
    except Exception as erro:
        print(f"Não foi possível gravar a inicialização: {erro}")


def main():
    sys.excepthook = lambda _tipo, erro, _tb: registrar_log(f"erro: {erro}\n{traceback.format_exc()}")
    threading.excepthook = lambda args: registrar_log(f"thread {args.thread.name}: {args.exc_value}\n{''.join(traceback.format_exception(args.exc_type, args.exc_value, args.exc_traceback))}")
    registrar_log("iniciando")
    if "--amostra" in sys.argv:
        gerar_amostra()
        return
    if "--console" in sys.argv:
        servir()
        return
    garantir_inicializacao()
    iniciar_bandeja()


if __name__ == "__main__":
    main()
