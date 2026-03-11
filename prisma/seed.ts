import { PrismaClient } from "@prisma/client";
import { PrismaNeonHttp } from "@prisma/adapter-neon";

const adapter = new PrismaNeonHttp(process.env.DATABASE_URL!, {});
const prisma = new PrismaClient({ adapter });

const DEFAULT_BUCKETS = [
  { name: "Action Required", sortOrder: 0, description: "Emails requiring a response or action — deadlines, RSVPs, approvals, requests, tasks, sign-ups, verifications", examples: "meeting invites, form submissions, account confirmations, follow-up requests" },
  { name: "Important", sortOrder: 1, description: "High-priority emails from real people — direct messages, time-sensitive updates, significant personal or professional communications", examples: "emails from colleagues, bosses, clients, family, friends, important announcements" },
  { name: "Can Wait", sortOrder: 2, description: "Low-priority but somewhat useful emails — informational updates, notifications that don't need immediate attention", examples: "app notifications, service updates, shipping updates, social media digests" },
  { name: "Finance / Receipts", sortOrder: 3, description: "Financial emails — receipts, invoices, bank statements, payment confirmations, billing, subscriptions, tax documents", examples: "purchase receipts, credit card alerts, PayPal, Venmo, bank notifications, billing statements" },
  { name: "Newsletters", sortOrder: 4, description: "Newsletters, mailing lists, marketing emails, promotional content, blog digests, and subscribed content", examples: "Substack, Morning Brew, marketing emails, promotional offers, weekly digests" },
  { name: "Recruiting / Job", sortOrder: 5, description: "Job-related emails — recruiters, job applications, interview scheduling, LinkedIn messages, career opportunities", examples: "recruiter outreach, application confirmations, interview invites, LinkedIn, job boards" },
  { name: "Personal", sortOrder: 6, description: "Personal and social emails — friends, family, community, events, hobbies, travel plans, non-work conversations", examples: "personal messages, event invitations, travel bookings, social plans, community groups" },
  { name: "Auto-Archive", sortOrder: 7, description: "Automated junk — no-reply emails with no useful info, pure spam, unsubscribe-worthy content, bulk automated messages with no action needed", examples: "noreply@, automated notifications, spam, marketing from unknown senders, terms of service updates" },
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
        description: bucket.description,
        examples: bucket.examples,
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
