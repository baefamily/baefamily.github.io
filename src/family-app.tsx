"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Tab = "home" | "chat" | "quests" | "stats" | "calendar" | "settings";
type QuestStatus = "open" | "doing" | "review" | "done" | "talk";

type Member = { id: string; name: string; emoji: string; role: string; color: string };
type Quest = {
  id: string;
  title: string;
  emoji: string;
  points: number;
  creator: string;
  target?: string;
  taker?: string;
  status: QuestStatus;
  createdAt: string;
  completedAt?: string;
};
type Photo = {
  id: string;
  url: string;
  author: string;
  caption: string;
  createdAt: string;
  likes: string[];
  dislikes: string[];
  comments: { id: string; author: string; text: string }[];
};
type CalendarItem = { id: string; title: string; emoji: string; date: string; creator: string };
type MessageAttachment = { url: string; name: string; type: string; size: number };
type Message = { id: string; sender: string; recipient?: string; text: string; attachment?: MessageAttachment; sentAt: string };
type FamilyState = {
  currentMember: string;
  quests: Quest[];
  photos: Photo[];
  calendar: CalendarItem[];
  messages: Message[];
  sunnyThreshold: number;
  rainThreshold: number;
};
type NotificationState = {
  supported: boolean;
  subscribed: boolean;
  permission: NotificationPermission | "unsupported";
  chatUnread: number;
  questUnread: number;
};
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const members: Member[] = [
  { id: "jangwoo", name: "Jangwoo", emoji: "👨🏻", role: "아빠", color: "#dcecff" },
  { id: "sujin", name: "Sujin", emoji: "👩🏻", role: "엄마", color: "#ffe1e9" },
  { id: "ayoung", name: "Ayoung", emoji: "👧🏻", role: "딸", color: "#eee2ff" },
  { id: "siwon", name: "Siwon", emoji: "👦🏻", role: "아들", color: "#dff3e4" },
];

const today = new Date();
const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const initialState: FamilyState = {
  currentMember: "Jangwoo",
  sunnyThreshold: 6,
  rainThreshold: 12,
  quests: [
    { id: "q1", title: "방 정리하기", emoji: "🧹", points: 10, creator: "Sujin", target: "Siwon", status: "open", createdAt: new Date().toISOString() },
    { id: "q2", title: "식탁 차리기", emoji: "🍽️", points: 10, creator: "Jangwoo", status: "open", createdAt: new Date().toISOString() },
    { id: "q3", title: "설거지 돕기", emoji: "🫧", points: 15, creator: "Sujin", status: "open", createdAt: new Date().toISOString() },
    { id: "q4", title: "책 20분 읽기", emoji: "📚", points: 15, creator: "Jangwoo", target: "Ayoung", status: "open", createdAt: new Date().toISOString() },
    { id: "q5", title: "가족에게 칭찬하기", emoji: "💌", points: 5, creator: "Ayoung", status: "open", createdAt: new Date().toISOString() },
  ],
  photos: [],
  calendar: [
    { id: "c1", title: "가족 영화의 밤", emoji: "🍿", date: isoDay(today), creator: "Sujin" },
    { id: "c2", title: "축구 연습", emoji: "⚽️", date: isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3)), creator: "Siwon" },
  ],
  messages: [
    { id: "m1", sender: "Sujin", text: "오늘 저녁 다 같이 떡볶이 어때?", sentAt: new Date().toISOString() },
    { id: "m2", sender: "Ayoung", text: "좋아!! 🙋🏻‍♀️", sentAt: new Date().toISOString() },
    { id: "m3", sender: "Jangwoo", text: "아빠가 퇴근하면서 사 갈게 ❤️", sentAt: new Date().toISOString() },
  ],
};

const recommended = [
  ["양치하고 먼저 준비하기", "🪥", 5],
  ["빨래 개기 도와주기", "🧺", 10],
  ["가족과 20분 산책하기", "🌿", 15],
] as const;
const questIcons = ["✨", "🧹", "🍽️", "🫧", "📚", "💌", "🪥", "🧺", "🌿", "🚶", "🎨", "🎵", "⚽️", "🏀", "🧸", "🛏️", "🗑️", "🐶", "🍳", "🥗", "💧", "🧘", "🤗", "🎁"];

