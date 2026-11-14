/** Render task-006 review materials only; never a product entry point. */
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

(async () => {
  const root = __dirname;
  const files = (await fs.readdir(root)).filter(f => f.endsWith('.svg'));
  for (const file of files) {
    await sharp(path.join(root,file)).png().toFile(path.join(root,file.replace('.svg','.png')));
  }
  const names=['01-time-aperture','02-counter-directions','03-change-seam','04-request-rail','05-voice'];
  const labels=['01 / TIME APERTURE','02 / COUNTER-DIRECTIONS','03 / CHANGE SEAM','04 / REQUEST RAIL','05 / VOICE'];
  const composites=[];
  for(let i=0;i<names.length;i++) {
    const col=i%2,row=Math.floor(i/2),x=col*720,y=row*490;
    const label=Buffer.from(`<svg width="720" height="40"><rect width="720" height="40" fill="#101E28"/><text x="22" y="28" fill="#F3F1E7" font-family="Arial" font-size="17">${labels[i]}</text></svg>`);
    composites.push({input:label,left:x,top:y});
    composites.push({input:await sharp(path.join(root,names[i]+'.png')).resize(720,450).toBuffer(),left:x,top:y+40});
  }
  const recommendation=Buffer.from('<svg width="720" height="490"><rect width="720" height="490" fill="#101E28"/><path d="M28 28H692" stroke="#3C535F"/><g font-family="Arial" fill="#F3F1E7"><text x="30" y="82" font-size="18">RECOMMENDATION / 01 + 03</text><text x="30" y="166" font-size="49" font-weight="700">Frame the years.</text><text x="30" y="226" font-size="49" font-weight="700">Read the change.</text><text x="30" y="308" font-size="25">+2.5–4 hours of interface work</text><text x="30" y="356" font-size="19">The existing API supplies the evidence.</text><text x="30" y="411" font-size="16" fill="#AFBFC6">Team choice pending / not a working frontend</text></g></svg>');
  composites.push({input:recommendation,left:720,top:980});
  await sharp({create:{width:1440,height:1470,channels:4,background:'#101E28'}})
    .composite(composites).png().toFile(path.join(root,'overview.png'));
  console.log('Rendered six task-006 PNGs and overview.png.');
})();
