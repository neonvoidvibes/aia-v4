// Renders the event dropdown (radio group) using page state via props
import React from 'react'
import {
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'

export function EventSelectorContent(props: {
  currentEventId: string
  events: string[]            // legacy path (still supported)
  mainEvents?: string[]       // new: non-breakout, alphabetically sorted
  breakoutEvents?: string[]   // new: breakout=true, alphabetically sorted
  onChange: (nextId: string) => void
  labelForEvent: (e?: string | null) => string
}) {
  const { currentEventId, events, onChange, labelForEvent, mainEvents, breakoutEvents } = props
  const hasSplit = Array.isArray(mainEvents) && Array.isArray(breakoutEvents)

  return (
    <DropdownMenuContent align="center" className="max-h-64 overflow-y-auto">
      <DropdownMenuRadioGroup value={currentEventId} onValueChange={onChange}>
        {(hasSplit ? mainEvents! : events).map((evt) => (
          <DropdownMenuRadioItem key={evt} value={evt} className="pr-8">
            {labelForEvent(evt)}
          </DropdownMenuRadioItem>
        ))}
        {hasSplit && breakoutEvents!.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {breakoutEvents!.map((evt) => (
              <DropdownMenuRadioItem key={evt} value={evt} className="pr-8">
                {labelForEvent(evt)}
              </DropdownMenuRadioItem>
            ))}
          </>
        )}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  )
}
