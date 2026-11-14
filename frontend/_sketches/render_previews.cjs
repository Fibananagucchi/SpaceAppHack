/** Presentation rendering only. Not a frontend entry point. */
const path = require('node:path');
const sharp = require('sharp');

(async () => {
  const root = __dirname;
  const dirs = ['field-atlas', 'signal-desk', 'evidence-journal'];
  const names = ['main', 'analysis', 'interaction'];
  for (const dir of [...dirs, '_shared']) {
    for (const name of dir === '_shared' ? ['states'] : names) {
      await sharp(path.join(root, dir, name + '.svg')).png().toFile(path.join(root, dir, name + '.png'));
    }
  }
  const thumbs = await Promise.all(dirs.map(async (dir, i) => ({
    input: await sharp(path.join(root, dir, 'main.png')).resize(480, 347).toBuffer(), left: i * 480, top: 44
  })));
  const labels = Buffer.from('<svg width="1440" height="44"><rect width="1440" height="44" fill="#173347"/>' +
    ['A / FIELD ATLAS', 'B / SIGNAL DESK', 'C / EVIDENCE JOURNAL'].map((v, i) =>
      `<text x="${i*480+22}" y="29" font-size="18" font-family="Arial" fill="#F3F0E7">${v}</text>`).join('') + '</svg>');
  await sharp({create:{width:1440,height:391,channels:4,background:'#F3F0E7'}})
    .composite([{input:labels,left:0,top:0},...thumbs]).png().toFile(path.join(root,'comparison.png'));
  console.log('Rendered ten previews and comparison.png.');
})();
