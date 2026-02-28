'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTaskStream } from '@/hooks/useTaskStream'
import { fetchTask, getArtifactUrl, sendFollowup } from '@/lib/api'
import type { Task } from '@/lib/types'

const STEP_ICONS: Record<string, string> = {
  bash:       '⚙️',
  file_write: '📝',
  file_read:  '📖',
  waiting:    '⏳',
  done:       '✅',
  error:      '❌',
  running:    '🔄',
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: '等待中', cls: 'bg-yellow-500/20 text-yellow-400' },
  running:   { label: '执行中', cls: 'bg-blue-500/20 text-blue-400' },
  completed: { label: '已完成', cls: 'bg-green-500/20 text-green-400' },
  failed:    { label: '失败',   cls: 'bg-red-500/20 text-red-400' },
}

export default function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>()
  const router = useRouter()
  const [task,           setTask]           = useState<Task | null>(null)
  const [expanded,       setExpanded]       = useState<Set<string>>(new Set())
  const [previewUrl,     setPreviewUrl]     = useState<string | null>(null)
  const [streamRevision, setStreamRevision] = useState(0)
  const [followupText,   setFollowupText]   = useState('')
  const [followupLoading, setFollowupLoading] = useState(false)
  const [followupError,  setFollowupError]  = useState<string | null>(null)

  const { steps, status, reportUrl, summary, error } =
    useTaskStream(taskId, streamRevision)

  // 首次加载任务基本信息
  useEffect(() => {
    if (taskId) fetchTask(taskId).then(setTask).catch(console.error)
  }, [taskId])

  // 追问完成后刷新 task（获取最新 session_id）
  useEffect(() => {
    if (status === 'completed' && streamRevision > 0 && taskId) {
      fetchTask(taskId).then(setTask).catch(console.error)
    }
  }, [status, streamRevision, taskId])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  // 任务已完成但 SSE 未推送 artifact（如刷新页面），从 task 数据兜底
  const resolvedReportUrl = reportUrl ?? task?.artifact_url ?? null
  const artifactFullUrl = resolvedReportUrl ? getArtifactUrl(resolvedReportUrl) : null

  // 当前 iframe 展示的 URL：手动选中的中间文件 > 最终报告
  const iframeUrl = previewUrl ?? artifactFullUrl

  const handleStepPreview = (fileUrl: string) => {
    const base = process.env.NEXT_PUBLIC_API_BASE?.replace('/api', '') ?? 'http://localhost:8000'
    setPreviewUrl(`${base}${fileUrl}`)
  }

  // SSE 无步骤数据时（任务已完成后才打开页面），从 task API 兜底
  const displaySteps = steps.length > 0 ? steps : (task?.steps ?? [])
  // 状态也兜底
  const displayStatus = steps.length === 0 && task?.status ? task.status : status

  // 追问：task 有 session_id 时才可用
  const canFollowup = displayStatus === 'completed' &&
    (task?.session_id != null || streamRevision === 0)

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

  return (
    <div className="min-h-screen bg-[#0f1117] text-white flex flex-col">

      {/* 顶栏 */}
      <header className="border-b border-[#1e2030] px-6 py-4 flex items-center gap-4">
        <button onClick={() => router.push('/')}
          className="text-[#8b8fa8] hover:text-white transition text-sm">
          ← 返回
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="font-medium text-sm">{task?.filename ?? '任务执行中'}</span>
            {task && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[displayStatus].cls}`}>
                {STATUS_BADGE[displayStatus].label}
              </span>
            )}
          </div>
          <div className="text-[#4b4f6a] text-xs mt-0.5">任务 ID: {taskId}</div>
        </div>
        {artifactFullUrl && (
          <a href={artifactFullUrl} target="_blank" rel="noopener noreferrer"
            className="px-4 py-2 bg-[#7c6aff] hover:bg-[#6b59ee] rounded-lg text-sm font-medium transition">
            下载报告
          </a>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* 左侧：执行过程 + 追问 */}
        <aside className="w-80 border-r border-[#1e2030] flex flex-col">
          <div className="px-4 py-3 border-b border-[#1e2030]">
            <p className="text-xs text-[#8b8fa8] uppercase tracking-widest">执行过程</p>
          </div>

          <div className="p-4 space-y-2 flex-1 overflow-y-auto">
            {displaySteps.length === 0 && displayStatus === 'running' && (
              <div className="text-[#8b8fa8] text-sm flex items-center gap-2 py-4">
                <span className="animate-spin">⏳</span> Agent 启动中…
              </div>
            )}

            {displaySteps.map(step => (
              <div key={step.id}
                className={`rounded-lg border transition-all
                  ${step.status === 'running'
                    ? 'border-[#7c6aff]/50 bg-[#7c6aff]/5'
                    : step.status === 'error'
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'border-[#1e2030] bg-[#161824]'}
                `}
              >
                {/* 步骤头 */}
                <div className="flex items-center gap-1">
                  <button
                    className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left"
                    onClick={() => toggleExpand(step.id)}
                  >
                    <span className="text-base">
                      {step.status === 'running'
                        ? <span className="animate-spin inline-block">⚙️</span>
                        : STEP_ICONS[step.status]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{step.name}</div>
                      <div className="text-[10px] text-[#8b8fa8] mt-0.5">
                        {step.tool}
                        {step.duration_ms != null && ` · ${step.duration_ms}ms`}
                      </div>
                    </div>
                    <span className="text-[#4b4f6a] text-xs">
                      {expanded.has(step.id) ? '▲' : '▼'}
                    </span>
                  </button>
                  {step.file_url && (
                    <button
                      onClick={() => handleStepPreview(step.file_url!)}
                      title="预览文件"
                      className={`mr-2 px-2 py-1 rounded text-[10px] transition-all
                        ${previewUrl && previewUrl.includes(step.file_url)
                          ? 'bg-[#7c6aff] text-white'
                          : 'bg-[#1e2030] text-[#8b8fa8] hover:bg-[#7c6aff]/30 hover:text-white'}`}
                    >
                      预览
                    </button>
                  )}
                </div>

                {/* 展开内容 */}
                {expanded.has(step.id) && (
                  <div className="px-3 pb-3 space-y-2">
                    {step.code && (
                      <pre className="text-[11px] bg-[#0f1117] rounded p-2 overflow-x-auto
                                      text-[#a8c1d4] whitespace-pre-wrap break-words max-h-40">
                        {step.code}
                      </pre>
                    )}
                    {step.output && (
                      <pre className="text-[11px] bg-[#0f1117] rounded p-2 overflow-x-auto
                                      text-[#6be8a0] whitespace-pre-wrap break-words max-h-32">
                        {step.output}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* 完成摘要 */}
            {displayStatus === 'completed' && summary && (
              <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <p className="text-xs text-green-400 font-medium mb-1">✅ 分析完成</p>
                <p className="text-xs text-[#8b8fa8] leading-relaxed">{summary}</p>
              </div>
            )}

            {/* 失败信息 */}
            {displayStatus === 'failed' && (
              <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs text-red-400 font-medium mb-1">❌ 执行失败</p>
                <p className="text-xs text-[#8b8fa8]">{error ?? '未知错误'}</p>
              </div>
            )}
          </div>

          {/* 追问区（任务完成后显示） */}
          {displayStatus === 'completed' && (
            <div className="border-t border-[#1e2030] p-4 space-y-2">
              <p className="text-xs text-[#8b8fa8] uppercase tracking-widest mb-2">追问</p>
              <textarea
                value={followupText}
                onChange={e => setFollowupText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleFollowup()
                  }
                }}
                placeholder="继续提问…（Ctrl+Enter 发送）"
                rows={3}
                disabled={followupLoading}
                className="w-full bg-[#0f1117] border border-[#1e2030] rounded-lg px-3 py-2
                           text-xs text-white placeholder-[#4b4f6a] resize-none
                           focus:outline-none focus:border-[#7c6aff]/60 transition-colors
                           disabled:opacity-50"
              />
              {followupError && (
                <p className="text-xs text-red-400">{followupError}</p>
              )}
              <button
                onClick={handleFollowup}
                disabled={followupLoading || !followupText.trim()}
                className="w-full py-2 bg-[#7c6aff] hover:bg-[#6b59ee] disabled:opacity-40
                           disabled:cursor-not-allowed rounded-lg text-xs font-medium transition-all"
              >
                {followupLoading ? '发送中…' : '发送追问'}
              </button>
            </div>
          )}
        </aside>

        {/* 右侧：报告预览 */}
        <main className="flex-1 flex flex-col">
          {iframeUrl ? (
            <>
              {/* 预览切换栏 */}
              {artifactFullUrl && previewUrl && previewUrl !== artifactFullUrl && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-[#1e2030] bg-[#161824]">
                  <span className="text-[11px] text-[#8b8fa8]">正在预览中间文件</span>
                  <button
                    onClick={() => setPreviewUrl(null)}
                    className="text-[11px] text-[#7c6aff] hover:underline"
                  >
                    切回最终报告
                  </button>
                </div>
              )}
              <iframe
                src={iframeUrl}
                sandbox="allow-scripts allow-same-origin"
                className="flex-1 w-full border-none"
                title="文件预览"
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[#4b4f6a]">
              {status === 'running' ? (
                <>
                  <div className="text-4xl mb-4 animate-pulse">📊</div>
                  <p className="text-sm">报告生成中，请稍候…</p>
                </>
              ) : status === 'failed' ? (
                <>
                  <div className="text-4xl mb-4">💔</div>
                  <p className="text-sm">任务执行失败</p>
                </>
              ) : (
                <>
                  <div className="text-4xl mb-4">⏳</div>
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
