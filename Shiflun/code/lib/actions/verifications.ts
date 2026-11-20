"use server";

import { createServerClient } from "@/lib/supabase/server";
import { ManagerVerification, Worker } from "@/lib/types/database";
import { getWorkerById } from "@/lib/actions/workers";
import { requireStore } from "@/lib/auth/session";

export type CreateManagerVerificationState = {
  error?: string;
  success?: boolean;
  verification?: {
    manager_name: string;
    store_name: string;
    manager_comment: string;
    created_at: string;
  };
};

function normalizeVerification(
  row: Record<string, unknown>,
): ManagerVerification {
  return row as ManagerVerification;
}

export async function getManagerVerificationByWorkerId(
  workerId: string,
): Promise<{ verification: ManagerVerification | null; error: string | null }> {
  const supabase = await createServerClient();

  if (!supabase) {
    return {
      verification: null,
      error: null,
    };
  }

  const { data, error } = await supabase
    .from("manager_verifications")
    .select("*")
    .eq("worker_id", workerId)
    .maybeSingle();

  if (error) {
    return { verification: null, error: error.message };
  }

  return {
    verification: data ? normalizeVerification(data) : null,
    error: null,
  };
}

export async function getWorkerWithVerification(
  workerId: string,
): Promise<{
  worker: Worker | null;
  verification: ManagerVerification | null;
  error: string | null;
}> {
  const { worker: workerData, error: workerError } = await getWorkerById(workerId);

  if (workerError) {
    return { worker: null, verification: null, error: workerError };
  }

  if (!workerData) {
    return { worker: null, verification: null, error: null };
  }

  const { verification, error: verificationError } =
    await getManagerVerificationByWorkerId(workerId);

  if (verificationError) {
    return { worker: null, verification: null, error: verificationError };
  }

  return {
    worker: workerData,
    verification,
    error: null,
  };
}

export async function createManagerVerification(
  _prevState: CreateManagerVerificationState,
  formData: FormData,
): Promise<CreateManagerVerificationState> {
  const workerId = String(formData.get("worker_id") ?? "").trim();
  const managerName = String(formData.get("manager_name") ?? "").trim();
  const managerComment = String(formData.get("manager_comment") ?? "").trim();

  if (!workerId) {
    return { error: "ワーカー情報が不正です。" };
  }
  if (!managerName) {
    return { error: "店長名を入力してください。" };
  }
  if (!managerComment) {
    return { error: "店長コメントを入力してください。" };
  }

  // 認証できるのは、ログイン中のオーナーの店舗に所属しているスタッフだけ（RLS でも同じ制限をしている）。
  const { supabase, store, error: authError } = await requireStore();
  if (!supabase) return { error: authError };

  const { data: worker, error: workerError } = await supabase
    .from("workers")
    .select("id, verification_status, current_store_id")
    .eq("id", workerId)
    .maybeSingle();

  if (workerError) {
    return { error: workerError.message };
  }
  if (!worker) {
    return { error: "対象のワーカーが見つかりません。" };
  }
  if (worker.current_store_id !== store.id) {
    return { error: "自店に所属しているスタッフだけを認証できます。" };
  }
  if (worker.verification_status === "verified") {
    return { error: "このスタッフはすでに店長認証済みです。" };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("manager_verifications")
    .insert({
      worker_id: workerId,
      store_id: store.id,
      manager_name: managerName,
      store_name: store.name,
      manager_comment: managerComment,
      verified: true,
    })
    .select("manager_name, store_name, manager_comment, created_at")
    .single();

  if (insertError || !inserted) {
    return {
      error: insertError?.message ?? "認証の保存に失敗しました。",
    };
  }

  // ワーカーの認証状態は、データベースのトリガー（mark_worker_verified）が更新する。

  return {
    success: true,
    verification: {
      manager_name: inserted.manager_name,
      store_name: inserted.store_name,
      manager_comment: inserted.manager_comment,
      created_at: inserted.created_at,
    },
  };
}