function startOfQuestWeek(date: Date) {
  const start = new Date(date);
  const daysSinceSaturday = (start.getDay() + 1) % 7;
  start.setDate(start.getDate() - daysSinceSaturday);
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfQuestWeek(start: Date) {
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return end;
}

function completedInWeek(quest: Quest, start: Date) {
  if (quest.status !== "done") return false;
  const completed = new Date(quest.completedAt ?? quest.createdAt);
  return completed >= start && completed < endOfQuestWeek(start);
}

function questPointsForWeek(quests: Quest[], start: Date, memberName?: string) {
  return quests
    .filter((quest) => completedInWeek(quest, start) && (!memberName || quest.taker === memberName || (!quest.taker && quest.target === memberName)))
    .reduce((sum, quest) => sum + quest.points, 0);
}

function weekLabel(start: Date) {
  const lastDay = new Date(start);
  lastDay.setDate(lastDay.getDate() + 6);
  return `${start.getMonth() + 1}/${start.getDate()}–${lastDay.getMonth() + 1}/${lastDay.getDate()}`;
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function FamilyApp() {
  const [tab, setTab] = useState<Tab>("home");
  const [data, setData] = useState<FamilyState>(initialState);
  const [loaded, setLoaded] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authMember, setAuthMember] = useState<string | null>(null);
  const [sync, setSync] = useState<"loading" | "saved" | "saving" | "offline">("loading");
  const [modal, setModal] = useState<"photo" | "archive" | "quest" | "event" | null>(null);
  const [notifications, setNotifications] = useState<NotificationState>({
    supported: false,
    subscribed: false,
    permission: "default",
    chatUnread: 0,
    questUnread: 0,
  });
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [eventDate, setEventDate] = useState(isoDay(today));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refreshNotificationStatus() {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      setNotifications((old) => ({ ...old, supported: false, permission: "unsupported" }));
      return;
    }
    const registration = await navigator.serviceWorker.register("/sw.js");
    const localSubscription = await registration.pushManager.getSubscription();
    const response = await fetch("/api/push");
    if (!response.ok) return;
    const result = await response.json() as {
      chatUnread: number;
      questUnread: number;
    };
    const next = {
      supported: true,
      subscribed: Boolean(localSubscription),
      permission: Notification.permission,
      chatUnread: result.chatUnread,
      questUnread: result.questUnread,
    } satisfies NotificationState;
    setNotifications(next);
    updateAppBadge(next.chatUnread + next.questUnread);
  }

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("not-authenticated");
        const result = await response.json() as { memberName: string };
        setAuthMember(result.memberName);
        await loadFamilyState();
        await refreshNotificationStatus();
        const requestedTab = new URLSearchParams(window.location.search).get("open");
        if (requestedTab === "chat" || requestedTab === "quests") {
          setTab(requestedTab);
          await markNotificationRead(requestedTab === "chat" ? "chat" : "quest");
          window.history.replaceState({}, "", "/");
        }
      })
      .catch(() => setAuthMember(null))
      .finally(() => setAuthChecking(false));
  }, []);

  async function loadFamilyState() {
    try {
      const response = await fetch("/api/state");
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (result.state) setData(result.state);
      setSync("saved");
    } catch {
      setSync("offline");
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (!loaded || !authMember) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSync("saving");
      fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      })
        .then((r) => {
          if (!r.ok) throw new Error();
          setSync("saved");
        })
        .catch(() => setSync("offline"));
    }, 450);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [data, loaded, authMember]);

  if (authChecking) return <AuthSplash />;
  if (!authMember) {
    return <FamilyLogin onSuccess={async (memberName) => {
      setAuthMember(memberName);
      setLoaded(false);
      await loadFamilyState();
      await refreshNotificationStatus();
    }} />;
  }

  const current = members.find((m) => m.name === authMember) ?? members[0];
  const currentQuestWeek = startOfQuestWeek(today);
  const verifiedPoints = questPointsForWeek(data.quests, currentQuestWeek);
  const updateQuest = (id: string, patch: Partial<Quest>) =>
    setData((old) => ({ ...old, quests: old.quests.map((q) => q.id === id ? { ...q, ...patch } : q) }));

  async function markNotificationRead(kind: "chat" | "quest") {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: kind }),
    });
    if (!response.ok) return;
    const result = await response.json() as { chatUnread: number; questUnread: number };
    setNotifications((old) => ({
      ...old,
      chatUnread: result.chatUnread,
      questUnread: result.questUnread,
    }));
    updateAppBadge(result.chatUnread + result.questUnread);
  }

  function openTab(nextTab: Tab) {
    setTab(nextTab);
    if (nextTab === "chat") markNotificationRead("chat").catch(() => undefined);
    if (nextTab === "quests") markNotificationRead("quest").catch(() => undefined);
  }

  async function enableNotifications() {
    setNotificationBusy(true);
    setNotificationMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("이 기기에서는 홈 화면에 앱을 설치한 뒤 알림을 켜주세요.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("기기 설정에서 Our Family 알림을 허용해주세요.");
      const registration = await navigator.serviceWorker.register("/sw.js");
      const statusResponse = await fetch("/api/push");
      if (!statusResponse.ok) throw new Error("알림 설정을 불러오지 못했어요.");
      const status = await statusResponse.json() as { publicKey: string };
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(status.publicKey),
        });
      }
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      if (!response.ok) throw new Error("알림을 등록하지 못했어요. 잠시 후 다시 시도해주세요.");
      setNotificationMessage("알림이 켜졌어요. 새 채팅과 퀘스트를 알려드릴게요.");
      await refreshNotificationStatus();
    } catch (error) {
      setNotificationMessage(error instanceof Error ? error.message : "알림을 켜지 못했어요.");
    } finally {
      setNotificationBusy(false);
    }
  }

  async function disableNotifications() {
    setNotificationBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }
      setNotifications((old) => ({ ...old, subscribed: false }));
      setNotificationMessage("이 기기의 알림을 껐어요.");
    } finally {
      setNotificationBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setTab("home")} aria-label="홈으로">
          <img src="/favicon.svg" alt="" />
          <span><strong>OUR FAMILY <i>- C.I.N.D.Y</i></strong><small>함께 만드는 우리 이야기</small></span>
        </button>
        <nav aria-label="주요 메뉴">
          <NavButton active={tab === "home"} icon="⌂" label="홈" onClick={() => setTab("home")} />
          <NavButton active={tab === "chat"} icon="◌" label="채팅" badge={notifications.chatUnread} onClick={() => openTab("chat")} />
          <NavButton active={tab === "quests"} icon="☁" label="퀘스트" badge={notifications.questUnread} onClick={() => openTab("quests")} />
          <NavButton active={tab === "stats"} icon="▥" label="통계" onClick={() => setTab("stats")} />
          <NavButton active={tab === "calendar"} icon="□" label="캘린더" onClick={() => setTab("calendar")} />
          <NavButton active={tab === "settings"} icon="⚙" label="설정" onClick={() => setTab("settings")} />
        </nav>
        <div className="family-switcher">
          <small>로그인한 가족</small>
          <div className="member-row">
            <span className="avatar" style={{ background: current.color }}>{current.emoji}</span>
            <span><b>{current.name}</b><small>{current.role}</small></span>
          </div>
          <button className="logout-button" onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            setAuthMember(null);
            setLoaded(false);
          }}>로그아웃</button>
        </div>
      </aside>

      <main>
        <header className="mobile-header">
          <button className="brand" onClick={() => setTab("home")}><img src="/icon-192.png" alt="" /><strong>OUR FAMILY <i>- C.I.N.D.Y</i></strong></button>
          <span className={`sync-dot ${sync}`}>{sync === "saved" ? "저장됨" : sync === "offline" ? "오프라인" : "저장 중"}</span>
        </header>
        {tab === "home" && <Home data={data} current={current} setModal={setModal} setTab={setTab} />}
        {tab === "quests" && <Quests data={data} setData={setData} current={current} points={verifiedPoints} updateQuest={updateQuest} setModal={setModal} />}
        {tab === "chat" && <Chat data={data} setData={setData} current={current} />}
        {tab === "stats" && <Stats data={data} current={current} />}
        {tab === "calendar" && <Calendar data={data} onAddEvent={(date) => { setEventDate(date); setModal("event"); }} />}
        {tab === "settings" && <Settings data={data} setData={setData} notifications={notifications} busy={notificationBusy} message={notificationMessage} enableNotifications={enableNotifications} disableNotifications={disableNotifications} />}
      </main>

      <nav className="bottom-nav" aria-label="모바일 메뉴">
        <NavButton active={tab === "home"} icon="⌂" label="홈" onClick={() => setTab("home")} />
        <NavButton active={tab === "chat"} icon="◌" label="채팅" badge={notifications.chatUnread} onClick={() => openTab("chat")} />
        <NavButton active={tab === "quests"} icon="☁" label="퀘스트" badge={notifications.questUnread} onClick={() => openTab("quests")} />
        <NavButton active={tab === "stats"} icon="▥" label="통계" onClick={() => setTab("stats")} />
        <NavButton active={tab === "calendar"} icon="□" label="캘린더" onClick={() => setTab("calendar")} />
        <NavButton active={tab === "settings"} icon="⚙" label="설정" onClick={() => setTab("settings")} />
      </nav>

      {modal === "photo" && <PhotoModal current={current} onClose={() => setModal(null)} onSave={(photo) => setData((old) => ({ ...old, photos: [photo, ...old.photos] }))} />}
      {modal === "archive" && <PhotoArchive data={data} setData={setData} current={current} onClose={() => setModal(null)} />}
      {modal === "quest" && <QuestModal current={current} onClose={() => setModal(null)} onSave={(quest) => setData((old) => ({ ...old, quests: [quest, ...old.quests] }))} />}
      {modal === "event" && <EventModal current={current} initialDate={eventDate} onClose={() => setModal(null)} onSave={(event) => setData((old) => ({ ...old, calendar: [...old.calendar, event] }))} />}
    </div>
  );
}

