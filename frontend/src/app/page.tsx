'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchSkills, createTask } from '@/lib/api'
import type { Skill } from '@/lib/types'

export default function HomePage() {
  const router = useRouter()
  const [skills,     setSkills]     = useState<Skill[]>([])
  const [selected,   setSelected]   = useState<Skill | null>(null)
  const [file,       setFile]       = useState<File | null>(null)
  const [textInputs, setTextInputs] = useState('')
  const [dragging,   setDragging]   = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')

  useEffect(() => {
    fetchSkills().then(setSkills).catch(() => setError('无法连接后端服务'))
  }, [])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }

  const handleSubmit = async () => {
    if (!selected) return setError('请先选择一个 Skill')
    if (selected.input.some(i => i.type === 'file' && i.required) && !file)
      return setError('请上传文件')
    setLoading(true)
    setError('')
    try {
      const { task_id } = await createTask(selected.id, file, textInputs)
      router.push(`/task/${task_id}`)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  const acceptedExts = selected?.input
    .filter(i => i.type === 'file')
    .flatMap(i => i.accept ?? [])
    .join(',') ?? '*'

  const hasTextInput = selected?.input.some(i => i.type === 'text')
  const textInputDef = selected?.input.find(i => i.type === 'text')

  return (
    <main className="min-h-screen bg-[#0f1117] text-white flex flex-col items-center justify-center px-4 py-16">

      {/* 标题 */}
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-3">
          <span className="text-[#7c6aff]">Agent</span> 平台
        </h1>
        <p className="text-[#8b8fa8] text-base">选择 Skill，上传文件，让 AI 替你完成分析</p>
      </div>

      <div className="w-full max-w-2xl space-y-6">

        {/* Skill 选择 */}
        <section>
          <p className="text-xs text-[#8b8fa8] uppercase tracking-widest mb-3">选择 Skill</p>
          <div className="grid grid-cols-2 gap-3">
            {skills.length === 0 && (
              <div className="col-span-2 text-[#8b8fa8] text-sm py-6 text-center">
                {error || '加载中…'}
              </div>
            )}
            {skills.map(skill => (
              <button
                key={skill.id}
                onClick={() => {
                  setSelected(skill)
                  setFile(null)
                  setTextInputs('')
                  setError('')
                }}
                className={`
                  flex items-start gap-3 p-4 rounded-xl border text-left transition-all
                  ${selected?.id === skill.id
                    ? 'border-[#7c6aff] bg-[#7c6aff]/10'
                    : 'border-[#1e2030] bg-[#161824] hover:border-[#7c6aff]/50'}
                `}
              >
                <span className="text-2xl mt-0.5">{skill.icon}</span>
                <div>
                  <div className="font-medium text-sm">{skill.name}</div>
                  <div className="text-[#8b8fa8] text-xs mt-0.5 line-clamp-2">
                    {skill.description}
                  </div>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {skill.tags.map(t => (
                      <span key={t} className="text-[10px] bg-[#1e2030] text-[#8b8fa8] px-2 py-0.5 rounded-full">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* 文件上传 */}
        {selected?.input.some(i => i.type === 'file') && (
          <section>
            <p className="text-xs text-[#8b8fa8] uppercase tracking-widest mb-3">上传文件</p>
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              className={`
                relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all
                ${dragging
                  ? 'border-[#7c6aff] bg-[#7c6aff]/5'
                  : file
                    ? 'border-[#7c6aff]/50 bg-[#161824]'
                    : 'border-[#1e2030] bg-[#161824] hover:border-[#7c6aff]/50'}
              `}
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <input
                id="file-input"
                type="file"
                className="hidden"
                accept={acceptedExts}
                onChange={e => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div>
                  <div className="text-2xl mb-2">📎</div>
                  <div className="font-medium text-sm">{file.name}</div>
                  <div className="text-[#8b8fa8] text-xs mt-1">
                    {(file.size / 1024).toFixed(0)} KB
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-2xl mb-2">☁️</div>
                  <div className="text-sm text-[#8b8fa8]">
                    拖拽文件到这里，或 <span className="text-[#7c6aff]">点击选择</span>
                  </div>
                  <div className="text-xs text-[#4b4f6a] mt-1">
                    支持 {selected.input.find(i => i.type === 'file')?.accept?.join(' / ')}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* 文本输入 */}
        {hasTextInput && (
          <section>
            <p className="text-xs text-[#8b8fa8] uppercase tracking-widest mb-3">
              {textInputDef?.label ?? '补充说明'}
              {!textInputDef?.required && (
                <span className="ml-2 normal-case text-[#4b4f6a]">（可选）</span>
              )}
            </p>
            <textarea
              value={textInputs}
              onChange={e => setTextInputs(e.target.value)}
              placeholder={`请输入${textInputDef?.label ?? '补充说明'}…`}
              rows={3}
              className="w-full bg-[#161824] border border-[#1e2030] rounded-xl px-4 py-3
                         text-sm text-white placeholder-[#4b4f6a] resize-none
                         focus:outline-none focus:border-[#7c6aff]/60 transition-colors"
            />
          </section>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {/* 提交按钮 */}
        <button
          onClick={handleSubmit}
          disabled={loading || !selected}
          className="w-full py-3.5 bg-[#7c6aff] hover:bg-[#6b59ee] disabled:opacity-40
                     disabled:cursor-not-allowed rounded-xl font-medium transition-all
                     text-sm tracking-wide"
        >
          {loading ? '启动中…' : '开始执行'}
        </button>
      </div>
    </main>
  )
}
