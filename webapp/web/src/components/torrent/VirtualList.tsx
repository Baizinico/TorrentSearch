/**
 * 虚拟滚动列表 —— 基于 @tanstack/react-virtual。
 */
import type { ReactNode, CSSProperties, RefObject } from 'react';
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';

export interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  renderRow: (item: T, index: number) => ReactNode;
  className?: string;
  height?: number | string;
  onScroll?: (scrollTop: number) => void;
  overscan?: number;
  /** 暴露内部滚动元素，供外部 programmatic 滚动使用 */
  scrollRef?: RefObject<HTMLDivElement>;
}

/** 虚拟滚动列表（固定行高） */
function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  className,
  height = '100%',
  onScroll,
  overscan = 5,
  scrollRef,
}: VirtualListProps<T>) {
  const innerRef = useRef<HTMLDivElement>(null);
  const parentRef = scrollRef ?? innerRef;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const totalSize = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className={clsx('overflow-auto', className)}
      style={{ height } as CSSProperties}
      onScroll={(e) => {
        onScroll?.((e.target as HTMLDivElement).scrollTop);
      }}
    >
      <div style={{ height: totalSize, position: 'relative' }}>
        {virtualItems.map((virtualRow) => {
          const item = items[virtualRow.index];
          if (item === undefined) return null;
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: virtualRow.start,
                height: rowHeight,
                width: '100%',
              }}
            >
              {renderRow(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualList;
