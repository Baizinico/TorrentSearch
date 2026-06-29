/**
 * 徽章组件 —— 基于 .badge 组件类的薄封装，提供色彩变体。
 */
import type { ReactNode } from 'react';
import clsx from 'clsx';

export type BadgeVariant =
  | 'default'
  | 'accent'
  | 'cyan'
  | 'danger'
  | 'success'
  | 'nsfw';

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
  title?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-bg-hover text-fg-muted border border-border',
  accent: 'bg-accent/15 text-accent border border-accent/40',
  cyan: 'bg-cyan/15 text-cyan border border-cyan/40',
  danger: 'bg-danger/15 text-danger border border-danger/40',
  success: 'bg-success/15 text-success border border-success/40',
  nsfw: 'bg-nsfw/15 text-nsfw border border-nsfw/40',
};

/** 小型徽章，用于类别、状态、安全标记等 */
export default function Badge({
  children,
  variant = 'default',
  className,
  title,
}: BadgeProps) {
  return (
    <span className={clsx('badge', variantClasses[variant], className)} title={title}>
      {children}
    </span>
  );
}
