"use client";

import ThreadList from "@/components/ThreadList";
import TopEmails from "@/components/TopEmails";

export default function InboxPage() {
  return (
    <div className="bg-stone-50 min-h-full">
      <TopEmails />
      <ThreadList />
    </div>
  );
}
