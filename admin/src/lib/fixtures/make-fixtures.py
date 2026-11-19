import json
import sys
from PIL import Image, PngImagePlugin
from PIL.TiffImagePlugin import IFDRational as R

out = sys.argv[1]
im = Image.new("RGB", (8, 8), (200, 120, 40))
ex = Image.Exif()
ex[0x010F] = "FUJIFILM"
ex[0x0110] = "X-T5"
ex[0x0112] = 6
ex[0x0132] = "2024:01:02 00:00:00"
e = ex.get_ifd(0x8769)
e[0x829A] = R(1, 250)
e[0x829D] = R(28, 10)
e[0x8827] = 400
e[0x9003] = "2023:12:11 01:21:32"
e[0x9011] = "+09:00"
e[0x920A] = R(35, 1)
e[0xA434] = "XF35mmF1.4 R"
g = ex.get_ifd(0x8825)
g[1] = "N"
g[2] = (R(35, 1), R(39, 1), R(3135, 100))
g[3] = "E"
g[4] = (R(139, 1), R(44, 1), R(4092, 100))
im.save(f"{out}/exif-gps.jpg", "JPEG", exif=ex, quality=50)

xmp = (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description rdf:about="" xmlns:vrc="http://ns.vrchat.com/vrc/1.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">'
    "<xmp:CreatorTool>VRChat</xmp:CreatorTool>"
    "<vrc:WorldID>wrld_4cf554b4-430c-4f8f-b53e-1f294eed230b</vrc:WorldID>"
    "<vrc:WorldDisplayName>The Black Cat &amp; Friends</vrc:WorldDisplayName>"
    "<vrc:AuthorID>usr_00000000-1111-2222-3333-444444444444</vrc:AuthorID>"
    "</rdf:Description></rdf:RDF></x:xmpmeta>"
)
for name, z in (("vrchat-xmp.png", False), ("vrchat-xmp-z.png", True)):
    info = PngImagePlugin.PngInfo()
    info.add_itxt("XML:com.adobe.xmp", xmp, zip=z)
    Image.new("RGB", (8, 8), (10, 20, 30)).save(f"{out}/{name}", "PNG", pnginfo=info)

# What VRChat (2025.3.1 and later) writes: the dates with the real offset
# and 7 fractional digits, the photographer's display name and ids. The
# values are made up.
xmp2026 = (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"'
    ' xmlns:tiff="http://ns.adobe.com/tiff/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"'
    ' xmlns:vrc="http://ns.vrchat.com/vrc/1.0/">'
    "<xmp:CreatorTool>VRChat</xmp:CreatorTool>"
    "<xmp:Author>Someone</xmp:Author>"
    "<xmp:CreateDate>2026-11-02T11:31:36.9591864+09:00</xmp:CreateDate>"
    "<xmp:ModifyDate>2026-11-02T11:31:36.9591864+09:00</xmp:ModifyDate>"
    "<tiff:DateTime>2026-11-02T11:31:36.9591864+09:00</tiff:DateTime>"
    "<vrc:WorldID>wrld_00000000-aaaa-bbbb-cccc-000000000001</vrc:WorldID>"
    "<vrc:WorldDisplayName>桜の川 （Sakura）</vrc:WorldDisplayName>"
    "<vrc:AuthorID>usr_00000000-1111-2222-3333-555555555555</vrc:AuthorID>"
    "</rdf:Description></rdf:RDF></x:xmpmeta>"
)
info = PngImagePlugin.PngInfo()
info.add_itxt("XML:com.adobe.xmp", xmp2026, zip=False)
Image.new("RGB", (8, 8), (40, 20, 30)).save(f"{out}/vrchat-2026.png", "PNG", pnginfo=info)

# VRCX (vrcx-team/VRCX, src/stores/vrcx.js processScreenshot and
# ScreenshotHelper.WriteVRCXMetadata) adds an uncompressed iTXt chunk
# "Description" with this JSON right after VRChat's chunks, before IDAT.
# Values made up; the second player has a non-ASCII name.
vrcx = json.dumps(
    {
        "application": "VRCX",
        "version": 1,
        "author": {
            "id": "usr_00000000-1111-2222-3333-555555555555",
            "displayName": "Someone",
        },
        "world": {
            "name": "桜の川 （Sakura）",
            "id": "wrld_00000000-aaaa-bbbb-cccc-000000000001",
            "instanceId": "wrld_00000000-aaaa-bbbb-cccc-000000000001:75296~friends(usr_00000000-1111-2222-3333-555555555555)~region(jp)",
        },
        "players": [
            {"id": "usr_00000000-1111-2222-3333-555555555555", "displayName": "Someone"},
            {"id": "usr_00000000-1111-2222-3333-666666666666", "displayName": "ねこ"},
        ],
    },
    ensure_ascii=False,
    separators=(",", ":"),
)
# VRChat's XMP and VRCX's JSON, as VRCX leaves a screenshot.
info = PngImagePlugin.PngInfo()
info.add_itxt("XML:com.adobe.xmp", xmp2026, zip=False)
info.add_itxt("Description", vrcx, zip=False)
Image.new("RGB", (8, 8), (40, 20, 30)).save(f"{out}/vrcx.png", "PNG", pnginfo=info)

# From before VRChat wrote XMP: VRCX's JSON is all there is.
info = PngImagePlugin.PngInfo()
info.add_itxt("Description", vrcx, zip=False)
Image.new("RGB", (8, 8), (30, 40, 20)).save(f"{out}/vrcx-only.png", "PNG", pnginfo=info)

# Other tools may keep the same JSON in a tEXt (UTF-8 inside, though the
# spec says Latin-1) or a zTXt chunk.
info = PngImagePlugin.PngInfo()
info.add_text("Description", vrcx.encode("utf-8"))
Image.new("RGB", (8, 8), (20, 30, 40)).save(f"{out}/vrcx-text.png", "PNG", pnginfo=info)
info = PngImagePlugin.PngInfo()
info.add_text("Description", vrcx.encode("utf-8"), zip=True)
Image.new("RGB", (8, 8), (20, 40, 30)).save(f"{out}/vrcx-ztxt.png", "PNG", pnginfo=info)

# Digitised from an analog original on a lab's Fuji Frontier: its EXIF
# names the scanner, and DateTimeOriginal is when it was scanned.
scan = Image.Exif()
scan[0x010F] = "FUJI PHOTO FILM CO., LTD."
scan[0x0110] = "SP-2000"
scan[0x0132] = "2023:12:12 10:00:00"
scan.get_ifd(0x8769)[0x9003] = "2023:12:12 10:00:00"
Image.new("RGB", (8, 8), (90, 90, 60)).save(
    f"{out}/lab-scan.jpg", "JPEG", exif=scan, quality=50
)

# A scanner with a generic name and a clock that was never set (seen on
# real files: make "GCMC", model "Scanner", every scan on 2021-01-01).
gcmc = Image.Exif()
gcmc[0x010F] = "GCMC"
gcmc[0x0110] = "Scanner"
gcmc[0x0132] = "2021:01:01 00:31:12"
gcmc.get_ifd(0x8769)[0x9003] = "2021:01:01 00:31:12"
Image.new("RGB", (8, 8), (60, 70, 90)).save(
    f"{out}/gcmc-scan.jpg", "JPEG", exif=gcmc, quality=50
)
