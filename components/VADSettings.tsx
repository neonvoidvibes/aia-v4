import * as React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import { useMobile } from "@/hooks/use-mobile";

export type VADAggressiveness = 1 | 2 | 3;

interface VADSettingsProps {
  aggressiveness: VADAggressiveness;
  onAggressivenessChange: (value: VADAggressiveness) => void;
}

export function VADSettings({ aggressiveness, onAggressivenessChange }: VADSettingsProps) {
  const isMobile = useMobile();
  const handleValueChange = (value: string) => {
    if (value) {
      const newAggressiveness = parseInt(value, 10) as VADAggressiveness;
      console.log(`[VAD TEST] Aggressiveness changed to: ${newAggressiveness}`);
      onAggressivenessChange(newAggressiveness);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <Label htmlFor="vad-aggressiveness-toggle">Sound Environment (VAD)</Label>
      <ToggleGroup
        type="single"
        id="vad-aggressiveness-toggle"
        value={aggressiveness.toString()}
        onValueChange={handleValueChange}
        className="rounded-md bg-muted p-1"
        aria-label="VAD Aggressiveness"
      >
        <ToggleGroupItem value="1" aria-label="Quiet" size="sm" className="px-3 data-[state=on]:bg-background data-[state=on]:text-foreground">
          {isMobile ? "Quiet" : "Quiet"}
        </ToggleGroupItem>
        <ToggleGroupItem value="2" aria-label="Balanced" size="sm" className="px-3 data-[state=on]:bg-background data-[state=on]:text-foreground">
          {isMobile ? "Balanced" : "Balanced"}
        </ToggleGroupItem>
        <ToggleGroupItem value="3" aria-label="Noisy" size="sm" className="px-3 data-[state=on]:bg-background data-[state=on]:text-foreground">
          {isMobile ? "Noisy" : "Noisy"}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
