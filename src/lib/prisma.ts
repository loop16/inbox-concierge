console.log("[PRISMA DEBUG] DATABASE_URL exists:", !!process.env.DATABASE_URL);
console.log("[PRISMA DEBUG] DATABASE_URL starts with:", process.env.DATABASE_URL?.slice(0, 30));

import { Pool, neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new Pool({ connectionString });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = new PrismaNeon(pool as any);

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
