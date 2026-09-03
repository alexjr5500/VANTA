const fs = require('fs');
const s = fs.readFileSync('frontend/src/lib/vanta-gifts.ts', 'utf8');
const blocks = s.split(/^\s*\{\s*$/m).slice(1);
const out = [];
for (const b of blocks) {
  const id = (b.match(/id: "([^"]+)"/) || [])[1];
  const name = (b.match(/name: "([^"]+)"/) || [])[1];
  const price = (b.match(/price: (\d+)/) || [])[1];
  const rarity = (b.match(/rarity: "([^"]+)"/) || [])[1];
  const cat = (b.match(/category: "([^"]+)"/) || [])[1];
  if (id) out.push(`${id}|${name}|${price}|${rarity}|${cat}`);
}
console.log('TOTAL', out.length);
console.log(out.join('\n'));