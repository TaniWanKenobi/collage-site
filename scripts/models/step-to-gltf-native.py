"""Native OpenCascade STEP -> GLB, for big assemblies the occt-import-js wasm build can't mesh.

Usage (needs `pip install cadquery-ocp`):
    python scripts/models/step-to-gltf-native.py <in.step> <out-raw.glb> [linear_deflection_mm] [angular_deflection_rad]

Writes an unoptimized GLB: Y-up, meters, with STEP part names and colors (RWGltf_CafWriter).
Then run it through step-to-glb.mjs, which accepts a .glb input, to decimate and compress it.
"""
import sys
import time

from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.IFSelect import IFSelect_RetDone
from OCP.Message import Message_ProgressRange
from OCP.RWGltf import RWGltf_CafWriter
from OCP.RWMesh import RWMesh_CoordinateSystem
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_AsciiString, TCollection_ExtendedString
from OCP.OCP.collections import IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString as FileInfo
from OCP.OCP.collections import Sequence_TDF_Label as TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.XCAFDoc import XCAFDoc_DocumentTool

src, dst = sys.argv[1], sys.argv[2]
lin = float(sys.argv[3]) if len(sys.argv) > 3 else 0.1
ang = float(sys.argv[4]) if len(sys.argv) > 4 else 0.35
t0 = time.time()
log = lambda *m: print(f"[{time.time() - t0:.1f}s]", *m, flush=True)

doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf"))
reader = STEPCAFControl_Reader()
reader.SetColorMode(True)
reader.SetNameMode(True)
reader.SetLayerMode(False)
if reader.ReadFile(src) != IFSelect_RetDone:
    sys.exit("STEP read failed")
log("read")
if not reader.Transfer(doc):
    sys.exit("STEP transfer failed")
log("transferred")

# Mesh every free shape; the CAF writer exports the existing triangulation.
tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
labels = TDF_LabelSequence()
tool.GetFreeShapes(labels)
for i in range(1, labels.Length() + 1):
    shape = tool.GetShape_s(labels.Value(i))
    BRepMesh_IncrementalMesh(shape, lin, False, ang, True)
log(f"meshed {labels.Length()} free shape(s) at {lin} mm / {ang} rad")

writer = RWGltf_CafWriter(TCollection_AsciiString(dst), True)
conv = writer.ChangeCoordinateSystemConverter()
conv.SetInputLengthUnit(0.001)  # STEP read in millimeters
conv.SetInputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_Zup)
conv.SetOutputLengthUnit(1.0)  # glTF meters
conv.SetOutputCoordinateSystem(RWMesh_CoordinateSystem.RWMesh_CoordinateSystem_glTF)
writer.SetMergeFaces(True)
ok = writer.Perform(doc, FileInfo(), Message_ProgressRange())
log("wrote" if ok else "WRITE FAILED", dst)
sys.exit(0 if ok else 3)
