import React from 'react';
import { cn } from "@/lib/utils";

export const SlidersIcon = ({ size = 23, className }: { size?: number; className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn(className)}
  >
    <path d="M4 8h8" />
    <path d="M16 8h4" />
    <path d="M4 16h4" />
    <path d="M12 16h8" />
    <circle cx="14" cy="8" r="2.8" />
    <circle cx="10" cy="16" r="2.8" />
  </svg>
);
