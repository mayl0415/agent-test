'use client'
// SSE 连接管理 Hook
// 接收事件并更新本地 steps / status / reportUrl

import { useEffect, useRef, useState, useCallback } from 'react'
import { getStreamUrl } from '@/lib/api'
import type { SSEEvent, Step, TaskStatus } from '@/lib/types'

interface UseTaskStreamReturn {
  steps: Step[]
  status: TaskStatus
  reportUrl: string | null
  summary: string
  error: string | null
}

export function useTaskStream(
  taskId: string | null,
  revision: number = 0
): UseTaskStreamReturn {
  const [steps, setSteps] = useState<Step[]>([])
  const [status, setStatus] = useState<TaskStatus>('pending')
  const [reportUrl, setReportUrl] = useState<string | null>(null)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)

  const updateStep = useCallback((stepId: string, patch: Partial<Step>) => {
    setSteps(prev =>
      prev.map(s => s.id === stepId ? { ...s, ...patch } : s)
    )
  }, [])

  const handleEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'step_start':
        setSteps(prev => [...prev, {
          id: event.step_id!,
          name: event.step_name!,
          tool: event.tool!,
          status: 'running',
          output: '',
          code: event.code ?? '',
        }])
        break

      case 'code_output':
        updateStep(event.step_id!, {
          output: event.output ?? '',
        })
        break

      case 'step_done':
        updateStep(event.step_id!, {
          status: 'done',
          duration_ms: event.duration_ms,
          file_url: event.file_url ?? undefined,
        })
        break

      case 'agent_thinking':
        if (event.thinking?.trim()) {
          setSteps(prev => [...prev, {
            id: `think-${Date.now()}`,
            name: event.thinking!,
            tool: 'thinking',
            status: 'done',
            output: '',
          }])
        }
        break

      case 'agent_text':
        if (event.text?.trim()) {
          setSteps(prev => {
            const filtered = event.is_loading_hint
              ? prev
              : prev.filter(s => !s.isLoadingHint)
            return [...filtered, {
              id: `txt-${Date.now()}`,
              name: event.text!,
              tool: 'text',
              status: 'done',
              output: '',
              isLoadingHint: event.is_loading_hint ?? false,
            }]
          })
        }
        break

      case 'artifact_ready':
        setReportUrl(event.download_url ?? null)
        break

      case 'task_done':
        setStatus('completed')
        setSummary(event.summary ?? '')
        break

      case 'error':
        setStatus('failed')
        setError(event.message ?? '未知错误')
        setSteps(prev =>
          prev.map(s =>
            s.status === 'running' ? { ...s, status: 'error' } : s
          )
        )
        break
    }
  }, [updateStep])

  useEffect(() => {
    if (!taskId) return

    if (revision > 0) {
      setSteps([])
      setReportUrl(null)
      setError(null)
    }
    setStatus('running')

    const controller = new AbortController()

    async function startStream() {
      try {
        const res = await fetch(getStreamUrl(taskId!), {
          headers: { 'ngrok-skip-browser-warning': '1' },
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          setStatus('failed')
          setError(`连接失败: ${res.status}`)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // 按行分割处理 SSE 格式
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''  // 最后一行可能不完整，留到下次

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (!data) continue
            try {
              const event: SSEEvent = JSON.parse(data)
              handleEvent(event)
            } catch {
              // 忽略解析失败的行（如心跳）
            }
          }
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return  // 组件卸载，正常退出
        setStatus('failed')
        setError('SSE 连接中断，请刷新重试')
      }
    }

    startStream()

    return () => controller.abort()
  }, [taskId, revision, handleEvent])

  return { steps, status, reportUrl, summary, error }
}