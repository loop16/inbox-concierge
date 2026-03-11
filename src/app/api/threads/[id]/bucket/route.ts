import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { bucketId } = await request.json();

  if (!bucketId) {
    return NextResponse.json({ error: "bucketId is required" }, { status: 400 });
  }

  // Verify the thread belongs to this user
  const thread = await prisma.thread.findFirst({
    where: { id, userId: auth.user.id },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Verify the bucket belongs to this user
  const bucket = await prisma.bucket.findFirst({
    where: { id: bucketId, userId: auth.user.id },
  });

  if (!bucket) {
    return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
  }

  // 1. Update the thread
  await prisma.thread.update({
    where: { id },
    data: {
      bucketId,
      manualOverride: true,
      confidence: 1.0,
      reason: "Manually assigned",
    },
  });

  // 2. Create or update a SenderRule
  const domain = thread.senderEmail.split("@")[1]?.toLowerCase() || null;

  await prisma.senderRule.upsert({
    where: {
      userId_senderEmail: {
        userId: auth.user.id,
        senderEmail: thread.senderEmail,
      },
    },
    update: {
      bucketId,
      senderDomain: domain,
      source: "learned",
    },
    create: {
      userId: auth.user.id,
      senderEmail: thread.senderEmail,
      senderDomain: domain,
      bucketId,
      source: "learned",
    },
  });

  // 3. Count other threads from this sender in a different bucket
  const otherThreadsFromSender = await prisma.thread.count({
    where: {
      userId: auth.user.id,
      senderEmail: thread.senderEmail,
      id: { not: id },
      bucketId: { not: bucketId },
    },
  });

  return NextResponse.json({
    updated: true,
    ruleCreated: true,
    senderEmail: thread.senderEmail,
    bucketName: bucket.name,
    otherThreadsFromSender,
  });
}
