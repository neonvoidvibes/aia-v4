"use client";

import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLocalization } from '@/context/LocalizationContext';

interface ActionTooltipProps {
  label?: string; // For dynamic labels like "Copied!"
  labelKey?: string; // For static, translatable labels
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

/**
 * A standardized tooltip component for action icons.
 * This should be used for all icon-based tooltips to ensure UI consistency.
 * It uses a centralized string dictionary for labels to prepare for future localization.
 *
 * @param label - A direct string label. Takes precedence over labelKey.
 * @param labelKey - The key for the label string (e.g., "tooltips.copy").
 * @param children - The trigger element for the tooltip (usually a button with an icon).
 * @param side - The preferred side of the trigger to render against.
 * @param align - The preferred alignment against the trigger.
 */
export function ActionTooltip({
  label,
  labelKey,
  children,
  side = 'bottom',
  align = 'center',
}: ActionTooltipProps) {
  const { t } = useLocalization();
  // `label` prop takes precedence over `labelKey`
  const displayText = label || (labelKey ? t(labelKey) : '');

  // If there's no label text to display, don't wrap the children in a tooltip.
  if (!displayText) {
    return <>{children}</>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={6}
        className="rounded-md bg-zinc-900 text-white px-2.5 py-1 text-xs font-semibold border-none"
        collisionPadding={10}
      >
        <p>{displayText}</p>
      </TooltipContent>
    </Tooltip>
  );
}
