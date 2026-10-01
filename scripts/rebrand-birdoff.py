from pathlib import Path
import re,json
paths=[*Path('src').rglob('*.tsx'),*Path('src').rglob('*.ts'),*Path('src').rglob('*.json'),*Path('src').rglob('*.txt'),*Path('tests').glob('*.ts'),*Path('tests').glob('*.tsx'),*Path('public/brains').glob('*.json'),Path('capacitor.config.ts'),Path('index.html'),Path('ios/App/App/Info.plist')]
for p in paths:
 s=p.read_text();s=re.sub(r'R\.A\.?I', 'Birdoff', s, flags=re.I);s=re.sub(r'\bStore\b|\bLibrary\b','AI Lab',s);s=s.replace('AI Lab (AI Lab)','AI Lab');s=s.replace('Birdoff - Offline AI Platform','Birdoff');s=s.replace(' in Las Vegas, NV','');p.write_text(s)
p=Path('index.html');s=p.read_text().replace('<title>Birdoff</title>','<title>Birdoff - your AI tool</title>');p.write_text(s)
p=Path('package.json');d=json.loads(p.read_text());d['name']='birdoff';p.write_text(json.dumps(d,indent=2)+'\n')
p=Path('package-lock.json');d=json.loads(p.read_text());d['name']='birdoff';d['packages']['']['name']='birdoff';p.write_text(json.dumps(d,indent=2)+'\n')
for p in [Path('src/nodo-offline.json'),Path('public/brains/nodo-offline.json')]:
 d=json.loads(p.read_text());d['version']+=1;p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=Path('src/brains.ts');s=p.read_text().replace('if (existing?.intents?.length) return existing','if (existing?.intents?.length && existing.version === BUILTIN_OFFLINE_PACK.version) return existing');p.write_text(s)
p=Path('src/i18n/translations.json');d=json.loads(p.read_text());d['AI Lab']=['AI Lab','AI Lab'];p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
