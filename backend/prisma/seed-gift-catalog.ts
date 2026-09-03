import { PrismaClient } from '@prisma/client';
import { initialGiftCatalog } from './gift-catalog.data';

const prisma = new PrismaClient();

export async function seedGiftCatalog() {
  for (const [index, gift] of initialGiftCatalog.entries()) {
    await prisma.gift.upsert({
      where: { slug: gift.slug },
      create: { id: `gift_${gift.slug.replace(/-/g, '_')}`, ...gift, sortOrder: index + 1, isActive: true },
      update: { ...gift, sortOrder: index + 1, isActive: true },
    });
  }
  return prisma.gift.count({ where: { isActive: true } });
}

if (require.main === module) {
  seedGiftCatalog()
    .then(count => console.log(`Seeded ${count} active gifts`))
    .catch(error => { console.error(error); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}