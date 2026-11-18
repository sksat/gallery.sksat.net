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
