import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, User, Sparkles, Headset, ArrowLeft, MessageSquarePlus, CircleDot, CircleCheck, Inbox, Loader2, Maximize2, Minimize2, Paperclip, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useClientAuth } from "@/contexts/client-auth";
import { useCabinetConfig } from "@/contexts/cabinet-config";
import { api, type TicketAttachmentDto } from "@/lib/api";

// Синхронизировано с backend (uploadTicketAttachment).
const TICKET_MAX_FILES = 5;
const TICKET_MAX_FILE_MB = 10;
const TICKET_MAX_FILE_BYTES = TICKET_MAX_FILE_MB * 1024 * 1024;

function TicketAttachments({ items }: { items: TicketAttachmentDto[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={cn("mt-1.5 grid gap-1", items.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
      {items.map((a, i) => (
        <a
          key={`${a.url}-${i}`}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-lg border border-white/10 bg-black/10 hover:opacity-90 transition-opacity"
        >
          <img src={a.url} alt={a.name ?? "attachment"} className="w-full max-h-44 object-cover" loading="lazy" />
        </a>
      ))}
    </div>
  );
}

type Message = {
  id: string;
  text: string;
  from: "user" | "bot";
  time: string;
};

type ChatType = "ai" | "support";

function getInitialAiMessage(serviceName: string): Message[] {
  const name = (serviceName || "Сервис").trim() || "Сервис";
  return [
    {
      id: "a1",
      text: `Привет! Я AI-ассистент ${name} ✨ Готов помочь с настройкой VPN, тарифами и любыми другими вопросами. Что вас интересует?`,
      from: "bot",
      time: "10:00",
    },
  ];
}

const ChatSwitcher = ({ activeChat, setActiveChat, aiUnread, supportUnread, isFloating = false, showAiTab = true }: any) => {
  if (!showAiTab) {
    return (
      <div className={cn(
        "relative flex p-1 w-full sm:w-auto sm:min-w-[200px]",
        isFloating
          ? "bg-black/20 dark:bg-white/10 backdrop-blur-md rounded-2xl border border-white/10 shadow-lg pointer-events-auto"
          : "bg-black/20 backdrop-blur-sm border border-white/5 rounded-xl"
      )}>
        <button
          onClick={() => setActiveChat("support")}
          className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold text-primary-foreground bg-primary relative z-10"
        >
          <Headset className="w-4 h-4" /> Поддержка
          {supportUnread > 0 && (
            <span className="ml-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
              {supportUnread}
            </span>
          )}
        </button>
      </div>
    );
  }
  return (
  <div className={cn(
    "relative flex p-1 w-full sm:w-auto sm:min-w-[320px]",
    isFloating 
      ? "bg-black/20 dark:bg-white/10 backdrop-blur-md rounded-2xl border border-white/10 shadow-lg pointer-events-auto" 
      : "bg-black/20 backdrop-blur-sm border border-white/5 rounded-xl"
  )}>
    <button
      onClick={() => setActiveChat("ai")}
      className={cn(
        "flex-1 sm:flex-none sm:w-[160px] flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all duration-300 relative z-10",
        activeChat === "ai" ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
      )}
    >
      <Sparkles className="w-4 h-4" /> AI Чат
      {aiUnread > 0 && activeChat !== "ai" && (
        <span className="ml-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {aiUnread}
        </span>
      )}
    </button>
    <button
      onClick={() => setActiveChat("support")}
      className={cn(
        "flex-1 sm:flex-none sm:w-[160px] flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all duration-300 relative z-10",
        activeChat === "support" ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
      )}
    >
      <Headset className="w-4 h-4" /> Поддержка
      {supportUnread > 0 && activeChat !== "support" && (
        <span className="ml-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
          {supportUnread}
        </span>
      )}
    </button>
    {/* Sliding Background */}
    <div
      className="absolute top-1 bottom-1 bg-primary shadow-md rounded-lg transition-all duration-300 ease-out z-0 w-[calc(50%-4px)] sm:w-[160px]"
      style={{
        transform: activeChat === "ai" ? "translateX(0)" : "translateX(100%)",
        left: "4px",
      }}
    />
  </div>
  );
};

const ChatHeader = ({ activeChat, setActiveChat, isExpanded, setIsExpanded, setIsOpen, aiUnread, supportUnread, showAiTab = true }: any) => (
  <>
    <div className="px-4 py-3 sm:py-4 border-b border-white/5 bg-black/5 dark:bg-white/5 shrink-0 relative overflow-hidden pt-[max(env(safe-area-inset-top),16px)] sm:pt-4">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent pointer-events-none" />
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary shadow-inner">
            {activeChat === "ai" ? <Sparkles className="h-5 w-5" /> : <Headset className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-base font-bold text-foreground leading-tight">
              {activeChat === "ai" ? "AI Ассистент" : "Поддержка"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 font-medium flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              {activeChat === "ai" ? "Бот онлайн" : "Операторы онлайн"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="hidden sm:flex rounded-full p-2 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-full p-2 hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="h-6 w-6 sm:h-5 sm:w-5" />
          </button>
        </div>
      </div>
    </div>

    {/* Chat Switcher */}
    {showAiTab && (
      <div className="flex sm:justify-center px-4 py-3 sm:py-4 shrink-0 bg-black/5 dark:bg-white/5 border-b border-white/5">
        <ChatSwitcher activeChat={activeChat} setActiveChat={setActiveChat} aiUnread={aiUnread} supportUnread={supportUnread} showAiTab={showAiTab} />
      </div>
    )}
  </>
);

function SupportTab({ headerProps, onRefreshUnread }: { headerProps: any, onRefreshUnread?: () => void }) {
  const { state } = useClientAuth();
  const token = state.token ?? null;

  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const replyInputRef = useRef<HTMLInputElement>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const newInputRef = useRef<HTMLInputElement>(null);
  const [createSending, setCreateSending] = useState(false);

  const addFiles = (
    setList: (files: File[]) => void,
    current: File[],
    incoming: FileList | null,
  ) => {
    if (!incoming) return;
    setUploadError(null);
    const next: File[] = [...current];
    for (const f of Array.from(incoming)) {
      if (next.length >= TICKET_MAX_FILES) {
        setUploadError(`Не больше ${TICKET_MAX_FILES} файлов`);
        break;
      }
      if (!f.type.startsWith("image/")) {
        setUploadError("Можно прикладывать только изображения");
        continue;
      }
      if (f.size > TICKET_MAX_FILE_BYTES) {
        setUploadError(`Файл больше ${TICKET_MAX_FILE_MB} MB`);
        continue;
      }
      next.push(f);
    }
    setList(next);
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadList = () => {
    if (!token) return;
    api.getTickets(token).then((r) => {
      setList(r.items);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    loadList();
    const intervalId = window.setInterval(loadList, 10000);
    return () => window.clearInterval(intervalId);
  }, [token]);

  useEffect(() => {
    if (!detailId || !token) {
      setDetail(null);
      return;
    }
    const loadDetail = () => {
      setDetailLoading(true);
      api.getTicket(token, detailId)
        .then((t) => setDetail(t))
        .catch(() => setDetail(null))
        .finally(() => setDetailLoading(false));
    };
    loadDetail();
    if (onRefreshUnread) onRefreshUnread();
    const intervalId = window.setInterval(loadDetail, 10000);
    return () => window.clearInterval(intervalId);
  }, [detailId, token]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  useEffect(() => {
    if (detail?.messages) {
      scrollToBottom();
    }
  }, [detail?.messages?.length]);

  const sendReply = () => {
    if (!token || !detailId) return;
    if (!replyText.trim() && replyFiles.length === 0) return;
    setReplySending(true);
    setUploadError(null);
    api.replyTicket(token, detailId, { content: replyText.trim(), files: replyFiles })
      .then((msg) => {
        setDetail((d: any) => (d ? { ...d, messages: [...d.messages, msg] } : d));
        setReplyText("");
        setReplyFiles([]);
        if (replyInputRef.current) replyInputRef.current.value = "";
        scrollToBottom();
      })
      .catch((e) => setUploadError(e instanceof Error ? e.message : "Не удалось отправить"))
      .finally(() => setReplySending(false));
  };

  const createTicket = () => {
    if (!token || !newSubject.trim()) return;
    if (!newMessage.trim() && newFiles.length === 0) return;
    setCreateSending(true);
    setUploadError(null);
    api.createTicket(token, { subject: newSubject.trim(), message: newMessage.trim(), files: newFiles })
      .then((t) => {
        setList((prev) => [{ id: t.id, subject: t.subject, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt }, ...prev]);
        setDetailId(t.id);
        setDetail({ id: t.id, subject: t.subject, status: t.status, messages: t.messages, createdAt: t.createdAt, updatedAt: t.updatedAt });
        setShowNewForm(false);
        setNewSubject("");
        setNewMessage("");
        setNewFiles([]);
        if (newInputRef.current) newInputRef.current.value = "";
      })
      .catch((e) => setUploadError(e instanceof Error ? e.message : "Не удалось создать тикет"))
      .finally(() => setCreateSending(false));
  };

  const formatDate = (s: string) => {
    try {
      const d = new Date(s);
      const isToday = new Date().toDateString() === d.toDateString();
      if (isToday) return "Сегодня, " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    } catch {
      return s;
    }
  };

  // 1. Detail View (Chat inside a ticket)
  if (detailId) {
    return (
      <div className="flex flex-col flex-1 min-h-0 w-full">
        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-gradient-to-b from-transparent to-black/5 scroll-smooth custom-scrollbar flex flex-col">
          <ChatHeader {...headerProps} />
          
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-black/5 dark:border-white/5 bg-background/90 backdrop-blur-md shrink-0">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full" onClick={() => setDetailId(null)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold truncate">{detail?.subject || "Загрузка..."}</h3>
              {detail && (
                <span className={cn("text-[10px] uppercase font-bold tracking-wider", detail.status === "open" ? "text-emerald-500" : "text-muted-foreground")}>
                  {detail.status === "open" ? "Открыт" : "Закрыт"}
                </span>
              )}
            </div>
          </div>
          
          {/* Messages */}
          <div className="p-4 space-y-4 flex-1">
            {detailLoading && !detail ? (
              <div className="flex justify-center items-center h-full"><Loader2 className="h-6 w-6 animate-spin text-primary/50" /></div>
            ) : detail?.messages?.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm font-medium">Нет сообщений</div>
            ) : (
              <AnimatePresence mode="popLayout">
                {detail?.messages?.map((m: any) => {
                  const isSupport = m.authorType === "support";
                  const isUser = !isSupport;
                  return (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className={cn("flex gap-3 max-w-[85%]", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}
                    >
                      <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm mt-1", isUser ? "bg-primary/20 text-primary" : "bg-blue-500/20 text-blue-400")}>
                        {isUser ? <User className="h-4 w-4" /> : <Headset className="h-4 w-4" />}
                      </div>
                      <div className={cn("rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed shadow-sm backdrop-blur-md", isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-card/60 border border-white/5 text-foreground rounded-tl-sm")}>
                        {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                        <TicketAttachments items={m.attachments ?? []} />
                        <p className={cn("text-[10px] mt-1.5 opacity-60 font-medium", isUser ? "text-right" : "text-left text-muted-foreground")}>
                          {formatDate(m.createdAt)}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
            <div ref={messagesEndRef} className="h-1" />
          </div>
        </div>

        {/* Input area */}
        {detail?.status === "open" && (
          <div className="p-3 sm:p-4 border-t border-black/5 dark:border-white/5 bg-background/80 sm:bg-background/50 backdrop-blur-xl shrink-0 pb-[max(env(safe-area-inset-bottom),16px)] sm:pb-4">
            {replyFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {replyFiles.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="relative flex items-center gap-1.5 rounded-lg border border-white/10 bg-background/60 px-1.5 py-1 backdrop-blur-md"
                  >
                    <img
                      src={URL.createObjectURL(f)}
                      alt={f.name}
                      className="h-8 w-8 rounded-md object-cover"
                      onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                    />
                    <span className="text-[10px] text-muted-foreground max-w-[90px] truncate font-medium">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setReplyFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      className="flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground"
                      aria-label="Удалить"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {uploadError && (
              <p className="mb-1.5 text-[10px] text-destructive text-center font-semibold">{uploadError}</p>
            )}
            <div className="relative flex items-end gap-2 bg-black/5 dark:bg-black/20 p-1.5 rounded-2xl border border-black/5 dark:border-white/10 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 transition-all">
              <input
                ref={replyInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => addFiles(setReplyFiles, replyFiles, e.target.files)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-xl shrink-0 text-muted-foreground hover:text-foreground mb-0.5"
                onClick={() => replyInputRef.current?.click()}
                disabled={replyFiles.length >= TICKET_MAX_FILES}
                aria-label="Прикрепить фото"
                title="Прикрепить фото"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <textarea
                className="flex-1 max-h-32 min-h-[40px] w-full resize-none bg-transparent px-2 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none custom-scrollbar"
                placeholder="Сообщение..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                rows={1}
              />
              <Button
                size="icon"
                className="h-10 w-10 rounded-xl shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-transform active:scale-95 mb-0.5 mr-0.5"
                onClick={sendReply}
                disabled={replySending || (!replyText.trim() && replyFiles.length === 0)}
              >
                {replySending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 ml-0.5" />}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 2. New Ticket Form
  if (showNewForm) {
    return (
      <div className="flex flex-col flex-1 min-h-0 w-full overflow-y-auto scroll-smooth custom-scrollbar">
        <ChatHeader {...headerProps} />
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-black/5 dark:border-white/5 bg-background/90 backdrop-blur-md shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-full -ml-2" onClick={() => setShowNewForm(false)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-base font-bold text-foreground">Новое обращение</h3>
        </div>
        <div className="p-4 sm:p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Тема</label>
            <input
              className="w-full rounded-2xl h-12 bg-black/5 dark:bg-black/20 border border-black/5 dark:border-white/10 px-4 text-sm font-medium text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
              placeholder="Коротко о проблеме"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Сообщение</label>
            <textarea
              className="w-full resize-none rounded-2xl min-h-[120px] bg-black/5 dark:bg-black/20 border border-black/5 dark:border-white/10 p-4 text-sm font-medium text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all custom-scrollbar"
              placeholder="Подробное описание..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Вложения</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={newInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => addFiles(setNewFiles, newFiles, e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => newInputRef.current?.click()}
                disabled={newFiles.length >= TICKET_MAX_FILES}
                className="gap-2 h-9 rounded-xl"
              >
                <Paperclip className="h-4 w-4" />
                Фото ({newFiles.length}/{TICKET_MAX_FILES})
              </Button>
              {newFiles.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="relative flex items-center gap-1.5 rounded-lg border border-white/10 bg-background/60 px-1.5 py-1 backdrop-blur-md"
                >
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="h-8 w-8 rounded-md object-cover"
                    onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                  />
                  <span className="text-[10px] text-muted-foreground max-w-[90px] truncate font-medium">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => setNewFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="flex h-4 w-4 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:text-foreground"
                    aria-label="Удалить"
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {uploadError && (
            <p className="text-[11px] text-destructive font-semibold ml-1">{uploadError}</p>
          )}
          <Button
            className="w-full h-11 rounded-xl shadow-md bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
            onClick={createTicket}
            disabled={createSending || !newSubject.trim() || (!newMessage.trim() && newFiles.length === 0)}
          >
            {createSending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Отправить
          </Button>
        </div>
      </div>
    );
  }

  // 3. List of Tickets
  return (
    <div className="flex flex-col flex-1 min-h-0 w-full overflow-y-auto custom-scrollbar">
      <ChatHeader {...headerProps} />
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 shrink-0 border-b border-black/5 dark:border-white/5 bg-background/90 backdrop-blur-md">
        <h3 className="text-sm font-bold text-foreground">Мои обращения</h3>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-8 rounded-lg text-xs bg-background/50 border-white/10 dark:border-white/5"
          onClick={() => setShowNewForm(true)}
        >
          <MessageSquarePlus className="h-3 w-3 mr-1.5" />
          Создать
        </Button>
      </div>
      
      <div className="p-3 space-y-2.5 flex-1">
        {loading && list.length === 0 ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary/50" /></div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Inbox className="h-8 w-8 opacity-50" />
            <p className="text-xs font-medium text-center">У вас пока нет<br/>открытых обращений</p>
          </div>
        ) : (
          list.map((t) => {
            const isOpen = t.status === "open";
            return (
              <div
                key={t.id}
                onClick={() => setDetailId(t.id)}
                className="group relative flex flex-col gap-1.5 p-3.5 rounded-2xl border border-black/5 dark:border-white/10 bg-card/60 hover:bg-card/80 transition-all cursor-pointer shadow-sm hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-semibold text-[13px] text-foreground line-clamp-2 leading-tight group-hover:text-primary transition-colors">{t.subject}</h4>
                  {isOpen ? (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                      <CircleDot className="h-2.5 w-2.5" /> Открыт
                    </span>
                  ) : (
                    <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                      <CircleCheck className="h-2.5 w-2.5" /> Закрыт
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium text-muted-foreground">
                  {formatDate(t.updatedAt)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function FloatingChat() {
  const { state } = useClientAuth();
  const config = useCabinetConfig();
  const token = state.token ?? null;
  const serviceName = config?.serviceName?.trim() || "Сервис";
  const aiChatEnabled = config?.aiChatEnabled !== false;
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeChat, setActiveChat] = useState<ChatType>(() => (config?.aiChatEnabled !== false ? "ai" : "support"));
  const [hasOpenDialog, setHasOpenDialog] = useState(false);
  useEffect(() => {
    if (!aiChatEnabled && activeChat === "ai") setActiveChat("support");
  }, [aiChatEnabled, activeChat]);

  // Tour integration: programmatically open/close chat when tour requests it
  useEffect(() => {
    const handleTourOpen = () => {
      // On mobile, don't open the chat panel — tour retargets to the FAB button
      if (window.innerWidth < 768) return;
      setIsOpen(true);
    };
    const handleTourClose = () => setIsOpen(false);
    window.addEventListener("tour:open-chat", handleTourOpen);
    window.addEventListener("tour:close-chat", handleTourClose);
    return () => {
      window.removeEventListener("tour:open-chat", handleTourOpen);
      window.removeEventListener("tour:close-chat", handleTourClose);
    };
  }, []);

  const [aiChats, setAiChats] = useState<Message[]>(() => getInitialAiMessage("Сервис"));
  useEffect(() => {
    setAiChats((prev) => {
      if (prev.length !== 1 || prev[0].id !== "a1") return prev;
      const want = getInitialAiMessage(serviceName)[0].text;
      return prev[0].text === want ? prev : getInitialAiMessage(serviceName);
    });
  }, [serviceName]);
  const [aiInput, setAiInput] = useState("");

  const [aiUnread, setAiUnread] = useState(0);
  const [supportUnread, setSupportUnread] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 100);
  };

  // Poll for support unread count (skip if tickets are disabled to avoid 404)
  const refreshUnread = () => {
    if (!token || !config?.ticketsEnabled) return;
    api.getUnreadTicketsCount(token).then((r) => {
      setSupportUnread(r.count);
    }).catch(() => {});
  };

  useEffect(() => {
    refreshUnread();
    const intervalId = window.setInterval(refreshUnread, 15000); // Poll every 15s
    return () => window.clearInterval(intervalId);
  }, [token, config?.ticketsEnabled]);

  // Скрываем кнопку чата когда открыт любой Dialog (Radix)
  useEffect(() => {
    function checkDialogs() {
      const overlay = document.querySelector("[data-radix-dialog-overlay]");
      setHasOpenDialog(!!overlay);
    }
    const observer = new MutationObserver(checkDialogs);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    checkDialogs();
    return () => observer.disconnect();
  }, []);

  // Блокировка скролла body при открытом чате только на мобилках
  useEffect(() => {
    const isMobile = window.innerWidth < 640;
    if (isOpen && isMobile) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (activeChat === "ai") {
        setAiUnread(0);
      }
      setIsScrolled(false);
      scrollToBottom();
    }
  }, [isOpen, activeChat, aiChats]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const handleSendAi = async () => {
    const text = aiInput.trim();
    if (!text || !token) return;

    const now = new Date();
    const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

    const userMsg: Message = {
      id: Date.now().toString(),
      text,
      from: "user",
      time,
    };

    setAiChats((prev) => [...prev, userMsg]);
    setAiInput("");
    setAiLoading(true);

    try {
      const messagesForApi = [...aiChats, userMsg]
        .filter(m => m.id !== "a1")
        .map(m => ({
          role: m.from === "user" ? "user" : "assistant",
          content: m.text
        }));

      const res = await api.chatAi(token, { messages: messagesForApi as any });
      
      const replyMsg: Message = {
        id: Date.now().toString(),
        text: res.reply,
        from: "bot",
        time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      };

      setAiChats((prev) => [...prev, replyMsg]);
      if (!isOpen || activeChat !== "ai") setAiUnread((n) => n + 1);
    } catch (e) {
      const errorMsg: Message = {
        id: Date.now().toString(),
        text: "Произошла ошибка при обращении к AI. Пожалуйста, попробуйте позже.",
        from: "bot",
        time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      };
      setAiChats((prev) => [...prev, errorMsg]);
      if (!isOpen || activeChat !== "ai") setAiUnread((n) => n + 1);
    } finally {
      setAiLoading(false);
    }
  };

  const headerProps = { activeChat, setActiveChat, isExpanded, setIsExpanded, setIsOpen, aiUnread, supportUnread, showAiTab: aiChatEnabled };

  return (
    <>
      <div className={cn("fixed bottom-24 right-4 sm:bottom-6 sm:right-6 z-[100]", hasOpenDialog && !isOpen && "pointer-events-none opacity-0")}>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              key="chat-panel"
              data-tour="floating-chat"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                "fixed sm:absolute z-50",
                "inset-0 sm:inset-auto sm:bottom-20 sm:right-0",
                "w-full h-[100dvh]",
                isExpanded
                  ? "sm:w-[calc(100vw-48px)] sm:h-[calc(100dvh-120px)]"
                  : "sm:w-[450px] sm:h-[650px] sm:max-h-[85vh]",
                "sm:rounded-3xl border-0 sm:border border-white/10",
                "bg-background/80 backdrop-blur-3xl sm:bg-background/60 sm:backdrop-blur-2xl sm:shadow-2xl sm:shadow-black/50",
                "flex flex-col overflow-hidden transition-all duration-500 ease-in-out"
              )}
            >
              {activeChat === "ai" && aiChatEnabled ? (
                <div className="flex flex-col flex-1 min-h-0 w-full">
                  {/* AI Messages */}
                  <div 
                    className="flex-1 overflow-y-auto min-h-0 bg-gradient-to-b from-transparent to-black/5 scroll-smooth custom-scrollbar flex flex-col relative"
                    onScroll={handleScroll}
                  >
                    <ChatHeader {...headerProps} />
                    
                    {/* Floating Switcher */}
                    <div className="sticky top-4 z-30 flex justify-center pointer-events-none px-4 w-full h-0 overflow-visible">
                      <AnimatePresence>
                        {isScrolled && (
                          <motion.div
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.2 }}
                            className="pointer-events-auto w-full sm:w-auto"
                          >
                            <ChatSwitcher {...headerProps} isFloating={true} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div className="p-4 space-y-4 flex-1">
                      <AnimatePresence mode="popLayout">
                        {aiChats.map((msg) => {
                          const isUser = msg.from === "user";
                          return (
                            <motion.div
                              key={msg.id}
                              initial={{ opacity: 0, y: 10, scale: 0.95 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              transition={{ duration: 0.2 }}
                              className={cn("flex gap-3 max-w-[85%]", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}
                            >
                              <div
                                className={cn(
                                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm mt-1",
                                  isUser ? "bg-primary/20 text-primary" : "bg-violet-500/20 text-violet-400"
                                )}
                              >
                                {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                              </div>
                              <div
                                className={cn(
                                  "rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm backdrop-blur-md",
                                  isUser
                                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                                    : "bg-card/60 border border-white/5 text-foreground rounded-tl-sm"
                                )}
                              >
                                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                                <p
                                  className={cn(
                                    "text-[10px] mt-1.5 opacity-60 font-medium",
                                    isUser ? "text-right" : "text-left text-muted-foreground"
                                  )}
                                >
                                  {msg.time}
                                </p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                      <div ref={messagesEndRef} className="h-1" />
                    </div>
                  </div>

                  {/* AI Input Area */}
                  <div className="p-3 sm:p-4 border-t border-black/5 dark:border-white/5 bg-background/80 sm:bg-background/50 backdrop-blur-xl shrink-0 pb-[max(env(safe-area-inset-bottom),16px)] sm:pb-4">
                    <div className="relative flex items-end gap-2 bg-black/5 dark:bg-black/20 p-1.5 rounded-2xl border border-black/5 dark:border-white/10 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 transition-all">
                      <textarea
                        className={cn(
                          "flex-1 max-h-32 min-h-[40px] w-full resize-none bg-transparent px-3 py-2.5",
                          "text-sm text-foreground placeholder:text-muted-foreground",
                          "focus:outline-none custom-scrollbar"
                        )}
                        placeholder="Спросите у AI..."
                        value={aiInput}
                        onChange={(e) => setAiInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSendAi();
                          }
                        }}
                        rows={1}
                      />
                      <Button
                        size="icon"
                        className="h-10 w-10 rounded-xl shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-transform active:scale-95 mb-0.5 mr-0.5"
                        onClick={handleSendAi}
                        disabled={!aiInput.trim() || aiLoading}
                      >
                        {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 ml-0.5" />}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <SupportTab headerProps={headerProps} onRefreshUnread={refreshUnread} />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toggle button */}
        <div data-tour="floating-chat-button" className={cn("relative group", isOpen && "hidden sm:block")}>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen((v) => !v)}
            className={cn(
              "relative flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full z-10",
              "bg-card/60 backdrop-blur-2xl border border-border/50 text-foreground transition-colors hover:bg-card/80",
              !isOpen ? "shadow-[0_8px_32px_rgba(0,0,0,0.12)]" : "shadow-lg"
            )}
          >
            <AnimatePresence mode="wait">
              {isOpen ? (
                <motion.span
                  key="close"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <X className="h-7 w-7" />
                </motion.span>
              ) : (
                <motion.span
                  key="open"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <MessageCircle className="h-7 w-7" />
                </motion.span>
              )}
            </AnimatePresence>

            {/* Unread badge */}
            <AnimatePresence>
              {(aiUnread + supportUnread) > 0 && !isOpen && (
                <motion.span
                  initial={{ scale: 0, y: 10 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-destructive text-[11px] font-bold text-white shadow-md"
                >
                  {aiUnread + supportUnread}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      </div>
    </>
  );
}
