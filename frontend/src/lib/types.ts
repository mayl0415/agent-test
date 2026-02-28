// 所有类型定义集中在这里

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed'
export type StepStatus = 'waiting' | 'running' | 'done' | 'error'

export interface SkillInput {
  type: 'file' | 'text'
  accept?: string[]
  label: string
  required: boolean
  max_size?: string
}

export interface Skill {
  id: string
  name: string
  description: string
  icon: string
  tags: string[]
  input: SkillInput[]
  output: string
}

export interface Step {
  id: string
  name: string
  tool: string
  status: StepStatus
  output: string
  code?: string
  file_url?: string
  duration_ms?: number
}

export interface Task {
  id: string
  skill_id: string
  status: TaskStatus
  filename: string
  artifact_url: string | null
  error: string | null
  steps: Step[]
}

// SSE 事件
export type SSEEventType =
  | 'step_start'
  | 'code_output'
  | 'step_done'
  | 'artifact_ready'
  | 'task_done'
  | 'error'
  | 'heartbeat'

export interface SSEEvent {
  type: SSEEventType
  // step_start
  step_id?: string
  step_name?: string
  tool?: string
  code?: string
  // code_output
  output?: string
  success?: boolean
  // step_done
  duration_ms?: number
  file_url?: string
  // artifact_ready
  filename?: string
  download_url?: string
  // task_done
  summary?: string
  // error
  message?: string
  stage?: string
}
