import clsx from 'clsx';

interface SkeletonRowProps {
  className?: string;
}

/** 骨架行：模拟 TorrentRow 高度（约 72px），含标题、副信息与右侧圆形 */
export default function SkeletonRow({ className }: SkeletonRowProps) {
  return (
    <div
      className={clsx(
        'flex h-[72px] items-center gap-3 px-4',
        'animate-pulse',
        className,
      )}
    >
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-3.5 w-[70%] rounded bg-bg-hover" />
        <div className="h-3 w-[40%] rounded bg-bg-hover" />
      </div>
      <div className="h-9 w-9 shrink-0 rounded-full bg-bg-hover" />
    </div>
  );
}
