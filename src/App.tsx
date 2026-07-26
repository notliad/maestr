import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Editor, { DiffEditor, type BeforeMount } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleStop, Code2, FileCode2, Folder, FolderOpen, GitBranch, LoaderCircle, Maximize2, MessageSquare, Minimize2, Play, Plus, Save, ScrollText, Search, Send, Settings2, TerminalSquare, WandSparkles, Wrench, X } from "lucide-react";
import { useWorkspaceStore } from "./store";
import type { FileEntry } from "./types";
import maestrLogo from "../assets/maestr-logo.png";
import maestrOnlyLogo from "../assets/maestr-only-only.png";
import "./App.css";
import "@xterm/xterm/css/xterm.css";

type TerminalEvent = { sessionId: number; kind: "output" | "exit"; data?: string };
type TerminalSession = { id: number; label: string };
type GitFile = { path: string; status: string; staged: boolean; additions?: number; deletions?: number };
type GitStatus = { isRepo: boolean; canPush: boolean; branch?: string; files: GitFile[] };
type GitDiff = { original: string; modified: string };
type CodeComment = { id: string; path: string; startLine: number; endLine: number; excerpt: string; text: string; status: "pending" | "sent" };
type CommentDraft = Omit<CodeComment, "id" | "status">;
type AppLog = { id: string; time: string; message: string };
type WorkspaceMode = "review" | "edit";
type TerminalAppearance = { fontFamily: string; fontSize: number; theme: { background: string; foreground: string; cursor: string; selectionBackground: string } };
const defaultTerminalAppearance: TerminalAppearance = { fontFamily: '"SFMono-Regular", "Cascadia Code", monospace', fontSize: 12, theme: { background: "#242423", foreground: "#e8eddf", cursor: "#f5cb5c", selectionBackground: "#4c4e48" } };
type AgentEvent = { taskId: number; kind: "started" | "output" | "activity" | "error" | "finished"; message?: string; raw?: string };
type AgentMessage = { id: string; role: "user" | "agent" | "activity" | "error"; text: string; open?: boolean };
type SearchMatch = { path: string; line: number; preview: string };
const agentCommands: Record<string, { command: string; description: string; local?: true }[]> = {
  claude: [{ command: "/help", description: "Show available commands", local: true }, { command: "/clear", description: "Clear this chat", local: true }, { command: "/compact", description: "Compact the conversation" }, { command: "/init", description: "Create project guidance" }, { command: "/review", description: "Review current changes" }],
  codex: [{ command: "/help", description: "Show available commands", local: true }, { command: "/clear", description: "Clear this chat", local: true }, { command: "/compact", description: "Compact the conversation" }, { command: "/review", description: "Review current changes" }, { command: "/status", description: "Show workspace status" }],
  opencode: [{ command: "/help", description: "Show available commands", local: true }, { command: "/clear", description: "Clear this chat", local: true }, { command: "/init", description: "Create project guidance" }, { command: "/review", description: "Review current changes" }, { command: "/model", description: "Choose a model" }],
  pi: [{ command: "/help", description: "Show available commands", local: true }, { command: "/clear", description: "Clear this chat", local: true }, { command: "/compact", description: "Compact the conversation" }, { command: "/model", description: "Choose a model" }, { command: "/new", description: "Start a new session" }],
};

function WindowControls() {
  const appWindow = getCurrentWindow();
  return <div className="window-controls"><button className="window-control" title="Minimize" aria-label="Minimize" onClick={() => void appWindow.minimize()}><Minimize2 size={15} /></button><button className="window-control" title="Maximize or restore" aria-label="Maximize or restore" onClick={() => void appWindow.toggleMaximize()}><Maximize2 size={14} /></button><button className="window-control window-close" title="Close" aria-label="Close" onClick={() => void appWindow.close()}><X size={16} /></button></div>;
}

function CommentComposer({ draft, onChange, onSave, onCancel }: { draft: CommentDraft; onChange: (text: string) => void; onSave: () => void; onCancel: () => void }) {
  return <div className="comment-composer"><div className="comment-composer-meta"><MessageSquare size={13} /><span>{draft.path}:{draft.startLine}{draft.endLine !== draft.startLine ? `-${draft.endLine}` : ""}</span></div><textarea autoFocus value={draft.text} placeholder="Leave an implementation comment" onChange={(event) => onChange(event.currentTarget.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); onSave(); } }} /><div className="comment-composer-actions"><span>Ctrl/Cmd + Enter to save</span><button className="button button-quiet" onClick={onCancel}>Cancel</button><button className="button button-primary" onClick={onSave} disabled={!draft.text.trim()}>Add comment</button></div></div>;
}

function TreeNode({ entry, depth, showHiddenFiles }: { entry: FileEntry; depth: number; showHiddenFiles: boolean }) {
  const { entries, expanded, toggleDirectory, openFile } = useWorkspaceStore();
  const isOpen = expanded.includes(entry.path);
  const children = (entries[entry.path] ?? []).filter((child) => showHiddenFiles || !child.name.startsWith("."));
  const extension = entry.kind === "file" ? entry.name.split(".").pop()?.toLowerCase() : "";
  const fileType = extension && ["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "sh"].includes(extension) ? "code" : extension && ["json", "yaml", "yml", "toml", "xml"].includes(extension) ? "data" : extension && ["css", "scss", "html"].includes(extension) ? "style" : extension && ["md", "txt", "pdf"].includes(extension) ? "document" : extension && ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(extension) ? "asset" : "other";
  return (
    <>
      <button className={`tree-row ${entry.kind} file-${fileType}`} style={{ paddingLeft: `${12 + depth * 16}px` }} onClick={() => entry.kind === "directory" ? toggleDirectory(entry) : openFile(entry)}>
        {entry.kind === "directory" ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="tree-spacer" />}
        {entry.kind === "directory" ? (isOpen ? <FolderOpen size={15} /> : <Folder size={15} />) : <FileCode2 size={15} />}
        <span className={`tree-name ${entry.project ? "tree-project" : ""}`}>{entry.name}</span>{entry.kind === "file" && extension && <span className="tree-extension">{extension}</span>}{entry.project && <GitBranch size={12} className="tree-project-mark" />}
        {entry.kind === "file" && entry.size > 5 * 1024 * 1024 && <span className="tree-meta">large</span>}
      </button>
      {isOpen && children.map((child) => <TreeNode key={child.path} entry={child} depth={depth + 1} showHiddenFiles={showHiddenFiles} />)}
    </>
  );
}

function languageFor(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", css: "css", scss: "scss", html: "html", md: "markdown",
    rs: "rust", py: "python", go: "go", java: "java", c: "c", cpp: "cpp",
    sh: "shell", yml: "yaml", yaml: "yaml", xml: "xml",
  } as Record<string, string>)[extension ?? ""] ?? "plaintext";
}