function AuthSplash() {
  return <div className="auth-page"><div className="auth-splash"><img src="/favicon.svg" alt="" /><b>OUR FAMILY</b><span>가족 공간을 여는 중…</span></div></div>;
}

function FamilyLogin({ onSuccess }: { onSuccess: (memberName: string) => Promise<void> }) {
  const [familyCode, setFamilyCode] = useState("");
  const [memberName, setMemberName] = useState("Jangwoo");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const member = members.find((item) => item.name === memberName) ?? members[0];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/auth/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familyCode, memberName, pin }),
      });
      const result = await response.json() as { memberName?: string; error?: string };
      if (!response.ok || !result.memberName) throw new Error(result.error ?? "로그인하지 못했습니다.");
      await onSuccess(result.memberName);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "로그인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="auth-page">
    <section className="auth-card">
      <div className="auth-art"><img src="/favicon.svg" alt="" /><p>작은 바람이 모여<br /><b>우리 가족의 이야기가 돼요.</b></p></div>
      <form onSubmit={submit}>
        <p className="eyebrow">PRIVATE FAMILY SPACE</p>
        <h1>우리 가족 공간에<br />들어가기</h1>
        <p className="auth-guide">처음 한 번만 가족 코드와 개인 PIN을 입력하면 이 기기에서 1년간 바로 열립니다.</p>
        <label className="field">가족 코드<input value={familyCode} onChange={(event) => setFamilyCode(event.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" placeholder="가족에게 받은 코드" /></label>
        <label className="field">나는 누구인가요?<select value={memberName} onChange={(event) => setMemberName(event.target.value)}>{members.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
        <div className="login-member"><span style={{ background: member.color }}>{member.emoji}</span><div><b>{member.name}</b><small>{member.role}</small></div></div>
        <label className="field">나의 4자리 PIN<input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="숫자 4자리" /></label>
        <small className="pin-help">첫 로그인이라면 입력한 PIN이 내 개인 PIN으로 등록돼요.</small>
        {error && <p className="auth-error">{error}</p>}
        <button className="primary coral-bg full" disabled={busy || !familyCode || pin.length !== 4}>{busy ? "확인하는 중…" : "우리 가족 공간 열기"}</button>
      </form>
    </section>
  </div>;
}

function NavButton({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: number; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><i>{icon}</i><span>{label}</span>{badge ? <em>{badge}</em> : null}</button>;
}

function Home({ data, current, setModal, setTab }: { data: FamilyState; current: Member; setModal: (v: "photo" | "archive") => void; setTab: (v: Tab) => void }) {
  const recent = data.photos[0];
  const weekendPoints = questPointsForWeek(data.quests, startOfQuestWeek(today));
  const weekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 6);
  const weekEvents = data.calendar
    .filter((item) => item.date >= isoDay(today) && item.date <= isoDay(weekEnd))
    .sort((a, b) => a.date.localeCompare(b.date));
  return <section className="page home-page">
    <div className="welcome">
      <div><p className="eyebrow">SATURDAY · FAMILY DAY</p><h1>안녕, {current.name} {current.emoji}</h1><p>오늘도 우리 가족의 재미있는 이야기를 만들어요.</p></div>
      <div className="family-bubbles">{members.map((m) => <span key={m.id} style={{ background: m.color }}>{m.emoji}</span>)}</div>
    </div>

    <div className="hero-grid">
      <article className="card mission-card">
        <div className="card-top"><span className="pill coral">오늘의 가족 미션</span><b>+20 ♥</b></div>
        <div className="mission-title"><span>😝</span><div><h2>오늘 가장 웃긴 표정</h2><p>사진을 남기고 가족의 반응을 기다려보세요!</p></div></div>
        <div className="split-actions">
          <button className="primary coral-bg" onClick={() => setModal("photo")}>📷 미션 도전하기</button>
          <button className="primary navy-bg" onClick={() => setModal("archive")}>▣ 등록 사진 {data.photos.length}</button>
        </div>
      </article>
      <article className="card tree-mini">
        <p className="eyebrow">WEEKEND QUEST</p>
        <FamilyGrove points={weekendPoints} />
        <h3>{weekendPoints} / 100점</h3>
        <p className="growth-caption">{growthCaption(weekendPoints)}</p>
        <div className="progress"><span style={{ width: `${Math.min(100, weekendPoints)}%` }} /></div>
        <button className="text-button" onClick={() => setTab("quests")}>퀘스트 보러 가기 →</button>
      </article>
    </div>

    <article className="card week-agenda">
      <div className="section-heading"><div><p className="eyebrow">THIS WEEK</p><h2>이번 주 가족 일정</h2></div><button onClick={() => setTab("calendar")}>달력 보기 →</button></div>
      {weekEvents.length
        ? <div className="week-agenda-list">{weekEvents.slice(0, 4).map((event) => <div key={event.id}><span>{event.emoji}</span><b>{event.title}</b><small>{new Date(`${event.date}T12:00:00`).toLocaleDateString("ko-KR", { weekday: "short", month: "numeric", day: "numeric" })} · {event.creator}</small></div>)}</div>
        : <p className="week-agenda-empty">이번 주에는 등록된 일정이 없어요. 가족과 하고 싶은 일을 달력에 더해보세요.</p>}
    </article>

    <div className="section-heading"><div><p className="eyebrow">FAMILY MOMENTS</p><h2>최근 가족 순간</h2></div><button onClick={() => setModal("archive")}>모두 보기</button></div>
    <div className="moment-grid">
      <article className="card moment-placeholder">
        {recent ? <><img src={recent.url} alt={recent.caption || "가족 미션 사진"} /><div className="photo-overlay"><b>{recent.caption || "오늘의 웃긴 표정"}</b><small>{recent.author} · 좋아요 {recent.likes.length}</small></div></> : <><span>📸</span><h3>첫 가족 순간을 남겨보세요</h3><p>사진을 찍거나 보관함에서 골라 올릴 수 있어요.</p><button onClick={() => setModal("photo")}>사진 올리기</button></>}
      </article>
      <article className="card week-story">
        <div className="play">▶</div><p className="eyebrow">THIS WEEK</p><h2>이번 주 우리 가족 이야기</h2>
        <p>사진과 댓글을 모아 가족이 함께 다시 보는 주간 앨범이에요.</p>
        <div className="story-stats"><span><b>{data.photos.length}</b> 사진</span><span><b>{data.photos.reduce((s, p) => s + p.comments.length, 0)}</b> 댓글</span></div>
        <small>AI 동영상 만들기는 서버 연결 후 추가될 예정이에요.</small>
      </article>
    </div>
  </section>;
}

function FamilyGrove({ points }: { points: number }) {
  const safePoints = Math.max(0, Math.min(100, points));
  const centerGrowth = Math.min(1, safePoints / 34);
  const sideGrowth = Math.max(0, Math.min(1, (safePoints - 34) / 66));

  return <div className="family-grove" aria-label={`가족 나무 성장도 ${safePoints}점`}>
    <GrowingPlant growth={sideGrowth} side="left" />
    <GrowingPlant growth={centerGrowth} side="center" />
    <GrowingPlant growth={sideGrowth} side="right" />
    <div className="grove-ground" />
  </div>;
}

function GrowingPlant({ growth, side }: { growth: number; side: "left" | "center" | "right" }) {
  const symbol = growth < 0.34 ? "🌱" : growth < 0.75 ? "🌿" : "🌳";
  const scale = side === "center" ? 0.72 + growth * 0.5 : 0.62 + growth * 0.42;

  return <span
    className={`growing-plant ${side}`}
    style={{ transform: `scale(${scale}) translateY(${growth > 0.74 ? "-2px" : "0"})` }}
    aria-hidden="true"
  >{symbol}</span>;
}

function growthCaption(points: number) {
  if (points <= 0) return "새싹 세 개에서 시작해요";
  if (points < 34) return "가운데 나무가 자라는 중";
  if (points < 100) return "양쪽 나무도 함께 자라는 중";
  return "세 나무가 모두 무성해졌어요!";
}

function Quests({ data, setData, current, points, updateQuest, setModal }: { data: FamilyState; setData: (v: FamilyState | ((o: FamilyState) => FamilyState)) => void; current: Member; points: number; updateQuest: (id: string, patch: Partial<Quest>) => void; setModal: (v: "quest") => void }) {
  const [lane, setLane] = useState<QuestStatus>("open");
  const [detailQuest, setDetailQuest] = useState<Quest | null>(null);
  const [showInbox, setShowInbox] = useState(false);
  const openCount = data.quests.filter((q) => q.status === "open").length;
  const sky = openCount >= data.rainThreshold ? "rainy" : openCount <= data.sunnyThreshold ? "sunny" : "cloudy";
  const visible = data.quests.filter((q) => q.status === lane);
  const targeted = data.quests.filter((q) => q.target === current.name && q.status === "open");
  const assigned = data.quests.filter((q) => q.taker === current.name && (q.status === "doing" || q.status === "review"));
  const challenged = data.quests.filter((q) => q.creator === current.name && q.status === "talk");
  const inboxTotal = targeted.length + assigned.length + challenged.length;
  const lanes: [QuestStatus, string][] = [["open", "떠 있는 바람"], ["doing", "도전 중"], ["review", "확인 요청"], ["done", "완료"], ["talk", "같이 이야기해요"]];
  const act = (q: Quest) => {
    if (q.status === "open" && (!q.target || q.target === current.name)) updateQuest(q.id, { status: "doing", taker: current.name });
    else if (q.status === "doing" && q.taker === current.name) updateQuest(q.id, { status: "review" });
    else if (q.status === "review" && q.creator === current.name) updateQuest(q.id, { status: "done", completedAt: new Date().toISOString() });
  };
  return <section className="page">
    <div className="page-title"><div><p className="eyebrow">WEEKEND QUEST</p><h1>함께 해내는 주말</h1><p>제안하고, 약속하고, 서로 확인하면 나무가 자라요.</p></div><button className="primary coral-bg compact wish-add" onClick={() => setModal("quest")}><span>＋</span> 바람 추가</button></div>
    <div className="quest-layout">
      <div>
        <article className="card goal-card"><div><span>우리 가족의 100점 나무</span><h2>{points >= 100 ? "🍕 피자 파티가 열렸어요!" : `${points}점 모았어요`}</h2><div className="progress large"><span style={{ width: `${Math.min(100, points)}%` }} /></div></div><div className="big-tree">{points < 30 ? "🌱" : points < 70 ? "🌿" : "🌳"}</div></article>
        <article className={`wish-sky ${sky}`}>
          <div className="sky-title"><div><h2>{sky === "rainy" ? "🌧️ 구름을 함께 걷어주세요" : sky === "sunny" ? "☀️ 맑은 가족 하늘이에요" : "🌤️ 가족 위에 떠 있는 바람"}</h2><p>구름을 눌러 내용을 확인하고 내가 맡을 수 있어요.</p></div><span>{openCount}개의 바람</span></div>
          <div className="cloud-field">
            {data.quests.filter((q) => q.status === "open").map((q, index) => <button key={q.id} className={`quest-cloud cloud-${index % 4}`} onClick={() => setDetailQuest(q)} title={`${q.title} · ${q.points}점 · 상세 보기`}>
              <span>{q.emoji}</span><b>{q.title.slice(0, 4)}</b><em>+{q.points}</em>
            </button>)}
          </div>
          {showInbox && <div className="quest-inbox-popover">
            <header><div><b>나의 퀘스트 알림</b><small>{inboxTotal ? `${inboxTotal}개의 소식이 있어요` : "새 소식이 없어요"}</small></div><button onClick={() => setShowInbox(false)}>×</button></header>
            <button onClick={() => { setLane("doing"); setShowInbox(false); }}><span>🙋</span><div><b>내가 맡은 퀘스트</b><small>도전 중이거나 확인을 기다리는 일</small></div><em>{assigned.length}</em></button>
            <button onClick={() => { setLane("open"); setShowInbox(false); }}><span>🎯</span><div><b>나를 지정한 바람</b><small>가족이 나에게 부탁한 퀘스트</small></div><em>{targeted.length}</em></button>
            <button onClick={() => { setLane("talk"); setShowInbox(false); }}><span>💬</span><div><b>내 제안에 온 챌린지</b><small>함께 이야기하고 결정할 내용</small></div><em>{challenged.length}</em></button>
          </div>}
          <div className="member-ground">{members.map((m) => {
            const targetCount = data.quests.filter((q) => q.target === m.name && q.status === "open").length;
            const memberPoints = questPointsForWeek(data.quests, startOfQuestWeek(today), m.name);
            const isCurrent = m.name === current.name;
            return <div key={m.id}>
              <button className={`member-avatar ${isCurrent ? "current" : ""}`} style={{ background: m.color }} onClick={() => isCurrent && setShowInbox((old) => !old)} aria-label={isCurrent ? `내 퀘스트 알림 ${inboxTotal}개` : m.name}>
                {m.emoji}{isCurrent && inboxTotal > 0 && <em>{inboxTotal}</em>}
              </button>
              <b>{m.name}</b>
              <strong>{memberPoints}점 달성</strong>
              <small>{isCurrent ? "내가 할게요" : targetCount ? "이 퀘스트 도전해보세요" : "함께할까요?"}</small>
            </div>;
          })}</div>
        </article>
      </div>
      <aside className="recommend card"><p className="eyebrow">RECOMMENDED</p><h3>이런 퀘스트 어때요?</h3>{recommended.map(([title, emoji, points]) => <button key={title} onClick={() => setData((old) => ({ ...old, quests: [{ id: uid("q"), title, emoji, points, creator: current.name, status: "open", createdAt: new Date().toISOString() }, ...old.quests] }))}><span>{emoji}</span><div><b>{title}</b><small>+{points}점</small></div><i>＋</i></button>)}</aside>
    </div>
    <div className="lane-tabs">{lanes.map(([id, title]) => <button key={id} className={lane === id ? "active" : ""} onClick={() => setLane(id)}>{title}<em>{data.quests.filter((q) => q.status === id).length}</em></button>)}</div>
    <div className="quest-list">{visible.length ? visible.map((q) => <article className="quest-item card" key={q.id}><span className="quest-emoji">{q.emoji}</span><div><h3>{q.title}</h3><p className="quest-route"><span>{q.creator}</span><i>→</i><span>{q.target ?? "가족 모두"}</span></p></div><b>+{q.points}</b>{q.status !== "done" && q.status !== "talk" ? <button disabled={q.status === "open" && Boolean(q.target && q.target !== current.name)} onClick={() => act(q)}>{q.status === "open" ? (q.target && q.target !== current.name ? `${q.target} 전용` : "내가 할게요") : q.status === "doing" ? "완료했어요" : q.creator === current.name ? "확인하기" : "확인 기다리는 중"}</button> : null}</article>) : <div className="empty">지금 이곳에는 퀘스트가 없어요.</div>}</div>
    {detailQuest && <QuestDetailModal
      quest={detailQuest}
      current={current}
      onClose={() => setDetailQuest(null)}
      onTake={() => {
        act(detailQuest);
        setLane("doing");
        setDetailQuest(null);
      }}
    />}
  </section>;
}

function QuestDetailModal({ quest, current, onClose, onTake }: { quest: Quest; current: Member; onClose: () => void; onTake: () => void }) {
  const canTake = !quest.target || quest.target === current.name;
  return <Modal title="퀘스트 상세" onClose={onClose}>
    <div className="quest-detail-hero">
      <span>{quest.emoji}</span>
      <div><p>FAMILY WISH</p><h2>{quest.title}</h2></div>
      <strong>+{quest.points}점</strong>
    </div>
    <dl className="quest-detail-list">
      <div><dt>제안한 사람</dt><dd>{quest.creator}</dd></div>
      <div><dt>부탁받은 사람</dt><dd>{quest.target ?? "가족 누구나"}</dd></div>
      <div><dt>현재 상태</dt><dd>가족 하늘에 떠 있어요</dd></div>
    </dl>
    <div className="quest-agreement">
      <span>✓</span>
      <p><b>퀘스트 약속</b><small>가져가면 내용과 {quest.points}점에 동의하고 도전을 시작해요.</small></p>
    </div>
    {canTake
      ? <button className="primary coral-bg full" onClick={onTake}>동의하고 내가 할게요</button>
      : <div className="target-notice">🔒 이 퀘스트는 <b>{quest.target}</b>에게 부탁한 바람이에요.<br />내용은 모든 가족이 함께 볼 수 있어요.</div>}
  </Modal>;
}

function Chat({ data, setData, current }: { data: FamilyState; setData: (v: FamilyState | ((o: FamilyState) => FamilyState)) => void; current: Member }) {
  const [peer, setPeer] = useState<string | undefined>();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const messages = data.messages.filter((m) => peer ? (m.sender === current.name && m.recipient === peer) || (m.sender === peer && m.recipient === current.name) : !m.recipient);
  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) setFile(selected);
    event.target.value = "";
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if ((!text.trim() && !file) || busy) return;
    setBusy(true);
    try {
      let attachment: MessageAttachment | undefined;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/media", { method: "POST", body: form });
        const result = await response.json() as MessageAttachment & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "파일을 보내지 못했어요.");
        attachment = { url: result.url, name: result.name, type: result.type, size: result.size };
      }
      setData((old) => ({ ...old, messages: [...old.messages, { id: uid("m"), sender: current.name, recipient: peer, text: text.trim(), attachment, sentAt: new Date().toISOString() }] }));
      setText("");
      setFile(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "메시지를 보내지 못했어요.");
    } finally {
      setBusy(false);
    }
  };
  return <section className="page chat-page">
    <div className="page-title"><div><p className="eyebrow">FAMILY CHAT</p><h1>우리 가족 채팅</h1><p>가족 모두에게, 또는 한 사람에게 이야기해요.</p></div></div>
    <div className="chat-shell card">
      <div className="chat-people" role="navigation" aria-label="채팅 상대 선택"><button className={!peer ? "active" : ""} onClick={() => setPeer(undefined)}><span>👨‍👩‍👧‍👦</span><div><b>모두</b><small>우리 가족 모두랑</small></div></button>{members.filter((m) => m.name !== current.name).map((m) => <button className={peer === m.name ? "active" : ""} key={m.id} onClick={() => setPeer(m.name)}><span style={{ background: m.color }}>{m.emoji}</span><div><b>{m.name}</b><small>{m.role}</small></div></button>)}</div>
      <div className="conversation">
        <header><b>{peer ?? "같이 하고 싶은 거 있어?"}</b><small>{peer ? "개인 대화" : "좋은 생각 있어?"}</small></header>
        <div className="bubbles">{messages.map((m) => <div className={m.sender === current.name ? "mine" : ""} key={m.id}><small>{m.sender}</small>{m.text && <p>{m.text}</p>}{m.attachment && (m.attachment.type.startsWith("image/") ? <a href={m.attachment.url} target="_blank" rel="noreferrer"><img className="chat-image" src={m.attachment.url} alt={m.attachment.name} /></a> : <a className="chat-file" href={m.attachment.url} target="_blank" rel="noreferrer"><span>📎</span><div><b>{m.attachment.name}</b><small>{formatFileSize(m.attachment.size)}</small></div></a>)}</div>)}</div>
        {file && <div className="attachment-preview"><span>📎 {file.name} · {formatFileSize(file.size)}</span><button onClick={() => setFile(null)}>×</button></div>}
        <form className="chat-composer" onSubmit={send}>
          <div className="chat-tools">
            <label title="카메라로 촬영">📷<input type="file" accept="image/*" capture="environment" onChange={pickFile} /></label>
            <label title="사진·파일 선택">📎<input type="file" accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip" onChange={pickFile} /></label>
          </div>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="메시지와 사진·파일을 보내보세요" />
          <button disabled={busy || (!text.trim() && !file)}>{busy ? "…" : "➤"}</button>
        </form>
      </div>
    </div>
  </section>;
}

