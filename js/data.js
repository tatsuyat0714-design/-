'use strict';
// ===== 属性 =====
// 火 → 林 → 風 → 山 → 火（矢印の先に強い）
const ELEMENTS = {
  fire:  { jp: '火', color: '#ff5a3c', beats: 'wood' },
  wood:  { jp: '林', color: '#4ade80', beats: 'wind' },
  wind:  { jp: '風', color: '#38bdf8', beats: 'earth' },
  earth: { jp: '山', color: '#e0a83a', beats: 'fire' },
};
const ELEMENT_KEYS = ['fire', 'wind', 'wood', 'earth'];

// ===== 必殺技 =====
const MOVE_TYPES = {
  shoot:   { jp: 'シュート', powers: [30, 45, 62, 80, 100], tp: [10, 18, 28, 40, 55] },
  dribble: { jp: 'ドリブル', powers: [25, 42, 60, 78],      tp: [8, 15, 24, 34] },
  block:   { jp: 'ブロック', powers: [25, 42, 60, 78],      tp: [8, 15, 24, 34] },
  catch:   { jp: 'キャッチ', powers: [30, 45, 62, 80, 100], tp: [10, 18, 28, 40, 55] },
};

const MOVE_NAMES = {
  shoot: {
    fire:  ['フレイムショット', '紅蓮スパイラル', '爆炎メテオ', '煉獄フェニックス', 'ラグナロクブレイク'],
    wind:  ['ウインドカッター', '疾風ブレード', '天翔サイクロン', '神風ストーム', 'ギャラクシーノヴァ'],
    wood:  ['リーフシュート', '大樹キャノン', '森羅スパイク', '世界樹ブラスト', 'ユグドラシル・レイ'],
    earth: ['ロックシュート', '岩砕インパクト', '大地クエイク', '天変ガイアノヴァ', 'オメガ・ガイア'],
  },
  dribble: {
    fire:  ['ヒートステップ', '炎舞フェイント', '陽炎ミラージュ', '紅焔ダンス'],
    wind:  ['疾風ダッシュ', '残像ステップ', '旋風ファントム', '神速ゼロ'],
    wood:  ['リーフダンス', '木霊フェイント', '森の迷宮', '幻想樹海'],
    earth: ['ローリングロック', '大地ローリング', '地裂ブレイク', 'グランドスライド'],
  },
  block: {
    fire:  ['ファイアタックル', '炎陣ガード', '灼熱ウォール', 'フレアプリズン'],
    wind:  ['ウインドカット', '疾風スナッチ', '竜巻ディフェンス', 'テンペストウォール'],
    wood:  ['ツタからめ', '森羅スナッチ', '樹海の檻', 'ユグドラ・バインド'],
    earth: ['ストーンウォール', 'アースウォール', '大山脈ガード', 'ギガントウォール'],
  },
  catch: {
    fire:  ['ヒートハンド', '火炎キャッチ', '烈火の拳', '不死鳥の掌', 'フェニックス・ゲート'],
    wind:  ['エアキャッチ', '旋風キーパー', '大竜巻ハンド', '天空の守護神', 'スカイ・サンクチュアリ'],
    wood:  ['リーフキャッチ', '大樹の盾', '森羅の手', '神樹の守護神', 'エデンの守護神'],
    earth: ['ロックハンド', '鉄壁ハンド', '大地の壁', '無限の城壁', 'グランドキャッスル'],
  },
};

const MOVES = {};
for (const type of Object.keys(MOVE_NAMES)) {
  for (const el of ELEMENT_KEYS) {
    MOVE_NAMES[type][el].forEach((name, i) => {
      const tier = i + 1;
      const id = `${type}_${el}_${tier}`;
      MOVES[id] = { id, name, type, element: el, tier, power: MOVE_TYPES[type].powers[i], tp: MOVE_TYPES[type].tp[i] };
    });
  }
}

// 技の熟練度（使用回数で進化）
const MOVE_RANKS = [
  { min: 0,  label: '',   mult: 1.0 },
  { min: 5,  label: '改', mult: 1.1 },
  { min: 15, label: '真', mult: 1.2 },
];

