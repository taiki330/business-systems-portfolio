const MockData = (() => {
  const forms = [
    // 1. 始業前報告
    { id: '1-1', reportType: '始業前報告', label: '新規入場者の有無', inputType: 'switch', required: true, options: [], sortOrder: 1, meta: { switchLabels: { on: 'あり', off: 'なし' } } },
    { id: '1-2', reportType: '始業前報告', label: '名簿提出', inputType: 'switch', required: true, options: [], sortOrder: 2, meta: { switchLabels: { on: 'あり', off: 'なし' } } },
    { id: '1-3', reportType: '始業前報告', label: '送り出し教育', inputType: 'check', required: false, options: [], sortOrder: 3, showWhen: { questionId: '1-2', equals: 'TRUE' }, meta: { checkLabel: '受講済み' } },
    { id: '1-4', reportType: '始業前報告', label: 'サンプル建設ルール', inputType: 'check', required: false, options: [], sortOrder: 4, showWhen: { questionId: '1-2', equals: 'TRUE' }, meta: { checkLabel: '理解済み' } },
    { id: '1-5', reportType: '始業前報告', label: '当日作業人数', inputType: 'number', required: true, options: [], sortOrder: 5, meta: { unit: '人' }, helperText: '半角数字で入力' },
    { id: '1-6', reportType: '始業前報告', label: '午前作業内容', inputType: 'text', required: true, options: [], sortOrder: 6, placeholder: '例: 3工区足場組' },
    {
      id: '1-6a',
      reportType: '始業前報告',
      label: '作業種別',
      inputType: 'checkbox',
      required: false,
      options: ['各所ダメ回り', '常用作業', '資材搬出入', '片付け', '台風養生'],
      sortOrder: 6.5
    },
    { id: '1-7', reportType: '始業前報告', label: '詰所使用', inputType: 'switch', required: true, options: [], sortOrder: 7, meta: { switchLabels: { on: 'あり', off: 'なし' } } },
    { id: '1-8', reportType: '始業前報告', label: '①親綱設置状況', inputType: 'image_text', required: true, options: [], sortOrder: 8, meta: { textPlaceholder: '未設置時は時間を記入', skipLabel: '該当なし' } },
    { id: '1-9', reportType: '始業前報告', label: '②資材置き場', inputType: 'image', required: true, options: [], sortOrder: 9, meta: { skipLabel: '該当なし' } },
    { id: '1-10', reportType: '始業前報告', label: '③荷揚げ場所', inputType: 'image', required: false, options: [], sortOrder: 10, meta: { skipLabel: '該当なし' } },
    { id: '1-11', reportType: '始業前報告', label: '④避難場所', inputType: 'image', required: false, options: [], sortOrder: 11, meta: { skipLabel: '該当なし' } },
    { id: '1-12', reportType: '始業前報告', label: '⑤梁枠設置状況', inputType: 'image', required: false, options: [], sortOrder: 12, meta: { skipLabel: '該当なし' } },
    { id: '1-13', reportType: '始業前報告', label: '⑥既存物養生', inputType: 'image', required: false, options: [], sortOrder: 13, meta: { skipLabel: '該当なし' } },
    { id: '1-14', reportType: '始業前報告', label: '⑦特殊材の使用状況', inputType: 'image', required: false, options: [], sortOrder: 14, meta: { skipLabel: '該当なし' } },

    // 2. 午後報告
    { id: '2-1', reportType: '午後報告', label: '午後作業内容', inputType: 'text', required: true, options: [], sortOrder: 1, placeholder: '例: 3工区足場組' },
    {
      id: '2-1a',
      reportType: '午後報告',
      label: '作業種別',
      inputType: 'checkbox',
      required: false,
      options: ['各所ダメ回り', '常用作業', '資材搬出入', '片付け', '台風養生'],
      sortOrder: 1.1
    },
    { id: '2-2', reportType: '午後報告', label: '問題事項(午前)', inputType: 'switch', required: true, options: [], sortOrder: 2, meta: { switchLabels: { on: 'あり', off: 'なし' } } },
    { id: '2-2-sub', reportType: '午後報告', label: '問題の詳細', inputType: 'check_text_group', required: true, options: ['事故', 'クレーム', 'その他'], sortOrder: 2.1, showWhen: { questionId: '2-2', equals: 'TRUE' } },
    { id: '2-3', reportType: '午後報告', label: '進捗状況(全体)', inputType: 'slider', required: true, options: [], sortOrder: 3, meta: { min: 0, max: 100, default: 50 } },
    { id: '2-4', reportType: '午後報告', label: '工区番号', inputType: 'select', required: true, options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], sortOrder: 4, placeholder: '工区を選択' },
    { id: '2-5', reportType: '午後報告', label: '進捗状況(各工区)', inputType: 'slider', required: true, options: [], sortOrder: 5, meta: { min: 0, max: 100, default: 50 } },
    { id: '2-6', reportType: '午後報告', label: '①親綱', inputType: 'image', required: false, options: [], sortOrder: 6, meta: { skipLabel: '該当なし' } },
    { id: '2-7', reportType: '午後報告', label: '②資材置き場', inputType: 'image', required: false, options: [], sortOrder: 7, meta: { skipLabel: '該当なし' } },
    { id: '2-8', reportType: '午後報告', label: '③荷揚げ場所', inputType: 'image', required: false, options: [], sortOrder: 8, meta: { skipLabel: '該当なし' } },
    { id: '2-9', reportType: '午後報告', label: '④避難場所', inputType: 'image', required: false, options: [], sortOrder: 9, meta: { skipLabel: '該当なし' } },
    { id: '2-10', reportType: '午後報告', label: '⑤足場の外観', inputType: 'image', required: false, options: [], sortOrder: 10, meta: { skipLabel: '該当なし' } },
    { id: '2-11', reportType: '午後報告', label: '⑥梁枠', inputType: 'image', required: false, options: [], sortOrder: 11, meta: { skipLabel: '該当なし' } },
    { id: '2-12', reportType: '午後報告', label: '⑦既存物養生', inputType: 'image', required: false, options: [], sortOrder: 12, meta: { skipLabel: '該当なし' } },
    { id: '2-13', reportType: '午後報告', label: '⑧特殊材', inputType: 'image', required: false, options: [], sortOrder: 13, meta: { skipLabel: '該当なし' } },
    { id: '2-14', reportType: '午後報告', label: '⑨詰所', inputType: 'image', required: false, options: [], sortOrder: 14, meta: { skipLabel: '該当なし' } },

    // 3. 終業前報告
    { id: '3-1', reportType: '終業前報告', label: '問題事項(午後)', inputType: 'switch', required: false, options: [], sortOrder: 1, meta: { switchLabels: { on: 'あり', off: 'なし' } } },
    { id: '3-1-sub', reportType: '終業前報告', label: '問題の詳細', inputType: 'check_text_group', required: false, options: ['事故', 'クレーム', 'その他'], sortOrder: 1.1, showWhen: { questionId: '3-1', equals: 'TRUE' } },
    { id: '3-2', reportType: '終業前報告', label: '翌日作業内容', inputType: 'text', required: false, options: [], sortOrder: 2, placeholder: '例: 3工区足場組' },
    {
      id: '3-2a',
      reportType: '終業前報告',
      label: '作業種別',
      inputType: 'checkbox',
      required: false,
      options: ['各所ダメ回り', '常用作業', '資材搬出入', '片付け', '台風養生'],
      sortOrder: 2.1
    },
    { id: '3-3', reportType: '終業前報告', label: '進捗状況(全体)', inputType: 'slider', required: false, options: [], sortOrder: 3, meta: { min: 0, max: 100, default: 50 } },
    { id: '3-4', reportType: '終業前報告', label: '工区番号', inputType: 'select', required: false, options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], sortOrder: 4, placeholder: '工区を選択' },
    { id: '3-5', reportType: '終業前報告', label: '進捗状況(各工区)', inputType: 'slider', required: false, options: [], sortOrder: 5, meta: { min: 0, max: 100, default: 50 } },
    { id: '3-6', reportType: '終業前報告', label: '①親綱', inputType: 'image', required: false, options: [], sortOrder: 6, meta: { skipLabel: '該当なし' } },
    { id: '3-7', reportType: '終業前報告', label: '②資材置き場', inputType: 'image', required: false, options: [], sortOrder: 7, meta: { skipLabel: '該当なし' } },
    { id: '3-8', reportType: '終業前報告', label: '③荷揚げ場所', inputType: 'image', required: false, options: [], sortOrder: 8, meta: { skipLabel: '該当なし' } },
    { id: '3-9', reportType: '終業前報告', label: '④避難場所', inputType: 'image', required: false, options: [], sortOrder: 9, meta: { skipLabel: '該当なし' } },
    { id: '3-10', reportType: '終業前報告', label: '⑤足場の外観', inputType: 'image', required: false, options: [], sortOrder: 10, meta: { skipLabel: '該当なし' } },
    { id: '3-11', reportType: '終業前報告', label: '⑥梁枠', inputType: 'image', required: false, options: [], sortOrder: 11, meta: { skipLabel: '該当なし' } },
    { id: '3-12', reportType: '終業前報告', label: '⑦既存物養生', inputType: 'image', required: false, options: [], sortOrder: 12, meta: { skipLabel: '該当なし' } },
    { id: '3-13', reportType: '終業前報告', label: '⑧特殊材', inputType: 'image', required: false, options: [], sortOrder: 13, meta: { skipLabel: '該当なし' } },
    { id: '3-14', reportType: '終業前報告', label: '⑨詰所', inputType: 'image', required: false, options: [], sortOrder: 14, meta: { skipLabel: '該当なし' } },

    // 4. 中間報告
    { id: '4-1', reportType: '中間報告', label: '①安全設備', inputType: 'image', required: false, options: [], sortOrder: 1, meta: { skipLabel: '該当なし' } },
    { id: '4-2', reportType: '中間報告', label: '②資材置き場', inputType: 'image', required: false, options: [], sortOrder: 2, meta: { skipLabel: '該当なし' } },
    { id: '4-3', reportType: '中間報告', label: '③荷揚げ場所', inputType: 'image', required: false, options: [], sortOrder: 3, meta: { skipLabel: '該当なし' } },
    { id: '4-4', reportType: '中間報告', label: '④避難場所', inputType: 'image', required: false, options: [], sortOrder: 4, meta: { skipLabel: '該当なし' } },
    { id: '4-5', reportType: '中間報告', label: '⑤梁枠', inputType: 'image', required: false, options: [], sortOrder: 5, meta: { skipLabel: '該当なし' } },
    { id: '4-6', reportType: '中間報告', label: '⑥既存物養生', inputType: 'image', required: false, options: [], sortOrder: 6, meta: { skipLabel: '該当なし' } },
    { id: '4-7', reportType: '中間報告', label: '⑦特殊材', inputType: 'image', required: false, options: [], sortOrder: 7, meta: { skipLabel: '該当なし' } }
  ];

  const sites = [
    { id: 'SITE-001', name: '〇〇団地', driveFolderId: '', status: 'active' },
    { id: 'SITE-002', name: '△△マンション', driveFolderId: '', status: 'active' }
  ];

  const workers = [
    { id: 'W-001', name: '佐藤 太郎', siteId: 'SITE-001', position: '班長', status: 'active' },
    { id: 'W-002', name: '鈴木 次郎', siteId: 'SITE-001', position: '', status: 'active' },
    { id: 'W-003', name: '田中 三郎', siteId: 'SITE-002', position: '', status: 'active' }
  ];

  const contractors = [
    { contractor: 'サンプル工業A', subcontractor: 'サンプル施工10' },
    { contractor: 'サンプル工業A', subcontractor: 'サンプル施工7' },
    { contractor: 'サンプル工業B', subcontractor: '' },
    { contractor: 'サンプル工業C', subcontractor: 'サンプル施工8' },
    { contractor: 'サンプル工業C', subcontractor: 'サンプル施工9' }
  ];

  return Object.freeze({
    version: 1,
    updatedAt: 'mock-mode',
    forms,
    sites,
    workers,
    contractors
  });
})();