function Stats({ data, current }: { data: FamilyState; current: Member }) {
  const currentStart = startOfQuestWeek(today);
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const start = new Date(currentStart);
    start.setDate(start.getDate() - (7 - index) * 7);
    const familyPoints = questPointsForWeek(data.quests, start);
    const myPoints = questPointsForWeek(data.quests, start, current.name);
    return { start, familyPoints, myPoints, current: index === 7 };
  });
  const currentEnd = new Date(currentStart);
  currentEnd.setDate(currentEnd.getDate() + 6);
  const myAssigned = data.quests.filter((quest) => quest.target === current.name || quest.taker === current.name);
  const myDone = myAssigned.filter((quest) => quest.status === "done");
  const myProposed = data.quests.filter((quest) => quest.creator === current.name);
  const myCompletionRate = myAssigned.length ? Math.round(myDone.length / myAssigned.length * 100) : 0;
  const myTotalPoints = myDone.reduce((sum, quest) => sum + quest.points, 0);
  const currentFamilyPoints = questPointsForWeek(data.quests, currentStart);
  const maxChartPoints = Math.max(100, ...weeks.map((week) => week.familyPoints));
  const memberStats = members.map((member) => ({
    ...member,
    points: questPointsForWeek(data.quests, currentStart, member.name),
    done: data.quests.filter((quest) => completedInWeek(quest, currentStart) && (quest.taker === member.name || (!quest.taker && quest.target === member.name))).length,
  })).sort((a, b) => b.points - a.points);
  const statusRows = [
    { label: "완료한 일", value: myDone.length, color: "#23745b" },
    { label: "진행 중", value: myAssigned.filter((quest) => quest.status === "doing" || quest.status === "review").length, color: "#ff9a62" },
    { label: "아직 기다리는 일", value: myAssigned.filter((quest) => quest.status === "open").length, color: "#8ea1b7" },
  ];
  const maxStatus = Math.max(1, ...statusRows.map((row) => row.value));

  return <section className="page stats-page">
    <div className="page-title"><div><p className="eyebrow">FAMILY STATISTICS</p><h1>우리 가족 주간 기록</h1><p>매주 토요일 새 목표가 시작되고, 지난 기록은 계속 남아요.</p></div><span className="week-range">{currentStart.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} 토 – {currentEnd.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} 금</span></div>

    <div className="stats-summary">
      <article className="card stats-highlight"><span>이번 주 가족 점수</span><strong>{currentFamilyPoints}<small>/100점</small></strong><div className="progress large"><span style={{ width: `${Math.min(100, currentFamilyPoints)}%` }} /></div><p>{currentFamilyPoints >= 100 ? "🍕 이번 주 피자 파티 목표 달성!" : `목표까지 ${100 - currentFamilyPoints}점 남았어요.`}</p></article>
      <article className="card stat-number"><span>내가 해낸 일</span><strong>{myDone.length}</strong><small>전체 기록</small></article>
      <article className="card stat-number"><span>내가 모은 점수</span><strong>{myTotalPoints}</strong><small>전체 기록</small></article>
      <article className="card stat-number"><span>나의 완료율</span><strong>{myCompletionRate}%</strong><small>받은 일 기준</small></article>
    </div>

    <div className="stats-grid">
      <article className="card weekly-chart">
        <div className="stats-card-title"><div><p className="eyebrow">8 WEEK HISTORY</p><h2>주간 점수 그래프</h2></div><div className="chart-legend"><span><i className="family-color" />가족</span><span><i className="mine-color" />나</span></div></div>
        <div className="bar-chart" aria-label="최근 8주 가족 및 개인 점수 그래프">
          {weeks.map((week) => <div className={`week-bar ${week.current ? "current" : ""}`} key={week.start.toISOString()}>
            <div className="bar-values"><span style={{ height: `${Math.max(3, week.familyPoints / maxChartPoints * 100)}%` }} title={`가족 ${week.familyPoints}점`}><b>{week.familyPoints || ""}</b></span><i style={{ height: `${Math.max(3, week.myPoints / maxChartPoints * 100)}%` }} title={`나 ${week.myPoints}점`}><b>{week.myPoints || ""}</b></i></div>
            <small>{weekLabel(week.start)}</small>
          </div>)}
        </div>
        <p className="chart-note">토요일 0시에 새 주가 시작됩니다. 완료 확인된 점수만 그래프에 반영돼요.</p>
      </article>

      <article className="card my-stats">
        <div className="stats-card-title"><div><p className="eyebrow">MY QUESTS</p><h2>{current.emoji} {current.name}의 통계</h2></div></div>
        <div className="my-counts"><span><b>{myAssigned.length}</b>주어진 일</span><span><b>{myDone.length}</b>해낸 일</span><span><b>{myProposed.length}</b>제안한 일</span></div>
        <div className="status-chart">{statusRows.map((row) => <div key={row.label}><label><span>{row.label}</span><b>{row.value}</b></label><i><span style={{ width: `${row.value / maxStatus * 100}%`, background: row.color }} /></i></div>)}</div>
      </article>
    </div>

    <article className="card family-ranking">
      <div className="stats-card-title"><div><p className="eyebrow">THIS WEEK</p><h2>이번 주 가족 기록</h2></div><small>순위 경쟁보다 서로의 수고를 발견하는 기록이에요.</small></div>
      <div className="ranking-grid">{memberStats.map((member, index) => <div key={member.id}><em>{index + 1}</em><span style={{ background: member.color }}>{member.emoji}</span><div><b>{member.name}</b><small>{member.done}개 완료</small></div><strong>{member.points}점</strong></div>)}</div>
    </article>
  </section>;
}

