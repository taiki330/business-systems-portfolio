/**
 * Instagram Graph API 自動投稿スクリプト
 *
 * 必要な環境変数:
 *   INSTAGRAM_USER_ID     - Instagram ビジネスアカウントの数字ID
 *   INSTAGRAM_ACCESS_TOKEN - 長期アクセストークン（60日有効）
 */

import { selectPost } from "./content.mjs";

const IG_USER_ID = process.env.INSTAGRAM_USER_ID;
const ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const API_BASE = "https://graph.facebook.com/v19.0";

if (!IG_USER_ID || !ACCESS_TOKEN) {
  console.error("❌ 環境変数 INSTAGRAM_USER_ID と INSTAGRAM_ACCESS_TOKEN を設定してください");
  process.exit(1);
}

async function apiPost(path, params) {
  const url = new URL(`${API_BASE}${path}`);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, access_token: ACCESS_TOKEN }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`API Error: ${JSON.stringify(data.error)}`);
  }
  return data;
}

async function createContainer(imageUrl, caption) {
  console.log("📦 メディアコンテナ作成中...");
  const data = await apiPost(`/${IG_USER_ID}/media`, {
    image_url: imageUrl,
    caption,
  });
  console.log(`✅ コンテナID: ${data.id}`);
  return data.id;
}

async function publishContainer(containerId) {
  console.log("🚀 投稿公開中...");
  const data = await apiPost(`/${IG_USER_ID}/media_publish`, {
    creation_id: containerId,
  });
  console.log(`✅ 投稿完了 ID: ${data.id}`);
  return data.id;
}

async function run() {
  const post = selectPost();
  console.log(`\n📸 今日の投稿を選択しました`);
  console.log(`キャプション冒頭: ${post.caption.slice(0, 30)}...`);

  try {
    const containerId = await createContainer(post.imageUrl, post.caption);

    // Instagram APIの仕様上、コンテナ作成後に少し待つ必要がある
    await new Promise((r) => setTimeout(r, 5000));

    await publishContainer(containerId);
    console.log("\n🎉 Instagram への投稿が完了しました！");
  } catch (err) {
    console.error("\n❌ 投稿失敗:", err.message);
    process.exit(1);
  }
}

run();
