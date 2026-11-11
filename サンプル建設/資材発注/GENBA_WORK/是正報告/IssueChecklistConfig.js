/**
 * 是正事項チェックリスト定義
 * ソース: 是正事項一覧.pdf（自主安全パトロール）
 * - 即報告: 2項目
 * - 是正: 31項目
 * - 注意: 7項目
 *
 * 指摘項目IDは項目名ごとに固定（既存ログとの互換のためID文字列は変更しない）
 */
const ISSUE_CHECKLIST_CONFIG = Object.freeze({
  sourceDocument: '是正事項一覧.pdf',
  kinds: Object.freeze(['即報告', '是正', '注意']),
  otherItemIds: Object.freeze({
    '即報告': 'OTHER_IMM',
    '是正': 'OTHER_COR',
    '注意': 'OTHER_NOT'
  }),
  items: Object.freeze([
    { id: 'IMM_001', kind: '即報告', label: '安全帯の未使用' },
    { id: 'COR_001', kind: '即報告', label: '親綱未設置' },

    { id: 'IMM_002', kind: '是正', label: '安全帯を手摺材に緊結' },
    { id: 'COR_002', kind: '是正', label: '資材養生不足' },
    { id: 'IMM_003', kind: '是正', label: '一人取り込み荷受け作業' },
    { id: 'COR_003', kind: '是正', label: 'メッシュシート設置不足' },
    { id: 'IMM_004', kind: '是正', label: '吊り荷の混載' },
    { id: 'COR_004', kind: '是正', label: '足元開口の終い不足' },
    { id: 'IMM_005', kind: '是正', label: '玉掛け方法が不適切' },
    { id: 'COR_005', kind: '是正', label: 'アンチ番線固定不足' },
    { id: 'IMM_006', kind: '是正', label: 'ツールキーパー未使用' },
    { id: 'COR_006', kind: '是正', label: '壁つなぎ未設置' },
    { id: 'IMM_007', kind: '是正', label: '蓋つき電工袋を使用していない' },
    { id: 'COR_007', kind: '是正', label: '侵入防止対策不足' },
    { id: 'IMM_008', kind: '是正', label: '使用工具の落下防止対策がされていない' },
    { id: 'COR_008', kind: '是正', label: 'シートで養生' },
    { id: 'IMM_009', kind: '是正', label: '足場資材立てかけ' },
    { id: 'COR_009', kind: '是正', label: '安全区画不足' },
    { id: 'IMM_010', kind: '是正', label: '足場資材直置き' },
    { id: 'COR_010', kind: '是正', label: '昇降階段の終い不足' },
    { id: 'IMM_011', kind: '是正', label: '端部ストッパー手摺設置不足' },
    { id: 'COR_011', kind: '是正', label: '跳ね出し足場未設置' },
    { id: 'IMM_012', kind: '是正', label: '足場上にアンチ立て掛け' },
    { id: 'COR_012', kind: '是正', label: 'コンパネ養生未設置' },
    { id: 'IMM_013', kind: '是正', label: '親綱の設置高さが低い' },
    { id: 'COR_013', kind: '是正', label: '不要材を放置' },
    { id: 'IMM_014', kind: '是正', label: '避難場所未設置' },
    { id: 'COR_014', kind: '是正', label: 'アンカーがデベソ' },
    { id: 'IMM_015', kind: '是正', label: '巾木未設置' },
    { id: 'COR_015', kind: '是正', label: '火打ちを手摺に取付け' },
    { id: 'COR_016', kind: '是正', label: 'シート紐結束不足' },
    { id: 'IMM_017', kind: '是正', label: 'ジャッキ釘未使用' },
    { id: 'COR_017', kind: '是正', label: '補強不足' },

    { id: 'NOT_001', kind: '注意', label: '腕章またはベスト未着用' },
    { id: 'NOT_002', kind: '注意', label: 'トラックのダッシュボード、清掃不足' },
    { id: 'NOT_003', kind: '注意', label: 'ヘルメット未着用' },
    { id: 'NOT_004', kind: '注意', label: '番線回収不足' },
    { id: 'NOT_005', kind: '注意', label: '作業時、袖まくり' },
    { id: 'NOT_006', kind: '注意', label: '足場上、整理不足' },
    { id: 'NOT_007', kind: '注意', label: '詰所の整理不足' }
  ])
});

/**
 * @return {{ kinds: string[], items: { id: string, kind: string, label: string }[], otherItemIds: Object }}
 */
function getIssueChecklistBootstrap() {
  return {
    kinds: ISSUE_CHECKLIST_CONFIG.kinds.slice(),
    items: ISSUE_CHECKLIST_CONFIG.items.map(function(item) {
      return { id: item.id, kind: item.kind, label: item.label };
    }),
    otherItemIds: Object.assign({}, ISSUE_CHECKLIST_CONFIG.otherItemIds)
  };
}

/**
 * @param {string} itemId
 * @return {{ id: string, kind: string, label: string }|null}
 */
function getIssueItemById(itemId) {
  const id = String(itemId || '').trim();
  if (!id) return null;
  const found = ISSUE_CHECKLIST_CONFIG.items.find(function(item) {
    return item.id === id;
  });
  return found ? { id: found.id, kind: found.kind, label: found.label } : null;
}

/**
 * @param {string} kind
 * @return {boolean}
 */
function isValidIssueKind(kind) {
  return ISSUE_CHECKLIST_CONFIG.kinds.indexOf(String(kind || '').trim()) >= 0;
}

/**
 * @param {string} kind
 * @return {string}
 */
function getOtherIssueItemId(kind) {
  const k = String(kind || '').trim();
  return ISSUE_CHECKLIST_CONFIG.otherItemIds[k] || ('OTHER_' + k);
}
