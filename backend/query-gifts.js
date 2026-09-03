const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.gift.findMany({
  orderBy: { sortOrder: 'asc' },
  select: { slug: true, name: true, price: true, category: true, artworkType: true, thumbnailUrl: true, animationUrl: true, isLimited: true, isLegendary: true },
}).then(rows => {
  for (const g of rows) console.log(`${g.slug}|${g.name}|${g.price}|${g.category}|${g.artworkType}|${g.thumbnailUrl || ''}|${g.animationUrl || ''}|limited=${!!g.isLimited}|leg=${!!g.isLegendary}`);
  return db.$disconnect();
}).catch(e => { console.error(e.message); process.exit(1); });