from pathlib import Path
import hashlib,json,struct,shutil
root=Path(__file__).resolve().parent.parent
source=root/'offline-assets/translation-model'
names=['LICENSE','config.json','generation_config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/encoder_model_quantized.onnx','onnx/decoder_model_merged_quantized.onnx']
files=[]
for name in names:
    path=source/name
    with path.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
    files.append({'name':name,'size':path.stat().st_size,'sha256':digest})
manifest={'format':'rai-translation-v1','model':'Xenova/m2m100_418M','revision':'9c374f0b7aca709787cea97b047bfbbd1559d177','languages':['en','ka','ru'],'files':files}
header=json.dumps(manifest,separators=(',',':')).encode()
out=root/'public/translator/rai-translator-en-ka-ru.raipack'
with out.open('wb') as pack:
    pack.write(struct.pack('<I',len(header)));pack.write(header)
    for name in names:
        with (source/name).open('rb') as f: shutil.copyfileobj(f,pack)
(root/'src/translation/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'{out.name}: {out.stat().st_size/1024/1024:.1f} MiB')
