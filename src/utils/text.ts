// ---------------------------------------------------------------------------
// Pure text helpers (word count, page count estimation).
// ---------------------------------------------------------------------------

export function countWords(content: string): number {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, "") // strip code blocks
    .replace(/!\[\[.*?\]\]/g, "") // strip embeds
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

export function calculatePages(words: number, wordsPerPage: number): number {
  return Math.max(1, Math.ceil(words / wordsPerPage));
}
