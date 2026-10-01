"""Project-local NLLB inference. Only install mode uses the network."""
import hashlib,json,os,sys,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MODEL=ROOT/'offline-assets/nllb-200-3.3b'
MANIFEST=json.loads((ROOT/'src/offline/nllb-manifest.json').read_text())
os.environ['HF_HOME']=str(ROOT/'offline-assets/hf-cache')
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
def emit(data): print(json.dumps(data,ensure_ascii=False),flush=True)
def verify():
 for item in MANIFEST['files']:
  path=MODEL/item['name']
  if not path.is_file() or path.stat().st_size!=item['size']: raise ValueError('Incomplete model file: '+item['name'])
  digest=hashlib.sha256() if 'sha256' in item else hashlib.sha1()
  if 'gitSha1' in item: digest.update(('blob '+str(item['size'])+'\0').encode())
  with path.open('rb') as stream:
   while chunk:=stream.read(4*1024*1024): digest.update(chunk)
  if digest.hexdigest()!=item.get('sha256',item.get('gitSha1')): raise ValueError('Model verification failed: '+item['name'])
def sentence_parts(text):
 # NLLB is trained for sentence translation; preserve separators verbatim.
 return re.split(r'((?<=[.!?。！？])\s+|\n+)',text)
def run():
 import ctranslate2
 from tokenizers import Tokenizer
 if sys.argv[1]=='install':
  from huggingface_hub import snapshot_download
  emit({'status':'Downloading NLLB-200 · 3.4 GB'})
  snapshot_download(MANIFEST['model'],revision=MANIFEST['revision'],local_dir=str(MODEL),allow_patterns=[f['name'] for f in MANIFEST['files']],max_workers=2)
  emit({'status':'Verifying model files…'});verify()
  emit({'status':'Checking local translation engine…'})
  engine=ctranslate2.Translator(str(MODEL),device='cpu',compute_type='int8',intra_threads=4,inter_threads=1)
  Tokenizer.from_file(str(MODEL/'tokenizer.json'))
  del engine
  marker=MODEL/'installed.json';temporary=MODEL/'installed.json.tmp'
  temporary.write_text(json.dumps({'revision':MANIFEST['revision']}));temporary.replace(marker)
  emit({'status':'success'});return
 body=json.load(sys.stdin)
 if body.get('source') not in ('en','ka','ru') or body.get('target') not in ('en','ka','ru'): raise ValueError('Unsupported translation language.')
 text=body.get('text','')
 if not isinstance(text,str) or not text.strip() or len(text)>8000: raise ValueError('Invalid translation text.')
 tokenizer=Tokenizer.from_file(str(MODEL/'tokenizer.json'))
 langs={'en':'eng_Latn','ka':'kat_Geor','ru':'rus_Cyrl'}
 engine=ctranslate2.Translator(str(MODEL),device='cpu',compute_type='int8',intra_threads=4,inter_threads=1)
 def translate(value,source,target):
  tokens=[langs[source]]+tokenizer.encode(value,add_special_tokens=False).tokens+['</s>']
  if len(tokens)>512: raise ValueError('This passage is too long. Please split it into shorter paragraphs.')
  result=engine.translate_batch([tokens],target_prefix=[[langs[target]]],beam_size=4,max_decoding_length=256)[0].hypotheses[0][1:]
  if len(result)>=256: raise ValueError('Translation reached its length limit. Please use a shorter passage.')
  answer=tokenizer.decode([tokenizer.token_to_id(token) for token in result]).strip()
  if not answer: raise ValueError('The model returned an empty translation.')
  return answer
 # Direct EN→KA produced malformed Georgian in evaluation; the tested RU pivot
 # preserves ordinary Georgian on the same examples. Both passes stay offline.
 translated=[]
 for part in sentence_parts(text):
  if not part.strip():
   translated.append(part);continue
  if body['source']=='en' and body['target']=='ka':
   translated.append(translate(translate(part,'en','ru'),'ru','ka'))
  else:
   translated.append(translate(part,body['source'],body['target']))
 answer=''.join(translated)
 emit({'text':answer})
if __name__=='__main__':
 try: run()
 except Exception as error:
  emit({'error':str(error)});sys.exit(1)