// ===== ポジション別の基礎能力と成長率 =====
const POS_BASE = {
  GK: { kick: 18, guard: 25, body: 28, control: 18, speed: 20, catch: 32 },
  DF: { kick: 22, guard: 32, body: 30, control: 22, speed: 24, catch: 8 },
  MF: { kick: 26, guard: 24, body: 24, control: 32, speed: 28, catch: 8 },
  FW: { kick: 34, guard: 18, body: 24, control: 28, speed: 30, catch: 8 },
};
const POS_GROWTH = {
  GK: { kick: 0.8, guard: 1.2, body: 1.5, control: 0.8, speed: 1.0, catch: 2.4 },
  DF: { kick: 1.0, guard: 2.2, body: 1.8, control: 1.0, speed: 1.3, catch: 0.2 },
  MF: { kick: 1.4, guard: 1.3, body: 1.2, control: 2.2, speed: 1.6, catch: 0.2 },
  FW: { kick: 2.4, guard: 0.8, body: 1.2, control: 1.6, speed: 1.6, catch: 0.2 },
};
const STAT_LABELS = { kick: 'キック', guard: 'ガード', body: 'ボディ', control: 'コントロール', speed: 'スピード', catch: 'キャッチ', tp: 'TP' };

// レベルで習得する技（[レベル, 種類, ティア]）
const LEARNSETS = {
  FW: [[1, 'shoot', 1], [6, 'dribble', 1], [14, 'shoot', 2], [24, 'dribble', 2], [30, 'shoot', 3], [38, 'dribble', 3], [44, 'shoot', 4]],
  MF: [[1, 'dribble', 1], [8, 'block', 1], [12, 'shoot', 1], [18, 'dribble', 2], [28, 'shoot', 2], [36, 'dribble', 3], [42, 'block', 2], [50, 'shoot', 3]],
  DF: [[1, 'block', 1], [16, 'block', 2], [20, 'dribble', 1], [32, 'block', 3], [46, 'block', 4]],
  GK: [[1, 'catch', 1], [14, 'catch', 2], [28, 'catch', 3], [42, 'catch', 4]],
};

// ===== フォーメーション（自陣ゴール x=0 → 敵陣ゴール x=100, 幅 y=0..64） =====
const FORMATIONS = {
  '4-4-2': [
    ['GK', 5, 32],
    ['DF', 20, 10], ['DF', 18, 25], ['DF', 18, 39], ['DF', 20, 54],
    ['MF', 40, 12], ['MF', 38, 26], ['MF', 38, 38], ['MF', 40, 52],
    ['FW', 58, 24], ['FW', 58, 40],
  ],
  '4-3-3': [
    ['GK', 5, 32],
    ['DF', 20, 10], ['DF', 18, 25], ['DF', 18, 39], ['DF', 20, 54],
    ['MF', 38, 18], ['MF', 36, 32], ['MF', 38, 46],
    ['FW', 58, 12], ['FW', 60, 32], ['FW', 58, 52],
  ],
  '3-5-2': [
    ['GK', 5, 32],
    ['DF', 18, 18], ['DF', 17, 32], ['DF', 18, 46],
    ['MF', 36, 8], ['MF', 38, 22], ['MF', 34, 32], ['MF', 38, 42], ['MF', 36, 56],
    ['FW', 58, 24], ['FW', 58, 40],
  ],
  '5-3-2': [
    ['GK', 5, 32],
    ['DF', 22, 6], ['DF', 18, 19], ['DF', 16, 32], ['DF', 18, 45], ['DF', 22, 58],
    ['MF', 38, 18], ['MF', 36, 32], ['MF', 38, 46],
    ['FW', 56, 24], ['FW', 56, 40],
  ],
};

