import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { bucketId } = await request.json();

  // Get the source thread
  const thread = await prisma.thread.findFirst({
    where: { id, userId: auth.user.id },
  });

  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  // Move all threads from this sender to the new bucket
  // EXCEPT threads with manualOverride that point to a DIFFERENT bucket
  const result = await prisma.thread.updateMany({
    where: {
      userId: auth.user.id,
      senderEmail: thread.senderEmail,
      id: { not: id },
      OR: [
        { manualOverride: false },
        { manualOverride: true, bucketId },
      ],
    },
    data: {
      bucketId,
      confidence: 0.95,
      reason: `Sender rule: ${thread.senderEmail} → applied by user`,
    },
  });

  return NextResponse.json({ moved: result.count });
}
