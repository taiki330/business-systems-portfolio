"use client";

import { SKILL_TAGS } from "@/lib/constants/options";

type SkillTagPickerProps = {
  disabled?: boolean;
};

export function SkillTagPicker({ disabled = false }: SkillTagPickerProps) {
  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="sr-only">スキルタグ</legend>
      <div className="flex flex-wrap gap-2">
        {SKILL_TAGS.map((tag) => (
          <label
            key={tag}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors has-checked:border-brand-blue has-checked:bg-brand-blue-light has-checked:text-brand-blue has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <input
              type="checkbox"
              name="skill_tags"
              value={tag}
              className="h-4 w-4 rounded border-line text-brand-blue focus:ring-brand-blue"
            />
            {tag}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
