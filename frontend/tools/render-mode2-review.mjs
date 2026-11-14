// Static component review from real API responses; no generated observations or browser automation.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const runtime=resolve('../data/runtime/codex-mode2-qa'),output=resolve('../reports/013-components.html');
const load=async name=>JSON.parse(await readFile(resolve(runtime,`${name}.json`),'utf8'));
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {Mode2Conclusion,ChangeFeatures,EonetObservation}=await server.ssrLoadModule('/src/Mode2Conclusion.tsx');
  const {Evidence}=await server.ssrLoadModule('/src/AnalysisView.tsx');
  const {TimeSeries}=await server.ssrLoadModule('/src/TimeSeries.tsx');
  const {month}=await server.ssrLoadModule('/src/format.ts');
  const e=React.createElement,sections=[];
  for(const [name,title] of [['precip-artifact','Precipitation'],['et-europe','Evapotranspiration']]){
    const a=await load(`${name}-analysis`),i=await load(`${name}-investigation`);
    if(a.status!=='ok'||i.status!=='complete'||i.analysis_id!==a.analysis_id)throw Error('Real matching responses required');
    const point=a.request.location;
    sections.push(e('section',{key:name,className:'analysis-view review-case'},
      e('p',{className:'eyebrow'},`Real API record / ${month(a.analysis_period.start)} — ${month(a.analysis_period.end)}`),
      e('h2',null,`${title} · ${point.lat}° / ${point.lon}°`),
      e(Evidence,{data:a,mode:'monthly_anomalies'}),
      e(TimeSeries,{plotId:`review-${name}`,points:a.series.points,mode:'monthly_anomalies',unit:a.series.unit}),
      e(Mode2Conclusion,{value:i.conclusion}),e(ChangeFeatures,{value:i.features}),e(EonetObservation,{value:i.eonet}),
      e('p',{className:'field-help'},`Analysis ${a.analysis_id} · Investigation ${i.investigation_id} · ${i.processing_version}`)));
  }
  const tokens=await readFile('src/tokens.css','utf8'),styles=(await readFile('src/styles.css','utf8')).replace("@import url('./tokens.css');",'');
  const body=renderToStaticMarkup(e('main',{className:'review-document'},e('header',null,e('p',{className:'eyebrow'},'SIGNAL DESK / MODE 2'),e('h1',null,'Evidence, with limits.'),e('p',null,'Component review from real API responses. This is not a screenshot. Expand the details below; live requests run in the workspace.')),...sections));
  await writeFile(output,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mode 2 — real component review</title><style>${tokens}\n${styles}\n.review-document{max-width:1000px;margin:auto;padding:30px 24px}.review-document>header p{margin-top:18px;color:var(--muted)}.review-case{margin-top:50px;border-top:1px solid var(--rule);padding-top:26px}.review-case>h2{margin-block:14px}.review-case>.field-help{margin-top:22px}</style></head><body>${body}</body></html>`,'utf8');
  console.log('Saved reports/013-components.html from real matching API responses.');
} finally { await server.close(); }