function Calendar({ data, onAddEvent }: { data: FamilyState; onAddEvent: (date: string) => void }) {
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return [...Array(first.getDay()).fill(null), ...Array.from({ length: last.getDate() }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))];
  }, [cursor]);
  return <section className="page">
    <div className="page-title"><div><p className="eyebrow">FAMILY CALENDAR</p><h1>가족 캘린더</h1><p>누가 등록했는지 한눈에 확인해요.</p></div><button className="primary navy-bg compact" onClick={() => onAddEvent(isoDay(today))}>＋ 일정 추가</button></div>
    <article className="calendar card">
      <header><button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹</button><h2>{cursor.getFullYear()}년 {cursor.getMonth() + 1}월</h2><button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>›</button></header>
      <div className="weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((d) => <b key={d}>{d}</b>)}</div>
      <div className="calendar-grid">{cells.map((date, index) => <div className={!date ? "blank" : isoDay(date) === isoDay(today) ? "today" : ""} key={date?.toISOString() ?? `b${index}`}>{date && <><div className="calendar-day-head"><strong>{date.getDate()}</strong><button className="calendar-add" onClick={() => onAddEvent(isoDay(date))} aria-label={`${date.getDate()}일에 일정 추가`}>＋</button></div>{data.calendar.filter((e) => e.date === isoDay(date)).map((event) => <button className="calendar-event" key={event.id} title={`${event.creator}님이 등록`}><span>{event.emoji}</span>{event.title}<small>{event.creator}</small></button>)}</>}</div>)}</div>
    </article>
    <p className="calendar-note">현재 버전에서는 등록한 사람이 일정을 추가할 수 있어요. 드래그 이동과 수정은 다음 버전에 추가합니다.</p>
  </section>;
}

