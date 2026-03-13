// 后端 API 调用封装 — 组件内禁止直接 fetch

import type { Skill, Task } from './types'

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api'

// SSE 流必须直连后端，绕过 Next.js rewrites 代理（代理层会缓冲响应，导致流式失效）
// 如果配置了 ngrok 等公网地址，NEXT_PUBLIC_STREAM_BASE 应设为后端直连地址
const STREAM_BASE = process.env.NEXT_PUBLIC_STREAM_BASE ?? 'http://localhost:8000/api'

// ngrok 免费版会对浏览器请求插入警告拦截页，加此头跳过
const EXTRA_HEADERS = { 'ngrok-skip-browser-warning': '1' }

export async function fetchSkills(): Promise<Skill[]> {
  const res = await fetch(`${BASE}/skills`, { headers: EXTRA_HEADERS })
  if (!res.ok) throw new Error('获取 Skill 列表失败')
  return res.json()
}

export async function createTask(
  skillId: string,
  file: File | null,
  textInputs?: string
): Promise<{ task_id: string }> {
  const form = new FormData()
  form.append('skill_id', skillId)
  if (file) form.append('file', file)
  if (textInputs && textInputs.trim()) form.append('text_inputs', textInputs.trim())
  const res = await fetch(`${BASE}/tasks`, { method: 'POST', body: form, headers: EXTRA_HEADERS })
  if (!res.ok) throw new Error('创建任务失败')
  return res.json()
}

export async function fetchTask(taskId: string): Promise<Task> {
  const res = await fetch(`${BASE}/tasks/${taskId}`, { headers: EXTRA_HEADERS })
  if (!res.ok) throw new Error('获取任务失败')
  return res.json()
}

export async function deleteTask(taskId: string): Promise<void> {
  await fetch(`${BASE}/tasks/${taskId}`, { method: 'DELETE', headers: EXTRA_HEADERS })
}

export async function sendFollowup(
  taskId: string,
  question: string
): Promise<{ task_id: string; status: string }> {
  const form = new FormData()
  form.append('question', question)
  const res = await fetch(`${BASE}/tasks/${taskId}/followup`, {
    method: 'POST',
    body: form,
    headers: EXTRA_HEADERS,
  })
  if (!res.ok) throw new Error('追问请求失败')
  return res.json()
}

export function getStreamUrl(taskId: string): string {
  return `${STREAM_BASE}/tasks/${taskId}/stream`
}

export function getArtifactUrl(downloadUrl: string): string {
  // download_url 形如 /api/tasks/{id}/artifact/{file}，直接用相对路径走 Next.js 反代
  return downloadUrl
}
