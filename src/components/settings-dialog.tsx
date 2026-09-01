import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  BOUNDS,
  DEFAULT_SETTINGS,
  EVICTION_FACTORS,
  validate,
  type EvictionFactor,
  type Settings,
} from '@/lib/settings'
import { num } from '@/lib/format'

/** Draft values are strings so a half-typed number is not silently coerced. */
type Draft = { retention: string; evictionFactor: EvictionFactor; pageSize: string; sampleDelayMs: string }

const toDraft = (s: Settings): Draft => ({
  retention: String(s.retention),
  evictionFactor: s.evictionFactor,
  pageSize: String(s.pageSize),
  sampleDelayMs: String(s.sampleDelayMs),
})

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: Settings
  onSave: (next: Settings) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* The form holds the draft in mount-scoped state, so reopening shows what is
            stored rather than what was abandoned last time — no effect resetting it.
            The unmount comes from `DialogContent`'s portal, which renders nothing
            while closed (measured: an `{open && …}` guard here changed no test and
            no rendered output, so it is not carried). What guarantees the reset is
            the behaviour pinned in settings-dialog.test.tsx, not this line. */}
        <SettingsForm settings={settings} onSave={onSave} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function SettingsForm({
  settings,
  onSave,
  onDone,
}: {
  settings: Settings
  onSave: (next: Settings) => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings))

  const errors = {
    retention: validate('retention', draft.retention),
    pageSize: validate('pageSize', draft.pageSize),
    sampleDelayMs: validate('sampleDelayMs', draft.sampleDelayMs),
  }
  const invalid = Object.values(errors).some((e) => e !== null)

  function submit() {
    if (invalid) return
    onSave({
      retention: Number(draft.retention),
      evictionFactor: draft.evictionFactor,
      pageSize: Number(draft.pageSize),
      sampleDelayMs: Number(draft.sampleDelayMs),
    })
    onDone()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>
          Stored in this browser only. Trace history stays in IndexedDB and is never sent anywhere.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-4">
        <Field data-invalid={errors.retention !== null}>
          <FieldLabel htmlFor="pc-retention">Retention limit</FieldLabel>
          <Input
            id="pc-retention"
            type="number"
            min={BOUNDS.retention.min}
            value={draft.retention}
            aria-invalid={errors.retention !== null}
            onChange={(e) => setDraft((d) => ({ ...d, retention: e.target.value }))}
          />
          {errors.retention ? (
            <FieldError>{errors.retention}</FieldError>
          ) : (
            <FieldDescription>Rows kept in browser storage. Minimum {num(BOUNDS.retention.min)}.</FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor="pc-eviction">Eviction factor</FieldLabel>
          <ToggleGroup
            id="pc-eviction"
            spacing={0}
            value={[String(draft.evictionFactor)]}
            onValueChange={(next) => {
              // Single-select: an empty array means the pressed item was clicked
              // again. There is no "no factor", so keep the current one.
              const picked = Number(next[0])
              if (!Number.isNaN(picked)) setDraft((d) => ({ ...d, evictionFactor: picked as EvictionFactor }))
            }}
          >
            {EVICTION_FACTORS.map((f) => (
              <ToggleGroupItem
                key={f}
                value={String(f)}
                variant="outline"
                // The registry's pressed style is `bg-muted`, which on this card is
                // almost the card colour — measured on screen, the selected factor was
                // not identifiable. A mutually-exclusive choice has to show which one
                // is live, so the brand token carries it.
                className="flex-1 font-mono aria-pressed:border-brand/40 aria-pressed:bg-brand/15 aria-pressed:text-brand"
              >
                {f}&times;
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>
            {draft.evictionFactor === 1
              ? 'Removes only the overflow, so the store sits at the limit and prunes on every batch once full.'
              : `Removes ${draft.evictionFactor}× the incoming batch, so pruning runs less often — and the store holds fewer rows than the limit between prunes.`}
          </FieldDescription>
        </Field>

        <Field data-invalid={errors.pageSize !== null}>
          <FieldLabel htmlFor="pc-page-size">Load-older page size</FieldLabel>
          <Input
            id="pc-page-size"
            type="number"
            min={BOUNDS.pageSize.min}
            max={BOUNDS.pageSize.max}
            value={draft.pageSize}
            aria-invalid={errors.pageSize !== null}
            onChange={(e) => setDraft((d) => ({ ...d, pageSize: e.target.value }))}
          />
          {errors.pageSize ? (
            <FieldError>{errors.pageSize}</FieldError>
          ) : (
            <FieldDescription>
              Rows fetched per &ldquo;Load older&rdquo; click. {BOUNDS.pageSize.min}&ndash;
              {num(BOUNDS.pageSize.max)}.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.sampleDelayMs !== null}>
          <FieldLabel htmlFor="pc-sample-delay">Sample-data delay</FieldLabel>
          <Input
            id="pc-sample-delay"
            type="number"
            min={BOUNDS.sampleDelayMs.min}
            max={BOUNDS.sampleDelayMs.max}
            value={draft.sampleDelayMs}
            aria-invalid={errors.sampleDelayMs !== null}
            onChange={(e) => setDraft((d) => ({ ...d, sampleDelayMs: e.target.value }))}
          />
          {errors.sampleDelayMs ? (
            <FieldError>{errors.sampleDelayMs}</FieldError>
          ) : (
            <FieldDescription>
              How long a cold start waits for a platform before showing sample data, in ms.{' '}
              {BOUNDS.sampleDelayMs.min}&ndash;{num(BOUNDS.sampleDelayMs.max)}.
            </FieldDescription>
          )}
        </Field>
      </FieldGroup>

      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" onClick={() => setDraft(toDraft(DEFAULT_SETTINGS))}>
          Reset to defaults
        </Button>
        <div className="flex flex-row-reverse gap-2 sm:flex-row">
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={submit} disabled={invalid}>
            Save
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
