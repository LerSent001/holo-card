import importlib.util
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from PIL import Image

spec=importlib.util.spec_from_file_location('native',Path(__file__).resolve().parents[1]/'scripts/native.py')
native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
class NativeTests(unittest.TestCase):
 def test_native_build_without_api_or_network(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=root/'source.png';Image.new('RGBA',(70,98),(20,130,210,255)).save(source)
   mask=root/'mask.png';Image.new('L',(70,98),255).save(mask);job=root/'task';colored=root/'colored.png';im=Image.new('RGBA',(70,98),(200,40,10,128));im.putpixel((0,0),(0,0,0,0));im.save(colored)
   with patch.object(socket,'create_connection',side_effect=AssertionError('Network forbidden')):
    result=native.prepare(source,job,'Safe </script> card');self.assertEqual(result['execution'],'codex_builtin_image_gen')
    self.assertEqual(result['completed_layers'],0)
    with self.assertRaises(ValueError):native.assemble(job)
    for kind in native.KINDS:native.add(job,kind,mask if kind=='structure' else source if kind=='background' else colored,'test-local-fixture')
    result=native.assemble(job);self.assertEqual(result['status'],'completed')
   self.assertEqual(Image.open(job/'assets/character.png').getpixel((1,1)),(200,40,10,128))
   html=(job/'index.html').read_text();self.assertIn('globalThis.HOLO_MANIFEST',html);self.assertIn('Safe \\u003c/script> card',html);self.assertNotIn('src="viewer.js',html)
   with zipfile.ZipFile(job/'card.zip') as archive:self.assertIsNone(archive.testzip());self.assertIn('provenance.json',archive.namelist())
 def test_background_plate_must_be_complete(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=root/'source.png';Image.new('RGBA',(70,98),(20,130,210,255)).save(source)
   hole=root/'hole.png';im=Image.open(source);im.putpixel((30,40),(0,0,0,0));im.save(hole)
   job=root/'task';native.prepare(source,job,None)
   with self.assertRaisesRegex(ValueError,'fully opaque'):native.add(job,'background',hole,None)
   self.assertEqual(native.load(job)['layers']['background']['error'],'BACKGROUND_HAS_HOLES')
   native.add(job,'background',source,None)
   self.assertEqual(native.load(job)['layers']['background']['status'],'imported')
 def test_independent_alpha_preserves_dark_and_light_rgb(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);color=root/'color.png';im=Image.new('RGB',(70,98),'white');im.putpixel((20,20),(0,0,0));im.save(color)
   mask=root/'mask.png';m=Image.new('L',im.size,255);m.putpixel((0,0),0);m.putpixel((1,0),128);m.save(mask)
   job=root/'job';native.prepare(color,job,None)
   native.apply_alpha(job,'character',color,mask,'local test selection')
   state=native.load(job);out=Image.open(job/state['layers']['character']['raw'])
   self.assertEqual(out.getpixel((20,20)),(0,0,0,255));self.assertEqual(out.getpixel((1,0)),(255,255,255,128));self.assertEqual(out.getpixel((0,0)),(255,255,255,0))
   self.assertEqual(state['layers']['character']['alpha_method'],'independent_selection')
   bad=root/'bad.png';Image.new('L',(10,10),255).save(bad)
   with self.assertRaisesRegex(ValueError,'identical dimensions'):native.apply_alpha(job,'ui',color,bad,'test')
 def test_mismatched_mask_preserved_for_review(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=root/'source.png';Image.new('RGB',(70,98)).save(source);mask=root/'mask.png';Image.new('L',(100,100),255).save(mask)
   native.prepare(source,root/'task',None)
   with self.assertRaisesRegex(ValueError,'aspect ratio'):native.add(root/'task','structure',mask,None)
   state=native.load(root/'task');self.assertEqual(state['status'],'needs_review');self.assertTrue((root/'task'/state['layers']['structure']['raw']).is_file())
if __name__=='__main__':unittest.main()
