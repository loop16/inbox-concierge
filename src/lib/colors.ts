const BUCKET_COLORS = [
  { bg: "bg-amber-100", text: "text-amber-800", dot: "bg-amber-500" },
  { bg: "bg-emerald-100", text: "text-emerald-800", dot: "bg-emerald-500" },
  { bg: "bg-sky-100", text: "text-sky-800", dot: "bg-sky-500" },
  { bg: "bg-rose-100", text: "text-rose-800", dot: "bg-rose-500" },
  { bg: "bg-violet-100", text: "text-violet-800", dot: "bg-violet-500" },
  { bg: "bg-teal-100", text: "text-teal-800", dot: "bg-teal-500" },
  { bg: "bg-orange-100", text: "text-orange-800", dot: "bg-orange-500" },
  { bg: "bg-stone-200", text: "text-stone-700", dot: "bg-stone-500" },
];

export function getBucketColor(index: number) {
  return BUCKET_COLORS[index % BUCKET_COLORS.length];
}
