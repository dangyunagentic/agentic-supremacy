/* eslint-disable no-console */
// Seeds: bootstrap admin (from env) + chain rows from the shared profiles.

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { CHAIN_PROFILES } from '@mintbot/shared';

const prisma = new PrismaClient();

async function main() {
  // ── System config singleton ──
  await prisma.systemConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  // ── Chains ──
  for (const profile of Object.values(CHAIN_PROFILES)) {
    await prisma.chain.upsert({
      where: { key: profile.key },
      update: {
        chainId: profile.chainId,
        name: profile.name,
        explorer: profile.explorer,
        nativeSymbol: profile.nativeSymbol,
        publicRpcs: profile.rpc.public,
        seadropAddress: profile.seadropAddress,
      },
      create: {
        key: profile.key,
        chainId: profile.chainId,
        name: profile.name,
        explorer: profile.explorer,
        nativeSymbol: profile.nativeSymbol,
        publicRpcs: profile.rpc.public,
        seadropAddress: profile.seadropAddress,
      },
    });
  }

  // ── Bootstrap admin ──
  const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const password = process.env.ADMIN_PASSWORD ?? 'change-me-admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: {
        email,
        username,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'admin',
      },
    });
    console.log(`Seeded admin ${email}`);
  } else {
    console.log(`Admin ${email} already exists, skipping`);
  }

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
