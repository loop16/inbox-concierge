import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Pool } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaNeon(pool as unknown as ConstructorParameters<typeof PrismaNeon>[0]);
const prisma = new PrismaClient({ adapter });

const DEFAULT_BUCKETS = [
  { name: "Action Required", sortOrder: 0 },
  { name: "Important", sortOrder: 1 },
  { name: "Can Wait", sortOrder: 2 },
  { name: "Finance / Receipts", sortOrder: 3 },
  { name: "Newsletters", sortOrder: 4 },
  { name: "Recruiting / Job", sortOrder: 5 },
  { name: "Personal", sortOrder: 6 },
  { name: "Auto-Archive", sortOrder: 7 },
];

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "placeholder@seed.local" },
    update: {},
    create: {
      email: "placeholder@seed.local",
      name: "Seed User",
    },
  });

  for (const bucket of DEFAULT_BUCKETS) {
    await prisma.bucket.upsert({
      where: {
        userId_name: { userId: user.id, name: bucket.name },
      },
      update: {},
      create: {
        name: bucket.name,
        isDefault: true,
        sortOrder: bucket.sortOrder,
        userId: user.id,
      },
    });
  }

  console.log(`Seeded ${DEFAULT_BUCKETS.length} default buckets for user ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
