import {writeFile} from 'node:fs/promises'
const base=process.env.SMARTASS_TEST_URL??'http://127.0.0.1:8787'
const cases=[['dog','en','ka','ძაღლი'],['cat','en','ka','კატა'],['water','en','ka','წყალი'],['Hello, how are you?','en','ka','გამარჯობა'],['The dog is sleeping under the table.','en','ka','ძაღლ'],['გამარჯობა, როგორ ხარ?','ka','en',null],['ხვალ თბილისში მივდივარ.','ka','ru','Тбилиси'],['Сегодня хорошая погода.','ru','ka','ამინდ'],['The meeting is tomorrow at 10:30. Please bring your passport.','en','ka',['10:30','პასპორტ']]]
const results=[]
for(const [text,source,target,expected] of cases){
 const start=Date.now()
 const response=await fetch(`${base}/api/desktop-ai/translate`,{method:'POST',headers:{'Content-Type':'application/json','X-Ostra-Local':'1'},body:JSON.stringify({model:'nllb-200-3.3b',text,source,target}),signal:AbortSignal.timeout(180000)})
 const data=await response.json()
 const result={input:text,source,target,output:data.text,error:data.error,seconds:Math.round((Date.now()-start)/100)/10,passed:response.ok&&typeof data.text==='string'&&(!expected||(Array.isArray(expected)?expected:[expected]).every(term=>data.text.includes(term)))}
 results.push(result);console.log(JSON.stringify(result))
}
await writeFile('docs/translation-evaluation.json',JSON.stringify(results,null,2)+'\n')
if(results.some(row=>!row.passed))process.exitCode=1
