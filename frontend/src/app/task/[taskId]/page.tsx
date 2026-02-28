'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import { useTaskStream } from '@/hooks/useTaskStream'
import { fetchTask, getArtifactUrl, sendFollowup } from '@/lib/api'
import type { Task, Step } from '@/lib/types'

// ── Sub-component: Artifact raw code viewer ──────────────────────────────────
function ArtifactCodeView({ url }: { url: string }) {
  const [code, setCode]       = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(url)
      .then(r => r.text())
      .then(text => { setCode(text); setLoading(false) })
      .catch(() => { setCode('// 无法加载文件内容'); setLoading(false) })
  }, [url])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#4b4f6a] text-sm">
        加载中…
      </div>
    )
  }

  return (
    <pre className="flex-1 overflow-auto p-4 text-[11px] font-mono text-[#cdd6f4] bg-[#0f1117] leading-relaxed">
      {code.split('\n').map((line, i) => (
        <div key={i} className="flex hover:bg-[#1e2030]/50">
          <span className="w-10 text-right text-[#313553] select-none mr-5 flex-shrink-0">{i + 1}</span>
          <span>{line || ' '}</span>
        </div>
      ))}
    </pre>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TaskPage() {
  const { taskId }  = useParams<{ taskId: string }>()
  const router      = useRouter()

  const [task,            setTask]            = useState<Task | null>(null)
  const [taskExpanded,    setTaskExpanded]    = useState(true)
  const [selectedStepId,  setSelectedStepId]  = useState<string | null>(null)
  const [selectedView,    setSelectedView]    = useState<'step' | 'artifact' | null>(null)
  const [previewTab,      setPreviewTab]      = useState<'preview' | 'code'>('preview')
  const [streamRevision,  setStreamRevision]  = useState(0)
  const [followupText,    setFollowupText]    = useState('')
  const [followupLoading, setFollowupLoading] = useState(false)
  const [followupError,   setFollowupError]   = useState<string | null>(null)
  const [startTime]                           = useState(() => new Date())
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())

  const { steps, status, reportUrl, summary, error } =
    useTaskStream(taskId, streamRevision)

  // Load task info on mount
  useEffect(() => {
    if (taskId) fetchTask(taskId).then(setTask).catch(console.error)
  }, [taskId])

  // Re-fetch task after a followup completes (to get fresh session_id)
  useEffect(() => {
    if (status === 'completed' && streamRevision > 0 && taskId) {
      fetchTask(taskId).then(setTask).catch(console.error)
    }
  }, [status, streamRevision, taskId])

  // Fallback: if SSE didn't push artifact (e.g. page was refreshed)
  const resolvedReportUrl = reportUrl ?? task?.artifact_url ?? null
  const artifactFullUrl   = resolvedReportUrl ? getArtifactUrl(resolvedReportUrl) : null

  // Fallback: if SSE hasn't sent steps yet (e.g. task already finished)
  const displaySteps  = steps.length > 0 ? steps : (task?.steps ?? [])
  const displayStatus = steps.length === 0 && task?.status ? task.status : status

  const selectedStep  = selectedStepId
    ? displaySteps.find(s => s.id === selectedStepId) ?? null
    : null

  // Derived display strings
  const timeStr = startTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  const artifactName = resolvedReportUrl
    ? resolvedReportUrl.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'report'
    : 'report'

  const createdDate = (() => {
    const d = new Date()
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${timeStr}`
  })()

  const statusLabel: Record<string, string> = {
    pending:   '等待中',
    running:   '执行中',
    completed: '任务已完成',
    failed:    '执行失败',
  }

  const toggleThinking = useCallback((id: string) => {
    setExpandedThinking(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────
  // Write .py 步骤：内容已附在 Bash 步骤上，chip 本身不展示
  const isPyWrite  = (s: Step) => s.tool === 'Write' && /\.py$/i.test(s.name)
  // Write .html/.json/其他：展示 chip，点击可预览
  const isHtmlWrite = (s: Step) => s.tool === 'Write' && /\.html?$/i.test(s.name)

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSelectStep = (step: Step) => {
    if (step.tool === 'text') return  // 文字块不打开代码面板
    setSelectedStepId(step.id)
    setSelectedView('step')
    // HTML write 步骤默认打开预览 tab
    if (isHtmlWrite(step)) setPreviewTab('preview')
  }

  const handleSelectArtifact = () => {
    setSelectedStepId(null)
    setSelectedView('artifact')
    setPreviewTab('preview')
  }

  const handleFollowup = async () => {
    if (!followupText.trim() || !taskId) return
    setFollowupLoading(true)
    setFollowupError(null)
    try {
      await sendFollowup(taskId, followupText)
      setFollowupText('')
      setStreamRevision(r => r + 1)
    } catch (e: any) {
      setFollowupError(e.message)
    } finally {
      setFollowupLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0f1117] text-white flex flex-col">

      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <header className="border-b border-[#1e2030] px-5 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => router.push('/')}
          className="text-[#8b8fa8] hover:text-white transition text-sm flex-shrink-0"
        >
          ← 返回
        </button>
        <span className="text-sm text-[#8b8fa8] truncate flex-1">{task?.filename ?? taskId}</span>
        {artifactFullUrl && (
          <a
            href={artifactFullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-[#7c6aff] hover:bg-[#6b59ee] rounded-lg text-xs font-medium transition flex-shrink-0"
          >
            下载
          </a>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Chat sidebar ────────────────────────────────────────────── */}
        <aside className="w-[340px] border-r border-[#1e2030] flex flex-col flex-shrink-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">

            {/* ── Task card ─────────────────────────────────────────────────── */}
            <div className="rounded-xl border border-[#1e2030] overflow-hidden">

              {/* Header (always visible) */}
              <button
                className="w-full flex items-center justify-between px-4 py-3 bg-[#161824] hover:bg-[#1a1d2e] transition"
                onClick={() => setTaskExpanded(v => !v)}
              >
                <div className="flex items-center gap-2.5">
                  {displayStatus === 'running' && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse flex-shrink-0" />
                  )}
                  {displayStatus === 'completed' && (
                    <span className="text-green-400 text-xs flex-shrink-0">✓</span>
                  )}
                  {displayStatus === 'failed' && (
                    <span className="text-red-400 text-xs flex-shrink-0">✗</span>
                  )}
                  {displayStatus === 'pending' && (
                    <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium">{statusLabel[displayStatus]}</span>
                  <span className="text-[11px] text-[#4b4f6a]">{timeStr}</span>
                </div>
                {/* Expand / collapse icon */}
                <span className="text-[#4b4f6a] text-xs select-none w-5 h-5 flex items-center justify-center rounded border border-[#1e2030]">
                  {taskExpanded ? '↘' : '↗'}
                </span>
              </button>

              {/* Expandable body: steps as chips */}
              {taskExpanded && (
                <div className="px-3 py-2.5 space-y-0.5 bg-[#0f1117]">

                  {/* Spinner — loading hint 到达后就消失，极短闪烁 */}
                  {displaySteps.length === 0 && displayStatus === 'running' && (
                    <div className="flex items-center gap-2 py-2 px-2 text-xs text-[#8b8fa8]">
                      <span className="animate-spin inline-block">◌</span> 正在启动…
                    </div>
                  )}

                  {/* Steps: text blocks or tool chips */}
                  {displaySteps.map(step => {
                    // Write .py 步骤不显示 chip（内容已附在对应 Bash 步骤）
                    if (isPyWrite(step)) return null

                    if (step.tool === 'thinking') {
                      const isOpen = expandedThinking.has(step.id)
                      return (
                        /* ── ThinkingBlock：可折叠的思考过程 ── */
                        <div key={step.id} className="rounded-lg border border-[#1e2030]/60 overflow-hidden">
                          <button
                            onClick={() => toggleThinking(step.id)}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-[#1e2030]/40 transition"
                          >
                            <span className="text-[#4b4f6a] text-[10px]">◆</span>
                            <span className="text-[10px] text-[#4b4f6a] flex-1">思考过程</span>
                            <span className="text-[#313553] text-[10px]">{isOpen ? '▲' : '▼'}</span>
                          </button>
                          {isOpen && (
                            <p className="px-3 py-2 text-[10px] text-[#4b4f6a] leading-relaxed italic whitespace-pre-wrap border-t border-[#1e2030]/40 bg-[#080a10]">
                              {step.name}
                            </p>
                          )}
                        </div>
                      )
                    }

                    if (step.tool === 'text') {
                      return step.isLoadingHint ? (
                        /* ── 启动 loading hint：脉冲动画，任务开始后自动消失 ── */
                        <p
                          key={step.id}
                          className="text-xs text-[#4b4f6a] italic px-2 py-1 animate-pulse"
                        >
                          {step.name}
                        </p>
                      ) : (
                        /* ── 真实模型输出 ── */
                        <p
                          key={step.id}
                          className="text-xs text-[#8b8fa8] leading-relaxed px-2 py-1 whitespace-pre-wrap"
                        >
                          {step.name}
                        </p>
                      )
                    }

                    return (
                      /* ── Tool call chip ── */
                      <button
                        key={step.id}
                        onClick={() => handleSelectStep(step)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition
                          ${selectedStepId === step.id
                            ? 'bg-[#7c6aff]/15 text-[#a89dff]'
                            : 'text-[#8b8fa8] hover:bg-[#1e2030] hover:text-white'
                          }`}
                      >
                        <span className="font-mono text-[9px] text-[#4b4f6a] bg-[#1e2030] px-1 py-0.5 rounded leading-none flex-shrink-0">
                          &lt;/&gt;
                        </span>
                        <span className="flex-1 truncate text-xs">{step.name}</span>
                        {step.status === 'running' ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
                        ) : step.status === 'done' ? (
                          <span className="text-[#4b4f6a] text-xs flex-shrink-0">›</span>
                        ) : step.status === 'error' ? (
                          <span className="text-red-400 text-[10px] flex-shrink-0">!</span>
                        ) : null}
                      </button>
                    )
                  })}

                  {/* Summary text */}
                  {summary && (
                    <p className="text-xs text-[#8b8fa8] leading-relaxed px-2 pt-2 mt-1 border-t border-[#1e2030]">
                      {summary}
                    </p>
                  )}

                  {/* Error text */}
                  {displayStatus === 'failed' && error && (
                    <p className="text-xs text-red-400 px-2 pt-1">{error}</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Artifact card ─────────────────────────────────────────────── */}
            {artifactFullUrl && (
              <button
                onClick={handleSelectArtifact}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition text-left
                  ${selectedView === 'artifact'
                    ? 'border-[#7c6aff]/50 bg-[#7c6aff]/5'
                    : 'border-[#1e2030] bg-[#161824] hover:border-[#7c6aff]/30 hover:bg-[#1a1d2e]'
                  }`}
              >
                {/* Icon badge */}
                <span className="font-mono text-[9px] text-[#8b8fa8] bg-[#1e2030] px-1.5 py-1 rounded leading-none flex-shrink-0">
                  &lt;/&gt;
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {artifactName}
                    <span className="ml-2 text-xs text-[#4b4f6a] font-normal">V1</span>
                  </div>
                  <div className="text-[10px] text-[#4b4f6a] mt-0.5">
                    创建时间：{createdDate}
                  </div>
                </div>
              </button>
            )}

          </div>

          {/* ── Followup input (after task completes) ─────────────────────── */}
          {displayStatus === 'completed' && (
            <div className="border-t border-[#1e2030] p-4 space-y-2 flex-shrink-0">
              <textarea
                value={followupText}
                onChange={e => setFollowupText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleFollowup()
                  }
                }}
                placeholder="继续提问… (Ctrl+Enter 发送)"
                rows={2}
                disabled={followupLoading}
                className="w-full bg-[#161824] border border-[#1e2030] rounded-lg px-3 py-2
                           text-xs text-white placeholder-[#4b4f6a] resize-none
                           focus:outline-none focus:border-[#7c6aff]/60 disabled:opacity-50
                           transition-colors"
              />
              {followupError && (
                <p className="text-xs text-red-400">{followupError}</p>
              )}
              <button
                onClick={handleFollowup}
                disabled={followupLoading || !followupText.trim()}
                className="w-full py-2 bg-[#7c6aff] hover:bg-[#6b59ee]
                           disabled:opacity-40 disabled:cursor-not-allowed
                           rounded-lg text-xs font-medium transition-all"
              >
                {followupLoading ? '发送中…' : '发送'}
              </button>
            </div>
          )}
        </aside>

        {/* ── RIGHT: Preview / code panel ──────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* ── Step view ────────────────────────────────────────────────── */}
          {selectedView === 'step' && selectedStep ? (

            isHtmlWrite(selectedStep) ? (
              /* ── Write .html: inline preview with srcdoc ── */
              <>
                <div className="flex items-center gap-3 px-5 py-2 border-b border-[#1e2030] bg-[#161824] flex-shrink-0">
                  <span className="text-xs text-[#8b8fa8] truncate flex-1">
                    {selectedStep.name.match(/[\w.-]+\.\w+$/)?.[0] ?? selectedStep.name}
                  </span>
                  <div className="flex items-center gap-0.5 bg-[#0f1117] rounded-lg p-0.5 flex-shrink-0">
                    <button
                      onClick={() => setPreviewTab('preview')}
                      className={`px-3 py-1 text-xs rounded-md transition
                        ${previewTab === 'preview' ? 'bg-[#1e2030] text-white' : 'text-[#4b4f6a] hover:text-white'}`}
                    >
                      预览
                    </button>
                    <button
                      onClick={() => setPreviewTab('code')}
                      className={`px-3 py-1 text-xs rounded-md transition
                        ${previewTab === 'code' ? 'bg-[#1e2030] text-white' : 'text-[#4b4f6a] hover:text-white'}`}
                    >
                      代码
                    </button>
                  </div>
                </div>
                {previewTab === 'preview' ? (
                  <iframe
                    srcDoc={selectedStep.code ?? ''}
                    sandbox="allow-scripts"
                    className="flex-1 w-full border-none bg-white"
                    title="文件预览"
                  />
                ) : (
                  <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-[#cdd6f4] bg-[#0f1117] leading-6">
                    {(selectedStep.code ?? '').split('\n').map((line, i) => (
                      <div key={i} className="flex hover:bg-[#1e2030]/40">
                        <span className="w-10 text-right text-[#313553] select-none mr-5 flex-shrink-0">{i + 1}</span>
                        <span>{line || ' '}</span>
                      </div>
                    ))}
                  </pre>
                )}
              </>

            ) : (
              /* ── Bash / other: code + console ── */
              <>
                {/* Top bar */}
                <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#1e2030] bg-[#161824] flex-shrink-0">
                  <span className="text-xs text-[#4b4f6a]">执行任务：</span>
                  <span className="flex items-center gap-1.5 text-xs font-mono bg-[#1e2030] px-2 py-0.5 rounded text-[#8b8fa8]">
                    <span className="text-[9px]">&lt;/&gt;</span>
                    <span>{selectedStep.name}</span>
                  </span>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col">
                  {/* Code pane */}
                  {selectedStep.code ? (
                    <div className="flex-1 overflow-auto bg-[#0f1117]">
                      <div className="px-4 py-1.5 border-b border-[#1e2030] bg-[#161824] text-[10px] text-[#4b4f6a] font-mono flex-shrink-0">
                        {selectedStep.name.match(/[\w.-]+\.\w+$/)?.[0] ?? selectedStep.name}
                      </div>
                      <pre className="p-4 text-xs font-mono text-[#cdd6f4] leading-6 overflow-auto">
                        {selectedStep.code.split('\n').map((line, i) => (
                          <div key={i} className="flex hover:bg-[#1e2030]/40">
                            <span className="w-10 text-right text-[#313553] select-none mr-5 flex-shrink-0">
                              {i + 1}
                            </span>
                            <span>{line || ' '}</span>
                          </div>
                        ))}
                      </pre>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-[#4b4f6a] text-sm">
                      {selectedStep.status === 'running' ? '执行中…' : '暂无代码'}
                    </div>
                  )}

                  {/* Console / output pane */}
                  {selectedStep.output && (
                    <div
                      className="border-t border-[#1e2030] bg-[#080a10] flex-shrink-0 flex flex-col"
                      style={{ maxHeight: '40%' }}
                    >
                      <div className="px-4 py-2 border-b border-[#1e2030] text-[10px] text-[#4b4f6a] flex items-center gap-2 flex-shrink-0">
                        <span className="w-2 h-2 rounded-full bg-[#313553]" />
                        <span>控制台</span>
                      </div>
                      <pre className="flex-1 overflow-auto p-4 text-[11px] text-[#6be8a0] font-mono leading-relaxed">
                        {selectedStep.output}
                      </pre>
                    </div>
                  )}
                </div>
              </>
            )

          /* ── Artifact preview ──────────────────────────────────────────── */
          ) : selectedView === 'artifact' && artifactFullUrl ? (
            <>
              {/* Top bar with preview/code tabs */}
              <div className="flex items-center gap-3 px-5 py-2 border-b border-[#1e2030] bg-[#161824] flex-shrink-0">
                <span className="text-xs text-[#8b8fa8] truncate flex-1">{artifactName}</span>
                <div className="flex items-center gap-0.5 bg-[#0f1117] rounded-lg p-0.5 flex-shrink-0">
                  <button
                    onClick={() => setPreviewTab('preview')}
                    className={`px-3 py-1 text-xs rounded-md transition
                      ${previewTab === 'preview'
                        ? 'bg-[#1e2030] text-white'
                        : 'text-[#4b4f6a] hover:text-white'}`}
                  >
                    预览
                  </button>
                  <button
                    onClick={() => setPreviewTab('code')}
                    className={`px-3 py-1 text-xs rounded-md transition
                      ${previewTab === 'code'
                        ? 'bg-[#1e2030] text-white'
                        : 'text-[#4b4f6a] hover:text-white'}`}
                  >
                    代码
                  </button>
                </div>
              </div>

              {previewTab === 'preview' ? (
                <iframe
                  src={artifactFullUrl}
                  sandbox="allow-scripts allow-same-origin"
                  className="flex-1 w-full border-none bg-white"
                  title="报告预览"
                />
              ) : (
                <ArtifactCodeView url={artifactFullUrl} />
              )}
            </>

          /* ── Empty / loading state ─────────────────────────────────────── */
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[#4b4f6a]">
              {displayStatus === 'running' ? (
                <>
                  <div className="text-3xl mb-3 animate-pulse">⚡</div>
                  <p className="text-sm">正在执行任务…</p>
                  <p className="text-xs mt-1 text-[#313553]">点击左侧步骤可实时查看代码</p>
                </>
              ) : displayStatus === 'completed' ? (
                <>
                  <div className="text-3xl mb-3">✓</div>
                  <p className="text-sm">任务已完成</p>
                  <p className="text-xs mt-1 text-[#313553]">点击左侧步骤或产物预览内容</p>
                </>
              ) : displayStatus === 'failed' ? (
                <>
                  <div className="text-3xl mb-3">✗</div>
                  <p className="text-sm text-red-400">执行失败</p>
                </>
              ) : (
                <>
                  <div className="text-3xl mb-3">⏳</div>
                  <p className="text-sm">等待任务启动…</p>
                </>
              )}
            </div>
          )}
        </main>

      </div>
    </div>
  )
}
