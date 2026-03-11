import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);

  // Find users inactive for 24+ hours who still have threads
  const inactiveUsers = await prisma.user.findMany({
    where: {
      OR: [
        { lastActiveAt: { lt: cutoff } },
        { lastActiveAt: null },
      ],
      threads: { some: {} },
    },
    select: { id: true },
  });

  if (inactiveUsers.length === 0) {
    return NextResponse.json({ cleaned: 0, users: 0 });
  }

  const userIds = inactiveUsers.map((u) => u.id);

  const result = await prisma.thread.deleteMany({
    where: { userId: { in: userIds } },
  });

  return NextResponse.json({
    cleaned: result.count,
    users: userIds.length,
  });
}