// ===== 名前 =====
const JP_SURNAMES = ['佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '山本', '中村', '小林', '加藤', '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '斎藤', '清水', '山崎', '池田', '橋本', '阿部', '石川', '前田', '藤田', '小川', '岡田', '後藤', '長谷川', '村上', '近藤', '石井', '坂本', '遠藤', '青木', '藤井', '西村', '福田', '太田', '三浦', '藤原', '岡本', '松田', '中川', '原田', '小野', '竹内', '金子', '和田', '中山', '森田', '柴田', '酒井', '工藤', '横山', '宮崎', '宮本', '内田', '高木', '安藤', '谷口', '大野', '丸山', '今井', '河野', '武田', '上野', '杉山', '平野', '久保', '松井', '桜井', '野口', '木下', '菊地', '大西', '新井', '浜田', '市川', '水野', '小松', '島田', '古川', '黒田', '鬼塚', '龍崎', '神楽', '不動', '霧島', '雷堂', '氷室', '剣崎', '黒崎', '白銀', '轟', '鳳', '獅堂', '影山'];
const JP_GIVEN = ['翔', '蓮', '陽翔', '湊', '大和', '悠真', '蒼', '樹', '颯', '律', '瑛太', '隼', '剛', '猛', '拓海', '健太', '誠', '大輔', '翼', '勇気', '迅', '光', '輝', '修', '隆', '竜也', '一真', '海斗', '零', '響', '司', '圭', '快', '昴', '凌', '航', '陸', '空', '楓', '奏', '進', '烈', '鋼', '雅', '虎太郎', '壮真', '晴', '大地'];
const FOREIGN_FIRST = ['レオ', 'マルコ', 'ルイス', 'ディエゴ', 'アレックス', 'カイ', 'ミハイル', 'ジャン', 'ハンス', 'エリック', 'ラファエル', 'アンドレ', 'ニコ', 'ヴィクトル', 'セルジオ', 'パブロ', 'ルカ', 'オスカー', 'イヴァン', 'マテオ', 'ノア', 'リアム', 'エンツォ', 'アドリアン', 'クリス', 'ダニエル', 'フェリペ', 'ゼイン', 'ユーリ', 'アーサー'];
const FOREIGN_LAST = ['ロッシ', 'シルバ', 'ガルシア', 'ミュラー', 'ベルナール', 'イワノフ', 'スミス', 'ハンセン', 'ロペス', 'サントス', 'ベルク', 'オコンクォ', 'カーン', 'モレッティ', 'ヴァルガス', 'フォスター', 'ノヴァク', 'クライン', 'デュボワ', 'ペトロフ', 'オリヴェイラ', 'ブラウン', 'ラーセン', 'コスタ', 'ベッカー'];

// ===== 初期メンバー =====
const STARTING_MEMBERS = [
  { name: '守山 大地', pos: 'GK', element: 'earth', level: 5, talent: 1.1, learnExtra: [[50, 'catch_earth_5']] },
  { name: '岩城 剛',   pos: 'DF', element: 'earth', level: 4 },
  { name: '風間 涼',   pos: 'DF', element: 'wind',  level: 4 },
  { name: '鉄 守',     pos: 'DF', element: 'earth', level: 3 },
  { name: '森 葉月',   pos: 'DF', element: 'wood',  level: 4 },
  { name: '早瀬 疾人', pos: 'MF', element: 'wind',  level: 5, talent: 1.05 },
  { name: '緑川 樹',   pos: 'MF', element: 'wood',  level: 4 },
  { name: '赤坂 炎',   pos: 'MF', element: 'fire',  level: 4 },
  { name: '空野 蒼',   pos: 'MF', element: 'wind',  level: 3 },
  { name: '天城 翔',   pos: 'FW', element: 'fire',  level: 6, talent: 1.15, captain: true, learnExtra: [[48, 'shoot_fire_5']] },
  { name: '嵐山 迅',   pos: 'FW', element: 'wind',  level: 5, talent: 1.05 },
  { name: '小石 拓',   pos: 'DF', element: 'earth', level: 2 },
  { name: '若葉 蓮',   pos: 'MF', element: 'wood',  level: 2 },
];

