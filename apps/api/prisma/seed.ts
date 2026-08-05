// Manual-testing seed for the core inventory domain (EVT-2).
//
// NOT run automatically by the api container (see apps/api/Dockerfile — only
// `prisma migrate deploy` runs on start). Run by hand against a running db:
//   pnpm --filter @eventory/api exec prisma db seed
// or, from the repo root:
//   pnpm --filter @eventory/api run seed

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Wipe existing seed data so this script is safely re-runnable.
  await prisma.itemTag.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.item.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.category.deleteMany();
  await prisma.location.deleteMany();

  const garage = await prisma.location.create({
    data: { name: 'Garage', path: 'garage' },
  });
  const westWall = await prisma.location.create({
    data: { name: 'West Wall', path: 'garage.west-wall', parentId: garage.id },
  });
  const cabinet3 = await prisma.location.create({
    data: { name: 'Cabinet 3', path: 'garage.west-wall.cabinet-3', parentId: westWall.id },
  });

  const tools = await prisma.category.create({ data: { name: 'Tools', path: 'tools' } });
  const power = await prisma.category.create({
    data: { name: 'Power Tools', path: 'tools.power', parentId: tools.id },
  });
  const hardware = await prisma.category.create({ data: { name: 'Hardware', path: 'hardware' } });

  const [electricTag, cordlessTag, fastenerTag] = await Promise.all([
    prisma.tag.create({ data: { name: 'electric', color: '#f59e0b' } }),
    prisma.tag.create({ data: { name: 'cordless', color: '#3b82f6' } }),
    prisma.tag.create({ data: { name: 'fastener', color: '#10b981' } }),
  ]);

  const drill = await prisma.item.create({
    data: {
      name: 'Cordless Drill',
      description: 'Bosch 18V cordless drill/driver',
      quantity: 1,
      properties: { brand: 'Bosch', voltage: '18V' },
      locationId: cabinet3.id,
      categoryId: power.id,
      tags: {
        create: [{ tagId: electricTag.id }, { tagId: cordlessTag.id }],
      },
    },
  });

  await prisma.item.create({
    data: {
      name: 'Wood Screws (1.5")',
      description: 'Box of assorted wood screws',
      quantity: 200,
      unit: 'screws',
      properties: { length: '1.5in', material: 'steel' },
      locationId: cabinet3.id,
      categoryId: hardware.id,
      tags: { create: [{ tagId: fastenerTag.id }] },
    },
  });

  await prisma.item.create({
    data: {
      name: 'Extension Cord',
      description: '25ft outdoor-rated extension cord',
      quantity: 2,
      unit: 'cords',
      locationId: westWall.id,
      categoryId: tools.id,
      tags: { create: [{ tagId: electricTag.id }] },
    },
  });

  // A photo for the drill, also set as its primary photo — exercises the
  // circular Item<->Photo relation (AC 2).
  const drillPhoto = await prisma.photo.create({
    data: {
      itemId: drill.id,
      filename: 'cordless-drill.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 245_760,
      width: 1024,
      height: 768,
    },
  });
  await prisma.item.update({
    where: { id: drill.id },
    data: { primaryPhotoId: drillPhoto.id },
  });

  const [locationCount, categoryCount, tagCount, itemCount] = await Promise.all([
    prisma.location.count(),
    prisma.category.count(),
    prisma.tag.count(),
    prisma.item.count(),
  ]);
  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${locationCount} locations, ${categoryCount} categories, ${tagCount} tags, ${itemCount} items.`,
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
