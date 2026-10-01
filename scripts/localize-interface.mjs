import ts from 'typescript'
import fs from 'node:fs'
const files = ['src/App.tsx','src/navigation/Navigation.tsx','src/accounts/History.tsx','src/accounts/AccountDialog.tsx','src/translation/TranslatorStore.tsx']
const keys = new Set()
for (const file of files) {
  let source = fs.readFileSync(file,'utf8')
  const ast = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const edits=[]
  const add = (node,text,attribute=false) => {
    const key = text.replace(/\s+/g,' ').trim().replaceAll('&amp;','&')
    if (!/[A-Za-z]/.test(key) || ['R.AI','R.A.I','STDG 1.0 (Truck Driver\'s Guide)','AIza… / sk-… / sk-ant-…','you@example.com'].includes(key)) return
    keys.add(key)
    edits.push([node.getStart(ast),node.end,attribute ? `{t(${JSON.stringify(key)})}` : `t(${JSON.stringify(key)})`])
  }
  const expressions = node => {
    if(ts.isStringLiteral(node)) add(node,node.text)
    else if(ts.isConditionalExpression(node)) { expressions(node.whenTrue); expressions(node.whenFalse) }
  }
  const visit = node => {
    if(ts.isJsxText(node)) {
      const key=node.text.replace(/\s+/g,' ').trim().replaceAll('&amp;','&')
      if (/[A-Za-z]/.test(key) && !['R.AI','R.A.I',"STDG 1.0 (Truck Driver's Guide)"].includes(key)) {
        keys.add(key); edits.push([node.pos,node.end,`${/^\s/.test(node.text)?' ':''}{t(${JSON.stringify(key)})}${/\s$/.test(node.text)?' ':''}`])
      }
    } else if(ts.isJsxAttribute(node) && ['title','aria-label','placeholder'].includes(node.name.getText(ast)) && node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer,node.initializer.text,true)
    else if(ts.isJsxExpression(node) && node.expression && (!ts.isJsxAttribute(node.parent) || ['title','aria-label','placeholder'].includes(node.parent.name.getText(ast)))) expressions(node.expression)
    ts.forEachChild(node,visit)
  }
  visit(ast)
  for(const [start,end,value] of edits.sort((a,b)=>b[0]-a[0])) source=source.slice(0,start)+value+source.slice(end)
  const path=file==='src/App.tsx'?'./i18n/Locale':'../i18n/Locale'
  source=`import { useLocale${file==='src/App.tsx'?', LocaleProvider':''} } from '${path}'\n`+source
  const ast2=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  const name=file==='src/App.tsx'?'App':file.split('/').at(-1).replace('.tsx','')
  const fn=ast2.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)
  source=source.slice(0,fn.body.pos+2)+`\n  const { t${file==='src/App.tsx'?', locale, setLocale':''} } = useLocale()\n`+source.slice(fn.body.pos+2)
  if(file==='src/App.tsx') source=source.replace('export default function App()', 'function AppContent()')+'\nexport default function App() { return <LocaleProvider><AppContent /></LocaleProvider> }\n'
  fs.writeFileSync(file,source)
}
fs.writeFileSync('src/i18n/keys.json',JSON.stringify([...keys],null,2))
