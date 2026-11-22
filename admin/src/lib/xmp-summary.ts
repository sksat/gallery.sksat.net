// media_file.xmp_summary (photo-meta.ts XmpSummary) in words for the edit
// page: the develop settings by Lightroom's own names, and the history
// steps. Covered by xmp-summary.spec.ts.

import { formatJst } from "./format";
import type { XmpSummary } from "./photo-meta";

/** Lightroom's names for the crs:* settings kept (CRS_KEYS). */
const CRS_LABELS: Record<string, string> = {
  ProcessVersion: "処理バージョン",
  WhiteBalance: "ホワイトバランス",
  Temperature: "色温度",
  Tint: "色かぶり補正",
  Exposure2012: "露光量",
  Contrast2012: "コントラスト",
  Highlights2012: "ハイライト",
  Shadows2012: "シャドウ",
  Whites2012: "白レベル",
  Blacks2012: "黒レベル",
  Texture: "テクスチャ",
  Clarity2012: "明瞭度",
  Dehaze: "かすみの除去",
  Vibrance: "自然な彩度",
  Saturation: "彩度",
  HasCrop: "切り抜き",
  LookName: "プロファイル",
};

/** xmpMM:History actions (stEvt:action), in words. */
const ACTIONS: Record<string, string> = {
  created: "作成",
  saved: "保存",
  converted: "変換",
  derived: "派生",
  edited: "編集",
  produced: "書き出し",
  managed: "管理",
  printed: "印刷",
  published: "公開",
  copied: "コピー",
};

export type SummaryView = {
  /** [label, value] of the develop settings. */
  settings: [string, string][];
  /** Settings the file has besides those (crs_count). */
  moreSettings: number;
  /** The history's last steps, oldest first. */
  history: { when: string | null; action: string | null; agent: string | null }[];
  /** Steps before those. */
  earlierSteps: number;
};

const value = (key: string, v: string): string | null => {
  if (key === "HasSettings") return null;
  if (key === "HasCrop") return /^true$/i.test(v) ? "あり" : "なし";
  if (key === "Temperature" && /^\d+$/.test(v)) return `${v} K`;
  return v;
};

export const summaryView = (s: XmpSummary | null): SummaryView | null => {
  if (!s) return null;
  const settings: [string, string][] = [];
  for (const [k, v] of Object.entries(s.crs ?? {})) {
    const shown = value(k, v);
    if (shown !== null) settings.push([CRS_LABELS[k] ?? k, shown]);
  }
  const kept = Object.keys(s.crs ?? {}).length;
  const history = (s.history ?? []).map((h) => ({
    when: h.when ? formatJst(h.when) : null,
    action: h.action ? (ACTIONS[h.action.toLowerCase()] ?? h.action) : null,
    agent: h.agent ?? null,
  }));
  const view: SummaryView = {
    settings,
    moreSettings: Math.max(0, (s.crs_count ?? kept) - kept),
    history,
    earlierSteps: Math.max(0, (s.history_count ?? history.length) - history.length),
  };
  return view.settings.length > 0 || view.moreSettings > 0 || view.history.length > 0
    ? view
    : null;
};