const defineMonacoThemes: BeforeMount = (monaco) => {
  const themes: Record<string, { background: string; foreground: string; accent: string }> = { tide: { background: "242423", foreground: "e8eddf", accent: "f5cb5c" }, onedark: { background: "282c34", foreground: "abb2bf", accent: "61afef" }, catppuccin: { background: "181825", foreground: "cdd6f4", accent: "cba6f7" }, nord: { background: "2e3440", foreground: "d8dee9", accent: "88c0d0" }, solarized: { background: "002b36", foreground: "839496", accent: "b58900" }, maestr: { background: "011627", foreground: "fdfffc", accent: "2ec4b6" } };
  Object.entries(themes).forEach(([name, theme]) => monaco.editor.defineTheme(`maestr-${name}`, { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": `#${theme.background}`, "editor.foreground": `#${theme.foreground}`, "editorCursor.foreground": `#${theme.accent}`, "editorLineNumber.foreground": `#${theme.foreground}88`, "editorLineNumber.activeForeground": `#${theme.accent}` } }));
};

function firstChangedLine(original: string, modified: string) {
  const before = original.split("\n"); const after = modified.split("\n");
  const limit = Math.min(before.length, after.length);
  for (let index = 0; index < limit; index += 1) if (before[index] !== after[index]) return index + 1;
  return Math.min(limit + 1, after.length);
}

function TerminalView({ sessionId, active, appearance = defaultTerminalAppearance, onExit }: { sessionId: number; active: boolean; appearance?: TerminalAppearance; onExit?: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      ...appearance,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.open(container.current);
    const resize = () => {
      if (!container.current?.clientWidth || !container.current.clientHeight) return;
      fit.fit();
      void invoke("resize_terminal", { sessionId, cols: terminal.cols, rows: terminal.rows });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    resize();
    const input = terminal.onData((data) => void invoke("write_terminal", { sessionId, data }));
    const unlisten = listen<TerminalEvent>("terminal-event", (event) => {
      if (event.payload.sessionId !== sessionId) return;
      if (event.payload.kind === "output" && event.payload.data) terminal.write(event.payload.data);
      if (event.payload.kind === "exit") { terminal.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n"); onExit?.(); }
    });
    return () => {
      observer.disconnect();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      void unlisten.then((remove) => remove());
    };
  }, [sessionId, onExit]);
  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.options.fontFamily = appearance.fontFamily;
    terminalRef.current.options.fontSize = appearance.fontSize;
    terminalRef.current.options.theme = appearance.theme;
  }, [appearance]);
  useEffect(() => {
    if (!active || !container.current || !fitRef.current || !terminalRef.current) return;
    requestAnimationFrame(() => {
      if (!container.current?.clientWidth || !container.current.clientHeight) return;
      fitRef.current?.fit();
      void invoke("resize_terminal", { sessionId, cols: terminalRef.current?.cols, rows: terminalRef.current?.rows });
    });
  }, [active, sessionId]);
  return <div className={`terminal-view ${active ? "active" : ""}`} ref={container} />;
}

function TerminalDock({ open: isOpen, command, onCommandHandled, onToggle, onResizeStart, onResizeReset, height }: { open: boolean; command: string | null; onCommandHandled: () => void; onToggle: () => void; onResizeStart: (event: ReactPointerEvent) => void; onResizeReset: () => void; height: number }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const sessionIds = useRef<number[]>([]);
  useEffect(() => { sessionIds.current = sessions.map((session) => session.id); }, [sessions]);
  useEffect(() => () => { sessionIds.current.forEach((sessionId) => void invoke("close_terminal", { sessionId })); }, []);
  const createSession = useCallback(async () => {
    try {
      const id = await invoke<number>("start_terminal", { cols: 100, rows: 24 });
      setSessions((current) => [...current, { id, label: `Terminal ${current.length + 1}` }]);
      setActiveId(id);
      return id;
    } catch (error) {
      console.error("Could not start terminal", error);
      return null;
    }
  }, []);
  useEffect(() => {
    if (isOpen && sessions.length === 0 && !command) void createSession();
  }, [command, createSession, isOpen, sessions.length]);
  useEffect(() => {
    if (!isOpen || !command) return;
    if (activeId === null) { void createSession(); return; }
    const timer = window.setTimeout(() => {
      void invoke("write_terminal", { sessionId: activeId, data: command }).catch(() => undefined);
      onCommandHandled();
    }, 100);
    return () => window.clearTimeout(timer);
  }, [activeId, command, createSession, isOpen, onCommandHandled]);
  const closeSession = async (id: number) => {
    await invoke("close_terminal", { sessionId: id }).catch(() => undefined);
    const next = sessions.filter((session) => session.id !== id);
    setSessions(next);
    setActiveId((active) => active === id ? next.at(-1)?.id ?? null : active);
    if (next.length === 0 && isOpen) onToggle();
  };
  return <div className={`terminal-dock ${isOpen ? "open" : ""}`} style={{ "--terminal-height": `${height}px` } as CSSProperties}>
    {isOpen && <div className="terminal-resize-handle" onPointerDown={onResizeStart} onDoubleClick={onResizeReset} />}
    <div className="terminal-header"><button className="terminal-toggle" onClick={onToggle} aria-expanded={isOpen}><TerminalSquare size={15} /><span>Terminal</span>{isOpen ? <ChevronUp size={14} /> : <><span className="terminal-status">{sessions.length} open</span><ChevronDown size={14} /></>}</button></div>
    {isOpen && <div className="terminal-tabs">{sessions.map((session) => <button key={session.id} className={`terminal-tab ${session.id === activeId ? "active" : ""}`} onClick={() => setActiveId(session.id)} onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); void closeSession(session.id); } }}>{session.label}<span onClick={(event) => { event.stopPropagation(); void closeSession(session.id); }}><X size={12} /></span></button>)}<button className="terminal-new-tab" title="New terminal" onClick={() => void createSession()}><Plus size={14} /></button></div>}
    {sessions.length > 0 && <div className={`terminal-views ${isOpen ? "" : "collapsed"}`}>{sessions.map((session) => <TerminalView key={session.id} sessionId={session.id} active={isOpen && session.id === activeId} />)}</div>}
  </div>;
}

function BranchSelect({ onFeedback, onChanged }: { onFeedback: (message: string) => void; onChanged: () => void }) {
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    void Promise.all([invoke<GitStatus>("git_status"), invoke<string[]>("git_branches")]).then(([status, nextBranches]) => { setAvailable(status.isRepo); setBranch(status.branch ?? ""); setBranches(nextBranches); }).catch(() => undefined);
  }, []);
  const changeBranch = async (next: string) => {
    try { await invoke("git_checkout", { branch: next }); await useWorkspaceStore.getState().refreshOpenFiles(); await useWorkspaceStore.getState().loadDirectory(); setBranch(next); onChanged(); onFeedback(`Switched to ${next}; clean open files updated`); } catch (error) { onFeedback(`Git error: ${String(error)}`); }
  };
  if (!available) return null;
  return <div className="branch-control"><GitBranch size={13} /><span>{branch || "Branch"}</span><select aria-label="Select branch" value={branch} onChange={(event) => void changeBranch(event.target.value)} disabled={!branch || branches.length === 0}><option value="" disabled>Branch</option>{branches.map((item) => <option key={item} value={item}>{item}</option>)}</select><ChevronDown size={13} /></div>;
}

