import { updateAppUser } from "@/app/users/actions";
import { EditUserForm } from "@/components/users/EditUserForm";
import { getCurrentUser } from "@/lib/auth/get-current-user";
import { fetchAppUserById } from "@/lib/users/fetch-users";
import { fetchSiteOptions } from "@/lib/sites/fetch-options";
import { fetchCenterOptions } from "@/lib/centers/fetch-options";
import Link from "next/link";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function EditUserPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { error: queryError } = await searchParams;

  const [currentUser, user, sites, centers] = await Promise.all([
    getCurrentUser(),
    fetchAppUserById(id),
    fetchSiteOptions(),
    fetchCenterOptions(),
  ]);

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-6 py-10">
        <p className="text-red-700">対象のユーザーが見つかりません。</p>
        <Link href="/users" className="mt-4 inline-block text-sm text-zinc-600">
          一覧へ戻る
        </Link>
      </div>
    );
  }

  const isSelf = currentUser?.id === id;
  const updateAction = updateAppUser.bind(null, id);

  return (
    <div className="min-h-full bg-zinc-50">
      <EditUserForm
        action={updateAction}
        user={user}
        sites={sites}
        centers={centers}
        isSelf={isSelf}
        error={queryError ? decodeURIComponent(queryError) : undefined}
      />
    </div>
  );
}
