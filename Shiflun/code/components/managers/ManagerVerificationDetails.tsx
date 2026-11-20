type VerificationDetails = {
  manager_name: string;
  store_name: string;
  manager_comment: string;
  created_at: string;
};

type ManagerVerificationDetailsProps = {
  verification: VerificationDetails;
};

export function formatVerificationDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ManagerVerificationDetails({
  verification,
}: ManagerVerificationDetailsProps) {
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          店舗名
        </dt>
        <dd className="mt-1 font-medium text-ink">
          {verification.store_name}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          店長名
        </dt>
        <dd className="mt-1 font-medium text-ink">
          {verification.manager_name}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          店長コメント
        </dt>
        <dd className="mt-1 leading-relaxed text-ink-soft">
          {verification.manager_comment}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          確認日
        </dt>
        <dd className="mt-1 font-medium text-ink">
          {formatVerificationDate(verification.created_at)}
        </dd>
      </div>
    </dl>
  );
}
