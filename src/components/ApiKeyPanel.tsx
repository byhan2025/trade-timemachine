import { useEffect, useRef, useState } from "react";
import type { Dataset } from "../lib/types";
import {
  BYOK_MAX_BARS,
  ByokError,
  TD_KEYS_URL,
  TD_REGISTER_URL,
  buildTimeSeriesUrl,
  byokHeaders,
  clearStoredKey,
  datasetFromTwelveData,
  errorFromResponse,
  loadStoredKey,
  looksKoreanTicker,
  messageFor,
  normalizeSymbol,
  redactKey,
  saveStoredKey,
  type KeyStore,
  type TdResponse,
} from "../lib/byok";

/**
 * 방문자 본인 무료 API 키(BYOK) 입력 + 초보자용 4단계 가이드 — v2.3.1 / v2.3.2.
 *
 * - 키는 이 사이트 서버로 보내지 않는다. 브라우저가 api.twelvedata.com 에 직접 요청한다.
 * - v2.3.2: 키를 URL 쿼리에서 떼어 `Authorization: apikey <키>` 헤더로만 보낸다.
 *   (제공처 preflight 가 Authorization 을 허용하는 것을 2026-11-20 실측 확인) + `referrerPolicy: no-referrer`.
 * - 기본은 메모리 보관, 방문자가 스위치를 켤 때만 이 브라우저 localStorage 에 남긴다.
 * - 가이드는 'API 키가 뭔지 모르는 사람' 기준으로 1→4단계를 순서대로 적는다.
 */

