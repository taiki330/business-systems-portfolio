import { redirect } from "next/navigation";

type SearchPageProps = {
  searchParams: Promise<Record<string, string>>;
};

export default async function CompanySearchRedirectPage({
  searchParams,
}: SearchPageProps) {
  const params = await searchParams;
  const query = new URLSearchParams(params).toString();
  redirect(query ? `/companies?${query}` : "/companies");
}