function GitPanel({ status, onRefresh, onFeedback, onLog, feedback, onAuthenticate, onReview, onAskCommit, canGenerateCommit }: { status: GitStatus | null; onRefresh: () => Promise<void>; onFeedback: (message: string) => void; onLog: (message: string) => void; feedback: string; onAuthenticate: () => void; onReview: (path: string) => void; onAskCommit: () => Promise<string>; canGenerateCommit: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [openSections, setOpenSections] = useState({ staged: true, changes: true });
  const needsGitHubAuth = /could not read Username|Authentication failed|terminal prompts disabled/i.test(feedback);
  const run = async (command: string, args: Record<string, unknown> = {}, success = "Git action completed") => {
    setBusy(true);
    try { await invoke(command, args); await onRefresh(); onFeedback(success); onLog(success); } catch (error) { const message = `Git error: ${String(error)}`; onFeedback(message); onLog(message); }
    finally { setBusy(false); }
  };
  const generateCommit = async () => { setGenerating(true); try { const next = await onAskCommit(); setMessage(next); onFeedback("Commit message generated"); onLog("Commit message generated"); } catch (error) { const message = `Commit message error: ${String(error)}`; onFeedback(message); onLog(message); } finally { setGenerating(false); } };
  if (!status) return <div className="git-panel git-loading">Loading Git…</div>;
  if (!status.isRepo) return <div className="git-panel git-empty"><GitBranch size={20} /><p>Not a Git repository</p><span>Initialize Git in the terminal to enable source control.</span></div>;
  return <div className="git-panel">
    {feedback && <div className="git-feedback">{needsGitHubAuth ? <><strong>GitHub precisa de autenticação</strong><span>Conecte sua conta para habilitar Push por HTTPS.</span><button className="button button-primary" onClick={onAuthenticate}>Conectar GitHub</button></> : feedback}</div>}
    <div className="git-toolbar"><span className="git-branch-label"><GitBranch size={13} /> {status.branch ?? "detached"}</span><button className="icon-button small" title="Refresh Git" onClick={() => void onRefresh()}><span aria-hidden="true">↻</span></button></div>
    {status.files.some((file) => file.staged) && <div className="git-commit"><input value={message} onChange={(event) => setMessage(event.currentTarget.value)} placeholder="Commit message" onKeyDown={(event) => { if (event.key === "Enter" && message.trim()) { void run("git_commit", { message }); setMessage(""); } }} /><button className="icon-button small" title={canGenerateCommit ? "Generate commit message with selected agent" : "Select an agent to generate a commit message"} onClick={() => void generateCommit()} disabled={!canGenerateCommit || busy || generating}>{generating ? <LoaderCircle size={14} className="loading-spin" /> : <WandSparkles size={14} />}</button><button className="button button-primary" onClick={() => { void run("git_commit", { message }); setMessage(""); }} disabled={busy || generating || !message.trim()}>Commit</button></div>}
    <div className="git-actions">{status.files.some((file) => !file.staged) && <button className="button button-quiet" onClick={() => void run("git_stage_all", {}, "All files staged")} disabled={busy}>Stage all</button>}{status.files.some((file) => file.staged) && <button className="button button-quiet" onClick={() => void run("git_unstage_all", {}, "All files unstaged")} disabled={busy}>Unstage all</button>}<button className="button button-quiet" onClick={() => void run("git_sync", { action: "pull" }, "Pull completed")} disabled={busy}>Pull</button>{status.canPush && <button className="button button-quiet" onClick={() => void run("git_sync", { action: "push" }, "Push completed")} disabled={busy}>Push</button>}</div>
    {(() => { const staged = status.files.filter((file) => file.staged); const changes = status.files.filter((file) => !file.staged); const renderFile = (file: GitFile) => <button key={file.path} className="git-file" onClick={() => onReview(file.path)}><span className={`git-status status-${file.status}`}>{file.status === "untracked" ? "U" : file.status[0].toUpperCase()}</span><span className="git-file-name">{file.path}</span><span className="git-lines"><strong>+{file.additions ?? 0}</strong><em>−{file.deletions ?? 0}</em></span><span className="git-stage" title={file.staged ? "Unstage file" : "Stage file"} onClick={(event) => { event.stopPropagation(); void run(file.staged ? "git_unstage" : "git_stage", { path: file.path }, file.staged ? "File unstaged" : "File staged"); }}>{file.staged ? "−" : "+"}</span></button>; const section = (name: "staged" | "changes", title: string, items: GitFile[], empty: string) => <><button className="git-section-label git-section-toggle" onClick={() => setOpenSections((current) => ({ ...current, [name]: !current[name] }))}>{openSections[name] ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {title} <span>{items.length}</span></button>{openSections[name] && <div className="git-file-list">{items.length === 0 ? <span className="git-muted">{empty}</span> : items.map(renderFile)}</div>}</>; return <>{section("staged", "Staged Changes", staged, "Nothing staged")}{section("changes", "Changes", changes, "Working tree clean")}</>; })()}
  </div>;
}

function ReviewPanel({ files, selected, checked, onSelect, onToggle, onStage, comments, onSendComments, onDeleteComment, onClearSent, agentRunning, onFeedback }: { files: GitFile[]; selected: string; checked: string[]; onSelect: (path: string) => void; onToggle: (path: string) => void; onStage: (file: GitFile) => void; comments: CodeComment[]; onSendComments: () => Promise<void>; onDeleteComment: (id: string) => void; onClearSent: () => void; agentRunning: boolean; onFeedback: (message: string) => void }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const completedGroups = useRef(new Set<string>());
  const [sending, setSending] = useState(false);
  const groups = files.reduce<Record<string, GitFile[]>>((all, file) => { const folder = file.path.split(/[\\/]/).slice(0, -1).join("/") || "."; (all[folder] ??= []).push(file); return all; }, {});
  useEffect(() => { const complete = new Set(Object.entries(groups).filter(([, items]) => items.every((file) => checked.includes(file.path))).map(([folder]) => folder)); const newlyComplete = [...complete].filter((folder) => !completedGroups.current.has(folder)); completedGroups.current = complete; if (newlyComplete.length) setOpenGroups((current) => ({ ...current, ...Object.fromEntries(newlyComplete.map((folder) => [folder, false])) })); }, [checked, files]);
  const done = files.length > 0 && files.every((file) => checked.includes(file.path));
  const pending = comments.filter((comment) => comment.status === "pending");
  const sent = comments.filter((comment) => comment.status === "sent");
  const send = async () => { setSending(true); try { await onSendComments(); onFeedback(`${pending.length} comment${pending.length === 1 ? "" : "s"} sent to agent`); } catch (error) { onFeedback(String(error)); } finally { setSending(false); } };
  return <div className="review-panel">{done && <div className="review-complete">✓ All changes reviewed</div>}<div className="review-summary">{files.length ? `${checked.filter((path) => files.some((file) => file.path === path)).length}/${files.length} reviewed` : "No changes to review"}</div>{pending.length > 0 && <div className="review-comment-actions"><button className="button button-primary" onClick={() => void send()} disabled={!agentRunning || sending}><MessageSquare size={14} /> {sending ? "Sending…" : `Send comments (${pending.length})`}</button>{!agentRunning && <span>Start the Agent to send queued comments.</span>}</div>}{comments.length > 0 && <details className="review-comment-queue"><summary><MessageSquare size={13} /> {pending.length} pending comment{pending.length === 1 ? "" : "s"}</summary>{comments.map((comment) => <div className="review-comment-item" key={comment.id}><span><strong>{comment.path}:{comment.startLine}</strong>{comment.text}</span><button className="icon-button small" title="Remove comment" onClick={() => onDeleteComment(comment.id)}><X size={13} /></button></div>)}{sent.length > 0 && <button className="button button-quiet" onClick={onClearSent}>Clear sent</button>}</details>}{Object.entries(groups).map(([folder, items]) => { const complete = items.every((file) => checked.includes(file.path)); const open = openGroups[folder] ?? !complete; return <div className="review-group" key={folder}><button className="review-group-title" onClick={() => setOpenGroups((current) => ({ ...current, [folder]: !open }))}><span>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={13} /> {folder}</span>{complete && <span className="review-group-check"><Check size={13} /></span>}</button>{open && items.map((file) => <div key={file.path} className={`review-file ${selected === file.path ? "active" : ""}`}><button onClick={() => onSelect(file.path)} aria-current={selected === file.path ? "page" : undefined}><span className={`git-status status-${file.status}`}>{file.status === "untracked" ? "U" : file.status[0].toUpperCase()}</span><span>{file.path.split(/[\\/]/).pop()}</span><span className="git-lines"><strong>+{file.additions ?? 0}</strong><em>−{file.deletions ?? 0}</em></span>{selected === file.path && <span className="review-active-label">Viewing</span>}</button><button className="review-stage" title={file.staged ? "Unstage file" : "Stage file"} onClick={() => onStage(file)}>{file.staged ? "−" : "+"}</button><button className={`review-check ${checked.includes(file.path) ? "checked" : ""}`} title={checked.includes(file.path) ? "Mark unreviewed" : "Mark reviewed"} aria-label={checked.includes(file.path) ? "Mark unreviewed" : "Mark reviewed"} aria-pressed={checked.includes(file.path)} onClick={() => onToggle(file.path)}>{checked.includes(file.path) ? <Check size={13} /> : <span />}</button></div>)}</div>; })}</div>;
}
function AgentPanel({ compact, terminalMode, onToggleCompact, onSessionChange, onAgentChange, onLog }: { compact: boolean; terminalMode: boolean; onToggleCompact: () => void; onSessionChange: (sessionId: number | null) => void; onAgentChange: (agent: string | null) => void; onLog: (message: string) => void }) {
  const root = useWorkspaceStore((state) => state.root);
  const [agents, setAgents] = useState<{ name: string; command: string; version?: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const transcript = useRef<HTMLDivElement>(null);
  const commands = agentCommands[selected] ?? [];
  const commandMatches = prompt.startsWith("/") ? commands.filter((item) => item.command.startsWith(prompt.trim().toLowerCase())).slice(0, 6) : [];
  useEffect(() => () => { if (sessionId !== null) void invoke(terminalMode ? "close_terminal" : "cancel_agent", terminalMode ? { sessionId } : { taskId: sessionId }); }, [sessionId, terminalMode]);
  useEffect(() => {
    const candidates = [{ name: "Claude Code", command: "claude" }, { name: "Codex CLI", command: "codex" }, { name: "OpenCode", command: "opencode" }, { name: "Pi", command: "pi" }];
    setAgentsLoading(true);
    void Promise.all(candidates.map(async (candidate) => ({ ...candidate, ...(await invoke<{ available: boolean; version?: string }>("detect_agent", { agent: candidate.command }).catch(() => ({ available: false }))) }))).then((found) => {
      const installed = found.filter((agent) => agent.available);
      const options = installed.length ? installed : candidates.map((candidate) => ({ ...candidate, version: undefined }));
      setAgents(options); setSelected(localStorage.getItem(`maestr-agent:${root ?? "default"}`) || options[0]?.command || "");
    }).finally(() => setAgentsLoading(false));
  }, [root]);
  useEffect(() => { onAgentChange(selected || null); }, [onAgentChange, selected]);
  useEffect(() => {
    const unlisten = listen<AgentEvent>("agent-event", (event) => {
      if (terminalMode) return;
      const { kind, message, raw } = event.payload;
      if (kind === "output" && (message || raw)) setMessages((current) => { const text = message || raw || ""; return current.at(-1)?.role === "agent" && current.at(-1)?.text === text ? current : [...current, { id: crypto.randomUUID(), role: "agent", text }]; });
      if (kind === "activity" && (message || raw)) setMessages((current) => { const text = message || raw || ""; return current.at(-1)?.role === "activity" && current.at(-1)?.text === text ? current : [...current, { id: crypto.randomUUID(), role: "activity", text }]; });
      if (kind === "error") setMessages((current) => [...current, { id: crypto.randomUUID(), role: "error", text: message || "Agent error" }]);
      if (kind === "finished") { setRunning(false); onLog(message || "Agent finished"); }
    });
    return () => { void unlisten.then((remove) => remove()); };
  }, [onLog, sessionId, terminalMode]);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" }); }, [messages]);
  const send = async (provided?: string) => {
    const message = (provided ?? prompt).trim();
    if (!message || !selected || running) return;
    if (message === "/clear") { setPrompt(""); setMessages([]); return; }
    if (message === "/help") { setPrompt(""); setMessages((current) => [...current, { id: crypto.randomUUID(), role: "activity", text: commands.map((item) => `${item.command} — ${item.description}`).join(" · ") }]); return; }
    localStorage.setItem(`maestr-agent:${root ?? "default"}`, selected);
    setPrompt("");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    setRunning(true);
    try {
      const id = await invoke<number>("start_agent", { agent: selected, prompt: message });
      setSessionId(id); onSessionChange(id); onLog(`${selected} started`);
    } catch (error) {
      setRunning(false);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "error", text: `Could not start ${selected}: ${String(error)}` }]);
      onLog(`Could not start ${selected}`);
    }
  };
  const startTerminal = async () => {
    if (!selected || running) return;
    try {
      const id = await invoke<number>("start_terminal", { cols: 100, rows: 28 });
      setSessionId(id); setRunning(true); onSessionChange(id); onLog(`${selected} terminal started`);
      await invoke("write_terminal", { sessionId: id, data: `clear\r${selected}\r` });
    } catch (error) { onLog(`Could not start ${selected}: ${String(error)}`); }
  };
  const stop = async () => { if (sessionId === null) return; await invoke(terminalMode ? "close_terminal" : "cancel_agent", terminalMode ? { sessionId } : { taskId: sessionId }).catch(() => undefined); setSessionId(null); onSessionChange(null); setRunning(false); onLog("Agent stopped"); };
  const switchAgent = (next: string) => {
    if (running && !window.confirm("Stop the current agent and switch?")) return;
    if (sessionId !== null) void invoke(terminalMode ? "close_terminal" : "cancel_agent", terminalMode ? { sessionId } : { taskId: sessionId }).catch(() => undefined);
    setSessionId(null); setRunning(false); setMessages([]); setSelected(next); onSessionChange(null);
  };
  const handleTerminalExit = useCallback(() => { setSessionId(null); setRunning(false); onSessionChange(null); onLog("Agent terminal exited"); }, [onLog, onSessionChange]);
  const chooseCommand = (command: string) => setPrompt(`${command} `);
  useEffect(() => {
    const receivePrompt = (event: Event) => { void send(String((event as CustomEvent<string>).detail ?? "")); };
    window.addEventListener("maestr-agent-prompt", receivePrompt);
    return () => window.removeEventListener("maestr-agent-prompt", receivePrompt);
  }, [send]);
  return <>
    {compact ? <button className="agent-rail" title={running ? "Expand running agent" : "Expand agent"} onClick={onToggleCompact}><TerminalSquare size={17} /><span className={`agent-rail-status ${running ? "running" : ""}`} /><span>Agent</span><ChevronRight size={14} /></button> : <div className="panel-heading agent-heading"><span className="agent-primary"><span>Agent</span><span className="agent-select-wrap"><select className="agent-select" aria-busy={agentsLoading} value={selected} onChange={(event) => switchAgent(event.currentTarget.value)} disabled={agentsLoading}><option value="">{agentsLoading ? "Loading agents…" : "No agent found"}</option>{agents.map((agent) => <option key={agent.command} value={agent.command}>{agent.name}{agent.version ? ` · ${agent.version}` : ""}</option>)}</select>{agentsLoading && <LoaderCircle size={13} className="loading-spin" />}</span></span>{terminalMode && <button className="icon-button small" title={running ? "Stop agent" : "Open agent terminal"} onClick={() => void (running ? stop() : startTerminal())} disabled={!selected || agentsLoading}>{running ? <CircleStop size={14} /> : <Play size={14} />}</button>}<button className="icon-button small agent-collapse" title="Collapse agent (Ctrl/Cmd+Shift+A)" onClick={onToggleCompact}><ChevronLeft size={14} /></button></div>}
    {terminalMode ? <div className={`agent-panel-content agent-terminal-host ${compact ? "compact-content" : ""}`}>{sessionId !== null ? <TerminalView sessionId={sessionId} active onExit={handleTerminalExit} /> : <div className="agent-empty"><TerminalSquare size={26} /><p>Open {agents.find((agent) => agent.command === selected)?.name ?? "an agent"} in a terminal</p><button className="button button-primary" disabled={!selected || agentsLoading} onClick={() => void startTerminal()}><Play size={14} /> Start terminal</button></div>}</div> : !compact && <><div className="agent-panel-content agent-chat" ref={transcript} aria-live="polite">{messages.length ? messages.map((message) => message.role === "activity" ? <div key={message.id} className="agent-activity" title={message.text}><Wrench size={13} /><span>{message.text}</span></div> : <div key={message.id} className={`agent-message ${message.role}`}><span>{message.role === "user" ? "You" : message.role === "error" ? "Error" : agents.find((agent) => agent.command === selected)?.name ?? "Agent"}</span>{message.role === "agent" ? <div className="agent-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{message.text}</ReactMarkdown></div> : <p>{message.text}</p>}</div>) : <div className="agent-empty"><Bot size={26} /><p>Ask {agents.find((agent) => agent.command === selected)?.name ?? "an agent"} to work on this workspace</p><span>Changes will appear in Review when the task finishes.</span></div>}</div><div className="agent-composer">{commandMatches.length > 0 && <div className="agent-command-menu" role="listbox" aria-label="Agent commands">{commandMatches.map((item) => <button key={item.command} type="button" role="option" onMouseDown={(event) => { event.preventDefault(); chooseCommand(item.command); }}><code>{item.command}</code><span>{item.description}</span></button>)}</div>}<label className="sr-only" htmlFor="agent-prompt">Message to agent</label><textarea id="agent-prompt" value={prompt} placeholder="Describe what you want to change…" onChange={(event) => setPrompt(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Tab" && commandMatches.length) { event.preventDefault(); chooseCommand(commandMatches[0].command); } else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} disabled={!selected || agentsLoading || running} /><button className="icon-button agent-send" title={running ? "Stop agent" : "Send message"} onClick={() => void (running ? stop() : send())} disabled={running ? sessionId === null : !prompt.trim() || !selected || agentsLoading}>{running ? <CircleStop size={16} /> : <Send size={16} />}</button></div></>}
  </>;
}

function EmptyWorkspace({ onOpen }: { onOpen: () => void }) {
  const recent = useWorkspaceStore((state) => state.recent);
  const openWorkspace = useWorkspaceStore((state) => state.openWorkspace);
  return (
    <section className="empty-state">
      <img className="empty-logo" src={maestrLogo} alt="Maestr" />
      <p className="eyebrow">CODE REVIEW YOUR AGENTS</p>
      <h1>Choose a workspace</h1>
      <p className="empty-copy">Open a local project to browse files and start shaping the work.</p>
      <button className="button button-primary" onClick={onOpen}><FolderOpen size={16} /> Open folder</button>
      {recent.length > 0 && <div className="recent-list"><span className="section-label">Recent workspaces</span>{recent.map((path) => <button key={path} className="recent-item" onClick={() => openWorkspace(path)}><Folder size={15} /><span>{path}</span></button>)}</div>}
    </section>
  );
}

function App() {
  const { root, entries, expanded, tabs, activePath, busy, error, loadRecent, openWorkspace, toggleDirectory, openFile, updateFile, saveFile, closeTab, setActive } = useWorkspaceStore();
  const [mode, setMode] = useState<WorkspaceMode>("edit");
  const [agentCompact, setAgentCompact] = useState(false);
  const [explorerCompact, setExplorerCompact] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [gitFeedback, setGitFeedback] = useState("");
  const [review, setReview] = useState<{ path: string; diff: GitDiff } | null>(null);
  const [reviewChecked, setReviewChecked] = useState<string[]>([]);
  const [comments, setComments] = useState<CodeComment[]>([]);
  const sendingComments = useRef(false);
  const [commentsLoadedFor, setCommentsLoadedFor] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const [agentSessionId, setAgentSessionId] = useState<number | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [logs, setLogs] = useState<AppLog[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const commentEditors = useRef(new Map<string, { editor: any; monaco: any; decorations: any }>());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(() => { try { return JSON.parse(localStorage.getItem("maestr-settings") || "{}"); } catch { return {}; } });
  const updateSettings = (key: string, value: unknown) => setSettings((current: Record<string, unknown>) => { const next = { ...current, [key]: value }; localStorage.setItem("maestr-settings", JSON.stringify(next)); return next; });
  const editorTheme = ["maestr", "onedark", "catppuccin", "nord", "solarized", "tide"].includes(settings.theme) ? `maestr-${settings.theme}` : settings.theme === "light" ? "vs-light" : "hc-black";
  const showHiddenFiles = settings.showHiddenFiles === true;
  const agentInterface = settings.agentInterface === "terminal" ? "terminal" : "chat";
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalCommand, setTerminalCommand] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [reviewSidebarWidth, setReviewSidebarWidth] = useState(496);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchTarget, setSearchTarget] = useState<SearchMatch | null>(null);
  const [agentWidth, setAgentWidth] = useState(() => Math.max(300, Math.round((window.innerWidth - 248) / 2)));
  const [terminalHeight, setTerminalHeight] = useState(190);
  const resizeState = useRef<{ kind: "sidebar" | "agent" | "terminal"; start: number; size: number } | null>(null);
  const gitFingerprint = useRef("");
  const reviewPath = useRef<string | null>(null);
  const activeFile = tabs.find((tab) => tab.path === activePath);
  const reviewFiles = gitStatus?.files ?? [];
  const reviewIndex = review ? reviewFiles.findIndex((file) => file.path === review.path) : -1;
  const rootName = useMemo(() => root?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace", [root]);
  const addLog = useCallback((message: string) => setLogs((current) => [...current.slice(-99), { id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), message }]), []);
  const refreshGit = useCallback(async () => {
    try {
      const next = await invoke<GitStatus>("git_status");
      const fingerprint = JSON.stringify(next);
      setGitStatus(next);
      const path = reviewPath.current;
      if (path) {
        if (next.files.some((file) => file.path === path)) {
          const diff = await invoke<GitDiff>("git_diff", { path });
          setReview((current) => current?.path === path && current.diff.original === diff.original && current.diff.modified === diff.modified ? current : { path, diff });
        } else setReview(null);
      }
      if (fingerprint === gitFingerprint.current) return;
      gitFingerprint.current = fingerprint;
      await useWorkspaceStore.getState().refreshOpenFiles();
      await useWorkspaceStore.getState().loadDirectory();
    } catch (error) {
      setGitFeedback(`Git error: ${String(error)}`);
    }
  }, []);

  useEffect(() => { void loadRecent(); }, [loadRecent]);
  useEffect(() => {
    const preventContextMenu = (event: MouseEvent) => event.preventDefault();
    const preventImageDrag = (event: DragEvent) => { if (event.target instanceof HTMLImageElement) event.preventDefault(); };
    window.addEventListener("contextmenu", preventContextMenu);
    window.addEventListener("dragstart", preventImageDrag);
    return () => { window.removeEventListener("contextmenu", preventContextMenu); window.removeEventListener("dragstart", preventImageDrag); };
  }, []);
  useEffect(() => {
    setReview(null); setReviewChecked([]); setCommentDraft(null); setGitStatus(null); setGitFeedback(""); setLogs([]); setLogsOpen(false); setTerminalOpen(false); setAgentCompact(false); setExplorerCompact(false); setAgentSessionId(null); setSelectedAgent(null); gitFingerprint.current = ""; commentEditors.current.clear();
    if (!root) { setComments([]); setCommentsLoadedFor(null); return; }
    try { setComments(JSON.parse(localStorage.getItem(`maestr-comments:${root}`) || "[]")); } catch { setComments([]); }
    setCommentsLoadedFor(root);
    const stored = localStorage.getItem(`maestr-mode:${root}`) as WorkspaceMode | null;
    void invoke<GitStatus>("git_status").then((status) => {
      setGitStatus(status);
      gitFingerprint.current = JSON.stringify(status);
      const initialMode = stored === "review" || stored === "edit" ? stored : status.files.length ? "review" : "edit";
      setMode(initialMode);
      setAgentCompact(initialMode === "review");
    }).catch((nextError) => setGitFeedback(`Git error: ${String(nextError)}`));
  }, [root]);
  useEffect(() => { reviewPath.current = review?.path ?? null; }, [review]);
  useEffect(() => {
    if (!root || (mode !== "review" && agentSessionId === null)) return;
    // ponytail: lightweight polling avoids a watcher dependency; use native file events if 2s latency becomes material.
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refreshGit(); }, 2000);
    return () => window.clearInterval(timer);
  }, [agentSessionId, mode, refreshGit, root]);
  useEffect(() => {
    if (root && commentsLoadedFor === root) localStorage.setItem(`maestr-comments:${root}`, JSON.stringify(comments));
  }, [comments, commentsLoadedFor, root]);
  useEffect(() => { setAgentWidth(Math.max(300, Math.round((window.innerWidth - sidebarWidth) / 2))); }, []);
  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) { setSearchResults([]); return; }
    const timer = window.setTimeout(() => { setSearchLoading(true); void invoke<SearchMatch[]>("search_workspace", { query: searchQuery }).then(setSearchResults).catch(() => setSearchResults([])).finally(() => setSearchLoading(false)); }, 150);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchQuery]);
  useEffect(() => {
    if (searchTarget?.path !== activePath) return;
    requestAnimationFrame(() => commentEditors.current.get(searchTarget.path)?.editor.revealLineInCenter(searchTarget.line));
  }, [activePath, searchTarget]);

  const applyCommentDecorations = useCallback((path: string, target: { editor: any; monaco: any; decorations: any }) => {
    target.decorations.set(comments.filter((comment) => comment.path === path).map((comment) => ({ range: new target.monaco.Range(comment.startLine, 1, comment.endLine, 1), options: { isWholeLine: true, className: comment.status === "pending" ? "commented-line-pending" : "commented-line-sent", linesDecorationsClassName: comment.status === "pending" ? "comment-line-pending" : "comment-line-sent", hoverMessage: { value: comment.text } } })));
  }, [comments]);
  useEffect(() => { commentEditors.current.forEach((target, path) => applyCommentDecorations(path, target)); }, [applyCommentDecorations]);

  const openCommentComposer = useCallback((editor: any | undefined, path: string) => {
    const model = editor?.getModel(); const selection = editor?.getSelection(); const position = editor?.getPosition();
    const startLine = selection?.startLineNumber ?? position?.lineNumber ?? 1;
    const endLine = selection?.endLineNumber ?? position?.lineNumber ?? startLine;
    const excerpt = model ? (selection && !selection.isEmpty() ? model.getValueInRange(selection) : model.getLineContent(startLine)) : "";
    setCommentDraft({ path, startLine, endLine, excerpt, text: "" });
  }, []);
  const mountCommentEditor = useCallback((editor: any, monaco: any, path: string) => {
    const target = { editor, monaco, decorations: editor.createDecorationsCollection() };
    const hoverDecorations = editor.createDecorationsCollection();
    const showGlyph = (line: number) => hoverDecorations.set([{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: "add-comment-glyph", glyphMarginHoverMessage: { value: "Add comment" } } }]);
    editor.updateOptions({ glyphMargin: true });
    commentEditors.current.set(path, target);
    applyCommentDecorations(path, target);
    editor.addAction({ id: `maestr.add-comment.${path}`, label: "Add comment", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM], contextMenuGroupId: "navigation", contextMenuOrder: 2, run: () => openCommentComposer(editor, path) });
    showGlyph(editor.getPosition()?.lineNumber ?? 1);
    editor.onDidChangeCursorPosition((event: any) => showGlyph(event.position.lineNumber));
    editor.onMouseMove((event: any) => { const line = event.target.position?.lineNumber; if (line) showGlyph(line); });
    editor.onMouseDown((event: any) => { const position = event.target.position ?? editor.getPosition(); if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !position) return; editor.setPosition(position); openCommentComposer(editor, path); });
    editor.onDidDispose(() => commentEditors.current.delete(path));
  }, [applyCommentDecorations, openCommentComposer]);

  const chooseFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Open workspace" });
    if (typeof selected === "string") { await openWorkspace(selected); addLog(`Workspace opened: ${selected}`); }
  };
  const openSearchResult = async (result: SearchMatch) => {
    await openFile({ name: result.path.split("/").at(-1) ?? result.path, path: result.path, kind: "file", size: 0 });
    setSearchTarget(result); setSearchOpen(false);
  };

  const addComment = () => {
    if (!commentDraft?.text.trim()) return;
    setComments((current) => [...current, { ...commentDraft, id: crypto.randomUUID(), text: commentDraft.text.trim(), status: "pending" }]);
    addLog(`Comment added on ${commentDraft.path}:${commentDraft.startLine}`);
    setCommentDraft(null);
  };
  const startComment = (path: string) => {
    openCommentComposer(commentEditors.current.get(path)?.editor, path);
  };
  const sendComments = async () => {
    if (sendingComments.current) return;
    sendingComments.current = true;
    try {
    const pending = comments.filter((comment) => comment.status === "pending");
    if (pending.length === 0) return;
    const paths = new Set(pending.map((comment) => comment.path));
    const dirty = useWorkspaceStore.getState().tabs.filter((tab) => tab.dirty && paths.has(tab.path));
    if (dirty.length && !window.confirm(`Save ${dirty.length} commented file${dirty.length === 1 ? "" : "s"} before sending to the agent?`)) throw new Error("Comments were not sent");
    for (const file of dirty) await saveFile(file.path);
    const latestTabs = useWorkspaceStore.getState().tabs;
    if (latestTabs.some((tab) => tab.dirty && paths.has(tab.path))) throw new Error("Save the commented files before sending");
    const stale = await Promise.all(pending.map(async (comment) => {
      const content = latestTabs.find((tab) => tab.path === comment.path)?.content ?? await invoke<string>("read_file", { path: comment.path });
      const selectedLines = content.split("\n").slice(comment.startLine - 1, comment.endLine).join("\n");
      return comment.excerpt && !selectedLines.includes(comment.excerpt) ? comment : null;
    }));
    const invalid = stale.filter((comment): comment is CodeComment => comment !== null);
    if (invalid.length) throw new Error(`${invalid.length} comment${invalid.length === 1 ? "" : "s"} no longer match the selected code`);
    const payload = pending.map(({ path, startLine, endLine, excerpt, text }) => ({ file: path, startLine, endLine, selectedText: excerpt, comment: text }));
    if (!selectedAgent) throw new Error("Select an agent before sending comments");
    setAgentCompact(false);
    window.dispatchEvent(new CustomEvent("maestr-agent-prompt", { detail: `Implement these code review comments now. Paths are relative to the workspace. Inspect the current file around each line, apply the requested changes without asking for confirmation, then summarize each item. Reply to each comment in the same language as that comment. Comments: ${JSON.stringify(payload)}` }));
    setComments((current) => current.map((comment) => comment.status === "pending" ? { ...comment, status: "sent" } : comment));
    addLog(`${pending.length} comment${pending.length === 1 ? "" : "s"} sent to agent`);
    } finally {
      sendingComments.current = false;
    }
  };
  const generateCommitMessage = async () => {
    if (!selectedAgent) throw new Error("Select an agent to generate a commit message");
    return invoke<string>("generate_commit_message", { agent: selectedAgent });
  };
  const saveActive = () => { if (activeFile) void saveFile(activeFile.path).then(() => addLog(`Saved ${activeFile.path}`)); };
  const openReview = useCallback(async (path: string) => { try { setReview({ path, diff: await invoke<GitDiff>("git_diff", { path }) }); } catch (nextError) { setGitFeedback(`Diff error: ${String(nextError)}`); } }, []);
  useEffect(() => {
    if (mode !== "review" || review || reviewFiles.length === 0) return;
    const next = reviewFiles.find((file) => !reviewChecked.includes(file.path));
    if (next) void openReview(next.path);
  }, [mode, openReview, review, reviewChecked, reviewFiles]);
  const markAndAdvance = (path: string) => {
    const checked = reviewChecked.includes(path) ? reviewChecked : [...reviewChecked, path];
    setReviewChecked(checked);
    const index = reviewFiles.findIndex((file) => file.path === path);
    const next = [...reviewFiles.slice(index + 1), ...reviewFiles.slice(0, index)].find((file) => !checked.includes(file.path));
    if (next) void openReview(next.path); else setReview(null);
  };
  const toggleReviewed = (path: string) => {
    if (reviewChecked.includes(path)) setReviewChecked((current) => current.filter((item) => item !== path));
    else if (review?.path === path) markAndAdvance(path);
    else setReviewChecked((current) => [...current, path]);
  };
  const toggleStage = async (file: GitFile) => {
    try {
      await invoke(file.staged ? "git_unstage" : "git_stage", { path: file.path });
      await refreshGit();
      addLog(file.staged ? "File unstaged" : "File staged");
    } catch (nextError) { setGitFeedback(`Git error: ${String(nextError)}`); }
  };
  const changeMode = (next: WorkspaceMode) => {
    setMode(next);
    setCommentDraft(null);
    setAgentCompact(next === "review");
    if (root) localStorage.setItem(`maestr-mode:${root}`, next);
  };
  const authenticateGitHub = () => {
    setTerminalOpen(true);
    setTerminalCommand("gh auth login -h github.com -p https -w && gh auth setup-git -h github.com\r");
    setGitFeedback("Conclua o login do GitHub no terminal e tente Push novamente.");
  };
  const rejectReview = async () => {
    if (!review || !review.diff.original || !window.confirm(`Restore ${review.path} to HEAD?`)) return;
    try { await invoke("git_restore_file", { path: review.path }); setReview(null); await refreshGit(); setGitFeedback("File restored to HEAD"); } catch (nextError) { setGitFeedback(`Restore error: ${String(nextError)}`); }
  };

  const startResize = (kind: "sidebar" | "agent" | "terminal", event: ReactPointerEvent) => {
    event.preventDefault();
    resizeState.current = { kind, start: kind === "terminal" ? event.clientY : event.clientX, size: kind === "sidebar" ? (mode === "review" ? reviewSidebarWidth : sidebarWidth) : kind === "agent" ? agentWidth : terminalHeight };
  };
  const resetResize = (kind: "sidebar" | "agent" | "terminal") => { if (kind === "sidebar") { if (mode === "review") setReviewSidebarWidth(496); else setSidebarWidth(248); } if (kind === "agent") setAgentWidth(Math.max(300, Math.round((window.innerWidth - 248) / 2))); if (kind === "terminal") setTerminalHeight(190); };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = resizeState.current;
      if (!resize) return;
      const delta = (resize.kind === "terminal" ? resize.start - event.clientY : event.clientX - resize.start);
      if (resize.kind === "sidebar") { const width = Math.min(700, Math.max(180, window.innerWidth - event.clientX)); if (mode === "review") setReviewSidebarWidth(width); else setSidebarWidth(width); }
      if (resize.kind === "agent") setAgentWidth(Math.max(220, resize.size + delta));
      if (resize.kind === "terminal") setTerminalHeight(Math.min(420, Math.max(140, resize.size + delta)));
    };
    const stop = () => { resizeState.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(".xterm, input, select, [contenteditable='true']") || (target?.closest("textarea") && !target.closest(".monaco-editor"))) return;
      const key = event.key.toLowerCase();
      if (mode === "edit" && key === "tab" && tabs.length) { event.preventDefault(); const index = Math.max(0, tabs.findIndex((tab) => tab.path === activePath)); setActive(tabs[(index + (event.shiftKey ? tabs.length - 1 : 1)) % tabs.length].path); }
      else if (mode === "edit" && key === "w" && activePath) { event.preventDefault(); closeTab(activePath); }
      else if (key === "s") { event.preventDefault(); saveActive(); }
      else if (key === "1") { event.preventDefault(); changeMode("edit"); }
      else if (key === "2") { event.preventDefault(); changeMode("review"); }
      else if (key === "b" && mode === "edit") { event.preventDefault(); setExplorerCompact((current) => !current); }
      else if (key === "j") { event.preventDefault(); setTerminalOpen((current) => !current); }
      else if (key === "a" && event.shiftKey) { event.preventDefault(); setAgentCompact((current) => !current); }
      else if (key === "f" && event.shiftKey && mode === "edit") { event.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!("__TAURI_INTERNALS__" in window)) return <main className={`app-shell theme-${settings.theme ?? "maestr"}`}><section className="desktop-only"><Code2 size={24} /><p>Maestr runs as a desktop app.</p><span>Start it with <code>pnpm tauri dev</code> to access local folders without uploading them.</span></section></main>;
  if (!root) return <main className={`app-shell empty-shell theme-${settings.theme ?? "maestr"}`}><header className="topbar empty-titlebar" data-tauri-drag-region><div className="brand"><img className="brand-mark" src={maestrOnlyLogo} alt="" /><span className="brand-name">Maestr</span></div><WindowControls /></header><EmptyWorkspace onOpen={chooseFolder} /></main>;

  return (
    <main className={`app-shell theme-${settings.theme ?? "maestr"} ${settingsOpen ? "settings-open" : ""}`}>
      <header className="topbar" data-tauri-drag-region>
        <div className="brand"><img className="brand-mark" src={maestrOnlyLogo} alt="" /><span className="brand-name">Maestr</span></div>
        <div className="workspace-title"><button className="workspace-picker" onClick={chooseFolder} title="Open another workspace"><Folder size={14} /><span>{rootName}</span></button><BranchSelect key={root} onFeedback={(message) => { setGitFeedback(message); addLog(message); }} onChanged={() => void refreshGit()} /></div>
        <div className="mode-switch" role="group" aria-label="Workspace mode"><button title="Edit (Ctrl/Cmd+1)" className={mode === "edit" ? "active" : ""} aria-pressed={mode === "edit"} onClick={() => changeMode("edit")}><FileCode2 size={13} /> Edit</button><button title="Review (Ctrl/Cmd+2)" className={mode === "review" ? "active" : ""} aria-pressed={mode === "review"} onClick={() => changeMode("review")}><GitBranch size={13} /> Review{reviewFiles.length > 0 && <span>{reviewFiles.length}</span>}</button></div>
        <div className="top-actions"><button className="icon-button" title="Activity logs" onClick={() => setLogsOpen(true)}><ScrollText size={17} /></button><button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button><WindowControls /></div>
      </header>
      <div className={`workspace-grid mode-${mode}`} style={{ gridTemplateColumns: `${agentCompact ? 48 : agentWidth}px minmax(300px, 1fr) ${mode === "review" ? reviewSidebarWidth : explorerCompact ? 48 : sidebarWidth}px` }}>
        <aside className={`agent-panel ${agentCompact ? "compact" : ""}`}>{!agentCompact && <div className="resize-handle resize-right" onPointerDown={(event) => startResize("agent", event)} onDoubleClick={() => resetResize("agent")} />}<AgentPanel key={`${root}:${agentInterface}`} compact={agentCompact} terminalMode={agentInterface === "terminal"} onToggleCompact={() => setAgentCompact((current) => !current)} onSessionChange={setAgentSessionId} onAgentChange={setSelectedAgent} onLog={addLog} /></aside>
        <section className="editor-area">
          {mode === "review" ? <div className="reviewbar"><span><strong>Review</strong>{reviewFiles.length ? review ? `${reviewIndex + 1} of ${reviewFiles.length}` : `${reviewChecked.length}/${reviewFiles.length} reviewed` : "No changes"}</span><span className="review-nav"><button className="icon-button small" title="Previous changed file" disabled={reviewIndex <= 0} onClick={() => void openReview(reviewFiles[reviewIndex - 1].path)}><ChevronLeft size={14} /></button><button className="icon-button small" title="Next changed file" disabled={reviewIndex < 0 || reviewIndex >= reviewFiles.length - 1} onClick={() => void openReview(reviewFiles[reviewIndex + 1].path)}><ChevronRight size={14} /></button></span></div> : <div className="tabbar">
            {tabs.length === 0 && <span className="tabbar-empty">No files open</span>}
            {tabs.map((tab) => <button key={tab.path} className={`tab ${tab.path === activePath ? "active" : ""}`} onClick={() => setActive(tab.path)} onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab.path); } }}><FileCode2 size={14} /><span>{tab.name}</span>{tab.dirty && <span className="dirty-dot" /> }<span className="tab-close" onClick={(event) => { event.stopPropagation(); closeTab(tab.path); }}><X size={13} /></span></button>)}
          </div>}
          {mode === "review" ? review ? <div className={`editor-wrap ${commentDraft?.path === review.path ? "comment-open" : ""}`}><div className="editor-toolbar"><span className="file-location">{review.path}</span><span className="review-actions"><button className="button button-quiet" onClick={() => startComment(review.path)}><MessageSquare size={14} /> Comment</button><button className="button button-quiet" onClick={() => markAndAdvance(review.path)}>Mark reviewed & next</button>{review.diff.original && <button className="button button-quiet danger" onClick={() => void rejectReview()}>Reject</button>}</span></div>{commentDraft?.path === review.path && <CommentComposer draft={commentDraft} onChange={(text) => setCommentDraft({ ...commentDraft, text })} onSave={addComment} onCancel={() => setCommentDraft(null)} />}<div className="monaco-editor-host"><DiffEditor key={review.path} height="100%" theme={editorTheme} beforeMount={defineMonacoThemes} original={review.diff.original} modified={review.diff.modified} language={languageFor(review.path)} onMount={(editor, monaco) => { const modified = editor.getModifiedEditor(); mountCommentEditor(modified, monaco, review.path); modified.revealLineInCenter(firstChangedLine(review.diff.original, review.diff.modified)); }} options={{ automaticLayout: true, readOnly: true, originalEditable: false, glyphMargin: true, minimap: { enabled: settings.minimap === true }, fontFamily: settings.font ?? "SFMono-Regular", fontSize: settings.fontSize ?? 13, lineHeight: settings.lineHeight ?? 22, padding: { top: settings.editorPadding ?? 18, bottom: settings.editorPadding ?? 18 }, wordWrap: settings.wordWrap ? "on" : "off", renderWhitespace: settings.renderWhitespace ?? "selection", renderSideBySide: settings.diff !== "inline", scrollBeyondLastLine: false }} /></div></div> : <div className="editor-empty review-finished"><GitBranch size={30} /><p>{reviewFiles.length ? "Review complete" : "Working tree clean"}</p><span>{reviewFiles.length ? "Every changed file is marked reviewed." : "New agent changes will appear here automatically."}</span>{reviewFiles.length > 0 && <button className="button button-quiet" onClick={() => setReviewChecked([])}>Review again</button>}</div> : activeFile ? <div className={`editor-wrap ${commentDraft?.path === activeFile.path ? "comment-open" : ""}`}><div className="editor-toolbar"><span className="file-location">{activeFile.path}</span><span className="review-actions"><button className="button button-quiet" onClick={() => startComment(activeFile.path)}><MessageSquare size={14} /> Add comment</button><button className="button button-quiet" disabled={!activeFile.dirty || busy} onClick={saveActive}><Save size={15} /> {activeFile.dirty ? "Save" : "Saved"}</button></span></div>{commentDraft?.path === activeFile.path && <CommentComposer draft={commentDraft} onChange={(text) => setCommentDraft({ ...commentDraft, text })} onSave={addComment} onCancel={() => setCommentDraft(null)} />}<div className="monaco-editor-host"><Editor height="100%" theme={editorTheme} beforeMount={defineMonacoThemes} path={activeFile.path} language={languageFor(activeFile.path)} value={activeFile.content} onMount={(editor, monaco) => mountCommentEditor(editor, monaco, activeFile.path)} onChange={(value) => updateFile(activeFile.path, value ?? "")} options={{ automaticLayout: true, minimap: { enabled: settings.minimap === true }, glyphMargin: true, fontFamily: settings.font ?? "SFMono-Regular", fontSize: settings.fontSize ?? 13, lineNumbers: settings.lineNumbers === false ? "off" : "on", lineHeight: settings.lineHeight ?? 22, padding: { top: settings.editorPadding ?? 18, bottom: settings.editorPadding ?? 18 }, scrollBeyondLastLine: false, smoothScrolling: true, wordWrap: settings.wordWrap ? "on" : "off", renderWhitespace: settings.renderWhitespace ?? "selection" }} loading={<div className="editor-loading">Loading editor…</div>} /></div></div> : <div className="editor-empty"><FileCode2 size={30} /><p>Open a file from the explorer</p><span>Changes stay local until you save them.</span></div>}
          <TerminalDock key={root} open={terminalOpen} command={terminalCommand} onCommandHandled={() => setTerminalCommand(null)} onToggle={() => setTerminalOpen(!terminalOpen)} onResizeStart={(event) => startResize("terminal", event)} onResizeReset={() => resetResize("terminal")} height={terminalHeight} />
        </section>
        <aside className={`sidebar ${mode === "edit" && explorerCompact ? "compact" : ""}`}>
          {mode === "edit" && explorerCompact ? <button className="explorer-rail" title="Expand Explorer" onClick={() => setExplorerCompact(false)}><FileCode2 size={17} /><span>Explorer</span><ChevronLeft size={14} /></button> : <><div className="panel-heading"><span>{mode === "review" ? "Changes" : "Explorer"}</span>{mode === "review" ? <button className="icon-button small" title="Refresh changes" onClick={() => void refreshGit()}><span aria-hidden="true">↻</span></button> : <button className="icon-button small" title="Collapse Explorer" onClick={() => setExplorerCompact(true)}><ChevronRight size={14} /></button>}</div>
          {mode === "edit" ? <><button className="project-root" onClick={() => toggleDirectory({ name: rootName, path: "", kind: "directory", size: 0 })}><span className="tree-root-chevron">{expanded.includes("") ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span><FolderOpen size={15} /><span>{rootName}</span></button><div className="tree" role="tree">{expanded.includes("") && (entries[""] ?? []).filter((entry) => showHiddenFiles || !entry.name.startsWith(".")).map((entry) => <TreeNode key={entry.path} entry={entry} depth={0} showHiddenFiles={showHiddenFiles} />)}</div></> : <><ReviewPanel files={reviewFiles} selected={review?.path ?? ""} checked={reviewChecked} onSelect={openReview} onToggle={toggleReviewed} onStage={(file) => void toggleStage(file)} comments={comments} onSendComments={sendComments} onDeleteComment={(id) => { setComments((current) => current.filter((comment) => comment.id !== id)); addLog("Comment removed"); }} onClearSent={() => { setComments((current) => current.filter((comment) => comment.status !== "sent")); addLog("Sent comments cleared"); }} agentRunning={selectedAgent !== null} onFeedback={setGitFeedback} /><div className="sidebar-section-divider"><span>VERSION CONTROL</span></div><GitPanel status={gitStatus} onRefresh={refreshGit} onFeedback={setGitFeedback} onLog={addLog} feedback={gitFeedback} onAuthenticate={authenticateGitHub} onReview={openReview} onAskCommit={generateCommitMessage} canGenerateCommit={selectedAgent !== null} /></>}
          <div className="resize-handle resize-left" onPointerDown={(event) => startResize("sidebar", event)} onDoubleClick={() => resetResize("sidebar")} /></>}
        </aside>
      </div>
      <footer className="statusbar"><span>{busy ? "Working…" : error ? error : gitFeedback || "Workspace ready"}</span><span className="status-right">UTF-8 <span className="separator" /> LF <span className="separator" /> Local</span></footer>
      {settingsOpen && <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}><section className="settings-panel" onClick={(event) => event.stopPropagation()}><div className="settings-heading"><strong>Settings</strong><button className="icon-button small" onClick={() => setSettingsOpen(false)}><X size={14} /></button></div><div className="settings-section first">Editor</div><label>Font<select value={String(settings.font ?? "SFMono-Regular")} onChange={(event) => updateSettings("font", event.target.value)}><option>SFMono-Regular</option><option>Cascadia Code</option><option>JetBrains Mono</option><option>Fira Code</option></select></label><label>Font size<input type="number" min="10" max="24" value={Number(settings.fontSize ?? 13)} onChange={(event) => updateSettings("fontSize", Number(event.target.value))} /></label><label>Line height<input type="number" min="16" max="40" value={Number(settings.lineHeight ?? 22)} onChange={(event) => updateSettings("lineHeight", Number(event.target.value))} /></label><label>Vertical padding<input type="number" min="0" max="48" value={Number(settings.editorPadding ?? 18)} onChange={(event) => updateSettings("editorPadding", Number(event.target.value))} /></label><label>Whitespace<select value={String(settings.renderWhitespace ?? "selection")} onChange={(event) => updateSettings("renderWhitespace", event.target.value)}><option value="none">Hidden</option><option value="selection">Selection</option><option value="boundary">Boundary</option><option value="all">All</option></select></label><label className="settings-check"><input type="checkbox" checked={settings.lineNumbers !== false} onChange={(event) => updateSettings("lineNumbers", event.target.checked)} /> Show line numbers</label><label className="settings-check"><input type="checkbox" checked={settings.wordWrap === true} onChange={(event) => updateSettings("wordWrap", event.target.checked)} /> Wrap long lines</label><label className="settings-check"><input type="checkbox" checked={settings.minimap === true} onChange={(event) => updateSettings("minimap", event.target.checked)} /> Show minimap</label><label className="settings-check"><input type="checkbox" checked={settings.showHiddenFiles === true} onChange={(event) => updateSettings("showHiddenFiles", event.target.checked)} /> Show hidden files</label><div className="settings-section">Agent</div><label>Interface<select value={agentInterface} onChange={(event) => updateSettings("agentInterface", event.target.value)}><option value="chat">Maestr Chat</option><option value="terminal">Terminal</option></select></label><div className="settings-section">Appearance</div><label>Editor theme<select value={String(settings.theme ?? "maestr")} onChange={(event) => updateSettings("theme", event.target.value)}><option value="tide">Tide</option><option value="onedark">One Dark</option><option value="catppuccin">Catppuccin Mocha</option><option value="nord">Nord</option><option value="solarized">Solarized Dark</option><option value="maestr">Maestr</option><option value="light">Light</option><option value="high-contrast">High contrast</option></select></label><label>Diff style<select value={String(settings.diff ?? "side")} onChange={(event) => updateSettings("diff", event.target.value)}><option value="side">Side by side</option><option value="inline">Inline</option></select></label></section></div>}
      {logsOpen && <div className="settings-backdrop" onClick={() => setLogsOpen(false)}><section className="settings-panel logs-panel" onClick={(event) => event.stopPropagation()}><div className="settings-heading"><strong>Activity logs</strong><button className="icon-button small" onClick={() => setLogsOpen(false)}><X size={14} /></button></div>{logs.length ? <div className="logs-list">{logs.slice().reverse().map((log) => <div key={log.id}><time>{log.time}</time><span>{log.message}</span></div>)}</div> : <p className="logs-empty">No activity yet.</p>}</section></div>}
      {searchOpen && <div className="global-search-backdrop" onMouseDown={() => setSearchOpen(false)}><section className="global-search" role="dialog" aria-modal="true" aria-label="Search workspace" onMouseDown={(event) => event.stopPropagation()}><div className="global-search-input"><Search size={16} /><input autoFocus value={searchQuery} placeholder="Search files" onChange={(event) => setSearchQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Escape") setSearchOpen(false); }} /><kbd>Esc</kbd></div><div className="global-search-results">{searchLoading ? <span>Searching…</span> : searchQuery.trim().length < 2 ? <span>Type at least two characters</span> : searchResults.length ? searchResults.map((result) => <button key={`${result.path}:${result.line}`} onClick={() => void openSearchResult(result)}><span><strong>{result.path}</strong><em>:{result.line}</em></span><p>{result.preview}</p></button>) : <span>No matches</span>}</div></section></div>}
    </main>
  );
}

export default App;
