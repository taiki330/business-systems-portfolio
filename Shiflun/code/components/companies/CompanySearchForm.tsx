import {
  FormField,
  inputClassName,
} from "@/components/ui/FormField";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SearchParams } from "@/lib/types/search";

type CompanySearchFormProps = {
  defaultValues?: Partial<SearchParams>;
};

export function CompanySearchForm({ defaultValues }: CompanySearchFormProps) {
  return (
    <form method="GET" action="/companies/search" className="flex flex-col gap-4">
      <FormField label="勤務日" htmlFor="work_date" required>
        <input
          id="work_date"
          name="work_date"
          type="date"
          required
          defaultValue={defaultValues?.work_date ?? ""}
          className={inputClassName}
        />
      </FormField>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="開始時間" htmlFor="start_time" required>
          <input
            id="start_time"
            name="start_time"
            type="time"
            required
            defaultValue={defaultValues?.start_time ?? ""}
            className={inputClassName}
          />
        </FormField>

        <FormField label="終了時間" htmlFor="end_time" required>
          <input
            id="end_time"
            name="end_time"
            type="time"
            required
            defaultValue={defaultValues?.end_time ?? ""}
            className={inputClassName}
          />
        </FormField>
      </div>

      <PrimaryButton type="submit" className="bg-ink hover:bg-ink active:bg-black">
        この条件で検索
      </PrimaryButton>
    </form>
  );
}
