import importlib.util
from pathlib import Path
import unittest
from PIL import Image
spec=importlib.util.spec_from_file_location('matte',Path(__file__).resolve().parents[1]/'scripts/matte_regions.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class MatteTests(unittest.TestCase):
 def test_unseeded_gray_clothing_and_detached_artwork_survive(self):
  c=Image.new('L',(9,9),255)
  # Dark silhouette encloses a gray interior that also matches the candidate color.
  for x in range(2,7):c.putpixel((x,2),0);c.putpixel((x,6),0)
  for y in range(2,7):c.putpixel((2,y),0);c.putpixel((6,y),0)
  c.putpixel((8,8),0)
  a=m.selection(c,[(0,0)])
  self.assertEqual(a.getpixel((0,0)),0);self.assertEqual(a.getpixel((4,4)),255);self.assertEqual(a.getpixel((8,8)),255)
  b=m.selection(c,[(0,0),(4,4)]);self.assertEqual(b.getpixel((4,4)),0)
 def test_protection_stops_leak_and_preserves_existing_alpha(self):
  c=Image.new('L',(5,5),255);protect=Image.new('L',c.size,0)
  for y in range(5):protect.putpixel((2,y),255)
  original=Image.new('L',c.size,255);original.putpixel((4,4),87)
  out=m.selection(c,[(0,0)],original,protect)
  self.assertEqual(out.getpixel((1,1)),0);self.assertEqual(out.getpixel((3,1)),255);self.assertEqual(out.getpixel((4,4)),87)
  with self.assertRaises(ValueError):m.selection(c,[(2,0)],original,protect)
if __name__=='__main__':unittest.main()
