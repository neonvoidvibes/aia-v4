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
  eventTypes?: Record<string, string> // needed to identify personal vs group events
}) {
  const { currentEventId, events, onChange, labelForEvent, mainEvents, breakoutEvents, eventTypes = {} } = props
  const hasSplit = Array.isArray(mainEvents) && Array.isArray(breakoutEvents)

  if (!hasSplit) {
    // Legacy path: render flat list
    return (
      <DropdownMenuContent align="center" className="max-h-64 overflow-y-auto">
        <DropdownMenuRadioGroup value={currentEventId} onValueChange={onChange}>
          {events.map((evt) => (
            <DropdownMenuRadioItem key={evt} value={evt} className="pr-8">
              {labelForEvent(evt)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    )
  }

  // New path: render with proper separators between personal, '0000', group, and breakout
  const personalEvents = mainEvents!.filter(ev => eventTypes[ev] === 'personal')
  const hasTeamspace = mainEvents!.includes('0000')
  const groupEvents = mainEvents!.filter(ev => ev !== '0000' && eventTypes[ev] !== 'personal')

  return (
    <DropdownMenuContent align="center" className="max-h-64 overflow-y-auto">
      <DropdownMenuRadioGroup value={currentEventId} onValueChange={onChange}>
        {/* Personal events */}
        {personalEvents.map((evt) => (
          <DropdownMenuRadioItem key={evt} value={evt} className="pr-8">
            {labelForEvent(evt)}
          </DropdownMenuRadioItem>
        ))}

        {/* Separator after personal (if any) */}
        {personalEvents.length > 0 && <DropdownMenuSeparator />}

        {/* Teamspace '0000' */}
        {hasTeamspace && (
          <DropdownMenuRadioItem key="0000" value="0000" className="pr-8">
            {labelForEvent('0000')}
          </DropdownMenuRadioItem>
        )}

        {/* Separator after '0000' (if group events exist) */}
        {hasTeamspace && groupEvents.length > 0 && <DropdownMenuSeparator />}

        {/* Group events */}
        {groupEvents.map((evt) => (
          <DropdownMenuRadioItem key={evt} value={evt} className="pr-8">
            {labelForEvent(evt)}
          </DropdownMenuRadioItem>
        ))}

        {/* Separator before breakout (if any breakout events) */}
        {breakoutEvents!.length > 0 && <DropdownMenuSeparator />}

        {/* Breakout events */}
        {breakoutEvents!.map((evt) => (
          <DropdownMenuRadioItem key={evt} value={evt} className="pr-8">
            {labelForEvent(evt)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  )
}
