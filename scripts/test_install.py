import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('installer',Path(__file__).with_name('install-skill.py'))
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)
class InstallTests(unittest.TestCase):
 def test_repeated_install_removes_obsolete_and_nested_files(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=root/'source';source.mkdir();(source/'SKILL.md').write_text('name: holo-card');(source/'current.py').write_text('current')
   dest=root/'skills/holo-card';installer.install(source,dest)
   (dest/'old.py').write_text('old');(dest/'holo-card').mkdir();(dest/'holo-card/SKILL.md').write_text('old nested')
   installer.install(source,dest)
   self.assertEqual(installer.files(source),installer.files(dest));self.assertFalse((dest/'holo-card').exists())
   self.assertEqual(list(dest.parent.iterdir()),[dest])
 def test_does_not_replace_unrelated_directory(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);source=root/'source';source.mkdir();(source/'SKILL.md').write_text('name: holo-card')
   dest=root/'holo-card';dest.mkdir();(dest/'personal.txt').write_text('keep')
   with self.assertRaises(ValueError):installer.install(source,dest)
   self.assertEqual((dest/'personal.txt').read_text(),'keep')
if __name__=='__main__':unittest.main()
