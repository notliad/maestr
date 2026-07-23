import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Editor, { DiffEditor, type BeforeMount } from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ChevronDown, ChevronRight, ChevronUp, CircleStop, Code2, FileCode2, Folder, FolderOpen, GitBranch, LoaderCircle, Maximize2, MessageSquare, Minimize2, PanelRight, Play, Plus, Save, ScrollText, Settings2, TerminalSquare, WandSparkles, X } from "lucide-react";
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

function WindowControls() {
  const appWindow = getCurrentWindow();
  return <div className="window-controls"><button className="window-control" title="Minimize" aria-label="Minimize" onClick={() => void appWindow.minimize()}><Minimize2 size={15} /></button><button className="window-control" title="Maximize or restore" aria-label="Maximize or restore" onClick={() => void appWindow.toggleMaximize()}><Maximize2 size={14} /></button><button className="window-control window-close" title="Close" aria-label="Close" onClick={() => void appWindow.close()}><X size={16} /></button></div>;
}

function CommentComposer({ draft, onChange, onSave, onCancel }: { draft: CommentDraft; onChange: (text: string) => void; onSave: () => void; onCancel: () => void }) {
  return <div className="comment-composer"><div className="comment-composer-meta"><MessageSquare size={13} /><span>{draft.path}:{draft.startLine}{draft.endLine !== draft.startLine ? `-${draft.endLine}` : ""}</span></div><textarea autoFocus value={draft.text} placeholder="Leave an implementation comment" onChange={(event) => onChange(event.currentTarget.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); onSave(); } }} /><div className="comment-composer-actions"><span>Ctrl/Cmd + Enter to save</span><button className="button button-quiet" onClick={onCancel}>Cancel</button><button className="button button-primary" onClick={onSave} disabled={!draft.text.trim()}>Add comment</button></div></div>;
}

function TreeNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  const { entries, expanded, toggleDirectory, openFile } = useWorkspaceStore();
  const isOpen = expanded.includes(entry.path);
  const children = entries[entry.path] ?? [];
  return (
    <>
      <button className={`tree-row ${entry.kind}`} style={{ paddingLeft: `${12 + depth * 16}px` }} onClick={() => entry.kind === "directory" ? toggleDirectory(entry) : openFile(entry)}>
        {entry.kind === "directory" ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="tree-spacer" />}
        {entry.kind === "directory" ? (isOpen ? <FolderOpen size={15} /> : <Folder size={15} />) : <FileCode2 size={15} />}
        <span className={`tree-name ${entry.project ? "tree-project" : ""}`}>{entry.name}</span>{entry.project && <GitBranch size={12} className="tree-project-mark" />}
        {entry.kind === "file" && entry.size > 5 * 1024 * 1024 && <span className="tree-meta">large</span>}
      </button>
      {isOpen && children.map((child) => <TreeNode key={child.path} entry={child} depth={depth + 1} />)}
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
  const themes: Record<string, { background: string; foreground: string; accent: string }> = { maestr: { background: "282a36", foreground: "f8f8f2", accent: "bd93f9" }, onedark: { background: "282c34", foreground: "abb2bf", accent: "61afef" }, catppuccin: { background: "181825", foreground: "cdd6f4", accent: "cba6f7" }, nord: { background: "2e3440", foreground: "d8dee9", accent: "88c0d0" }, solarized: { background: "002b36", foreground: "839496", accent: "b58900" } };
  Object.entries(themes).forEach(([name, theme]) => monaco.editor.defineTheme(`maestr-${name}`, { base: "vs-dark", inherit: true, rules: [], colors: { "editor.background": `#${theme.background}`, "editor.foreground": `#${theme.foreground}`, "editorCursor.foreground": `#${theme.accent}`, "editorLineNumber.foreground": `#${theme.foreground}88`, "editorLineNumber.activeForeground": `#${theme.accent}` } }));
};

function firstChangedLine(original: string, modified: string) {
  const before = original.split("\n"); const after = modified.split("\n");
  const limit = Math.min(before.length, after.length);
  for (let index = 0; index < limit; index += 1) if (before[index] !== after[index]) return index + 1;
  return Math.min(limit + 1, after.length);
}