// ===== 大会 =====
// ace: { pos, name, element, lvBonus, learnExtra }
const STAGES = [
  {
    id: 'regional', name: '地区予選', reward: 3000, days: 5, firstDays: 7,
    matches: [
      { round: '1回戦', team: { id: 'kagero', name: '陽炎中', color: '#f97316', element: 'fire', lv: 8, formation: '4-4-2',
        ace: { pos: 'FW', name: '炎堂 烈', element: 'fire', lvBonus: 2 }, quote: '俺たちの炎、止められるもんなら止めてみな！' } },
      { round: '準決勝', team: { id: 'kazami', name: '風見ヶ丘中', color: '#0ea5e9', element: 'wind', lv: 13, formation: '4-3-3',
        ace: { pos: 'MF', name: '風祭 颯', element: 'wind', lvBonus: 3 }, quote: '風より速く、誰にも追いつかせない。' } },
      { round: '決勝', team: { id: 'shirasagi', name: '白鷺学園', color: '#e5e7eb', element: 'earth', lv: 18, formation: '5-3-2',
        ace: { pos: 'GK', name: '城ヶ崎 巌', element: 'earth', lvBonus: 4 }, quote: '我がゴールは鉄壁。一点も許さん。' } },
    ],
  },
  {
    id: 'national', name: '全国大会 ジャパンカップ', reward: 6000, days: 5, firstDays: 6,
    matches: [
      { round: '1回戦', team: { id: 'umenari', name: '海鳴中', color: '#22d3ee', element: 'wind', lv: 22, formation: '4-4-2',
        ace: { pos: 'FW', name: '潮見 凪', element: 'wind', lvBonus: 3 }, quote: '大波のような攻撃、受け止められるかな？' } },
      { round: '2回戦', team: { id: 'kokuryu', name: '黒竜学園', color: '#7f1d1d', element: 'fire', lv: 27, formation: '4-3-3',
        ace: { pos: 'FW', name: '龍崎 焔', element: 'fire', lvBonus: 4 }, quote: '黒き竜の炎で、すべてを焼き尽くす！' } },
      { round: '準決勝', team: { id: 'shinra', name: '森羅学院', color: '#15803d', element: 'wood', lv: 31, formation: '3-5-2',
        ace: { pos: 'MF', name: '翠川 森羅', element: 'wood', lvBonus: 4 }, quote: '森の迷宮から抜け出せた者はいない。' } },
      { round: '決勝', team: { id: 'teio', name: '帝王学園', color: '#a855f7', element: 'earth', lv: 35, formation: '4-4-2',
        ace: { pos: 'FW', name: '皇 王牙', element: 'earth', lvBonus: 5 }, quote: '40年無敗の帝王学園。お前たちも歴史の踏み台だ。' } },
    ],
  },
  {
    id: 'world', name: '世界大会 ギャラクシーカップ', reward: 10000, days: 5, firstDays: 8,
    groupSize: 3,
    matches: [
      { round: 'グループ第1節', group: true, team: { id: 'arcadia', name: 'ブレイズ・アルカディア', color: '#dc2626', element: 'fire', lv: 38, formation: '4-3-3', foreign: true,
        ace: { pos: 'FW', name: 'ディエゴ・ロッシ', element: 'fire', lvBonus: 4 }, quote: 'ハポンの少年たち、情熱のサッカーを見せてやる！' } },
      { round: 'グループ第2節', group: true, team: { id: 'frost', name: 'ノーザン・フロスト', color: '#93c5fd', element: 'wind', lv: 41, formation: '5-3-2', foreign: true,
        ace: { pos: 'GK', name: 'ミハイル・イワノフ', element: 'wind', lvBonus: 5 }, quote: '凍てつく守りの前に、君たちのシュートは届かない。' } },
      { round: 'グループ第3節', group: true, team: { id: 'sahara', name: 'デザート・ライオンズ', color: '#eab308', element: 'earth', lv: 44, formation: '4-4-2', foreign: true,
        ace: { pos: 'MF', name: 'ゼイン・カーン', element: 'earth', lvBonus: 5 }, quote: '砂漠の王者の誇りにかけて、負けはしない。' } },
      { round: '準々決勝', team: { id: 'amazonia', name: 'アマゾニア・ジャガーズ', color: '#16a34a', element: 'wood', lv: 48, formation: '4-3-3', foreign: true,
        ace: { pos: 'FW', name: 'フェリペ・サントス', element: 'wood', lvBonus: 5 }, quote: 'ジャングルの野生、君たちに見切れるかな？' } },
      { round: '準決勝', team: { id: 'valkyrie', name: 'ヴァルキュリア・ナイツ', color: '#f8fafc', element: 'wind', lv: 52, formation: '3-5-2', foreign: true,
        ace: { pos: 'MF', name: 'ルカ・ハンセン', element: 'wind', lvBonus: 5, learnExtra: [[50, 'dribble_wind_4']] }, quote: '戦乙女の加護は我らにあり。' } },
      { round: '決勝', team: { id: 'galaxy', name: 'ギャラクシー・オーダー', color: '#6366f1', element: 'wind', lv: 57, formation: '4-3-3', foreign: true, talent: 1.08,
        ace: { pos: 'FW', name: 'ゼノ', element: 'wind', lvBonus: 6, learnExtra: [[50, 'shoot_wind_5']] },
        ace2: { pos: 'GK', name: 'オメガ', element: 'earth', lvBonus: 6, learnExtra: [[50, 'catch_earth_5']] },
        quote: '超次元サッカーの頂点…それは我々ギャラクシー・オーダーのものだ。' } },
    ],
  },
];

