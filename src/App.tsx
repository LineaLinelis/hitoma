import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  Copy,
  Flag,
  Hash,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { api, post } from "./api";
import {
  CATEGORIES,
  LIMITS,
  type Category,
  type PublicConfig,
  type Reply,
  type SessionStatus,
  type Thread,
} from "./shared";
import { samples, sampleReplies } from "./samples";
import type { GateContext } from "./WorldGate";

const WorldGate = lazy(() => import("./WorldGate"));
type Topic = "すべて" | Category;
type View = { thread: Thread; replies: Reply[]; nextCursor: string | null };
const topicIcons = [Hash, MessageCircle, CircleHelp, Code2, Leaf];

function dateLabel(timestamp: number, sample = false) {
  if (sample) return "表示例";
  const diff = Math.max(0, Date.now() / 1000 - timestamp);
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
  }).format(timestamp * 1000);
}

function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
      </span>
      <span>
        ひとま<span className="brand-latin">HITOMA</span>
      </span>
    </span>
  );
}

function Modal({
  title,
  close,
  children,
  className = "",
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      close();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
      previous?.focus();
    };
  }, [close]);
  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button className="icon-button" onClick={close} aria-label="閉じる">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [session, setSession] = useState<SessionStatus>({ verified: false });
  const [topic, setTopic] = useState<Topic>("すべて");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [demo, setDemo] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [dialog, setDialog] = useState<
    "about" | "privacy" | "rules" | "compose" | "verify" | "report" | null
  >(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>("雑談");
  const [submitting, setSubmitting] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    threadId: string;
    replyId?: string;
  } | null>(null);
  const [reportReason, setReportReason] = useState("個人情報");
  const [gateContext, setGateContext] = useState<GateContext | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const deepLinkLoaded = useRef(false);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setFormError("");
  }, []);
  const announce = useCallback((message: string) => {
    setNotice(message);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timeout);
  }, [notice]);

  const refreshSession = useCallback(async () => {
    try {
      setSession(await api<SessionStatus>("/api/session"));
    } catch {
      setSession({ verified: false });
    }
  }, []);

  useEffect(() => {
    let active = true;
    api<PublicConfig>("/api/config")
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch(() => {
        if (active)
          setLoadError(
            "掲示板に接続できませんでした。再読み込みしてください。",
          );
      });
    void refreshSession();
    const onFocus = () => {
      void refreshSession();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshSession]);

  const loadThreads = useCallback(
    async (next?: string) => {
      const request = ++listRequest.current;
      setLoading(true);
      setLoadError("");
      try {
        const params = new URLSearchParams();
        if (topic !== "すべて") params.set("category", topic);
        if (next) params.set("cursor", next);
        const data = await api<{
          threads: Thread[];
          nextCursor: string | null;
        }>(`/api/threads?${params}`);
        if (request !== listRequest.current) return;
        setThreads((previous) =>
          next
            ? [
                ...previous,
                ...data.threads.filter(
                  (thread) => !previous.some((t) => t.id === thread.id),
                ),
              ]
            : data.threads,
        );
        setCursor(data.nextCursor);
      } catch (error) {
        if (request === listRequest.current)
          setLoadError(
            error instanceof Error
              ? error.message
              : "投稿を読み込めませんでした。",
          );
      } finally {
        if (request === listRequest.current) setLoading(false);
      }
    },
    [topic],
  );

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const openThread = useCallback(
    async (thread: Thread, isSample = demo) => {
      const request = ++detailRequest.current;
      setReplyBody("");
      setFormError("");
      if (isSample) {
        setView({
          thread,
          replies: sampleReplies[thread.id] ?? [],
          nextCursor: null,
        });
        return;
      }
      try {
        const data = await api<View>(`/api/threads/${thread.id}`);
        if (request !== detailRequest.current) return;
        setView(data);
        history.replaceState(null, "", `#thread/${thread.id}`);
      } catch (error) {
        announce(
          error instanceof Error
            ? error.message
            : "投稿を読み込めませんでした。",
        );
      }
    },
    [demo, announce],
  );

  useEffect(() => {
    if (!config || deepLinkLoaded.current) return;
    deepLinkLoaded.current = true;
    const id = /^#thread\/([0-9a-f-]+)$/i.exec(location.hash)?.[1];
    if (!id) return;
    api<View>(`/api/threads/${id}`)
      .then(setView)
      .catch((error) =>
        announce(
          error instanceof Error ? error.message : "投稿が見つかりません。",
        ),
      );
  }, [config, announce]);

  function backToList() {
    detailRequest.current++;
    setView(null);
    setReplyBody("");
    history.replaceState(null, "", location.pathname + location.search);
  }
  function chooseTopic(value: Topic) {
    setTopic(value);
    setQuery("");
    setMobileMenu(false);
    backToList();
  }
  function openDialog(value: NonNullable<typeof dialog>) {
    setFormError("");
    setDialog(value);
  }

  async function startVerification() {
    if (!config?.configured) {
      openDialog("verify");
      return;
    }
    setAuthLoading(true);
    setFormError("");
    try {
      const context = await post<GateContext>("/api/auth/challenge");
      setGateContext(context);
      setGateOpen(true);
      closeDialog();
    } catch (error) {
      announce(
        error instanceof Error ? error.message : "認証を開始できませんでした。",
      );
    } finally {
      setAuthLoading(false);
    }
  }

  async function submitThread(event: React.FormEvent) {
    event.preventDefault();
    if (!session.verified) {
      openDialog("verify");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const result = await post<{ id: string }>("/api/threads", {
        title,
        body,
        category,
      });
      setTitle("");
      setBody("");
      closeDialog();
      setDemo(false);
      await Promise.all([loadThreads(), refreshSession()]);
      await openThread({ id: result.id } as Thread, false);
      announce("あなたの言葉を置きました。");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "投稿できませんでした。",
      );
      await refreshSession();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    if (!session.verified) {
      openDialog("verify");
      return;
    }
    if (!view || demo) return;
    const targetId = view.thread.id;
    const request = detailRequest.current;
    setSubmitting(true);
    setFormError("");
    try {
      await post(`/api/threads/${targetId}/replies`, { body: replyBody });
      const data = await api<View>(`/api/threads/${targetId}`);
      if (request === detailRequest.current) setView(data);
      setReplyBody("");
      await refreshSession();
      announce("返信を置きました。");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "返信できませんでした。",
      );
      await refreshSession();
    } finally {
      setSubmitting(false);
    }
  }

  async function moreReplies() {
    if (!view?.nextCursor || replyLoading) return;
    const targetId = view.thread.id;
    setReplyLoading(true);
    try {
      const data = await api<View>(
        `/api/threads/${view.thread.id}?cursor=${encodeURIComponent(view.nextCursor)}`,
      );
      setView((previous) =>
        previous && previous.thread.id === targetId
          ? {
              ...previous,
              replies: [...previous.replies, ...data.replies],
              nextCursor: data.nextCursor,
            }
          : previous,
      );
    } catch (error) {
      announce(
        error instanceof Error ? error.message : "返信を読み込めませんでした。",
      );
    } finally {
      setReplyLoading(false);
    }
  }

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}${location.pathname}#thread/${id}`,
      );
      announce("投稿へのリンクをコピーしました。");
    } catch {
      announce(
        "リンクをコピーできませんでした。ブラウザーのアドレス欄からコピーしてください。",
      );
    }
  }

  function openReport(threadId: string, replyId?: string) {
    if (!session.verified) {
      openDialog("verify");
      return;
    }
    setReportTarget({ threadId, replyId });
    openDialog("report");
  }

  async function submitReport(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      await post("/api/reports", { ...reportTarget, reason: reportReason });
      closeDialog();
      await refreshSession();
      announce("通報を受け付けました。管理者が確認します。");
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "通報できませんでした。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const shown = (
    demo
      ? samples.filter(
          (thread) => topic === "すべて" || thread.category === topic,
        )
      : threads
  ).filter((thread) =>
    `${thread.title} ${thread.body}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const verified =
    session.verified && (session.expiresAt ?? 0) > Date.now() / 1000;
  const startCompose = () => openDialog(verified ? "compose" : "verify");

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a
            className="logo-link"
            href="#"
            aria-label="ひとまのトップ"
            onClick={(event) => {
              event.preventDefault();
              chooseTopic("すべて");
            }}
          >
            <Brand />
          </a>
          <nav className="top-nav" aria-label="メイン">
            <button className="active" onClick={backToList}>
              掲示板
            </button>
            <button onClick={() => openDialog("about")}>
              ひとまについて
              <ArrowUpRight size={13} />
            </button>
          </nav>
          <div className="header-actions">
            <span className="quiet-label">名前を持たず、言葉を持つ。</span>
            <button
              className={`auth-pill ${verified ? "is-verified" : ""}`}
              onClick={() =>
                verified ? openDialog("verify") : void startVerification()
              }
              disabled={authLoading}
            >
              {authLoading ? (
                <LoaderCircle className="spin" size={15} />
              ) : verified ? (
                <ShieldCheck size={16} />
              ) : (
                <LockKeyhole size={15} />
              )}
              <span>{verified ? "人間性を確認済み" : "World IDで認証"}</span>
            </button>
            <button
              className="mobile-toggle icon-button"
              onClick={() => setMobileMenu(!mobileMenu)}
              aria-label="話題メニュー"
              aria-expanded={mobileMenu}
            >
              <Menu size={22} />
            </button>
          </div>
        </div>
      </header>

      <div className="page-grid">
        <aside className={`left-sidebar ${mobileMenu ? "mobile-open" : ""}`}>
          <p className="eyebrow sidebar-label">YOUR SMALL PUBLIC SPACE</p>
          <nav className="topic-nav" aria-label="話題から読む">
            {(["すべて", ...CATEGORIES] as Topic[]).map((value, index) => {
              const Icon = topicIcons[index];
              return (
                <button
                  key={value}
                  className={topic === value ? "selected" : ""}
                  onClick={() => chooseTopic(value)}
                >
                  <Icon size={18} strokeWidth={1.6} />
                  <span>{value === "すべて" ? "すべての話題" : value}</span>
                  {topic === value && <span className="nav-dot" />}
                </button>
              );
            })}
          </nav>
          <div className="sidebar-note">
            <span className="tiny-orbit" aria-hidden="true" />
            <p>
              誰かの言葉が、
              <br />
              誰かの居場所になる。
            </p>
            <span>
              ここには、名前も肩書きも
              <br />
              フォロワー数もありません。
            </span>
          </div>
          <div className="sidebar-bottom">
            <button onClick={() => openDialog("rules")}>
              この場所の約束
              <ArrowUpRight size={12} />
            </button>
            <button onClick={() => openDialog("privacy")}>
              匿名性とプライバシー
              <ArrowUpRight size={12} />
            </button>
            <p>
              ひとと、ことば。
              <br />
              <span>© 2026 HITOMA</span>
            </p>
          </div>
        </aside>

        <main className="main-content">
          {!view && (
            <section className="hero" aria-labelledby="hero-title">
              <p className="eyebrow hero-eyebrow">
                <span className="green-dot" /> HUMAN WORDS, NOTHING ELSE.
              </p>
              <h1 id="hero-title">
                言葉だけで、
                <br />
                ここにいる<span className="hero-period">。</span>
              </h1>
              <p className="hero-description">
                人間だけが書き込める、匿名の掲示板。
                <br />
                名前を置いて、考えや日々を、そっと置いていこう。
              </p>
              <div className="hero-seal" aria-hidden="true">
                <div className="seal-orbit orbit-one" />
                <div className="seal-orbit orbit-two" />
                <div className="seal-orbit orbit-three" />
                <span>
                  ひと<span>と</span>ことば
                </span>
              </div>
              <div className="hero-bottom">
                <span>
                  <ShieldCheck size={14} />
                  World IDで人間性を確認
                </span>
                <span>
                  <Hash size={13} />
                  テキストのみ
                </span>
                <span>
                  <LockKeyhole size={13} />
                  公開プロフィールなし
                </span>
              </div>
            </section>
          )}

          <div className="mobile-topics">
            {(["すべて", ...CATEGORIES] as Topic[]).map((value) => (
              <button
                className={topic === value ? "selected" : ""}
                key={value}
                onClick={() => chooseTopic(value)}
              >
                {value}
              </button>
            ))}
          </div>

          {!config?.configured && config && (
            <div className="setup-banner">
              <span>
                <span className="status-dot" />
                準備中 · 閲覧できます。投稿はWorld ID設定後に開きます。
              </span>
              <button
                onClick={() => {
                  setDemo(!demo);
                  backToList();
                  setQuery("");
                }}
              >
                {demo ? "実際の掲示板へ" : "表示例を読む"}
                <ArrowRight size={13} />
              </button>
            </div>
          )}
          {demo && (
            <div className="sample-banner">
              以下は画面の表示例です。実際の投稿・認証済みの利用者ではありません。
            </div>
          )}

          {view ? (
            <section className="thread-view">
              <button className="back-link" onClick={backToList}>
                <ArrowLeft size={15} />
                話題一覧に戻る
              </button>
              <div className="thread-meta">
                <span
                  className={`category-tag category-${view.thread.category}`}
                >
                  {view.thread.category}
                </span>
                <span>{dateLabel(view.thread.created_at, demo)}</span>
                {!demo && (
                  <span className="human-label">
                    <ShieldCheck size={12} />
                    人間性確認済み
                  </span>
                )}
              </div>
              <h1 className="detail-title">{view.thread.title}</h1>
              <p className="detail-body">{view.thread.body}</p>
              <div className="detail-actions">
                <span>
                  <MessageCircle size={15} />
                  {view.thread.reply_count}件の返信{demo && "の表示例"}
                </span>
                {!demo && (
                  <div>
                    <button
                      className="text-button"
                      onClick={() => void copyLink(view.thread.id)}
                    >
                      <Copy size={14} />
                      リンク
                    </button>
                    <button
                      className="text-button"
                      onClick={() => openReport(view.thread.id)}
                    >
                      <Flag size={14} />
                      通報
                    </button>
                  </div>
                )}
              </div>
              <div className="replies-heading">
                <h2>ここから、会話。</h2>
                <span>みんな、ひとりの人間です。</span>
              </div>
              {view.replies.length === 0 && (
                <p className="no-replies">
                  まだ返信はありません。最初の言葉を置いてみませんか。
                </p>
              )}
              {view.replies.map((reply, index) => (
                <article className="reply" key={reply.id}>
                  <div className="reply-meta">
                    <span className="reply-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{demo ? "返信の表示例" : "ひとりの人間"}</span>
                    <time>{dateLabel(reply.created_at, demo)}</time>
                    {!demo && (
                      <button
                        className="icon-button"
                        aria-label={`返信${index + 1}を通報`}
                        onClick={() => openReport(view.thread.id, reply.id)}
                      >
                        <Flag size={13} />
                      </button>
                    )}
                  </div>
                  <p>{reply.body}</p>
                </article>
              ))}
              {view.nextCursor && (
                <button
                  className="load-more"
                  onClick={() => void moreReplies()}
                  disabled={replyLoading}
                >
                  {replyLoading ? "読み込み中…" : "続きの返信を読む"}
                  <ArrowDown size={14} />
                </button>
              )}
              <form className="reply-form" onSubmit={submitReply}>
                <label htmlFor="reply-body">あなたの言葉を、ひとつ。</label>
                <textarea
                  id="reply-body"
                  value={replyBody}
                  onChange={(event) => setReplyBody(event.target.value)}
                  placeholder={
                    demo
                      ? "表示例への返信はできません。"
                      : "相手の向こうにも、人がいます。"
                  }
                  maxLength={LIMITS.body * 2}
                  disabled={demo}
                  rows={4}
                />
                <div className="compose-foot">
                  <span>
                    {[...replyBody].length} / {LIMITS.body}
                  </span>
                  <button
                    className="primary-button"
                    type={verified && !demo ? "submit" : "button"}
                    onClick={
                      verified && !demo
                        ? undefined
                        : () => void startVerification()
                    }
                    disabled={
                      demo ||
                      submitting ||
                      (verified &&
                        (!replyBody.trim() ||
                          [...replyBody].length > LIMITS.body))
                    }
                  >
                    {submitting ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : verified ? (
                      <ArrowUpRight size={15} />
                    ) : (
                      <LockKeyhole size={14} />
                    )}
                    {verified ? "返信を置く" : "認証して返信する"}
                  </button>
                </div>
                {formError && (
                  <p className="form-error" role="alert">
                    {formError}
                  </p>
                )}
              </form>
            </section>
          ) : (
            <>
              <div className="feed-heading">
                <div>
                  <span className="eyebrow">THE BOARD</span>
                  <h2>
                    {topic === "すべて" ? "みんなの言葉" : topic}
                    <span className="heading-dot">.</span>
                  </h2>
                </div>
                <button className="primary-button" onClick={startCompose}>
                  <Plus size={17} />
                  言葉を置く
                </button>
              </div>
              <div className="feed-toolbar">
                <div className="feed-tabs">
                  <button
                    className="active"
                    onClick={() => {
                      setQuery("");
                      void loadThreads();
                    }}
                  >
                    新しい話題
                    <span />
                  </button>
                  <span className="feed-count">
                    {demo ? "表示例" : `${threads.length}件を表示`}
                  </span>
                </div>
                <label className="search-box">
                  <Search size={15} />
                  <input
                    aria-label="表示中の投稿を検索"
                    placeholder="表示中の言葉を探す"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {query && (
                    <button
                      aria-label="検索をクリア"
                      onClick={() => setQuery("")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </label>
              </div>
              {loading && !demo ? (
                <div className="loading-state" role="status">
                  <LoaderCircle className="spin" size={22} />
                  言葉を読み込んでいます…
                </div>
              ) : loadError && !demo ? (
                <div className="empty-state">
                  <CircleHelp size={26} />
                  <h3>少し、つながりにくいようです。</h3>
                  <p>{loadError}</p>
                  <button
                    className="outline-button"
                    onClick={() => void loadThreads()}
                  >
                    もう一度読み込む
                  </button>
                </div>
              ) : shown.length ? (
                <div className="thread-list">
                  {shown.map((thread, index) => (
                    <article className="thread-card" key={thread.id}>
                      <div className="thread-meta">
                        <span
                          className={`category-tag category-${thread.category}`}
                        >
                          {thread.category}
                        </span>
                        <span>{dateLabel(thread.created_at, demo)}</span>
                        {index === 0 && (
                          <span className="new-label">
                            {demo ? "SAMPLE" : "LATEST"}
                          </span>
                        )}
                      </div>
                      <h3>
                        <button onClick={() => void openThread(thread)}>
                          {thread.title}
                        </button>
                      </h3>
                      <p className="thread-excerpt">{thread.body}</p>
                      <div className="thread-card-footer">
                        <button
                          className="reply-link"
                          onClick={() => void openThread(thread)}
                        >
                          <MessageCircle size={15} />
                          {thread.reply_count
                            ? `${thread.reply_count}件の返信`
                            : "会話をはじめる"}
                        </button>
                        <span className="human-label">
                          {demo ? (
                            <>
                              <span className="sample-label">表示サンプル</span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck size={12} />
                              人間性確認済み
                            </>
                          )}
                        </span>
                        <button
                          className="card-arrow"
                          aria-label={`「${thread.title}」を読む`}
                          onClick={() => void openThread(thread)}
                        >
                          <ArrowUpRight size={19} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-spark">
                    <Sparkles size={24} strokeWidth={1.3} />
                  </span>
                  <span className="eyebrow">A LITTLE SPACE FOR YOUR WORDS</span>
                  <h3>
                    {query
                      ? "その言葉は、まだ見つかりません。"
                      : "まだ、誰の言葉もない場所。"}
                  </h3>
                  <p>
                    {query
                      ? "表示中の投稿から探しています。違う言葉で試してみてください。"
                      : "最初のひとことから、この場所ははじまります。\n考えごとも、何気ない日々も、そのままどうぞ。"}
                  </p>
                  {query ? (
                    <button
                      className="outline-button"
                      onClick={() => setQuery("")}
                    >
                      検索をクリア
                    </button>
                  ) : (
                    <button className="outline-button" onClick={startCompose}>
                      最初の言葉を置く
                      <ArrowUpRight size={15} />
                    </button>
                  )}
                </div>
              )}
              {!demo && cursor && !query && (
                <button
                  className="load-more"
                  onClick={() => void loadThreads(cursor)}
                  disabled={loading}
                >
                  もう少し読む
                  <ArrowDown size={14} />
                </button>
              )}
              <div className="feed-end">
                <span />
                <p>スクロールの先にも、ひとがいる。</p>
                <span />
              </div>
            </>
          )}
        </main>

        <aside className="right-sidebar">
          <section className="human-card">
            <div className="human-card-top">
              <ShieldCheck size={19} strokeWidth={1.4} />
              <span>HUMAN, VERIFIED.</span>
              <span className="light-dot" />
            </div>
            <div className="human-card-orbit" aria-hidden="true" />
            <h2>
              読むのは、誰でも。
              <br />
              話すのは、人だけ。
            </h2>
            <p>
              World IDのProof of Humanで、
              <br />
              人間であることだけを確認します。
              <br />
              あなたが誰かは、問いません。
            </p>
            <button
              onClick={() => void startVerification()}
              disabled={authLoading}
            >
              {verified ? (
                <>
                  <Check size={16} />
                  人間性を確認済み
                </>
              ) : (
                <>
                  {authLoading ? "認証を準備中…" : "World IDで認証する"}
                  <ArrowUpRight size={17} />
                </>
              )}
            </button>
            <span className="human-card-foot">
              {verified
                ? `今日あと${session.writesRemaining ?? 20}回の書き込み`
                : "公開プロフィールは作りません"}
            </span>
          </section>
          <section className="small-rules">
            <p className="eyebrow">A FEW SMALL PROMISES</p>
            <h3>この場所を、心地よく。</h3>
            <div>
              <span>01</span>
              <p>
                名前の向こうにも、人がいる。
                <br />
                <small>相手を尊重して、言葉を選ぼう。</small>
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                言葉だけで、伝えよう。
                <br />
                <small>画像や動画、添付ファイルはなし。</small>
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                個人情報は、ここに置かない。
                <br />
                <small>自分のことも、誰かのことも。</small>
              </p>
            </div>
            <button className="text-button" onClick={() => openDialog("rules")}>
              すべての約束を読む
              <ArrowRight size={14} />
            </button>
          </section>
          <div className="temporary-note">
            <Leaf size={17} strokeWidth={1.4} />
            <p>
              言葉は、ずっと残りません。
              <br />
              <span>話題は作成から30日で消えます。</span>
            </p>
          </div>
          <button
            className="privacy-link"
            onClick={() => openDialog("privacy")}
          >
            匿名性について
            <ArrowUpRight size={12} />
          </button>
        </aside>
      </div>

      <footer className="site-footer">
        <Brand small />
        <span>確かに人間。あとは、自由に。</span>
        <button onClick={() => openDialog("privacy")}>
          プライバシー
          <ArrowUpRight size={12} />
        </button>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button onClick={() => setNotice("")} aria-label="通知を閉じる">
            <X size={14} />
          </button>
        </div>
      )}

      {dialog && (
        <Modal
          title={
            {
              about: "ひとまについて",
              privacy: "匿名性とプライバシー",
              rules: "この場所の約束",
              compose: "あなたの言葉を、ひとつ。",
              verify: verified
                ? "人間性を確認済みです"
                : "話す前に、人間性を確認。",
              report: "この投稿を通報する",
            }[dialog]
          }
          close={closeDialog}
          className={dialog === "compose" ? "compose-modal" : ""}
        >
          {dialog === "compose" ? (
            <form onSubmit={submitThread} className="compose-form">
              <p className="modal-intro">
                名前も、肩書きもいりません。あなたが思ったことを。
              </p>
              <label htmlFor="post-category">話題</label>
              <div className="select-wrap">
                <select
                  id="post-category"
                  value={category}
                  onChange={(event) =>
                    setCategory(event.target.value as Category)
                  }
                >
                  {CATEGORIES.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
              <label htmlFor="post-title">タイトル</label>
              <input
                id="post-title"
                placeholder="どんなことを話しましょう？"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={LIMITS.title * 2}
              />
              <label htmlFor="post-body">本文</label>
              <textarea
                id="post-body"
                placeholder="考えかけのことでも、何気ないことでも。"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                rows={7}
                maxLength={LIMITS.body * 2}
              />
              <p className="compose-note">
                <LockKeyhole size={13} />
                投稿に作者IDは付きません。個人情報は書かないでください。
              </p>
              <div className="compose-foot">
                <span>
                  {[...body].length} / {LIMITS.body}
                </span>
                <button
                  className="primary-button"
                  disabled={
                    submitting ||
                    !body.trim() ||
                    !title.trim() ||
                    [...body].length > LIMITS.body ||
                    [...title].length > LIMITS.title
                  }
                >
                  {submitting ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Plus size={15} />
                  )}
                  言葉を置く
                </button>
              </div>
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
            </form>
          ) : dialog === "verify" ? (
            <div className="verify-content">
              <span className="verify-symbol">
                <ShieldCheck size={34} strokeWidth={1.2} />
              </span>
              <p>
                {verified
                  ? "あなたは、人間性を確認したひとりの人間です。"
                  : "名前を明かすことなく、人間であることを証明できます。World AppでProof of Humanを確認してください。"}
              </p>
              {!config?.configured ? (
                <div className="setup-message">
                  <strong>ただいま、投稿の準備中です。</strong>
                  <p>
                    World
                    IDの設定が完了したら、ここから認証できます。設定がない間は、投稿も返信も受け付けません。
                  </p>
                </div>
              ) : (
                <button
                  className="primary-button full-width"
                  onClick={() => void startVerification()}
                  disabled={authLoading}
                >
                  {authLoading ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ShieldCheck size={16} />
                  )}
                  {verified
                    ? "World IDで再確認する"
                    : "World IDで人間性を確認する"}
                  <ArrowUpRight size={16} />
                </button>
              )}
              <p className="verify-note">
                氏名・メール・ウォレットアドレスは求めません。
                <br />
                確認状態は24時間で期限が切れます。
              </p>
              {verified && (
                <button
                  className="text-button logout-link"
                  onClick={async () => {
                    try {
                      await post("/api/auth/logout");
                      setSession({ verified: false });
                      closeDialog();
                      announce("このブラウザーの認証を解除しました。");
                    } catch (error) {
                      setFormError(
                        error instanceof Error
                          ? error.message
                          : "解除できませんでした。",
                      );
                    }
                  }}
                >
                  このブラウザーの認証を解除する
                </button>
              )}
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
            </div>
          ) : dialog === "report" ? (
            <form className="report-form" onSubmit={submitReport}>
              <p className="modal-intro">
                管理者が内容を確認します。通報者の名前は記録しません。
              </p>
              <label htmlFor="report-reason">理由</label>
              <select
                id="report-reason"
                value={reportReason}
                onChange={(event) => setReportReason(event.target.value)}
              >
                <option>個人情報</option>
                <option>迷惑行為</option>
                <option>その他</option>
              </select>
              <p className="verify-note">
                通報も1日の書き込み上限に含まれます。
                <br />
                通報だけで投稿が自動削除されることはありません。
              </p>
              <button
                className="primary-button full-width"
                disabled={submitting}
              >
                {submitting ? "送信中…" : "通報を送る"}
                <Flag size={15} />
              </button>
              {formError && (
                <p className="form-error" role="alert">
                  {formError}
                </p>
              )}
            </form>
          ) : (
            <div className="prose">
              {dialog === "about" ? (
                <>
                  <p className="about-lead">
                    誰が言ったかより、
                    <br />
                    何を言ったか。
                  </p>
                  <p>
                    ひとまは、人間であることだけを確かめて、言葉を交わす小さな掲示板です。閲覧は誰でも。投稿と返信にはWorld
                    IDのProof of Humanが必要です。
                  </p>
                  <h3>名前を持たず、言葉を持つ。</h3>
                  <p>
                    アカウント名、公開ユーザーID、プロフィール、いいねの数はありません。投稿できるのはプレーンテキストだけ。URLも文字として表示し、自動でリンクや埋め込みにしません。
                  </p>
                  <h3>小さく、続けられる場所に。</h3>
                  <p>
                    掲示板全体で1日300回、1認証セッションで1日20回の書き込みまで。連続投稿は30秒の間隔を空けます。投稿は作成から30日で閲覧できなくなり、定期削除されます。
                  </p>
                </>
              ) : dialog === "privacy" ? (
                <>
                  <p className="about-lead">
                    誰かは、記録しない。
                    <br />
                    人間かは、確かめる。
                  </p>
                  <h3>掲示板が保存するもの</h3>
                  <p>
                    投稿のタイトル、本文、話題、時刻（分単位）、返信・通報だけを保存します。投稿に作者・World
                    ID・認証セッションのIDは付けません。
                  </p>
                  <h3>認証と連投制限</h3>
                  <p>
                    World
                    IDの証明は検証時だけ扱い、証明そのものや生のnullifierは保存しません。ブラウザーの認証Cookieは暗号化され、24時間有効です。連投制限と再利用防止のための鍵付きハッシュは、投稿と別の表で短期間保持します。
                  </p>
                  <h3>匿名性の範囲</h3>
                  <p>
                    掲示板アプリはIPや通信ログを記録しません。ただしCloudflare、World、通信事業者は通信情報を処理します。文章の内容や投稿時刻からも人物を推測できるため、追跡不能や運営者に対する完全な匿名性は保証できません。
                  </p>
                  <p>
                    アクセス解析・広告・外部フォントはありません。Cookieは認証のためにだけ使います。基盤のバックアップには削除前のデータが一定期間残る場合があります。
                  </p>
                </>
              ) : (
                <>
                  <p>
                    ここは、ひとりひとりの言葉のための場所です。自由に話すために、次の約束を守ってください。
                  </p>
                  <h3>相手を尊重する</h3>
                  <p>
                    意見への反論は歓迎します。脅迫、差別、嫌がらせ、なりすまし、繰り返しの迷惑投稿は避けてください。
                  </p>
                  <h3>個人情報を置かない</h3>
                  <p>
                    氏名、住所、連絡先、誰かを特定できる情報は書かないでください。匿名の投稿でも、文章から特定されることがあります。
                  </p>
                  <h3>テキストだけで話す</h3>
                  <p>
                    画像・動画・音声・添付はありません。HTMLやMarkdown、URLも、装飾や埋め込みをせず文字のまま表示します。
                  </p>
                  <h3>少しずつ、言葉を置く</h3>
                  <p>
                    1認証セッションあたり1日20回。掲示板全体では1日300回まで。認証セッションの作り直しによる制限回避はしないでください。複数セッションをまたぐ「1人1枠」は保証していません。
                  </p>
                  <h3>気になる投稿は通報する</h3>
                  <p>
                    投稿や返信の通報ボタンからお知らせください。管理者が確認し、必要に応じて削除します。投稿の自己編集・自己削除はありません。個人情報を誤って書いた場合も通報してください。
                  </p>
                  <p>
                    人間性の証明は、その人が内容を手入力したことや、内容の正しさを証明するものではありません。
                  </p>
                </>
              )}
            </div>
          )}
        </Modal>
      )}
      {gateContext && (
        <Suspense
          fallback={
            <div className="toast" role="status">
              <LoaderCircle className="spin" size={16} />
              World IDを準備しています…
            </div>
          }
        >
          <WorldGate
            context={gateContext}
            open={gateOpen}
            onOpenChange={setGateOpen}
            onVerified={() => {
              setGateOpen(false);
              void refreshSession();
              announce("人間性を確認しました。匿名で言葉を置けます。");
            }}
            onError={announce}
          />
        </Suspense>
      )}
    </>
  );
}