function TerminalView({ sessionId, active, onExit }: { sessionId: number; active: boolean; onExit?: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", "Cascadia Code", monospace',
      fontSize: 12,
      theme: { background: "#171815", foreground: "#d8dbd1", cursor: "#e7b75e", selectionBackground: "#4a4e43" },
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
    if (!active || !container.current || !fitRef.current || !terminalRef.current) return;
    requestAnimationFrame(() => {
      if (!container.current?.clientWidth || !container.current.clientHeight) return;
      fitRef.current?.fit();
      void invoke("resize_terminal", { sessionId, cols: terminalRef.current?.cols, rows: terminalRef.current?.rows });
    });
  }, [active, sessionId]);
  return <div className={`terminal-view ${active ? "active" : ""}`} ref={container} />;
}

function TerminalDock({ open: isOpen, onToggle, onResizeStart, onResizeReset, height }: { open: boolean; onToggle: () => void; onResizeStart: (event: ReactPointerEvent) => void; onResizeReset: () => void; height: number }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const createSession = useCallback(async () => {
    try {
      const id = await invoke<number>("start_terminal", { cols: 100, rows: 24 });
      setSessions((current) => [...current, { id, label: `Terminal ${current.length + 1}` }]);
      setActiveId(id);
    } catch (error) {
      console.error("Could not start terminal", error);
    }
  }, []);
  useEffect(() => {
    if (isOpen && sessions.length === 0) void createSession();
  }, [createSession, isOpen, sessions.length]);
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

function GitPanel({ onFeedback, onLog, feedback, revision, onReview, onAskCommit, canGenerateCommit }: { onFeedback: (message: string) => void; onLog: (message: string) => void; feedback: string; revision: number; onReview: (path: string) => void; onAskCommit: () => Promise<string>; canGenerateCommit: boolean }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [openSections, setOpenSections] = useState({ staged: true, changes: true });
  const refresh = useCallback(async () => {
    try {
      const next = await invoke<GitStatus>("git_status");
      setStatus(next);
    } catch (error) { setStatus({ isRepo: true, canPush: false, files: [], branch: String(error) }); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, revision]);
  const run = async (command: string, args: Record<string, unknown> = {}, success = "Git action completed") => {
    setBusy(true);
    try { await invoke(command, args); await refresh(); onFeedback(success); onLog(success); } catch (error) { const message = `Git error: ${String(error)}`; onFeedback(message); onLog(message); }
    finally { setBusy(false); }
  };
  const generateCommit = async () => { setGenerating(true); try { const next = await onAskCommit(); setMessage(next); onFeedback("Commit message generated"); onLog("Commit message generated"); } catch (error) { const message = `Commit message error: ${String(error)}`; onFeedback(message); onLog(message); } finally { setGenerating(false); } };
  if (!status) return <div className="git-panel git-loading">Loading Git…</div>;
  if (!status.isRepo) return <div className="git-panel git-empty"><GitBranch size={20} /><p>Not a Git repository</p><span>Initialize Git in the terminal to enable source control.</span></div>;
  return <div className="git-panel">
    {feedback && <div className="git-feedback">{feedback}</div>}
    <div className="git-toolbar"><span className="git-branch-label"><GitBranch size={13} /> {status.branch ?? "detached"}</span><button className="icon-button small" title="Refresh Git" onClick={() => void refresh()}><span aria-hidden="true">↻</span></button></div>
    {status.files.some((file) => file.staged) && <div className="git-commit"><input value={message} onChange={(event) => setMessage(event.currentTarget.value)} placeholder="Commit message" onKeyDown={(event) => { if (event.key === "Enter" && message.trim()) { void run("git_commit", { message }); setMessage(""); } }} /><button className="icon-button small" title={canGenerateCommit ? "Generate commit message with selected agent" : "Select an agent to generate a commit message"} onClick={() => void generateCommit()} disabled={!canGenerateCommit || busy || generating}>{generating ? <LoaderCircle size={14} className="loading-spin" /> : <WandSparkles size={14} />}</button><button className="button button-primary" onClick={() => { void run("git_commit", { message }); setMessage(""); }} disabled={busy || generating || !message.trim()}>Commit</button></div>}
    <div className="git-actions">{status.files.some((file) => !file.staged) && <button className="button button-quiet" onClick={() => void run("git_stage_all", {}, "All files staged")} disabled={busy}>Stage all</button>}{status.files.some((file) => file.staged) && <button className="button button-quiet" onClick={() => void run("git_unstage_all", {}, "All files unstaged")} disabled={busy}>Unstage all</button>}<button className="button button-quiet" onClick={() => void run("git_sync", { action: "pull" }, "Pull completed")} disabled={busy}>Pull</button>{status.canPush && <button className="button button-quiet" onClick={() => void run("git_sync", { action: "push" }, "Push completed")} disabled={busy}>Push</button>}</div>
    {(() => { const staged = status.files.filter((file) => file.staged); const changes = status.files.filter((file) => !file.staged); const renderFile = (file: GitFile) => <button key={file.path} className="git-file" onClick={() => onReview(file.path)}><span className={`git-status status-${file.status}`}>{file.status === "untracked" ? "U" : file.status[0].toUpperCase()}</span><span className="git-file-name">{file.path}</span><span className="git-lines"><strong>+{file.additions ?? 0}</strong><em>−{file.deletions ?? 0}</em></span><span className="git-stage" onClick={(event) => { event.stopPropagation(); void run(file.staged ? "git_unstage" : "git_stage", { path: file.path }, file.staged ? "File unstaged" : "File staged"); }}>{file.staged ? "−" : "+"}</span></button>; const section = (name: "staged" | "changes", title: string, items: GitFile[], empty: string) => <><button className="git-section-label git-section-toggle" onClick={() => setOpenSections((current) => ({ ...current, [name]: !current[name] }))}>{openSections[name] ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {title} <span>{items.length}</span></button>{openSections[name] && <div className="git-file-list">{items.length === 0 ? <span className="git-muted">{empty}</span> : items.map(renderFile)}</div>}</>; return <>{section("staged", "Staged Changes", staged, "Nothing staged")}{section("changes", "Changes", changes, "Working tree clean")}</>; })()}
  </div>;
}

function ReviewPanel({ revision, selected, checked, onSelect, onToggle, comments, onSendComments, onDeleteComment, onClearSent, agentRunning, onFeedback }: { revision: number; selected: string; checked: string[]; onSelect: (path: string) => void; onToggle: (path: string) => void; comments: CodeComment[]; onSendComments: () => Promise<void>; onDeleteComment: (id: string) => void; onClearSent: () => void; agentRunning: boolean; onFeedback: (message: string) => void }) {
  const [files, setFiles] = useState<GitFile[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const completedGroups = useRef(new Set<string>());
  const [sending, setSending] = useState(false);
  useEffect(() => { void invoke<GitStatus>("git_status").then((status) => setFiles(status.files)).catch(() => setFiles([])); }, [revision]);
  const groups = files.reduce<Record<string, GitFile[]>>((all, file) => { const folder = file.path.split(/[\\/]/).slice(0, -1).join("/") || "."; (all[folder] ??= []).push(file); return all; }, {});
  useEffect(() => { const complete = new Set(Object.entries(groups).filter(([, items]) => items.every((file) => checked.includes(file.path))).map(([folder]) => folder)); const newlyComplete = [...complete].filter((folder) => !completedGroups.current.has(folder)); completedGroups.current = complete; if (newlyComplete.length) setOpenGroups((current) => ({ ...current, ...Object.fromEntries(newlyComplete.map((folder) => [folder, false])) })); }, [checked, files]);
  const done = files.length > 0 && files.every((file) => checked.includes(file.path));
  const pending = comments.filter((comment) => comment.status === "pending");
  const sent = comments.filter((comment) => comment.status === "sent");
  const send = async () => { setSending(true); try { await onSendComments(); onFeedback(`${pending.length} comment${pending.length === 1 ? "" : "s"} sent to agent`); } catch (error) { onFeedback(String(error)); } finally { setSending(false); } };
  return <div className="review-panel"><div className="review-section-title">Code Review</div>{done && <div className="review-complete">✓ All changes reviewed</div>}<div className="review-summary">{files.length ? `${checked.length}/${files.length} reviewed` : "No changes to review"}</div>{pending.length > 0 && <div className="review-comment-actions"><button className="button button-primary" onClick={() => void send()} disabled={!agentRunning || sending}><MessageSquare size={14} /> {sending ? "Sending…" : `Send comments (${pending.length})`}</button>{!agentRunning && <span>Start an agent to send</span>}</div>}{comments.length > 0 && <details className="review-comment-queue"><summary><MessageSquare size={13} /> {pending.length} pending comment{pending.length === 1 ? "" : "s"}</summary>{comments.map((comment) => <div className="review-comment-item" key={comment.id}><span><strong>{comment.path}:{comment.startLine}</strong>{comment.text}</span><button className="icon-button small" title="Remove comment" onClick={() => onDeleteComment(comment.id)}><X size={13} /></button></div>)}{sent.length > 0 && <button className="button button-quiet" onClick={onClearSent}>Clear sent</button>}</details>}{Object.entries(groups).map(([folder, items]) => { const complete = items.every((file) => checked.includes(file.path)); const open = openGroups[folder] ?? !complete; return <div className="review-group" key={folder}><button className="review-group-title" onClick={() => setOpenGroups((current) => ({ ...current, [folder]: !open }))}><span>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Folder size={13} /> {folder}</span>{complete && <span className="review-group-check">✓</span>}</button>{open && items.map((file) => <div key={file.path} className={`review-file ${selected === file.path ? "active" : ""}`}><button onClick={() => onSelect(file.path)}><span className="git-status">{file.status === "untracked" ? "U" : file.status[0].toUpperCase()}</span><span>{file.path.split(/[\\/]/).pop()}</span><span className="git-lines"><strong>+{file.additions ?? 0}</strong><em>−{file.deletions ?? 0}</em></span></button><button className={`review-check ${checked.includes(file.path) ? "checked" : ""}`} title="Mark reviewed" onClick={() => onToggle(file.path)}>✓</button></div>)}</div>; })}</div>;
}
function AgentPanel({ onSessionChange, onAgentChange, onLog }: { onSessionChange: (sessionId: number | null) => void; onAgentChange: (agent: string | null) => void; onLog: (message: string) => void }) {
  const root = useWorkspaceStore((state) => state.root);
  const [agents, setAgents] = useState<{ name: string; command: string; version?: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const running = sessionId !== null;
  const handleExit = useCallback(() => { setSessionId(null); onSessionChange(null); onLog("Agent session exited"); }, [onLog, onSessionChange]);
  useEffect(() => {
    const candidates = [{ name: "Claude Code", command: "claude" }, { name: "Codex CLI", command: "codex" }, { name: "OpenCode", command: "opencode" }, { name: "Pi", command: "pi" }];
    void Promise.all(candidates.map(async (candidate) => ({ ...candidate, ...(await invoke<{ available: boolean; version?: string }>("detect_agent", { agent: candidate.command }).catch(() => ({ available: false }))) }))).then((found) => {
      const installed = found.filter((agent) => agent.available);
      const options = installed.length ? installed : candidates.map((candidate) => ({ ...candidate, version: undefined }));
      setAgents(options); setSelected(localStorage.getItem(`maestr-agent:${root ?? "default"}`) || options[0]?.command || "");
    });
  }, [root]);
  useEffect(() => { onAgentChange(selected || null); }, [onAgentChange, selected]);
  const launch = async () => { if (!selected || running) return; localStorage.setItem(`maestr-agent:${root ?? "default"}`, selected); try { const id = await invoke<number>("start_terminal", { cols: 100, rows: 28 }); setSessionId(id); onSessionChange(id); onLog(`${selected} started`); await invoke("write_terminal", { sessionId: id, data: `clear; ${selected}\r` }); } catch { setSessionId(null); onSessionChange(null); onLog(`Could not start ${selected}`); } };
  const close = async () => { if (sessionId !== null) { await invoke("close_terminal", { sessionId }).catch(() => undefined); setSessionId(null); onSessionChange(null); onLog("Agent stopped"); } };
  return <>
    <div className="panel-heading agent-heading"><span>Agent</span><span className="agent-controls"><select className="agent-select" value={selected} onChange={(event) => setSelected(event.currentTarget.value)} disabled={running}><option value="">No agent found</option>{agents.map((agent) => <option key={agent.command} value={agent.command}>{agent.name}{agent.version ? ` · ${agent.version}` : ""}</option>)}</select><button className={`icon-button small agent-run-button ${running ? "running" : ""}`} title={running ? "Stop agent" : "Start agent"} onClick={() => void (running ? close() : launch())} disabled={!selected}>{running ? <CircleStop size={15} /> : <Play size={14} />}</button></span></div>
    <div className="agent-panel-content">{sessionId !== null ? <div className="agent-terminal-host"><TerminalView sessionId={sessionId} active onExit={handleExit} /></div> : <div className="agent-empty"><TerminalSquare size={26} /><p>Select an agent and press Play</p></div>}</div>
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
  const { root, entries, expanded, tabs, activePath, busy, error, loadRecent, openWorkspace, toggleDirectory, updateFile, saveFile, closeTab, setActive } = useWorkspaceStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"explorer" | "git" | "review">("explorer");
  const [gitFeedback, setGitFeedback] = useState("");
  const [gitRevision, setGitRevision] = useState(0);
  const [review, setReview] = useState<{ path: string; diff: GitDiff } | null>(null);
  const [reviewChecked, setReviewChecked] = useState<string[]>([]);
  const [comments, setComments] = useState<CodeComment[]>([]);
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
  const editorTheme = ["maestr", "onedark", "catppuccin", "nord", "solarized"].includes(settings.theme) ? `maestr-${settings.theme}` : settings.theme === "light" ? "vs-light" : "hc-black";
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [agentWidth, setAgentWidth] = useState(() => Math.max(300, Math.round((window.innerWidth - 248) / 2)));
  const [terminalHeight, setTerminalHeight] = useState(190);
  const resizeState = useRef<{ kind: "sidebar" | "agent" | "terminal"; start: number; size: number } | null>(null);
  const activeFile = tabs.find((tab) => tab.path === activePath);
  const rootName = useMemo(() => root?.split(/[\\/]/).filter(Boolean).at(-1) ?? "Workspace", [root]);
  const addLog = useCallback((message: string) => setLogs((current) => [...current.slice(-99), { id: crypto.randomUUID(), time: new Date().toLocaleTimeString(), message }]), []);

  useEffect(() => { void loadRecent(); }, [loadRecent]);
  useEffect(() => {
    if (!root) { setComments([]); setCommentsLoadedFor(null); return; }
    try { setComments(JSON.parse(localStorage.getItem(`maestr-comments:${root}`) || "[]")); } catch { setComments([]); }
    setCommentsLoadedFor(root);
    setCommentDraft(null);
  }, [root]);
  useEffect(() => {
    if (root && commentsLoadedFor === root) localStorage.setItem(`maestr-comments:${root}`, JSON.stringify(comments));
  }, [comments, commentsLoadedFor, root]);
  useEffect(() => { setAgentWidth(Math.max(300, Math.round((window.innerWidth - sidebarWidth) / 2))); }, []);

  const applyCommentDecorations = useCallback((path: string, target: { editor: any; monaco: any; decorations: any }) => {
    target.decorations.set(comments.filter((comment) => comment.path === path).map((comment) => ({ range: new target.monaco.Range(comment.startLine, 1, comment.endLine, 1), options: { isWholeLine: true, className: comment.status === "pending" ? "commented-line-pending" : "commented-line-sent", linesDecorationsClassName: comment.status === "pending" ? "comment-line-pending" : "comment-line-sent", hoverMessage: { value: comment.text } } })));
  }, [comments]);
  useEffect(() => { commentEditors.current.forEach((target, path) => applyCommentDecorations(path, target)); }, [applyCommentDecorations]);

  const openCommentComposer = useCallback((editor: any, path: string) => {
    const model = editor.getModel(); const selection = editor.getSelection(); const position = editor.getPosition();
    const startLine = selection?.startLineNumber ?? position?.lineNumber;
    const endLine = selection?.endLineNumber ?? position?.lineNumber;
    if (!model || !startLine || !endLine) return;
    const excerpt = selection && !selection.isEmpty() ? model.getValueInRange(selection) : model.getLineContent(startLine);
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

  const addComment = () => {
    if (!commentDraft?.text.trim()) return;
    setComments((current) => [...current, { ...commentDraft, id: crypto.randomUUID(), text: commentDraft.text.trim(), status: "pending" }]);
    addLog(`Comment added on ${commentDraft.path}:${commentDraft.startLine}`);
    setCommentDraft(null);
  };
  const sendComments = async (sessionId: number) => {
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
    await invoke("write_terminal", { sessionId, data: `Implement these code comments. Paths are relative to the workspace. Inspect the current file around each line, apply the requested changes, then summarize each item. Comments: ${JSON.stringify(payload)}\r` });
    setComments((current) => current.map((comment) => comment.status === "pending" ? { ...comment, status: "sent" } : comment));
    addLog(`${pending.length} comment${pending.length === 1 ? "" : "s"} sent to agent`);
  };
  const generateCommitMessage = async () => {
    if (!selectedAgent) throw new Error("Select an agent to generate a commit message");
    return invoke<string>("generate_commit_message", { agent: selectedAgent });
  };
  const saveActive = () => { if (activeFile) void saveFile(activeFile.path).then(() => addLog(`Saved ${activeFile.path}`)); };
  const openReview = async (path: string) => { try { setReview({ path, diff: await invoke<GitDiff>("git_diff", { path }) }); } catch (error) { setGitFeedback(`Diff error: ${String(error)}`); } };
  const markReview = (path: string) => setReviewChecked((current) => current.includes(path) ? current : [...current, path]);
  const rejectReview = async () => {
    if (!review || !review.diff.original || !window.confirm(`Restore ${review.path} to HEAD?`)) return;
    try { await invoke("git_restore_file", { path: review.path }); await useWorkspaceStore.getState().refreshOpenFiles(); await useWorkspaceStore.getState().loadDirectory(); setGitRevision((value) => value + 1); setReview(null); setGitFeedback("File restored to HEAD"); } catch (error) { setGitFeedback(`Restore error: ${String(error)}`); }
  };

  const startResize = (kind: "sidebar" | "agent" | "terminal", event: ReactPointerEvent) => {
    event.preventDefault();
    resizeState.current = { kind, start: kind === "terminal" ? event.clientY : event.clientX, size: kind === "sidebar" ? sidebarWidth : kind === "agent" ? agentWidth : terminalHeight };
  };
  const resetResize = (kind: "sidebar" | "agent" | "terminal") => { if (kind === "sidebar") setSidebarWidth(248); if (kind === "agent") setAgentWidth(Math.max(300, Math.round((window.innerWidth - 248) / 2))); if (kind === "terminal") setTerminalHeight(190); };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const resize = resizeState.current;
      if (!resize) return;
      const delta = (resize.kind === "terminal" ? resize.start - event.clientY : event.clientX - resize.start);
      if (resize.kind === "sidebar") setSidebarWidth(Math.min(700, Math.max(180, window.innerWidth - event.clientX)));
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); saveActive(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!("__TAURI_INTERNALS__" in window)) return <main className="app-shell"><section className="desktop-only"><Code2 size={24} /><p>Maestr runs as a desktop app.</p><span>Start it with <code>pnpm tauri dev</code> to access local folders without uploading them.</span></section></main>;
  if (!root) return <main className="app-shell empty-shell"><header className="topbar empty-titlebar" data-tauri-drag-region><div className="brand"><img className="brand-mark" src={maestrOnlyLogo} alt="" /><span className="brand-name">Maestr</span></div><WindowControls /></header><EmptyWorkspace onOpen={chooseFolder} /></main>;

  return (
    <main className={`app-shell theme-${settings.theme ?? "maestr"}`}>
      <header className="topbar" data-tauri-drag-region>
        <div className="brand"><img className="brand-mark" src={maestrOnlyLogo} alt="" /><span className="brand-name">Maestr</span></div>
        <div className="workspace-title"><button className="workspace-picker" onClick={chooseFolder} title="Open another workspace"><Folder size={14} /><span>{rootName}</span></button><BranchSelect onFeedback={(message) => { setGitFeedback(message); addLog(message); }} onChanged={() => setGitRevision((value) => value + 1)} /></div>
        <div className="top-actions"><button className="icon-button" title="Toggle file tree" onClick={() => setSidebarOpen(!sidebarOpen)}><PanelRight size={17} /></button><button className="icon-button" title="Activity logs" onClick={() => setLogsOpen(true)}><ScrollText size={17} /></button><button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={17} /></button><WindowControls /></div>
      </header>
      <div className="workspace-grid" style={{ gridTemplateColumns: `${agentWidth}px minmax(300px, 1fr) ${sidebarOpen ? sidebarWidth : 0}px` }}>
        <aside className="agent-panel"><div className="resize-handle resize-right" onPointerDown={(event) => startResize("agent", event)} onDoubleClick={() => resetResize("agent")} /><AgentPanel onSessionChange={setAgentSessionId} onAgentChange={setSelectedAgent} onLog={addLog} /></aside>
        <section className="editor-area">
          <div className="tabbar">
            {tabs.length === 0 && <span className="tabbar-empty">No files open</span>}
            {tabs.map((tab) => <button key={tab.path} className={`tab ${tab.path === activePath ? "active" : ""}`} onClick={() => setActive(tab.path)} onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab.path); } }}><FileCode2 size={14} /><span>{tab.name}</span>{tab.dirty && <span className="dirty-dot" /> }<span className="tab-close" onClick={(event) => { event.stopPropagation(); closeTab(tab.path); }}><X size={13} /></span></button>)}
          </div>
          {review ? <div className={`editor-wrap ${commentDraft?.path === review.path ? "comment-open" : ""}`}><div className="editor-toolbar"><span className="file-location">Review · {review.path}</span><span className="review-actions"><button className="button button-quiet" onClick={() => { markReview(review.path); setReview(null); }}>Mark reviewed</button>{review.diff.original && <button className="button button-quiet" onClick={() => void rejectReview()}>Reject</button>}<button className="button button-quiet" onClick={() => setReview(null)}>Close diff</button></span></div>{commentDraft?.path === review.path && <CommentComposer draft={commentDraft} onChange={(text) => setCommentDraft({ ...commentDraft, text })} onSave={addComment} onCancel={() => setCommentDraft(null)} />}<div className="monaco-editor-host"><DiffEditor height="100%" theme={editorTheme} beforeMount={defineMonacoThemes} original={review.diff.original} modified={review.diff.modified} language={languageFor(review.path)} onMount={(editor, monaco) => { const modified = editor.getModifiedEditor(); mountCommentEditor(modified, monaco, review.path); modified.revealLineInCenter(firstChangedLine(review.diff.original, review.diff.modified)); }} options={{ automaticLayout: true, glyphMargin: true, minimap: { enabled: false }, fontSize: settings.fontSize ?? 13, renderSideBySide: settings.diff !== "inline", scrollBeyondLastLine: false }} /></div></div> : activeFile ? <div className={`editor-wrap ${commentDraft?.path === activeFile.path ? "comment-open" : ""}`}><div className="editor-toolbar"><span className="file-location">{activeFile.path}</span><button className="button button-quiet" disabled={!activeFile.dirty || busy} onClick={saveActive}><Save size={15} /> {activeFile.dirty ? "Save" : "Saved"}</button></div>{commentDraft?.path === activeFile.path && <CommentComposer draft={commentDraft} onChange={(text) => setCommentDraft({ ...commentDraft, text })} onSave={addComment} onCancel={() => setCommentDraft(null)} />}<div className="monaco-editor-host"><Editor height="100%" theme={editorTheme} beforeMount={defineMonacoThemes} path={activeFile.path} language={languageFor(activeFile.path)} value={activeFile.content} onMount={(editor, monaco) => mountCommentEditor(editor, monaco, activeFile.path)} onChange={(value) => updateFile(activeFile.path, value ?? "")} options={{ automaticLayout: true, minimap: { enabled: false }, glyphMargin: true, fontSize: settings.fontSize ?? 13, lineNumbers: settings.lineNumbers === false ? "off" : "on", lineHeight: 22, padding: { top: 18, bottom: 18 }, scrollBeyondLastLine: false, smoothScrolling: true, wordWrap: "off", renderWhitespace: "selection" }} loading={<div className="editor-loading">Loading editor…</div>} /></div></div> : <div className="editor-empty"><FileCode2 size={30} /><p>Open a file from the explorer</p><span>Changes stay local until you save them.</span></div>}
          <TerminalDock open={terminalOpen} onToggle={() => setTerminalOpen(!terminalOpen)} onResizeStart={(event) => startResize("terminal", event)} onResizeReset={() => resetResize("terminal")} height={terminalHeight} />
        </section>
        <aside className={`sidebar ${sidebarOpen ? "" : "collapsed"}`}>
          <div className="panel-heading"><div className="sidebar-tabs"><button className={sidebarTab === "explorer" ? "active" : ""} onClick={() => setSidebarTab("explorer")}>Explorer</button><button className={sidebarTab === "git" ? "active" : ""} onClick={() => setSidebarTab("git")}><GitBranch size={13} /> CODE REVIEW</button></div></div>
          {sidebarTab === "explorer" ? <><button className="project-root" onClick={() => toggleDirectory({ name: rootName, path: "", kind: "directory", size: 0 })}><span className="tree-root-chevron">{expanded.includes("") ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span><FolderOpen size={15} /><span>{rootName}</span></button><div className="tree" role="tree">{expanded.includes("") && (entries[""] ?? []).map((entry) => <TreeNode key={entry.path} entry={entry} depth={0} />)}</div></> : <><ReviewPanel revision={gitRevision} selected={review?.path ?? ""} checked={reviewChecked} onSelect={openReview} onToggle={(path) => setReviewChecked((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path])} comments={comments} onSendComments={() => agentSessionId === null ? Promise.reject(new Error("Start an agent before sending comments")) : sendComments(agentSessionId)} onDeleteComment={(id) => { setComments((current) => current.filter((comment) => comment.id !== id)); addLog("Comment removed"); }} onClearSent={() => { setComments((current) => current.filter((comment) => comment.status !== "sent")); addLog("Sent comments cleared"); }} agentRunning={agentSessionId !== null} onFeedback={setGitFeedback} /><div className="sidebar-section-divider"><span>Git</span></div><GitPanel onFeedback={setGitFeedback} onLog={addLog} feedback={gitFeedback} revision={gitRevision} onReview={openReview} onAskCommit={generateCommitMessage} canGenerateCommit={selectedAgent !== null} /></>}
          <div className="resize-handle resize-left" onPointerDown={(event) => startResize("sidebar", event)} onDoubleClick={() => resetResize("sidebar")} />
        </aside>
      </div>
      <footer className="statusbar"><span>{busy ? "Working…" : error ? error : gitFeedback || "Workspace ready"}</span><span className="status-right">UTF-8 <span className="separator" /> LF <span className="separator" /> Local</span></footer>
      {settingsOpen && <div className="settings-backdrop" onClick={() => setSettingsOpen(false)}><section className="settings-panel" onClick={(event) => event.stopPropagation()}><div className="settings-heading"><strong>Settings</strong><button className="icon-button small" onClick={() => setSettingsOpen(false)}><X size={14} /></button></div><label>Editor font<select value={String(settings.font ?? "SFMono-Regular")} onChange={(event) => updateSettings("font", event.target.value)}><option>SFMono-Regular</option><option>Cascadia Code</option><option>JetBrains Mono</option><option>Fira Code</option></select></label><label>Editor font size<input type="number" min="10" max="24" value={Number(settings.fontSize ?? 13)} onChange={(event) => updateSettings("fontSize", Number(event.target.value))} /></label><label>Theme<select value={String(settings.theme ?? "maestr")} onChange={(event) => updateSettings("theme", event.target.value)}><option value="maestr">Maestr</option><option value="onedark">One Dark</option><option value="catppuccin">Catppuccin Mocha</option><option value="nord">Nord</option><option value="solarized">Solarized Dark</option><option value="light">Light</option><option value="high-contrast">High contrast</option></select></label><label>Diff style<select value={String(settings.diff ?? "side")} onChange={(event) => updateSettings("diff", event.target.value)}><option value="side">Side by side</option><option value="inline">Inline</option></select></label><label className="settings-check"><input type="checkbox" checked={settings.lineNumbers !== false} onChange={(event) => updateSettings("lineNumbers", event.target.checked)} /> Show line numbers on editor</label></section></div>}
      {logsOpen && <div className="settings-backdrop" onClick={() => setLogsOpen(false)}><section className="settings-panel logs-panel" onClick={(event) => event.stopPropagation()}><div className="settings-heading"><strong>Activity logs</strong><button className="icon-button small" onClick={() => setLogsOpen(false)}><X size={14} /></button></div>{logs.length ? <div className="logs-list">{logs.slice().reverse().map((log) => <div key={log.id}><time>{log.time}</time><span>{log.message}</span></div>)}</div> : <p className="logs-empty">No activity yet.</p>}</section></div>}
    </main>
  );
}

export default App;
