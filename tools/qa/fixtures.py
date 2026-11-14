"""Synthetic, static two-page PDF + PNG. Run on Debian with existing Pillow.

Writes a tar stream to stdout. No application data, network calls or /uploads writes.
The PDF is deliberately a raster background, with no AcroForm fields.
"""
from io import BytesIO
import tarfile
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1240, 1754


def font(size):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                 "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def page(number, image=False):
    im = Image.new("RGB", (WIDTH, HEIGHT), "white")
    d = ImageDraw.Draw(im)
    d.rectangle((75, 75, 1165, 215), fill="#e9f1fb")
    d.text((105, 92), "LMPDF - RECETTE 20261114", font=font(37), fill="#12314f")
    d.text((105, 151), f"DONNEES SYNTHETIQUES - {'PNG' if image else 'PDF'} - PAGE {number}", font=font(26), fill="#12314f")
    d.text((100, 270), "Nom QA / texte libre :", font=font(26), fill="black")
    d.rectangle((100, 320, 1100, 405), outline="black", width=3)
    d.text((100, 470), "Case QA :", font=font(26), fill="black")
    d.rectangle((300, 465, 345, 510), outline="black", width=3)
    d.text((100, 575), "Compteur QA :", font=font(26), fill="black")
    d.rectangle((440, 570, 650, 635), outline="black", width=3)
    d.text((100, 710), "Date QA (JJ/MM/AAAA) :", font=font(26), fill="black")
    d.rectangle((520, 705, 1000, 775), outline="black", width=3)
    d.text((100, 850), "Notes - reperes pour texte riche et OCR :", font=font(26), fill="black")
    for y in (920, 1000, 1080):
        for x in range(100, 1100, 16):
            d.line((x, y, x + 8, y), fill="black", width=3)
    d.text((100, 1200), f"REFERENCE QA {'IMAGE' if image else number} - AUCUNE DONNEE PERSONNELLE", font=font(24), fill="#12314f")
    d.text((100, 1270), "La page 2 sert a verifier navigation et export multipage.", font=font(23), fill="black")
    d.line((100, 1560, 1140, 1560), fill="#a3b5c8", width=2)
    d.text((100, 1590), f"Fixture persistante QA / page {number} / fond statique", font=font(23), fill="#12314f")
    return im


pdf, png = BytesIO(), BytesIO()
page(1).save(pdf, "PDF", resolution=150, save_all=True, append_images=[page(2)], quality=95)
page(1, image=True).save(png, "PNG")
import sys
with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
    for name, content in (("RECETTE-20261114-deux-pages.pdf", pdf.getvalue()),
                          ("RECETTE-20261114-image.png", png.getvalue())):
        entry = tarfile.TarInfo(name)
        entry.size, entry.mode = len(content), 0o600
        archive.addfile(entry, BytesIO(content))
