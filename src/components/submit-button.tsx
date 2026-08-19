'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

type Props = React.ComponentProps<typeof Button> & { pendingLabel?: string }

export function SubmitButton({ children, pendingLabel, ...props }: Props) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" {...props} disabled={pending || props.disabled}>
      {pending ? (pendingLabel ?? 'Working…') : children}
    </Button>
  )
}
