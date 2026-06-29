/** 页面占位组件 —— 后续任务填充实际内容 */
export default function PagePlaceholder({ name }: { name: string }) {
  return (
    <div className="max-w-content mx-auto px-6 py-16">
      <h1 className="font-display text-3xl font-bold mb-3">{name}</h1>
      <p className="text-fg-muted">该页面将在后续任务中实现。</p>
    </div>
  );
}
