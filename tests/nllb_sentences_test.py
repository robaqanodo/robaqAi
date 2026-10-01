import importlib.util,unittest
from pathlib import Path
path=Path(__file__).resolve().parents[1]/'scripts/nllb-runtime.py'
spec=importlib.util.spec_from_file_location('nllb_runtime',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class SentenceTests(unittest.TestCase):
 def test_preserves_every_character(self):
  text='The meeting is at 10:30. Bring your passport.\n\nPrice: 3.50 dollars! Next sentence?'
  self.assertEqual(''.join(module.sentence_parts(text)),text)
  self.assertIn('Price: 3.50 dollars!',module.sentence_parts(text))
 def test_translates_both_sentences_separately(self):
  self.assertEqual(module.sentence_parts('The meeting is tomorrow. Bring your passport.'),['The meeting is tomorrow.',' ','Bring your passport.'])
if __name__=='__main__':unittest.main()
