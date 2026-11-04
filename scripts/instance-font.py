# Pins Archivo's variable axes to the "monument" instance (wdth 125, wght 800)
# so the specimen generator can read plain outlines. fontkit cannot instance WOFF2.
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

src, dst = sys.argv[1], sys.argv[2]
font = instantiateVariableFont(TTFont(src), {"wdth": 125, "wght": 800})
font.flavor = None
font.save(dst)
print("instanced", dst)
