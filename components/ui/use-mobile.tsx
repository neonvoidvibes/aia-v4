import * as React from "react"

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const ua = navigator.userAgent || ""
    const isMobileUA =
      (navigator as any).userAgentData?.mobile === true ||
      /Android|iPhone|iPad|iPod/i.test(ua)
    setIsMobile(!!isMobileUA)
  }, [])

  return isMobile
}
