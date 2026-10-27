import { useI18n } from '#/components/locale-provider'
import { cn } from 'cn'

/** Original logo geometry with brandbook colors; CSS selects the theme before hydration. */
export function BrandLogo({
  compact = false,
  wordmark = false,
  className,
}: {
  compact?: boolean
  wordmark?: boolean
  className?: string
}) {
  const { t, locale } = useI18n()

  const asset = compact
    ? 'marzgah-symbol-small'
    : wordmark
      ? 'marzgah-wordmark-fa'
      : locale === 'en'
        ? 'marzgah-horizontal-en'
        : 'marzgah-horizontal'
  const width = compact
    ? 256
    : wordmark
      ? 991
      : locale === 'en'
        ? 671.67
        : 605.86
  const height = compact ? 256 : wordmark ? 446 : 200

  return (
    <span
      role="img"
      aria-label={t('مرزگاه')}
      className={cn('inline-block', compact ? 'size-8' : 'w-36', className)}
    >
      <img
        src={`/brand/${asset}-color.svg`}
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        className="block h-auto w-full dark:hidden"
        draggable={false}
      />
      <img
        src={`/brand/${asset}-dark.svg`}
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        className="hidden h-auto w-full dark:block"
        draggable={false}
      />
    </span>
  )
}
