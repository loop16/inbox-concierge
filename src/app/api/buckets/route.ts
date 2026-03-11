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
      examples: examples || null,
      sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      userId: auth.user.id,
    },
  });

  return NextResponse.json(bucket, { status: 201 });
}

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
