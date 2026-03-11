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
  const body = await request.json();
  const { name, description, examples } = body;

  const bucket = await prisma.bucket.findFirst({
    where: { id, userId: auth.user.id },
  });
  if (!bucket) {
    return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
  }

  if (name && name.trim() !== bucket.name) {
    const existing = await prisma.bucket.findUnique({
      where: { userId_name: { userId: auth.user.id, name: name.trim() } },
    });
    if (existing) {
      return NextResponse.json({ error: "Bucket name already exists" }, { status: 409 });
    }
  }

  const updated = await prisma.bucket.update({
    where: { id },
    data: {
      ...(name ? { name: name.trim() } : {}),
      description: description ?? bucket.description,
      examples: examples ?? bucket.examples,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthSession();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const bucket = await prisma.bucket.findFirst({
    where: { id, userId: auth.user.id },
  });
  if (!bucket) {
    return NextResponse.json({ error: "Bucket not found" }, { status: 404 });
  }

  // Unlink threads from this bucket
  await prisma.thread.updateMany({
    where: { bucketId: id },
    data: { bucketId: null, confidence: null, reason: null },
  });

  await prisma.bucket.delete({ where: { id } });

  return NextResponse.json({ deleted: true });
}
