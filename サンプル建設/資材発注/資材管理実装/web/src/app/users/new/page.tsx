import { createAppUser } from "@/app/users/actions";
import { RegisterUserForm } from "@/components/users/RegisterUserForm";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import { fetchCenterOptions } from "@/lib/centers/fetch-options";

type PageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewUserPage({ searchParams }: PageProps) {
  const { error } = await searchParams;
  const [sites, centers] = await Promise.all([fetchSiteOptions(), fetchCenterOptions()]);

  return (
    <div className="min-h-full bg-zinc-50">
      <RegisterUserForm
        action={createAppUser}
        sites={sites}
        centers={centers}
        error={error ? decodeURIComponent(error) : undefined}
      />
    </div>
  );
}
