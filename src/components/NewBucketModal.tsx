"use client";

import { useAppStore } from "@/lib/store";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";

export default function NewBucketModal() {
  const { newBucketOpen, setNewBucketOpen, editingBucket } = useAppStore();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [examples, setExamples] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEditing = !!editingBucket;

  useEffect(() => {
    if (editingBucket) {
      setName(editingBucket.name);
      setDescription(editingBucket.description);
      setExamples(editingBucket.examples);
    } else {
      setName("");
      setDescription("");
      setExamples("");
    }
    setError("");
  }, [editingBucket, newBucketOpen]);

  if (!newBucketOpen) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url = isEditing ? `/api/buckets/${editingBucket.id}` : "/api/buckets";
      const method = isEditing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          examples: examples.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save bucket");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["buckets"] });
      handleClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setName("");
    setDescription("");
    setExamples("");
    setError("");
    setNewBucketOpen(false);
    useAppStore.setState({ editingBucket: null });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 border border-stone-200">
        <h2 className="text-lg font-semibold text-stone-900 mb-4">
          {isEditing ? "Edit Bucket" : "New Bucket"}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Trading Research"
              className="w-full px-3 py-2.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What kind of emails belong here?"
              rows={2}
              className="w-full px-3 py-2.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none bg-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              Examples
            </label>
            <textarea
              value={examples}
              onChange={(e) => setExamples(e.target.value)}
              placeholder="e.g., emails from bloomberg.com, subjects about market data"
              rows={2}
              className="w-full px-3 py-2.5 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 resize-none bg-white"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={handleClose}
            className="px-4 py-2.5 text-sm text-stone-500 hover:text-stone-700 cursor-pointer focus:outline-none rounded-lg hover:bg-stone-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 cursor-pointer focus:outline-none transition-colors"
          >
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Bucket"}
          </button>
        </div>
      </div>
    </div>
  );
}
