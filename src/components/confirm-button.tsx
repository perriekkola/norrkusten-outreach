'use client'

import { useState } from 'react'
import { Spinner } from '@/components/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/**
 * Confirms before running an action that cannot be undone. Works with a server action
 * taking FormData: the extra fields are passed as `payload`, so callers don't need a form.
 */
export function ConfirmButton({
  action,
  payload,
  children,
  title,
  description,
  confirmLabel = 'Confirm',
  pendingLabel = 'Working…',
  variant = 'ghost',
  size = 'sm',
  className,
  disabled,
}: {
  action: (formData: FormData) => Promise<void>
  payload: Record<string, string | number | (string | number)[]>
  children: React.ReactNode
  title: string
  description: string
  confirmLabel?: string
  pendingLabel?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function run() {
    setPending(true)
    const formData = new FormData()
    for (const [key, value] of Object.entries(payload)) {
      for (const item of Array.isArray(value) ? value : [value]) formData.append(key, String(item))
    }
    try {
      await action(formData)
      setOpen(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled || pending}
        onClick={() => setOpen(true)}
      >
        {pending ? <Spinner /> : null}
        {pending ? pendingLabel : children}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void run()
              }}
              disabled={pending}
            >
              {pending ? <Spinner /> : null}
              {pending ? pendingLabel : confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
