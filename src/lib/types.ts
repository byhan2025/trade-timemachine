export type Side = "buy" | "sell";

/** 봉 하나: [시가, 고가, 저가, 종가, 거래량] */
export type Bar = number[];

export interface Session {
  /** 거래일 YYYY-MM-DD (데이터의 현지 날짜) */
  date: string;
  /** 세션 시작부터 5분 간격(또는 입력된 봉 간격) 순서의 봉 */
  bars: Bar[];
}

export interface DatasetMeta {
  source: string;
  sourceUrl?: string;
  fetchedAt: string;
  interval: string;
  intervalSeconds?: number;
  /** 연속 봉 간격이 모두 같으면 true, 섞여 있으면 false(불규칙 봉) */
  intervalRegular?: boolean;
  /** 실제 간격 분포 (예: "5분 3회, 55분 1회") */
  gapSummary?: string;
  barTimestampMeans?: string;
  sessionStart: string;
  sessionEnd: string;
  sessionBars: number;
  sessionsUsed: number;
  firstDate: string;
  lastDate: string;
  note?: string;
  sessionsDropped?: { date: string; bars: number }[];
}

export interface Dataset {
  id: string;
  symbol: string;
  name: string;
  market: string;
  currency: string;
  priceUnit: string;
  exchangeTimezone?: string;
  meta: DatasetMeta;
  /** 각 슬롯의 봉 시작 시각 (HH:MM) */
  times: string[];
  sessions: Session[];
  /** 사용자가 올린 데이터인지 */
  custom?: boolean;
  /** 실시간 중계 서버에서 받은 데이터인지 */
  live?: boolean;
}

export interface SampleIndexItem {
  id: string;
  symbol: string;
  name: string;
  market: string;
  currency: string;
  priceUnit: string;
  sessions: number;
  sessionBars: number;
  sessionStart: string;
  sessionEnd: string;
  firstDate: string;
  lastDate: string;
  fetchedAt: string;
  file: string;
}

export interface SampleIndex {
  source: string;
  interval: string;
  generatedAt: string;
  items: SampleIndexItem[];
}