function Settings({
  data,
  setData,
  notifications,
  busy,
  message,
  enableNotifications,
  disableNotifications,
}: {
  data: FamilyState;
  setData: (v: FamilyState) => void;
  notifications: NotificationState;
  busy: boolean;
  message: string;
  enableNotifications: () => void;
  disableNotifications: () => void;
}) {
  return <section className="page settings-page"><div className="page-title"><div><p className="eyebrow">SETTINGS</p><h1>가족 공간 설정</h1><p>우리 가족에게 맞게 하늘의 날씨 기준을 바꿔보세요.</p></div></div>
    <article className="card notification-card">
      <div className="notification-icon">🔔</div>
      <div>
        <p className="eyebrow">NOTIFICATIONS</p>
        <h2>채팅·퀘스트 알림</h2>
        <p>{notifications.subscribed ? "이 기기에서 새 가족 소식을 바로 알려드려요." : "새 채팅과 나에게 온 퀘스트를 잠금 화면과 앱 아이콘으로 알려드려요."}</p>
        {!notifications.supported && <small>iPhone·iPad에서는 Safari의 ‘홈 화면에 추가’로 설치한 다음 이 버튼을 눌러주세요.</small>}
        {message && <small className="notification-message">{message}</small>}
      </div>
      <button className={notifications.subscribed ? "secondary" : "primary"} disabled={busy} onClick={notifications.subscribed ? disableNotifications : enableNotifications}>
        {busy ? "설정 중…" : notifications.subscribed ? "이 기기 알림 끄기" : "알림 켜기"}
      </button>
    </article>
    <article className="card setting-card"><h2>퀘스트 하늘 날씨</h2><label><span><b>맑은 하늘</b><small>열린 퀘스트가 이 개수 이하면 맑아져요.</small></span><input type="number" min="1" max="20" value={data.sunnyThreshold} onChange={(e) => setData({ ...data, sunnyThreshold: Number(e.target.value) })} /></label><label><span><b>비 오는 하늘</b><small>열린 퀘스트가 이 개수 이상이면 비가 와요.</small></span><input type="number" min={data.sunnyThreshold + 1} max="40" value={data.rainThreshold} onChange={(e) => setData({ ...data, rainThreshold: Number(e.target.value) })} /></label></article>
    <article className="card unavailable"><h2>이번 웹 버전에서 제외한 기능</h2><ul><li>Google Photos 자동 연동</li><li>AI 가족 동영상 자동 생성</li><li>브라우저 음성 인식</li><li>Apple 가족 계정 자동 연동</li></ul><p>외부 계정과 안전한 서버 설정이 준비되면 하나씩 추가할 수 있어요.</p></article>
    <article className="card install-card">
      <span>📲</span>
      <div>
        <h2>홈 화면에 설치하기</h2>
        <p>휴대폰·태블릿 기종보다 지금 사용하는 <b>브라우저 메뉴</b>가 중요해요. 설치하면 홈 화면 아이콘을 눌러 앱처럼 열 수 있습니다.</p>
        <ol className="install-steps">
          <li><b>iPhone·iPad Safari</b><span>아래쪽 공유 버튼(□↑) → <strong>홈 화면에 추가</strong> → 추가</span></li>
          <li><b>Galaxy·Android Chrome</b><span>아래의 설치 버튼을 누르세요. 버튼이 없으면 오른쪽 위 점 3개(⋮) → <strong>홈 화면에 추가</strong> 또는 <strong>앱 설치</strong>를 확인하세요.</span></li>
        </ol>
        <InstallAppButton />
        <small>메뉴가 보이지 않으면 Safari 또는 Chrome에서 <b>baefamily.github.io</b>를 직접 연 뒤 다시 시도하세요.</small>
      </div>
    </article>
  </section>;
}

function InstallAppButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const ready = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const done = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", done);
    };
  }, []);

  if (installed) return <p className="install-status">✓ 이 기기의 홈 화면에 설치되어 있어요.</p>;
  if (!prompt) return null;
  return <button className="primary install-button" onClick={async () => {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setPrompt(null);
  }}>📲 이 기기에 Our Family 설치</button>;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function updateAppBadge(count: number) {
  const badgeNavigator = navigator as Navigator & {
    setAppBadge?: (value?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0) badgeNavigator.setAppBadge?.(count).catch(() => undefined);
  else badgeNavigator.clearAppBadge?.().catch(() => undefined);
}

function PhotoModal({ current, onClose, onSave }: { current: Member; onClose: () => void; onSave: (p: Photo) => void }) {
  const [preview, setPreview] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const select = (e: ChangeEvent<HTMLInputElement>) => { const picked = e.target.files?.[0]; if (picked) { setFile(picked); setPreview(URL.createObjectURL(picked)); } };
  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/media", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSave({ id: uid("p"), url: result.url, author: current.name, caption, createdAt: new Date().toISOString(), likes: [], dislikes: [], comments: [] }); onClose();
    } catch (error) { alert(error instanceof Error ? error.message : "사진을 올리지 못했어요."); } finally { setBusy(false); }
  };
  return <Modal title="오늘 가장 웃긴 표정" onClose={onClose}><div className="photo-picker">{preview ? <img src={preview} alt="선택한 사진 미리보기" /> : <span>😝</span>}<div className="pick-actions"><label>📷 사진 찍기<input type="file" accept="image/*" capture="user" onChange={select} /></label><label>▣ 보관함에서 선택<input type="file" accept="image/*" onChange={select} /></label></div></div><label className="field">한마디 남기기<textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="가족에게 보여줄 짧은 말을 적어주세요" /></label><button className="primary coral-bg full" disabled={!file || busy} onClick={save}>{busy ? "사진 올리는 중…" : "미션 사진 등록하기"}</button></Modal>;
}