// 世界大会グループの4チーム目（他会場で試合）
const GROUP_OTHERS_ORDER = ['arcadia', 'frost', 'sahara'];

const TRAININGS = {
  shoot:    { name: 'シュート練習', icon: '⚽', desc: 'キックが大きく上がる（FW・MFに効果大）', stats: { kick: { FW: 2.2, MF: 1.4, DF: 0.6, GK: 0.3 } }, exp: 90, fatigue: 15 },
  dribble:  { name: 'ドリブル練習', icon: '💨', desc: 'コントロールとスピードが上がる', stats: { control: { FW: 1.4, MF: 1.8, DF: 0.7, GK: 0.3 }, speed: { FW: 1.0, MF: 1.0, DF: 0.7, GK: 0.4 } }, exp: 90, fatigue: 15 },
  defense:  { name: 'ディフェンス練習', icon: '🛡', desc: 'ガードとボディが上がる（DFに効果大）', stats: { guard: { FW: 0.5, MF: 1.0, DF: 2.0, GK: 0.6 }, body: { FW: 0.6, MF: 0.8, DF: 1.2, GK: 0.8 } }, exp: 90, fatigue: 15 },
  keeper:   { name: 'キーパー特訓', icon: '🧤', desc: 'GKのキャッチが大幅UP。他の選手はボディが少し上がる', stats: { catch: { FW: 0, MF: 0, DF: 0, GK: 3.2 }, body: { FW: 0.5, MF: 0.5, DF: 0.6, GK: 0.8 } }, exp: 80, fatigue: 15 },
  physical: { name: 'フィジカル強化', icon: '💪', desc: 'ボディ・スピード・最大TPが上がる。疲労大', stats: { body: { FW: 1.0, MF: 1.0, DF: 1.2, GK: 1.0 }, speed: { FW: 0.9, MF: 0.9, DF: 0.9, GK: 0.6 }, tp: { FW: 2, MF: 2, DF: 2, GK: 2 } }, exp: 100, fatigue: 22 },
  special:  { name: '必殺技特訓', icon: '🔥', desc: '最大TPが上がり、全員の必殺技の熟練度が進む（改→真へ進化）', stats: { tp: { FW: 3, MF: 3, DF: 3, GK: 3 } }, exp: 70, fatigue: 18, moveUses: 2 },
};

const SHOP_ITEMS = [
  { id: 'drink',   name: 'スポーツドリンク', desc: '全員のコンディション +30', price: 800 },
  { id: 'protein', name: '特製プロテイン',   desc: '全員に経験値 +120', price: 3000 },
];
const BOOK_PRICES = [0, 1500, 4000, 9000, 16000, 30000];
const MAX_ROSTER = 16;
