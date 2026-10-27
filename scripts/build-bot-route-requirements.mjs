/** Declara o contrato de execução das rotas atuais; não infere arquétipos em runtime. */
import {readFileSync,writeFileSync} from 'node:fs';
const names=['albaz-strike','herois-lendarios-aesir','herois-lendarios-destiny-hero','herois-lendarios-cavaleiros-fantasmas'];
for(const name of names){
  const path=`src/data/bot-profiles/${name}.json`,p=JSON.parse(readFileSync(path,'utf8'));
  for(const route of p.routes){
    const needs=new Map();
    for(const r of route.requires)needs.set(r.code,(needs.get(r.code)??0)+r.count);
    const use=code=>needs.set(code,Math.max(1,needs.get(code)??0));
    for(const step of route.steps){
      if(step.action)use(step.action.code);for(const code of step.effects)use(code);
      const quantities=new Map();
      for(const target of step.targets){if(step.spend&&target.scope!=='action'&&target.location===2)continue;
        const key=`${target.code}:${target.location}`;quantities.set(key,(quantities.get(key)??0)+1);use(target.code);}
      for(const [key,count]of quantities){const code=Number(key.split(':')[0]);needs.set(code,Math.max(count,needs.get(code)??0));}
    }
    route.deckRequirements={main:[],extra:[]};
    for(const [code,count]of [...needs].sort((a,b)=>a[0]-b[0])){
      const zone=p.deckSnapshot.main.includes(code)?'main':'extra';route.deckRequirements[zone].push({code,count});
    }
    for(const zone of ['main','extra'])for(const r of route.deckRequirements[zone]){
      if(p.deckSnapshot[zone].filter(code=>code===r.code).length<r.count)throw Error(`${name}/${route.id}: requisito impossível ${r.code} × ${r.count}`);
    }
  }
  p.engineRequirements={main:[],extra:[]};
  for(const zone of ['main','extra'])for(const r of p.routes[0].deckRequirements[zone]){
    const counts=p.routes.map(route=>route.deckRequirements[zone].find(other=>other.code===r.code)?.count??0);
    const count=Math.min(...counts);if(count)p.engineRequirements[zone].push({code:r.code,count});
  }
  writeFileSync(path,JSON.stringify(p,null,2)+'\n');
}
console.log('Contratos de quatro motores e suas rotas atualizados');