function PhotoArchive({ data, setData, current, onClose }: { data: FamilyState; setData: (v: FamilyState | ((o: FamilyState) => FamilyState)) => void; current: Member; onClose: () => void }) {
  const vote = (id: string, kind: "likes" | "dislikes") => {
    setData((old) => ({
      ...old,
      photos: old.photos.map((photo) => {
        if (photo.id !== id) return photo;
        const isLike = kind === "likes";
        const selected = isLike ? photo.likes : photo.dislikes;
        const nextSelected = selected.includes(current.name)
          ? selected.filter((name) => name !== current.name)
          : [...selected.filter((name) => name !== current.name), current.name];
        return {
          ...photo,
          likes: isLike ? nextSelected : photo.likes.filter((name) => name !== current.name),
          dislikes: isLike ? photo.dislikes.filter((name) => name !== current.name) : nextSelected,
        };
      }),
    }));
  };
  return <Modal title="등록된 가족 표정" onClose={onClose} wide><div className="archive-grid">{data.photos.length ? data.photos.map((p) => <article className={`archive-photo ${p.likes.length >= 4 ? "all-liked" : p.dislikes.length >= 3 ? "talk-needed" : ""}`} key={p.id}><img src={p.url} alt={p.caption || "가족 표정"} /><div><b>{p.caption || "오늘의 웃긴 표정"}</b><small>{new Date(p.createdAt).toLocaleDateString("ko-KR")} · {p.author}</small><div className="vote-row"><button onClick={() => vote(p.id, "likes")}>♥ {p.likes.length}</button><button onClick={() => vote(p.id, "dislikes")}>👎 {p.dislikes.length}</button>{p.likes.length >= 4 && <em>✨ 모두가 좋아해요</em>}{p.dislikes.length >= 3 && <em>💬 같이 이야기해요</em>}</div></div></article>) : <div className="empty">아직 등록된 사진이 없어요.</div>}</div></Modal>;
}

function QuestModal({ current, onClose, onSave }: { current: Member; onClose: () => void; onSave: (q: Quest) => void }) {
  const [title, setTitle] = useState(""); const [emoji, setEmoji] = useState("✨"); const [points, setPoints] = useState(10); const [target, setTarget] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); if (!title.trim()) return; onSave({ id: uid("q"), title: title.trim(), emoji, points, creator: current.name, target: target || undefined, status: "open", createdAt: new Date().toISOString() }); onClose(); };
  return <Modal title="새로운 바람 띄우기" onClose={onClose}><form className="stack-form" onSubmit={submit}><label className="field">퀘스트 이름<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 함께 저녁 산책하기" /></label><fieldset className="quest-icon-field"><legend>아이콘 선택</legend><div className="quest-icon-picker">{questIcons.map((icon) => <button type="button" className={emoji === icon ? "selected" : ""} key={icon} onClick={() => setEmoji(icon)} aria-label={`${icon} 아이콘 선택`}>{icon}</button>)}</div></fieldset><div className="two-fields"><label className="field">선택한 아이콘<input value={emoji} readOnly /></label><label className="field">점수<select value={points} onChange={(e) => setPoints(Number(e.target.value))}><option>5</option><option>10</option><option>15</option><option>20</option></select></label></div><label className="field">누구에게 부탁할까요?<select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">누구나</option>{members.map((m) => <option key={m.id}>{m.name}</option>)}</select></label><button className="primary coral-bg full">가족 하늘에 띄우기</button></form></Modal>;
}

function EventModal({ current, initialDate, onClose, onSave }: { current: Member; initialDate: string; onClose: () => void; onSave: (e: CalendarItem) => void }) {
  const [title, setTitle] = useState(""); const [emoji, setEmoji] = useState("📌"); const [date, setDate] = useState(initialDate);
  const submit = (e: FormEvent) => { e.preventDefault(); if (!title.trim()) return; onSave({ id: uid("c"), title: title.trim(), emoji, date, creator: current.name }); onClose(); };
  return <Modal title="가족 일정 추가" onClose={onClose}><form className="stack-form" onSubmit={submit}><label className="field">일정 이름<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 가족 영화의 밤" /></label><div className="two-fields"><label className="field">아이콘<input value={emoji} onChange={(e) => setEmoji(e.target.value)} /></label><label className="field">날짜<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div><button className="primary navy-bg full">일정 등록하기</button></form></Modal>;
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true"><header><div><p className="eyebrow">OUR FAMILY</p><h2>{title}</h2></div><button onClick={onClose} aria-label="닫기">×</button></header>{children}</section></div>;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
