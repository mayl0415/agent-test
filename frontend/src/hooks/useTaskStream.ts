'use client'
// SSE 连接管理 Hook
// 接收事件并更新本地 steps / status / reportUrl

import { useEffect, useRef, useState, useCallback } from 'react'
import { getStreamUrl } from '@/lib/api'
import type { SSEEvent, Step, TaskStatus } from '@/lib/types'

interface UseTaskStreamReturn {
  steps:     Step[]
  status:    TaskStatus
  reportUrl: string | null
  summary:   string
  error:     string | null
}

export function useTaskStream(
  taskId: string | null,
  revision: number = 0
): UseTaskStreamReturn {
  const [steps,     setSteps]     = useState<Step[]>([])
  const [status,    setStatus]    = useState<TaskStatus>('pending')
  const [reportUrl, setReportUrl] = useState<string | null>(null)
  const [summary,   setSummary]   = useState('')
  const [error,     setError]     = useState<string | null>(null)

  const esRef = useRef<EventSource | null>(null)

  const updateStep = useCallback((stepId: string, patch: Partial<Step>) => {
    setSteps(prev =>
      prev.map(s => s.id === stepId ? { ...s, ...patch } : s)
    )
  }, [])

  useEffect(() => {
    if (!taskId) return

    // revision > 0 means a followup was triggered — reset transient state
    if (revision > 0) {
      setStatus('running')
      setError(null)
    }

    const es = new EventSource(getStreamUrl(taskId))
    esRef.current = es
    setStatus('running')

    es.onmessage = (e) => {
      // 心跳（: keep-alive）不触发 onmessage
      if (!e.data) return
      const event: SSEEvent = JSON.parse(e.data)

      switch (event.type) {
        case 'step_start':
          setSteps(prev => [...prev, {
            id:     event.step_id!,
            name:   event.step_name!,
            tool:   event.tool!,
            status: 'running',
            output: '',
            code:   event.code ?? '',
          }])
          break

        case 'code_output':
          updateStep(event.step_id!, {
            output: event.output ?? '',
          })
          break

        case 'step_done':
          updateStep(event.step_id!, {
            status:      'done',
            duration_ms: event.duration_ms,
            file_url:    event.file_url ?? undefined,
          })
          break

        case 'artifact_ready':
          setReportUrl(event.download_url ?? null)
          break

        case 'task_done':
          setStatus('completed')
          setSummary(event.summary ?? '')
          es.close()
          break

        case 'error':
          setStatus('failed')
          setError(event.message ?? '未知错误')
          // 标记最后一个 running step 为 error
          setSteps(prev =>
            prev.map(s =>
              s.status === 'running' ? { ...s, status: 'error' } : s
            )
          )
          es.close()
          break
      }
    }

    es.onerror = () => {
      // 短暂断线不立即报错，浏览器会自动重连
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [taskId, updateStep, revision])

  return { steps, status, reportUrl, summary, error }
}
