"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Loader2, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/utils/supabase/client"

interface ConsentViewProps {
  workspaceId: string;
  workspaceName: string;
  onConsentGiven: () => void;
}

export default function ConsentView({ workspaceId, workspaceName, onConsentGiven }: ConsentViewProps) {
  const [hasAgreed, setHasAgreed] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingContent, setIsLoadingContent] = useState(true)
  const [title, setTitle] = useState<string>("Terms and Conditions")
  const [contentMarkdown, setContentMarkdown] = useState<string>("")
  const [requireScrollToEnd, setRequireScrollToEnd] = useState<boolean>(true)
  const [isAtBottom, setIsAtBottom] = useState<boolean>(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Minimal, safe-ish markdown renderer for headings/lists/strong/inline code
  const renderMarkdown = (md: string): string => {
    if (!md) return ""

    const escapeHtml = (s: string) => s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")

    // Handle fenced code blocks first
    let html = ""
    const lines = md.replace(/\r\n?/g, "\n").split("\n")
    let inCode = false
    let codeLang = ""
    let buffer: string[] = []
    const flushParagraph = () => {
      if (buffer.length) {
        html += `<p class="mb-3 leading-relaxed">${buffer.join(" ")}</p>`
        buffer = []
      }
    }
    let inUL = false
    let inOL = false
    const closeLists = () => {
      if (inUL) { html += "</ul>"; inUL = false }
      if (inOL) { html += "</ol>"; inOL = false }
    }

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const line = raw.trimEnd()
      if (line.startsWith("```") || line.startsWith("~~~")) {
        if (!inCode) {
          flushParagraph(); closeLists()
          inCode = true
          codeLang = line.replace(/^[`~]+\s*/, "").trim()
          html += `<pre class="mb-3"><code>`
        } else {
          inCode = false
          html += `</code></pre>`
        }
        continue
      }
      if (inCode) { html += `${escapeHtml(raw)}\n`; continue }

      // Headings
      const hMatch = line.match(/^(#{1,3})\s+(.*)$/)
      if (hMatch) {
        flushParagraph(); closeLists()
        const level = hMatch[1].length
        const text = hMatch[2]
        const size = level === 1 ? "text-2xl" : level === 2 ? "text-xl" : "text-lg"
        const mt = level === 1 ? "mt-1" : "mt-6"
        html += `<h${level} class="${size} font-semibold ${mt} mb-2">${escapeHtml(text)}</h${level}>`
        continue
      }

      // Lists: unordered "- " and ordered like "1. " or "1) "
      const ulMatch = line.match(/^[-•]\s+(.*)$/)
      const olMatch = line.match(/^\d+[\.)]\s+(.*)$/)
      if (ulMatch) {
        flushParagraph()
        if (!inUL) { closeLists(); html += '<ul class="list-disc pl-5 space-y-1 mb-3">'; inUL = true }
        html += `<li>${escapeHtml(ulMatch[1])}</li>`
        continue
      }
      if (olMatch) {
        flushParagraph()
        if (!inOL) { closeLists(); html += '<ol class="list-decimal pl-5 space-y-1 mb-3">'; inOL = true }
        html += `<li>${escapeHtml(olMatch[1])}</li>`
        continue
      }

      // Blank line: close lists and flush paragraph
      if (line.trim() === "") {
        closeLists(); flushParagraph(); continue
      }

      // Inline formatting for non-list lines collected as paragraphs
      const withCode = escapeHtml(line).replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-muted text-muted-foreground">$1</code>')
      const withStrong = withCode.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      const withEm = withStrong.replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<em>$2</em>')
      buffer.push(withEm)
    }
    closeLists(); flushParagraph()
    return html
  }

  // Render full markdown content in original order (no extraction)

  useEffect(() => {
    const supabase = createClient()
    const load = async () => {
      try {
        // Try by workspace_id first, then fallback to slug ikea-pilot
        const byId = await supabase
          .from('workspace_consent_configs')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('is_active', true)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle()

        let cfg = byId.data
        if (!cfg) {
          const bySlug = await supabase
            .from('workspace_consent_configs')
            .select('*')
            .eq('workspace_slug', 'ikea-pilot')
            .eq('is_active', true)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle()
          cfg = bySlug.data || null
        }

        if (cfg) {
          setTitle(cfg.title || 'Terms and Conditions')
          setContentMarkdown(cfg.content_markdown || '')
          setRequireScrollToEnd(cfg.require_scroll_to_end ?? true)
        } else {
          // Fallback to minimal generic text
          setTitle('Terms and Conditions')
          setContentMarkdown('Please review and accept the terms to continue.')
          setRequireScrollToEnd(false)
        }
      } catch (e) {
        console.warn('Failed to load consent config', e)
        toast.warning('Could not load consent text. Showing fallback.')
        setTitle('Terms and Conditions')
        setContentMarkdown('Please review and accept the terms to continue.')
        setRequireScrollToEnd(false)
      } finally {
        setIsLoadingContent(false)
      }
    }
    load()
  }, [workspaceId])

  // Recalculate bottom state after content renders
  useEffect(() => {
    if (!isLoadingContent) {
      requestAnimationFrame(() => handleScroll())
    }
  }, [isLoadingContent, contentMarkdown])

  const handleConsent = async () => {
    if (!hasAgreed) {
      toast.error("Please agree to the terms before continuing.");
      return;
    }

    setIsSubmitting(true);
    
    try {
      const response = await fetch('/api/user/consent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workspaceId })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to record consent');
      }

      toast.success("Terms accepted successfully.");
      onConsentGiven();
      
    } catch (error) {
      const message = error instanceof Error ? error.message : "An error occurred while recording your consent.";
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
    setIsAtBottom(atBottom)
  }

  const scrollToEnd = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }

  const fullHtml = useMemo(() => renderMarkdown(contentMarkdown), [contentMarkdown])

  return (
    <div className="w-full flex items-center justify-center min-h-screen bg-background px-4">
      <Card className="w-full max-w-3xl max-h-[92vh] flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>
            Granska och godkänn villkoren för {workspaceName}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-4 pt-2">
          {isLoadingContent ? (
            <div className="flex items-center text-muted-foreground"><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Loading policy…</div>
          ) : (
            <div className="relative">
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="max-h-[62vh] md:max-h-[66vh] overflow-auto rounded-md border border-border p-4 bg-muted/20"
              >
                <div className="text-[15px] leading-relaxed space-y-3 policy-markdown pb-16" dangerouslySetInnerHTML={{ __html: fullHtml }} />
              </div>
              {!isAtBottom && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent rounded-b-md" />
              )}
              {!isAtBottom && (
                <button
                  type="button"
                  onClick={scrollToEnd}
                  className="absolute bottom-3 right-3 inline-flex items-center rounded-full bg-primary text-primary-foreground shadow hover:opacity-90 transition-opacity h-10 w-10 justify-center"
                  aria-label="Scroll to end"
                >
                  <ChevronDown className="h-5 w-5" />
                </button>
              )}
            </div>
          )}

          <div className="sticky bottom-0 z-10 -mx-6 px-6 pt-3 pb-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 border-t">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="consent-checkbox"
                  checked={hasAgreed}
                  onCheckedChange={(checked) => setHasAgreed(checked === true)}
                  disabled={isSubmitting || (requireScrollToEnd && !isAtBottom)}
                  className="h-[18px] w-[18px] rounded-[3px] mt-1"
                />
                <div className="space-y-1">
                  <Label htmlFor="consent-checkbox" className="text-[15px] font-medium leading-snug">
                    Jag godkänner villkoren och integritetspolicyn
                  </Label>
                  {requireScrollToEnd && (
                    !isAtBottom ? (
                      <div className="text-xs text-muted-foreground">Scrolla till slutet för att aktivera godkännandet.</div>
                    ) : (
                      <div className="text-xs text-transparent select-none" aria-hidden="true">&nbsp;</div>
                    )
                  )}
                </div>
              </div>
              <div className="flex items-center">
                <Button
                  onClick={handleConsent}
                  disabled={!hasAgreed || isSubmitting}
                  className="min-w-[160px]"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Bearbetar…
                    </>
                  ) : (
                    "Godkänn och fortsätt"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
