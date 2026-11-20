import { Worker } from "@/lib/types/database";

export function normalizeWorker(row: Record<string, unknown>): Worker {
  const skillTags = row.skill_tags;
  return {
    ...(row as Worker),
    skill_tags: Array.isArray(skillTags) ? (skillTags as string[]) : [],
    job_type: (row.job_type as string | null) ?? null,
    preferred_areas: Array.isArray(row.preferred_areas) ? row.preferred_areas as string[] : [],
  };
}
