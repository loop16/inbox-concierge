Read the full project spec in SPEC.md at the project root. That is your source of truth for everything.

PHASE 1: Project scaffold, dependencies, database schema, and seed.

TASKS:
1. Install all dependencies:
   npm install next-auth @prisma/client zustand @tanstack/react-query
   npm install -D prisma
   npx prisma init

2. Set up Prisma with SQLite. Replace prisma/schema.prisma with the exact schema from SPEC.md (Data Model section). Make sure the datasource uses provider = "sqlite" and url = "file:./dev.db".

3. Run: npx prisma db push

4. Create a seed script at prisma/seed.ts that:
   - Takes a userId as argument (or creates a placeholder user)
   - Creates the 8 default buckets from SPEC.md (Action Required, Important, Can Wait, Finance / Receipts, Newsletters, Recruiting / Job, Personal, Auto-Archive)
   - Each bucket has isDefault: true and incrementing sortOrder
   - Is idempotent (skipDuplicates or upsert)

5. Add "prisma": { "seed": "npx tsx prisma/seed.ts" } to package.json. Install tsx as a dev dep.

6. Run the seed: npx prisma db seed

VERIFICATION — run all of these and confirm they pass:
- npx prisma db push runs without errors
- npx prisma db seed runs without errors  
- npx prisma studio launches and shows User, Thread, Bucket tables
- Bucket table has 8 rows
- npm run dev starts without errors on localhost:3000

If all verifications pass, output <promise>PHASE1_DONE</promise>

If something is broken, fix it and re-verify. Do NOT output the promise until everything works.
