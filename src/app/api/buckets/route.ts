import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buckets = await prisma.bucket.findMany({
    where: { userId: auth.user.id },
    include: { _count: { select: { threads: true } } },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(buckets);
}

export async function POST(request: NextRequest) {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description, examples } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Bucket name is required" }, { status: 400 });
  }

  const existing = await prisma.bucket.findUnique({
    where: { userId_name: { userId: auth.user.id, name: name.trim() } },
  });
  if (existing) {
    return NextResponse.json({ error: "Bucket already exists" }, { status: 409 });
  }

  const maxSort = await prisma.bucket.aggregate({
    where: { userId: auth.user.id },
    _max: { sortOrder: true },
  });

  const bucket = await prisma.bucket.create({
    data: {
      name: name.trim(),
      description: description || null,
      examples: Array.isArray(examples) ? examples.join(", ") : (examples || null),
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      userId: auth.user.id,
    },
  });

  return NextResponse.json(bucket, { status: 201 });
}

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

export async function DELETE() {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Unlink all threads from buckets
  await prisma.thread.updateMany({
    where: { userId: auth.user.id },
    data: { bucketId: null, confidence: null, reason: null },
  });

  // Delete all buckets
  await prisma.bucket.deleteMany({
    where: { userId: auth.user.id },
  });

  // Recreate defaults
  await prisma.bucket.createMany({
    data: DEFAULT_BUCKETS.map((b) => ({
      ...b,
      isDefault: true,
      userId: auth.user.id,
    })),
  });

  return NextResponse.json({ reset: true });
}
