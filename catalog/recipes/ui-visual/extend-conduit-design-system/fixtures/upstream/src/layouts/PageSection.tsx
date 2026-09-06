import { cn } from '@/lib/utils'

interface PageSectionProps {
  children: React.ReactNode
  width?: 'wide' | 'normal' | 'narrow' | 'xNarrow' | 'full'
  gap?: 'none' | 'sm' | 'md' | 'lg'
  className?: string
  sectionClassName?: string
}

const PageSection: React.FC<PageSectionProps> = ({
  children,
  width = 'wide',
  gap = 'md',
  className,
  sectionClassName
}) => {
  const widthClass = {
    full: 'max-w-full',
    wide: 'max-w-7xl',
    normal: 'max-w-4xl',
    narrow: 'max-w-2xl',
    xNarrow: 'max-w-xl'
  }[width]

  const gapClass = {
    none: 'gap-0',
    sm: 'gap-2',
    md: 'gap-4',
    lg: 'gap-6'
  }[gap]

  const innerColumnClassName = cn(
    'w-full mx-auto grid py-8 px-4',
    gapClass,
    widthClass,
    className
  )
  return (
    <section className={sectionClassName}>
      <div className={innerColumnClassName}>{children}</div>
    </section>
  )
}

export default PageSection