function browserStore(): KeyStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ApiKeyPanel({
  onApply,
  onRequestCustom,
}: {
  onApply: (d: Dataset) => void;
  /** 4단계 안내에서 [내 데이터 직접 입력]으로 바로 이동(v2.3.2) */
  onRequestCustom?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [symbol, setSymbol] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const saved = loadStoredKey(browserStore());
    if (saved) {
      setApiKey(saved);
      setRemember(true);
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const toggleRemember = () => {
    const next = !remember;
    setRemember(next);
    if (!next) {
      clearStoredKey(browserStore());
      setOk("이 브라우저에 저장한 키를 지웠어요. 지금 입력한 키는 이 화면을 닫을 때 사라져요.");
    }
  };

  const submit = async (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (busy) return;
    const key = apiKey.trim();
    const sym = normalizeSymbol(symbol);
    if (!key) {
      setError("API 키를 먼저 붙여넣어 주세요. 1단계에서 받은 키를 그대로 넣으면 됩니다.");
      setOk(null);
      return;
    }
    if (!sym) {
      setError("종목 티커를 입력해 주세요. 미국 종목은 AAPL, TSLA처럼 넣습니다.");
      setOk(null);
      return;
    }

    setBusy(true);
    setError(null);
    setOk(null);
    const controller = new AbortController();
    timer.current = window.setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(buildTimeSeriesUrl(sym, BYOK_MAX_BARS), {
        signal: controller.signal,
        // v2.3.2 — 키는 헤더로만. URL·Referer 어디에도 남기지 않는다.
        headers: byokHeaders(key),
        referrerPolicy: "no-referrer",
      });
      const body = (await res.json().catch(() => null)) as TdResponse | null;
      if (!res.ok) throw errorFromResponse(res.status, body);
      if (!body) throw new ByokError("server", messageFor("server"), res.status);
      const dataset = datasetFromTwelveData(body, sym);
      if (remember) saveStoredKey(browserStore(), key);
      else clearStoredKey(browserStore());
      onApply(dataset);
      setOk(
        `${dataset.symbol} · ${dataset.meta.firstDate} ~ ${dataset.meta.lastDate} · ` +
          `${dataset.meta.sessionsUsed}일 × ${dataset.meta.sessionBars}봉을 불러왔어요. ` +
          "아래 [1만 번 모의 재생 실행]을 눌러 주세요."
      );
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      const message =
        e instanceof ByokError
          ? e.message
          : aborted
            ? "20초 안에 응답이 없어 그만뒀어요. 인터넷 연결을 확인하고 다시 눌러 주세요."
            : messageFor("network");
      setError(redactKey(message, key));
    } finally {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      setBusy(false);
    }
  };

  return (
    <section className="byok" aria-labelledby="byok-title" data-testid="byok">
      <button
        type="button"
        className="byok-toggle"
        aria-expanded={open}
        aria-controls="byok-body"
        onClick={() => setOpen((v) => !v)}
        data-testid="byok-toggle"
      >
        <span className="byok-toggle-text">
          <span className="byok-toggle-title" id="byok-title">
            🔑 내 무료 API 키로 실제 5분봉 불러오기
          </span>
          <span className="muted small">선택 사항 · 1분이면 준비 끝</span>
        </span>
        <span className="byok-chevron" aria-hidden="true">
          {open ? "접기 ▲" : "펼치기 ▼"}
        </span>
      </button>

      {open && (
        <div className="byok-body" id="byok-body">
          <p className="byok-intro">
            API 키는 <strong>내가 받은 데이터를 나만 볼 수 있게 해 주는 비밀 열쇠</strong>예요. 이 앱은
            키를 받아 두는 서버가 없어서, <strong>내 브라우저가 시세 사이트에 직접 물어봅니다.</strong>{" "}
            키는 우리 사이트로 오지 않아요. 아래 4단계만 따라 하면 됩니다.
          </p>
          <p className="byok-intro small">
            키는 요청 주소(URL)에 붙지 않고 <strong>요청 헤더(Authorization)</strong>에만 담겨 시세
            사이트로 갑니다. 주소창·브라우저 방문 기록·다른 사이트로 넘기는 Referer 에 키가 남지 않아요.
          </p>

          <ol className="byok-guide">
            <li>
              <h3>
                <span className="byok-step-no">1</span> 무료 API 키 발급 사이트 열기
              </h3>
              <p>
                새 탭에서 Twelve Data 가입 화면을 엽니다. 이메일(또는 구글 계정)로 가입하고,{" "}
                <strong>무료 Basic 플랜($0)</strong>을 그대로 쓰세요. 유료 플랜은 돈이 나가니 고르지 말고
                Basic 그대로 두면 됩니다.
              </p>
              <a className="guide-link" href={TD_REGISTER_URL} target="_blank" rel="noreferrer noopener">
                Twelve Data 무료 가입 열기 (새 탭) ↗
              </a>
              <ul className="byok-facts">
                <li>무료 플랜: 1분에 8회 · 하루 800회까지 조회할 수 있어요.</li>
                <li>무료 플랜에서 열려 있는 곳: 미국 주식·ETF, 외환, 암호화폐 3곳.</li>
                <li>
                  한국 종목은 무료 플랜에 없어요. 4단계의 증권사 CSV 방법을 쓰면 됩니다.
                </li>
              </ul>
            </li>

            <li>
              <h3>
                <span className="byok-step-no">2</span> 내 API 키 복사하기
              </h3>
              <p>
                로그인한 뒤 <strong>My API Keys</strong> 화면을 엽니다. 거기 있는 내 키(영문·숫자가 섞인
                긴 문자열)를 복사하세요. 키는 비밀번호와 같아서 남에게 보여 주거나 화면 캡처에 담지 않는
                게 좋아요.
              </p>
              <a className="guide-link" href={TD_KEYS_URL} target="_blank" rel="noreferrer noopener">
                내 API 키 화면 열기 (새 탭) ↗
              </a>
            </li>

            <li>
              <h3>
                <span className="byok-step-no">3</span> 아래 칸에 붙여넣고 [데이터 불러오기]
              </h3>
              <p>
                ① <strong>API 키</strong> 칸에 복사한 키를 붙여넣기 → ② <strong>티커</strong> 칸에{" "}
                <code>AAPL</code>·<code>TSLA</code>·<code>NVDA</code> 같은 미국 종목 기호 입력 → ③{" "}
                <strong>[데이터 불러오기]</strong> 누르기 → ④ “불러왔어요”가 뜨면{" "}
                <strong>[1만 번 모의 재생 실행]</strong>.
              </p>
              <p className="muted small">
                조회 1번에 무료 한도 1회가 줄 뿐, 돈은 나가지 않아요. 같은 종목을 다시 누르면 한도만
                줄어드니, 결과가 마음에 안 들 때만 종목을 바꿔 보세요.
              </p>
            </li>

            <li>
              <h3>
                <span className="byok-step-no">4</span> 한국 종목은 증권사 HTS 5분봉 CSV로
              </h3>
              <p>
                무료 키로는 한국 종목 5분봉을 받을 수 없어요. 대신 증권사 홈트레이딩(HTS, 키움 등)에서
                받은 5분봉 파일을 그대로 올리면 <strong>똑같이 1만 번 계산</strong>됩니다.
              </p>
              <ol className="byok-substeps">
                <li>HTS에서 종목 차트를 열고 봉 주기를 <strong>5분</strong>으로 맞춥니다.</li>
                <li>
                  차트 메뉴에서 <strong>데이터 내보내기 / CSV 저장</strong>을 찾습니다(프로그램마다 이름이
                  조금씩 달라요).
                </li>
                <li>
                  저장한 파일을 열어 <code>2026-11-18 09:00, 71500, 71800, 71300, 71600, 120345</code>{" "}
                  처럼 <strong>시각·시가·고가·저가·종가·거래량</strong> 순서인지 봅니다. 한글 머리글
                  (날짜·시가·고가·저가·종가·거래량)도 읽어요.
                </li>
                <li>
                  최신 봉이 <strong>위에</strong> 있으면 시간순(오래된 봉 → 최신 봉)으로 뒤집습니다.
                </li>
                <li>
                  위 종목 선택에서 <strong>[내 데이터 직접 입력 (CSV/JSON)]</strong>을 고르고, [파일
                  선택]으로 올리거나 붙여넣은 뒤 <strong>[이 데이터로 적용]</strong>을 누릅니다.
                </li>
              </ol>
              {onRequestCustom && (
                <button
                  type="button"
                  className="btn secondary byok-goto-custom"
                  onClick={onRequestCustom}
                  data-testid="byok-goto-custom"
                >
                  내 데이터 직접 입력으로 이동
                </button>
              )}
            </li>
          </ol>

          <form className="byok-form" onSubmit={submit} autoComplete="off">
            <div className="field">
              <label className="field-label" htmlFor="byok-key">
                API 키 <span className="muted small">(붙여넣기)</span>
              </label>
              <div className="byok-key-row">
                <input
                  id="byok-key"
                  className="control"
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="여기에 내 API 키를 붙여넣으세요"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-testid="byok-key"
                />
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setShowKey((v) => !v)}
                  aria-pressed={showKey}
                  aria-label={showKey ? "API 키 가리기" : "API 키 보기"}
                  data-testid="byok-show"
                >
                  {showKey ? "가리기" : "보기"}
                </button>
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="byok-symbol">
                종목 티커 <span className="muted small">(미국: AAPL · TSLA · NVDA)</span>
              </label>
              <input
                id="byok-symbol"
                className="control"
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="예: AAPL"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                data-testid="byok-symbol"
              />
              {looksKoreanTicker(symbol) && (
                <p className="muted small byok-hint" data-testid="byok-kr-hint">
                  6자리 한국 종목 코드는 무료 플랜에서 조회되지 않아요. 4단계(HTS CSV)를 써 주세요.
                </p>
              )}
            </div>
            <button
              type="submit"
              className="btn primary byok-load"
              disabled={busy}
              data-testid="byok-load"
            >
              {busy ? "불러오는 중…" : "데이터 불러오기"}
            </button>
          </form>

          {error && (
            <p className="alert error small" role="alert" data-testid="byok-error">
              {error}
            </p>
          )}
          {ok && (
            <p className="alert ok small" role="status" data-testid="byok-ok" aria-live="polite">
              {ok}
            </p>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={remember}
            className={remember ? "remember on" : "remember"}
            onClick={toggleRemember}
            data-testid="byok-remember"
          >
            <span>
              이 브라우저에 키 저장 <span className="muted small">(localStorage · 다음 방문 때 자동 입력)</span>
            </span>
            <span className="remember-knob" aria-hidden="true" />
          </button>
          <p className="footnote byok-privacy" data-testid="byok-privacy">
            키는 <strong>우리 서버로 전송되지 않습니다.</strong> 요청 주소에도 붙지 않고 헤더로만
            시세 사이트에 전달됩니다. 저장을 켜지 않으면 이 화면을 닫거나 새로 고침할 때 사라지고,
            켜면 이 브라우저에만 남습니다(같은 브라우저를 쓰는 사람은 볼 수 있어요).
            불러온 데이터는 화면 계산에만 쓰고 저장·재배포하지 않습니다.
          </p>
        </div>
      )}
    </section>
  );
}
